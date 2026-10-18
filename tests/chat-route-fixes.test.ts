/**
 * Khoá hồi quy cho các bản sửa bug trong app/api/chat/route.ts.
 *
 * POST /api/chat đẩy cả pool key, hàng đợi gateway, streamText và data-stream
 * vào một hàm duy nhất — mock đủ tầng đó trong vitest thì test xanh vì mock
 * chứ không phải vì code đúng. Repo đã có pattern đọc-source
 * (tests/design-system.test.ts, tests/tool-trace.test.ts): khoá các điều kiện
 * sống còn bằng regex lên source. Bản cũ lỗi thì regex không khớp → ĐỎ ngay.
 *
 * Mỗi describe ghi rõ điều kiện đảo ngược nào làm test ĐỎ — đó là hợp đồng
 * của file này, không phải trang trí.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { looksLikePseudoError } from '@/lib/pseudo-error-response';
import { POST } from '@/app/api/chat/route';
import { streamText } from 'ai';
import { isToolUnsupported, resetToolSupportCache } from '@/lib/tool-support-cache';

vi.mock('@/lib/security', () => ({ checkSameOrigin: () => true }));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({ modelId })),
}));

/**
 * Lỗi upstream mà `streamText` sẽ phát lên data stream, và transcript mà
 * `generateText` (đường giả lập) nhận được. `vi.hoisted` vì `vi.mock` bị nâng
 * lên trên mọi import còn các biến này dùng trong factory.
 */
const upstream = vi.hoisted(() => ({
  message: '',
  /** Messages đường giả lập đưa lên SDK — None khi đường giả lập chưa chạy. */
  emulatedMessages: null as unknown,
}));

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText: vi.fn(
    () =>
      ({
        fullStream: (async function* () {
          yield { type: 'error', error: new Error(upstream.message) };
        })(),
      }) as unknown as ReturnType<typeof streamText>,
  ),
  generateText: vi.fn(async (opts: { messages: unknown[] }) => {
    upstream.emulatedMessages = opts.messages;
    return { text: 'trả lời đường giả lập', usage: { promptTokens: 1, completionTokens: 1 } };
  }),
}));

const ROUTE_PATH = path.resolve(__dirname, '../app/api/chat/route.ts');
// CRLF → LF một lần: file trên đĩa là CRLF (core.autocrlf) và regex dưới đây
// viết theo giả định nguồn là LF. Bản cũ không normalize, chỉ sống sót vì
// các pattern của nó đều có `\s*\n` nên `\r` bị `\s*` nuốt — hễ một
// assertion bám `\n` trực tiếp là đỏ trên máy khác.
const source = fs.readFileSync(ROUTE_PATH, 'utf8').replace(/\r\n/g, '\n');

/** Lỗi trá hình THẬT của gateway (HTTP 200 + finish 'stop' + nội dung lỗi). */
const REAL_GATEWAY_ERROR =
  '\n\n[Notion is currently unavailable — tried 22 accounts over 0s, every account ' +
  "tried is over its usage cap for this model right now. This usually clears within a " +
  "few minutes as the account pool refreshes; try again shortly, or shorten/simplify " +
  "the prompt if it's very large. If it keeps happening, report it in the Discord.]";

/**
 * Bug 1 (A3) + Bug 2 (A5): đường GIẢ LẬP tool (emulatedMode do negative-cache
 * tool-support, hoặc retryAsEmulated sau khi gateway chê field `tools`) vẫn
 * phải nhận ĐỦ server tools + MCP tools. Bản cũ điều kiện chỉ là
 * `allowAgentTools || forceEmulatedTools`: vào emulated do isToolUnsupported
 * đặt allowAgentTools=false thì serverTools={} và mcpTools=mapMcpTools([]) —
 * model mất trắng web_search/web_fetch/memory_save và
 * toàn bộ tool MCP mà không có thông báo nào.
 *
 * Đảo điều kiện (bỏ `emulatedToolPath` khỏi một trong hai ternary) → cả
 * describe này ĐỎ.
 */
describe('A3/A5 — đường emulated vẫn đủ server tools + MCP tools', () => {
  it('điều kiện build serverTools/mcpTools có đủ nhánh emulatedToolPath', () => {
    expect(source).toMatch(
      /const emulatedToolPath = emulatedMode \|\| retryAsEmulated;/,
    );
    expect(source).toMatch(
      /const serverTools = allowAgentTools \|\| forceEmulatedTools \|\| emulatedToolPath\s*\n\s*\? buildAgentTools\(\{/,
    );
    expect(source).toMatch(
      /const mcpTools = allowAgentTools \|\| forceEmulatedTools \|\| emulatedToolPath\s*\n\s*\? mapMcpTools\(mcpToolList \?\? \[\], undefined, mcpProxyToolList \?\? \[\]\)/,
    );
  });

  it('runEmulatedLoop nhận đúng serverTools + schema MCP qua extraToolDocs', () => {
    // Đường emulated không có kênh tool-call native: không đưa tools vào
    // runEmulatedLoop là model không bao giờ biết tool tồn tại.
    expect(source).toMatch(
      /tools: { ...serverTools, ...subRecipeToolDefs } as ReturnType<typeof buildAgentTools>,/,
    );
    // Meta-tools router cũng phải đi kèm: chúng không có trong registry tĩnh
    // của formatToolProtocolManual nên thiếu là bị bỏ qua âm thầm (manual rỗng
    // cho đúng 2 tool này). Khoá: schema MCP + schema meta cùng đi một lệnh.
    // Nhiều dòng, và khớp TỪNG mục chứ không khớp cả khối: comment tiếng Việt chen
    // giữa các entry nên một regex duy nhất sẽ vỡ mỗi lần ai đó thêm giải thích.
    expect(source).toMatch(
      /extraToolDocs: \{\s*\n\s*\.\.\.mcpTools\.defs,\s*\n\s*\.\.\.routerMetaTools,/,
    );
    // `delegate` phải vào đây: nó không nằm trong registry tĩnh của agent-tools
    // (dựng động vì mô tả liệt kê agent trên đĩa). Thiếu nó thì model đường
    // emulated — tức model KHÔNG có native tool-calling — không thấy sub-agent nào.
    expect(source).toMatch(
      /\.\.\.\(delegateAvailable \? \{ delegate: buildDelegateTool\(agentRegistry\) \} : \{\}\),/,
    );
    expect(source).toMatch(/clientTools: clientToolNames,/);
  });
});

describe('media generation retirement', () => {
  it('removes generation endpoints, SSE parsing and Pollinations fallback', () => {
    expect(source).not.toMatch(/pollinations|images\/generations|emitMedia|pumpSseData|coreToOpenAiMessages/i);
    expect(source).not.toMatch(/VIDEO_BUDGET_MS|isVideoModel|isImageModel/);
    expect(source).toContain('MEDIA_GENERATION_RETIRED');
  });
});

/**
 * Bug 4 (A10): đường native nhận finish/step-finish MỖI vòng tool — bản cũ
 * gán đè `usage = part.usage...` nên lượt agent nhiều step chỉ còn usage của
 * step cuối (undercount thống kê).
 *
 * Sửa tiếp: `ai@4` gộp sẵn các step thành `finish` (combinedUsage), nên cộng
 * THÊM `step-finish` vào phép cộng đếm mọi step trừ step cuối HAI LẦN — thống
 * kê và cost phình 2× (lượt một step cũng ra đúng 2P). Nay `finish` giữ phép
 * cộng dồn (tổng đã tính, đúng cho cost) còn `step-finish` chỉ gán vào
 * `lastStepUsage` (kích thước request cuối, đúng cho ngưỡng nén ngữ cảnh).
 *
 * Đảo điều kiện (gộp lại `case 'step-finish'` vào `case 'finish'`) →
 * describe này ĐỎ.
 */
describe('A10 — usage native: tổng để tính tiền, step cuối cho ngưỡng nén', () => {
  it('chỉ `finish` cộng dồn; `step-finish` là nhánh riêng', () => {
    expect(source).toMatch(
      /case 'finish':\s*\n[\s\S]*?usage = \{\s*\n\s*promptTokens: \(usage\?\.promptTokens \?\? 0\) \+ \(part\.usage\.promptTokens \?\? 0\),\s*\n\s*completionTokens: \(usage\?\.completionTokens \?\? 0\) \+ \(part\.usage\.completionTokens \?\? 0\),/,
    );
    // `step-finish` KHÔNG được nằm chung nhánh với `finish` nữa.
    expect(source).not.toMatch(/case 'finish':\s*\n\s*case 'step-finish':/);
  });

  it('`step-finish` gán đè vào lastStepUsage (giữ step CUỐI)', () => {
    expect(source).toMatch(
      /case 'step-finish':\s*\n[\s\S]*?lastStepUsage = \{\s*\n\s*promptTokens: part\.usage\.promptTokens \?\? 0,/,
    );
  });

  it('lastStepUsage được gửi riêng cho client qua annotation', () => {
    expect(source).toMatch(/writeAnnotation\(\{ lastStepUsage \}\)/);
  });

  it('đường emulated cộng dồn tổng VÀ gán lastStepUsage theo round', () => {
    expect(source).toMatch(
      /onUsage: \(u\) => \{[\s\S]*?promptTokens: \(usage\?\.promptTokens \?\? 0\) \+ \(u\.promptTokens \?\? 0\),/,
    );
    expect(source).toMatch(
      /onUsage: \(u\) => \{[\s\S]*?lastStepUsage = \{\s*\n\s*promptTokens: u\.promptTokens \?\? 0,/,
    );
  });
});

/**
 * Bug 5 (A13): `isLastModelInChain` phải so VỊ TRÍ (modelIndex === length-1)
 * chứ không so GIÁ TRỊ (targetModel === modelChain[length-1]) — chain có thể
 * chứa cùng một tên model ở nhiều vị trí; so giá trị khiến ô giữa chain bị
 * coi là "model cuối", failover dừng sớm và bỏ sót phần chain còn lại.
 *
 * Đảo điều kiện (đổi về so giá trị) → describe này ĐỎ (regex khớp dạng
 * modelIndex không còn, dạng targetModel bị not.toMatch chặn).
 */
describe('A13 — isLastModelInChain so vị trí, không so giá trị', () => {
  it('khai báo theo modelIndex', () => {
    expect(source).toMatch(
      /const isLastModelInChain = modelIndex === modelChain\.length - 1;/,
    );
  });

  it('không còn dạng so giá trị của bản cũ', () => {
    expect(source).not.toMatch(
      /isLastModelInChain = targetModel ===/,
    );
  });
});

/**
 * Bug 6 (A14): reasoningEffort phải tính theo model THẬT của từng ô failover
 * (targetModel trong vòng lặp). Bản cũ tính MỘT LẦN ngoài vòng lặp từ model
 * user chọn, và biến ngoài đó shadow tên `targetModel` — sau failover mức
 * reasoning của model cũ vẫn được gửi theo model mới.
 *
 * Đảo điều kiện (kéo khai báo ra ngoài vòng lặp / đặt lại shadow) → describe
 * này ĐỎ: hoặc khai báo đứng cạnh emulatedMode (bị not.toMatch chặn), hoặc
 * vị trí ra khỏi khoảng [vòng lặp modelIndex .. streamText].
 */
describe('A14 — reasoningEffort tính theo targetModel trong từng ô failover', () => {
  it('biến model-được-chọn đổi tên, hết shadow targetModel', () => {
    expect(source).toMatch(/const selectedProviderModel = modelConfig\.providerModel;/);
    expect(source).not.toMatch(/const targetModel = modelConfig\.providerModel;/);
  });

  it('không còn khối tính reasoningEffort ngay sau emulatedMode (vị trí cũ ngoài vòng lặp)', () => {
    expect(source).not.toMatch(
      /const emulatedMode = \(agentTools \?\? true\) && !allowAgentTools;\s*\nlet reasoningEffort/,
    );
  });

  it('reasoningEffort khai báo đúng MỘT lần, nằm TRONG vòng lặp model trước streamText', () => {
    const decls = source.match(/let reasoningEffort: ThinkingLevel \| null = null;/g) ?? [];
    expect(decls).toHaveLength(1);

    const declAt = source.indexOf('let reasoningEffort: ThinkingLevel | null = null;');
    const loopAt = source.indexOf('for (let modelIndex = 0;');
    const streamAt = source.indexOf('const result = streamText(');
    expect(declAt).toBeGreaterThan(loopAt);
    expect(declAt).toBeLessThan(streamAt);

    // Tra capability theo model ĐANG gọi của ô này, không theo model user chọn,
    // VÀ phải kèm apiKey: hàm fetch `${base}/models`, mọi provider đều BYOK —
    // thiếu `Authorization` thì gateway 401, `cap` null và mức suy luận người
    // dùng chọn bị bỏ âm thầm. Đoạn gọi nhiều dòng là chủ ý (prettier).
    expect(source).toMatch(
      /const cap = await getReasoningCapability\(\s*effortBase,\s*targetModel,\s*apiKey,?\s*\);/,
    );
  });
});

/**
 * Bug 7 (A15): trần dài tên model ở BodySchema phải là 120 (khớp validator
 * provider-override `{1,120}` và lib/store.ts). Bản cũ `max(64)` từ chối model
 * `vendor/repo/name` dài hợp lệ mà mọi tầng sau đều chấp nhận.
 *
 * Đảo điều kiện (đổi về max(64)) → describe này ĐỎ.
 */
describe('A15 — trần tên model 120 ký tự', () => {
  it('schema cho phép 120, không còn 64', () => {
    expect(source).toMatch(/model: z\.string\(\)\.min\(1\)\.max\(120\)\.optional\(\)/);
    expect(source).not.toMatch(/model: z\.string\(\)\.min\(1\)\.max\(64\)/);
    // Validator provider-override cũng phải đồng bộ 120 (dùng chuỗi literal
    // thay regex: ký tự `/` trong character class khó đọc khi escape).
    // Character class đã nới thêm space (Bug 11) — trần 120 giữ nguyên.
    expect(source).toContain('/^[\\w.\\-:~/ ]{1,120}$/');
  });
});

/**
 * Bug 8 (A16): UPSTREAM_POOL_EXHAUSTED phải trả ĐÚNG mã + thông điệp "hết
 * dung lượng" — ChatUpstreamError không mang status, rơi vào
 * diagnoseUpstreamError sẽ bị gán nhầm "Không kết nối được tới AI Provider".
 * Bản cũ ở ô cuối không thoát sớm nên diagnosis ghi đè thông điệp.
 *
 * Đảo điều kiện (xoá `throw e` / để lỗi chảy xuống diagnoseUpstreamError) →
 * describe này ĐỎ: nhánh throw biến mất hoặc đứng sau diagnosis.
 */
describe('A16 — pool cạn giữ đúng mã UPSTREAM_POOL_EXHAUSTED', () => {
  const branchAt = source.indexOf(
    "if (e instanceof ChatUpstreamError && e.code === 'UPSTREAM_POOL_EXHAUSTED') {",
  );
  const diagnoseAt = source.indexOf('const diagnosis = diagnoseUpstreamError(');

  it('nhánh pool-exhausted tồn tại và xử lý TRƯỚC diagnoseUpstreamError', () => {
    expect(branchAt).toBeGreaterThan(-1);
    expect(diagnoseAt).toBeGreaterThan(-1);
    expect(branchAt).toBeLessThan(diagnoseAt);
  });

  it.skipIf(branchAt === -1)('chỉ failover khi còn ô; hết ô thì annotation + rethrow nguyên error', () => {
    const tail = source.slice(branchAt, branchAt + 2600);
    // Còn model/key kế tiếp (và lượt này chưa phát chữ nào) → chuyển tiếp,
    // không báo lỗi. `textCharsThisRequest()` là bộ đếm kênh TEXT của riêng
    // request này; `emittedChars` là offset TUYỐT ĐỐI trong message.content
    // client (đã cộng phần mang từ vòng client-tool trước) nên không dùng để
    // hỏi "lượt này có nói gì không".
    expect(tail).toMatch(
      /if \(textCharsThisRequest\(\) === 0 && !\(isLastModelInChain && isLastKeyAttempt\)\) \{/,
    );
    // Hết ô (hoặc pseudo-error lộ giữa luồng đã có token) → phát error part
    // rồi ném lại CHÍNH error gốc: giữ message "hết dung lượng" + mã.
    expect(tail).toContain("writeAnnotation({ error: 'UPSTREAM_POOL_EXHAUSTED' });");
    const throwAt = tail.indexOf('throw e;');
    expect(throwAt).toBeGreaterThan(-1);
    expect(tail.indexOf("writeAnnotation({ error: 'UPSTREAM_POOL_EXHAUSTED' });")).toBeLessThan(throwAt);
  });

  it('onError giữ nguyên message + mã của ChatUpstreamError cho người dùng', () => {
    expect(source).toMatch(
      /onError: \(err\) => \{\s*\n\s*if \(err instanceof ChatUpstreamError\) return `\$\{err\.message\} \[\$\{err\.code\}#\$\{err\.requestId\}\]`;/,
    );
  });
});

/**
 * Bug 9 (A22): buffer sniff đầu stream. Bản cũ ghì 120 ký tự trước khi nhả
 * token đầu. Bản mới ghì 40 ký tự (token đầu nhanh hơn) + sniff TIẾP cửa sổ
 * 600 ký tự sau khi đã nhả — pseudo-error ló ra giữa chừng vẫn ném
 * UPSTREAM_POOL_EXHAUSTED cho handler A16 ở trên.
 *
 * Đảo điều kiện: nâng SNIFF_HOLD_CHARS về ≥120 → test "hold < 120" ĐỎ (token
 * đầu chậm đi). Hạ hold xuống dưới độ dài khớp tối thiểu của payload thật
 * (~34) → test hành vi với lib ĐỎ (lỗ hổng bỏ sót lỗi thật). Xoá nhánh sniff
 * sau release → regex "phát hiện giữa luồng" ĐỎ.
 */
describe('A22 — sniff 40 ký tự đầu + cửa sổ 600 ký tự giữa luồng', () => {
  const hold = Number(source.match(/const SNIFF_HOLD_CHARS = (\d+);/)?.[1] ?? NaN);
  const windowChars = Number(source.match(/const SNIFF_WINDOW_CHARS = (\d+);/)?.[1] ?? NaN);

  it('tham số sniff tồn tại; hold thấp hơn ngưỡng cũ 120 → token đầu không chậm hơn xưa', () => {
    expect(Number.isFinite(hold)).toBe(true);
    expect(hold).toBeGreaterThan(0);
    expect(hold).toBeLessThan(120);
  });

  it('cửa sổ sniff giữa luồng đúng 600 — khớp cửa sổ tự soi của looksLikePseudoError', () => {
    expect(windowChars).toBe(600);
  });

  it('kiểm tra pseudo-error TRƯỚC khi quyết định nhả token (giữ lỗi < 40 ký tự)', () => {
    expect(source).toMatch(
      /if \(!sniffReleased\) \{\s*\n\s*sniffHead \+= String\(part\.textDelta \?\? ''\);\s*\n[\s\S]*?if \(looksLikePseudoError\(sniffHead\)\) throwPseudoError\(\);/,
    );
  });

  it('đã nhả token vẫn sniff tiếp trong cửa sổ — lỗi lộ GIỮA luồng có đường phát error', () => {
    expect(source).toMatch(
      /if \(sniffHead\.length < SNIFF_WINDOW_CHARS\) \{\s*\n\s*sniffHead \+= String\(part\.textDelta \?\? ''\);\s*\n\s*if \(looksLikePseudoError\(sniffHead\)\) throwPseudoError\(\);/,
    );
    // Đường phát error: throwPseudoError ném ChatUpstreamError đúng mã để
    // handler A16 bắt (annotation + rethrow), không rơi vào diagnosis chung.
    expect(source).toMatch(
      /const throwPseudoError = \(\) => \{\s*\n\s*throw new ChatUpstreamError\([\s\S]{0,400}'UPSTREAM_POOL_EXHAUSTED',/,
    );
  });

  it('hành vi thật: payload gateway thật khớp trong đúng cửa sổ hold — hạ hold sẽ hở lỗ', () => {
    expect(Number.isFinite(hold)).toBe(true);
    // Tiền tố ngắn nhất mà lib nhận diện được — đây là mức tối thiểu mà
    // route PHẢI tiếp tục soi trước khi nhả token.
    let minMatch = -1;
    for (let i = 1; i <= REAL_GATEWAY_ERROR.length; i++) {
      if (looksLikePseudoError(REAL_GATEWAY_ERROR.slice(0, i))) {
        minMatch = i;
        break;
      }
    }
    expect(minMatch).toBeGreaterThan(0);
    expect(minMatch).toBeLessThanOrEqual(hold);
  });
});

/**
 * Doc comment phải phản ánh runtime thật: route chạy Node.js
 * (`export const runtime = 'nodejs'`), thông báo chạm người dùng không được
 * đổ lỗi "Edge Function" nữa. Đảo điều kiện (đổi runtime hoặc hồi thông báo
 * cũ) → describe này ĐỎ.
 */
describe('doc — runtime Node.js, thông báo không nói sai "Edge Function"', () => {
  it("khai báo runtime = 'nodejs'", () => {
    expect(source).toMatch(/export const runtime = 'nodejs';/);
  });

  it('thông báo vượt ngân sách nói "phiên stream", không nói Edge Function', () => {
    expect(source).not.toMatch(/của Edge Function/);
    expect(source).toMatch(/của phiên stream và đã bị cắt\./);
  });
});
/**
 * Trần `toolInvocations` phải rộng và dùng hằng số, không để số cứng.
 *
 * Lỗi thật (đo từ log trình duyệt): trần để cứng 12 trong khi budget tool cho
 * phép nhiều hơn. Model gọi thứ 13 trong một lượt → server trả 400 BAD_SCHEMA
 * với `too_big / maximum: 12` → useChat nhận lỗi → vòng agent chết im lặng
 * giữa chừng, đúng triệu chứng "chạy được vài tool rồi đùng luôn".
 *
 * Lưu ý: sau khi bỏ trần lượt agent, đây là trần KÍCH THƯỚC payload
 * (MAX_TOOL_INVOCATIONS_PER_REQUEST), không còn gắn với budget theo lượt.
 *
 * Đảo điều kiện: dán .max(12) trở lại → describe này ĐỎ.
 */
describe('schema toolInvocations dùng hằng số, rộng cho lượt dài', () => {
  it('dùng hằng số chung, không để số cứng', () => {
    expect(source).toMatch(/\.max\(MAX_TOOL_INVOCATIONS_PER_REQUEST\)/);
  });

  it('không còn .max(12) cứng trên toolInvocations', () => {
    // Điều kiện đảo ngược: dán .max(12) trở lại là ĐỎ.
    expect(source).not.toMatch(/\.max\(12\)/);
  });

  it('hằng số đủ rộng cho một lượt agent dài', () => {
    const m = source.match(/MAX_TOOL_INVOCATIONS_PER_REQUEST = (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(32);
  });
});

/* --------------------------------------------------------------------------
 * Harness cho ba describe dưới: chạy POST /api/chat THẬT với một provider
 * override, streamText phát về đúng lỗi `upstream.message`, và đọc thẳng
 * data-stream để xem mã lỗi người dùng thật sự nhận.
 *
 * Mock chỉ ở tầng SDK (createOpenAI / streamText) — không mock hàm của route:
 * các case dưới khoá hành vi quan sát được, không khoá regex trong source.
 * -------------------------------------------------------------------------- */

const PROVIDER_BASE = 'https://provider.example.com/v1';
const CHAT_MODEL = 'fledge-step-5';

function chatRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'test-key',
      'x-api-base': PROVIDER_BASE,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'chạy thử giúp tôi' }],
      model: CHAT_MODEL,
      agentTools: false,
      ...body,
    }),
  });
}

/** Chạy một lượt chat với lỗi upstream cho trước; trả về body data-stream. */
async function chatWithUpstreamError(
  message: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  upstream.message = message;
  const response = await POST(chatRequest(body));
  expect(response.status).toBe(200);
  return response.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  upstream.message = '';
  upstream.emulatedMessages = null;
  resetToolSupportCache();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Bug 10: lỗi LOGIC từ gateway (không có HTTP status) bị gắn nhãn
 * UPSTREAM_NETWORK — người dùng bị bảo kiểm tra mạng trong khi nguyên nhân
 * thật là model gọi sai tên tool.
 *
 * `status === undefined` là ô của HAI loại lỗi khác hẳn nhau: lỗi kết nối
 * thật (fetch/undici — không có mã HTTP nào để mang) và yêu cầu bị TỪ CHỐI
 * vì lý do logic (gateway bọc `[401]: {...}` trong stream 200, hoặc chính AI
 * SDK ném "Model tried to call unavailable tool 'bash'."). Bản cũ gộp chung
 * mọi lỗi thứ hai thành "Không kết nối được tới AI Provider"; bật lại Wi-Fi
 * không giúp được gì.
 *
 * Đảo điều kiện (bỏ `NETWORK_FAILURE_RE` khỏi nhánh `status === undefined`) →
 * hai case "bị từ chối" ĐỎ. Bỏ nhánh UPSTREAM_NETWORK → case "lỗi mạng thật" ĐỎ.
 */
describe('lỗi không-status: chỉ lỗi MẠNG mới là UPSTREAM_NETWORK', () => {
  it('lỗi tool của AI SDK không còn bị báo thành lỗi mạng', async () => {
    const text = await chatWithUpstreamError(
      "Model tried to call unavailable tool 'bash'. No tools are available.",
    );
    expect(text).toContain('"UPSTREAM_MODEL_REJECTED"');
    expect(text).not.toContain('UPSTREAM_NETWORK');
    // Thông điệp tiếng Việt phải nói rõ KHÔNG phải mạng + không đổ lỗi key.
    expect(text).toContain('Không phải lỗi mạng');
    expect(text).toContain('đổi key không giúp');
  });

  it('gateway bọc lỗi trong thông điệp `[401]: {...}` cũng không phải lỗi mạng', async () => {
    const text = await chatWithUpstreamError('[401]: {"error":"upstream token expired"}');
    expect(text).toContain('"UPSTREAM_MODEL_REJECTED"');
    expect(text).not.toContain('UPSTREAM_NETWORK');
  });

  it('lỗi mạng THẬT vẫn là UPSTREAM_NETWORK (không mất cảnh báo cũ)', async () => {
    const text = await chatWithUpstreamError(
      'Cannot connect to API: connect ECONNREFUSED 127.0.0.1:20128',
    );
    expect(text).toContain('"UPSTREAM_NETWORK"');
    expect(text).not.toContain('UPSTREAM_MODEL_REJECTED');
  });

  it.each([
    ['fetch failed', 'socket hang up'],
    ['ETIMEDOUT', 'request timed out'],
  ])('timeout/kết nối đứt (%s) vẫn là lỗi mạng', async (prefix, rest) => {
    const text = await chatWithUpstreamError(`${prefix}: ${rest}`);
    expect(text).toContain('"UPSTREAM_NETWORK"');
  });
});

/**
 * Bug 11: tên model có KHOẢNG TRẮNG bị app từ chối 400 MODEL_NOT_ALLOWED
 * trong khi provider chạy được (`Fledge Step 5` → gọi thẳng ra HTTP 200).
 * Regex provider-override cũ `^[\w.\-:~/]{1,120}$` không có space.
 *
 * Sửa bằng ALLOWLIST (thêm space vào character class), KHÔNG bỏ chốt an toàn:
 * tên model đi vào body upstream, log và key cache nên ký tự điều khiển /
 * `\r\n` / dấu nháy / `;` vẫn phải bị chặn.
 *
 * Đảo điều kiện: bỏ space khỏi character class → case "khoảng trắng" ĐỎ; nới
 * thêm ký tự lạ (vd `[^\\r\\n]`) → case "chặn ký tự lạ" ĐỎ.
 */
describe('tên model provider-override: nhận khoảng trắng, vẫn chặn ký tự lạ', () => {
  it('model có khoảng trắng được chấp nhận và gọi provider', async () => {
    upstream.message = 'marker';
    const response = await POST(chatRequest({ model: 'Fledge Step 5' }));
    expect(await response.text()).not.toContain('MODEL_NOT_ALLOWED');
    expect(vi.mocked(streamText).mock.calls[0][0].model).toMatchObject({
      modelId: 'Fledge Step 5',
    });
  });

  it('vẫn chặn tên model chứa ký tự điều khiển, newline và ký tự shell', async () => {
    const bad = [
      'bad\nmodel',
      'bad\r\nmodel',
      'bad\\u0000model',
      'bad\\u0007model',
      'bad\\u001b[31mmodel',
      'bad;rm -rf model',
      "bad'model",
      'bad`whoami`model',
      'bad$(id)model',
    ];
    for (const model of bad) {
      const response = await POST(chatRequest({ model }));
      expect(response.status, `model ${JSON.stringify(model)} phải bị chặn`).toBe(400);
      expect((await response.json()).code).toBe('MODEL_NOT_ALLOWED');
    }
    expect(streamText).not.toHaveBeenCalled();
  });

  it.each(['openai/gpt-4o', 'gpt-5.6-sol', 'deepseek/r1:free', 'Fledge Step 5'])(
    'id hợp lệ %s đi qua được',
    async (model) => {
      upstream.message = 'marker';
      const response = await POST(chatRequest({ model }));
      expect(await response.text()).not.toContain('MODEL_NOT_ALLOWED');
    },
  );
});

/**
 * Bug 12: nhánh "gateway chê tools" dùng `/tool|function/i` — khớp BẤT KỲ
 * thông điệp nào có substring đó. Đo được: lỗi tool của CHÍNH app ("Error
 * executing tool web_search: fetch failed") khiến route tắt tools cho cả
 * request VÀ ghim `markToolsUnsupported(base, model)` — tước agent của model
 * đó suốt TTL 10 phút chỉ vì một lần tool server hỏng mạng.
 *
 * Đảo điều kiện (trả lại `/tool|function/i`) → case "tool của app hỏng" ĐỎ;
 * thu regex quá tay (chỉ khớp đúng một câu) → case "gateway nói không hỗ trợ
 * tools" ĐỎ.
 */
describe('retry tắt tools chỉ khi gateway NÓI không hỗ trợ tools', () => {
  it('tool của APP hỏng thì không retry và không ghim cache tools', async () => {
    const text = await chatWithUpstreamError(
      'Error executing tool web_search: fetch failed',
      { agentTools: true },
    );
    expect(vi.mocked(streamText).mock.calls.length).toBe(1);
    expect(isToolUnsupported(PROVIDER_BASE, CHAT_MODEL)).toBe(false);
    expect(text).toBeTruthy();
  });

  it('gateway nói không hỗ trợ tools thì VẪN retry và ghim cache', async () => {
    await chatWithUpstreamError('This model does not support tools', { agentTools: true });
    expect(isToolUnsupported(PROVIDER_BASE, CHAT_MODEL)).toBe(true);
  });

  it.each([
    "Model tried to call unavailable tool 'bash'. No tools are available.",
    'tool use is not supported by this model',
    'Unknown tool: web_search',
  ])('lỗi từ chối tools thật vẫn kích hoạt retry (%s)', async (message) => {
    resetToolSupportCache();
    await chatWithUpstreamError(message, { agentTools: true });
    expect(isToolUnsupported(PROVIDER_BASE, CHAT_MODEL)).toBe(true);
  });
});

/**
 * Bug A2: `forceEmulatedTools` ghim cache tool-unsupported TOÀN CỤC 10 phút,
 * không phân biệt nguồn cờ. Cờ này tới từ HAI nơi: client TỰ PHÁT HIỆN gateway
 * strip `tools` (kèm bằng chứng `toolsStrippedByGateway`) và người dùng BẬT
 * TOGGLE trong Cài đặt. Bản cũ ghim ở cả hai, nên bật toggle một lần là model
 * đó mất agent ở MỌI request sau — kể cả request native thuần — và không có
 * đường gỡ (lib/tool-support-cache không có API xoá).
 *
 * Đo A/B/A trên cùng model: native sống → bật giả lập → chết → native thuần vẫn
 * chết.
 *
 * Đảo điều kiện (bỏ `&& toolsStrippedByGateway`) → describe này ĐỎ.
 */
describe('A2 — bật giả lập không tước agent của các lượt native sau', () => {
  /** streamText trả lời bình thường → đường native đi trọn vẹn. */
  function streamNativeOk() {
    vi.mocked(streamText).mockImplementation(
      () =>
        ({
          fullStream: (async function* () {
            yield { type: 'text-delta', textDelta: 'câu trả lời' };
            yield { type: 'finish', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } };
          })(),
        }) as unknown as ReturnType<typeof streamText>,
    );
  }

  /** Gọi native thuần và trả về tools mà route thật sự gửi lên upstream. */
  async function nativeToolsSent(body: Record<string, unknown> = {}): Promise<unknown> {
    vi.mocked(streamText).mockClear();
    const response = await POST(chatRequest({ agentTools: true, ...body }));
    await response.text();
    expect(streamText).toHaveBeenCalled();
    return vi.mocked(streamText).mock.calls[0][0].tools;
  }

  it('toggle của người dùng (không kèm bằng chứng) KHÔNG ghim cache', async () => {
    streamNativeOk();
    await POST(chatRequest({ agentTools: true, forceEmulatedTools: true }));
    expect(isToolUnsupported(PROVIDER_BASE, CHAT_MODEL)).toBe(false);
  });

  it('sau khi bật giả lập, request NATIVE THUẦN vẫn có tools', async () => {
    streamNativeOk();
    // (1) bật giả lập một lần — quyết định của người dùng cho lượt này.
    await POST(chatRequest({ agentTools: true, forceEmulatedTools: true }));
    // (2) lượt sau không ép gì cả: agent phải VẪN chạy native đủ bộ tool.
    const tools = await nativeToolsSent();
    expect(tools).toBeDefined();
    expect(Object.keys(tools as Record<string, unknown>).length).toBeGreaterThan(0);
    expect(isToolUnsupported(PROVIDER_BASE, CHAT_MODEL)).toBe(false);
  });

  it('client tự phát hiện (kèm toolsStrippedByGateway) thì VẪN ghim cache', async () => {
    streamNativeOk();
    await POST(
      chatRequest({ agentTools: true, forceEmulatedTools: true, toolsStrippedByGateway: true }),
    );
    // Đây là quan sát THẬT về gateway → ghim được, giữ nguyên lợi ích cũ.
    expect(isToolUnsupported(PROVIDER_BASE, CHAT_MODEL)).toBe(true);
  });
});

/**
 * Bug A1: route làm phẳng `CoreMessage` thành `{ role, content: string }` trước
 * khi đưa vào `runEmulatedLoop`. Part `tool-call`/`tool-result` không có field
 * `text` nên rơi về `''`, và message `role:'tool'` mà SDK BẮT BUỘC phải có
 * `content` là mảng part → prompt fail validate → data stream báo
 * BAD_PROMPT_HISTORY. Hệ quả: đường giả lập không bao giờ thấy kết quả tool.
 *
 * Trace lỗi đo thật trên log (trước khi sửa):
 *   [{"role":"user","content":"Trong workspace, đọc file demo/s1.txt rồi báo nội dung."},
 *    {"role":"assistant","content":""},
 *    {"role":"tool","content":""}]
 *
 * Đảo điều kiện (làm phẳng lại content ở route) → describe này ĐỎ.
 */
describe('A1 — đường giả lập thấy được kết quả tool của vòng trước', () => {
  const HISTORY_WITH_TOOL_RESULT = [
    { role: 'user', content: 'Trong workspace, đọc file demo/s1.txt rồi báo nội dung.' },
    {
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 'c1',
          toolName: 'fs_read',
          args: { path: 'demo/s1.txt' },
          state: 'result',
          result: 'DONG_DAU_FILE_S1',
        },
      ],
    },
  ];

  /** Chạy một lượt qua đường giả lập với lịch sử đã có tool result. */
  async function runEmulatedTurn(): Promise<string> {
    upstream.emulatedMessages = null;
    const response = await POST(
      chatRequest({
        // agentTools phải BẬT: `emulatedMode = (agentTools ?? true) && !allowAgentTools`
        // — tắt hẳn thì route chạy đường "user không muốn agent", không vào
        // vòng lặp giả lập.
        agentTools: true,
        forceEmulatedTools: true,
        messages: HISTORY_WITH_TOOL_RESULT,
      }),
    );
    return response.text();
  }

  it('message role tool đi tới SDK với part tool-result, không phải chuỗi rỗng', async () => {
    const text = await runEmulatedTurn();
    expect(upstream.emulatedMessages).not.toBeNull();

    const sent = upstream.emulatedMessages as Array<{ role: string; content: unknown }>;
    const toolMessage = sent.find((m) => m.role === 'tool');
    expect(toolMessage, 'thiếu message role=tool → đường giả lập mất kết quả tool').toBeDefined();
    // Bắt buộc là MẢNG part; chuỗi rỗng là đúng lỗi của bản cũ.
    expect(Array.isArray(toolMessage!.content)).toBe(true);
    expect(JSON.stringify(toolMessage)).toContain('DONG_DAU_FILE_S1');
    // Lời gọi tool của vòng trước cũng phải còn để ghép đúng cặp tool_call_id.
    expect(JSON.stringify(sent)).toContain('tool-call');
    // Không phải BAD_PROMPT_HISTORY — dấu hiệu prompt hỏng.
    expect(text).not.toContain('BAD_PROMPT_HISTORY');
  });

  it('prompt đường giả lập hợp lệ theo schema thật của ai@4', async () => {
    await runEmulatedTurn();
    const { coreMessageSchema } = await import('ai');
    const { z } = await import('zod');
    expect(
      z.array(coreMessageSchema).safeParse(upstream.emulatedMessages).success,
      'prompt đường giả lập phải validate được — đây là điều kiện sinh BAD_PROMPT_HISTORY',
    ).toBe(true);
  });
});
