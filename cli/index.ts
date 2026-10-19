/**
 * CLI của Vyen — chạy thật trên provider thật, dùng bộ tool thật.
 *
 * ============ CÁC FILE NÀY CHIA VIỆC GÌ ============
 *
 *   `cli/index.ts`      nối vào console: đọc biến môi trường, dựng host, hỏi
 *                       duyệt, in ra, chẩn đoán lỗi provider. **Không có logic
 *                       test được** — cứ thêm vào đây là thêm thứ không test nào
 *                       chạm được.
 *   `cli/agent-turn.ts` vòng lặp tool (`maxSteps`, stream, bắt lỗi tool). Hàm
 *                       thuần, test được bằng model giả — xem `tests/cli-agent-
 *                       turn.test.ts`.
 *   `cli/approve.ts`    cổng duyệt trên console, có test.
 *   `lib/tools/ipc-node.ts` lớp cầu tới `lib/ipc.cjs`: đọc/ghi file, shell, git,
 *                       có path-guard, chống TOCTOU và audit.
 *
 * ============ CỐ Ý KHÔNG CÓ (trạng thái 2026-10-19) ============
 *
 * - Tìm kiếm hội thoại: transcript là JSONL, không có chỉ mục. Đủ dùng một buổi;
 *   cần tìm thì phải đổi sang SQLite.
 * - Rút gọn context: càng nói nhiều lượt thì lượt sau gửi lên càng nhiều token.
 *   Không có compaction. Claude Code mất nhiều phiên bản mới chịu được vùng
 *   "resume × compaction" — xem CHANGELOG của họ, có ít nhất 9 mục lỗi.
 * - Agent nhớ sở thích bạn qua các phiên (`agentMemories`) — cần kho riêng.
 *
 * ============ CÁCH CHẠY ============
 *
 *   # Mở hội thoại — mở terminal, nói chuyện tiếp nhiều lượt (giống Claude Code)
 *   $env:VYEN_API_KEY = "sk-..."
 *   $env:VYEN_MODEL   = "gpt-4o-mini"
 *   $env:VYEN_WORKSPACE = "C:\duong\dan\du-an"
 *   npm run cli
 *   > doc README.md
 *   > them vao staging
 *   > /exit
 *
 *   # Hỏi một câu rồi thoát luôn (đường cũ)
 *   npm run cli -p -- "xin chao"
 *
 *   # Câu hỏi truyền qua argv là LƯỢT ĐẦU, rồi CLI vẫn ở lại để nói tiếp
 *   npm run cli -- "doc README.md"
 *
 *   # Anthropic-native
 *   $env:VYEN_API_KEY = "sk-ant-..."
 *   $env:VYEN_MODEL   = "claude-3-5-haiku-20241022"
 *   $env:VYEN_KIND    = "anthropic"
 *
 * ============ LỆNH TRONG PHIÊN ============
 *
 *   /exit    thoát. Mọi thứ đã ghi xuống đĩa, mở lại là đọc tiếp.
 *   /new     bắt đầu phiên mới (lịch sử cũ vẫn còn trên đĩa, không bị xoá).
 *
 * ============ NHỚ LÀ GÌ ============
 *
 * Transcript lưu ở `~/.vyen/cli/sessions/<hash-thu-muc>.jsonl`, **một file cho mỗi
 * thư mục dự án**. Đóng terminal rồi mở lại `npm run cli` trong cùng thư mục là đọc
 * tiếp — không phải chọn lại. Chuyển sang thư mục khác thì là dòng hội thoại khác,
 * không bị lẫn.
 *
 * ============ CÁCH CHẠY — LUÔN DÙNG `npm run cli` ============
 *
 * KHÔNG chạy `node cli/index.ts` thẳng. File này import `@/lib/provider/
 * upstream-diagnosis`, mà Node không đọc `paths` trong `tsconfig.json` — nên
 * cách đó chết ngay với `Cannot find package '@/lib'`. `npm run cli` đi qua
 * `tsx` nên resolve được. Đây là lý do `tsx` nằm trong devDependencies.
 *
 * Biến môi trường:
 *   VYEN_API_KEY   bắt buộc. Key được đọc TỪ BIẾN MÔI TRƯỜNG, không bao giờ
 *                  nhận qua argv — argv nằm trong lịch sử shell và trong
 *                  `Get-History`, biến môi trường thì không.
 *   VYEN_MODEL     bắt buộc. Id model theo quy ước của provider.
 *   VYEN_BASE_URL  tuỳ chọn. Bỏ trống thì adapter dùng base URL mặc định của
 *                  hãng. **Phải có `/v1`** — cả `@ai-sdk/openai` lẫn
 *                  `@ai-sdk/anthropic` đều mặc định `https://api.<host>/v1` rồi
 *                  chỉ nối phần endpoint. Thiếu `/v1` sẽ ra `/messages` thay vì
 *                  `/v1/messages`.
 *   VYEN_KIND      `anthropic` (SDK native) hoặc `openai-compatible` (mặc định).
 *   VYEN_MAX_TOKENS trần token đầu ra, mặc định 2048. **Đừng bỏ trống** — xem
 *                  ghi chú cạnh chỗ dùng: gateway tính credit sẽ từ chối vì
 *                  trần mặc định của provider quá lớn.
 *   VYEN_WORKSPACE thư mục dự án mà tool được phép chạm vào. Bỏ trống thì dùng
 *                  thư mục hiện tại. `createNodeHost` TỪ CHỐI thư mục rộng (gốc
 *                  ổ đĩa, home) và thư mục không tồn tại — nếu bị từ chối thì CLI
 *                  vẫn chat được, chỉ không có tool, và có in lý do.
 *   VYEN_STATE_DIR nơi ghi `vyen-audit.log` (vết của mọi lệnh ghi/xoá). Mặc
 *                  định `~/.vyen/cli`. Đổi ra ngoài repo thì xoá file này là
 *                  xoá được vết.
 *   VYEN_YOLO      đặt `1` để **tự động duyệt mọi lệnh ghi/xoá**. Mặc định là
 *                  hỏi từng lần trên console. Chỉ bật trong thư mục tạm.
 *   VYEN_DEBUG     đặt `1` để in thêm `devLog` (req id, host, body upstream).
 *                  Mặc định KHÔNG in — người dùng chỉ cần thông báo sạch.
 *
 * ============ VẤN ĐỀ ĐÃ GẶP ============
 *
 * VẤN ĐỀ ĐÃ GIẢI — alias `@/lib/...`: Node chạy file `.ts` thẳng KHÔNG đọc
 * `paths` trong `tsconfig.json`, nên `lib/provider/upstream-diagnosis.ts` không
 * import được. Đã giải bằng `tsx` (devDependency) — `npm run cli` đi qua nó.
 * Vì vậy **phải** dùng `npm run cli`, không `node cli/index.ts`.
 */

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';
import { type ToolSet } from 'ai';
import type { AdapterKind } from '../lib/provider/adapter.ts';
import { resolveOpenAIModel } from '../lib/provider/openai-adapter.ts';
import { resolveAnthropicModel } from '../lib/provider/anthropic-adapter.ts';
// Hai dòng dưới ĐỂ ĐÚNG alias `@/` để chứng minh lý do phải có `tsx`: chạy
// `node cli/index.ts` thẳng thì hai import này hỏng. Chạy `npm run cli` thì
// được. Nếu sau này đổi alias, sửa cả hai chỗ cùng lúc.
import { diagnoseUpstreamError } from '@/lib/provider/upstream-diagnosis';
import { getKeyLabel } from '@/lib/api-keys';
import { createNodeHost, buildIpcTools } from '@/lib/tools/ipc-node';
import { createConsoleApprover, createAutoApprover } from './approve';
import { runAgentTurn } from './agent-turn';
import { runRepl, SYSTEM_PROMPT } from './repl';
import { openSession } from './session';

/**
 * Bọc trong hàm async thay vì dùng top-level `await`.
 *
 * Lý do: repo KHÔNG có `"type": "module"` trong package.json (thêm vào sẽ phá
 * Next.js), nên `tsx` dịch file này thành **CJS** — mà CJS không có top-level
 * await. Đo thật 2026-10-18: `Top-level await is currently not supported with the
 * "cjs" output format`. Cách này giữ file chạy được dưới CẨ `node` lẫn `tsx`.
 */
/**
 * Phân tích argv.
 *
 * `-p` / `--print` = chạy một lượt rồi thoát, giữ hành vi cũ của
 * `npm run cli -- "..."`. Không có thì vào REPL và nói tiếp.
 *
 * Câu hỏi truyền qua argv dùng làm **lượt đầu tiên** của REPL, giống
 * `claude "cau hoi"` — không phải chạy rồi chết. Nếu bạn muốn chạy rồi chết thì
 * thêm `-p`. */
function parseArgs(argv: string[]): { question?: string; print: boolean } {
  const goc = argv.filter((a) => !/^-p$|^--print$/.test(a));
  const print = goc.length !== argv.length;
  const question = goc.join(' ').trim() || undefined;
  return { question, print };
}

/** Chạy một lượt rồi thoát — đường dùng khi có `-p`. */
async function chayMotLuot(opts: {
  lm: Parameters<typeof runAgentTurn>[0]['model'];
  session: ReturnType<typeof openSession>;
  question: string;
  tools: ToolSet | undefined;
  maxTokens: number;
  apiKey: string;
  model: string;
}): Promise<void> {
  const { lm, session, question, tools, maxTokens, apiKey, model } = opts;
  session.append({ role: 'user', content: question });
  let wroteAny = false;
  try {
    const turn = await runAgentTurn({
      model: lm,
      tools,
      messages: [...session.messages],
      system: SYSTEM_PROMPT,
      maxTokens,
      onText: (delta) => {
        process.stdout.write(delta);
        wroteAny = true;
      },
      onToolCall: (name) => console.error(`\n[goi tool] ${name}`),
      onToolError: (name, msg) => console.error(`[tool that bai] ${name}: ${msg}`),
    });
    session.appendAll(turn.messages);
    if (wroteAny) process.stdout.write('\n');
    console.error(
      `\n> xong. token: vao ${turn.usage.promptTokens ?? '?'} / ra ${turn.usage.completionTokens ?? '?'}`,
    );
  } catch (e) {
    /* Chuyển lỗi thô thành chẩn đoán có nghĩa (spec §7).
     *
     * Không in `e.message` thẳng: message của provider là tiếng Anh dài dòng, và
     * quan trọng hơn là **không phân biệt được lỗi mạng với lỗi key** — người
     * dùng CLI không biết nên bật lại Wi-Fi hay đổi key. */
    const diag = diagnoseUpstreamError(e, {
      requestId: randomUUID().slice(0, 8),
      model,
      keyLabel: getKeyLabel(apiKey),
      providerBase: process.env.VYEN_BASE_URL,
    });
    console.error(`\n> ${diag.code}  (${diag.scope})`);
    console.error(`> ${diag.userMessage}`);
    console.error(
      `> phai doi key: ${diag.blameKey ? 'co' : 'khong'} | dung thu key khac: ${diag.stopFailover ? 'dung roi' : 'chua'}`,
    );
    if (process.env.VYEN_DEBUG === '1') console.error(`> dev: ${diag.devLog}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prompt = args.question;

  /* KHÔNG đòi phải có câu hỏi. `npm run cli` không có đối số **chính là** cách
   * dùng chính — mở hội thoại rồi gõ. Bản đầu tôi in hướng dẫn rồi `exit(2)`
   * khi thiếu câu hỏi, tức là khoá ngay chính cách dùng mà tính năng này sinh ra.
   *
   * Chỉ `-p` mới đòi câu hỏi, vì `-p` nghĩa là "chạy một lượt rồi thoát" — không có
   * câu hỏi thì không có việc gì để chạy. */
  if (args.print && !prompt) {
    console.error('-p nhung khong co cau hoi: npm run cli -p -- "cau hoi"');
    process.exit(2);
  }

  const apiKey = process.env.VYEN_API_KEY ?? '';
  if (!apiKey) {
    // Chủ ý KHÔNG in gì cả giá trị biến — lỗi kiểu này hay in ra cả key.
    console.error('Thieu VYEN_API_KEY. Dat bien moi truoc khi chay.');
    process.exit(2);
  }

  const model = process.env.VYEN_MODEL ?? '';
  if (!model) {
    console.error('Thieu VYEN_MODEL. Dat bien moi truoc khi chay.');
    process.exit(2);
  }

  // Kiểm tra thật, KHÔNG dựa vào `resolveAdapterKind`. Lý do: hàm đó trả thẳng
  // `cfg.kind` (identity), nên `resolveAdapterKind({kind}) !== kind` **luôn false**
  // — guard viết bằng cách đó không bao giờ bắt được gì. Chính lượt chạy thật đã
  // lộ ra điều này: đặt VYEN_KIND sai mà không có gì được in.
  const KINDS: readonly AdapterKind[] = ['anthropic', 'openai-compatible'];
  const kind = (process.env.VYEN_KIND ?? 'openai-compatible') as AdapterKind;
  if (!KINDS.includes(kind)) {
    console.error(`VYEN_KIND khong hop le: ${kind}`);
    console.error(`Gia tri dung: ${KINDS.join(' | ')}`);
    process.exit(2);
  }

  // Trần số token đầu ra. KHÔNG để mặc định của provider: OpenRouter từ chối
  // bằng lỗi kiểu "you requested up to 16384 tokens but can only afford 13228"
  // — đo thật 2026-10-18. Với gateway tính tiền theo credit, để provider tự
  // chọn trần nghĩa là một câu hỏi ngắn cũng có thể bị từ chối vì lý do không
  // liên quan gì tới nội dung.
  const rawMax = process.env.VYEN_MAX_TOKENS ?? '2048';
  const maxTokens = Number(rawMax);
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    console.error(`VYEN_MAX_TOKENS khong hop le: ${rawMax} (can la so nguyen duong)`);
    process.exit(2);
  }

  const cfg = {
    kind,
    apiKey,
    model,
    ...(process.env.VYEN_BASE_URL ? { baseUrl: process.env.VYEN_BASE_URL } : {}),
  };

  /* ---- Tool: chỉ bật khi có workspace ----
   *
   * `createNodeHost` từ chối workspace rộng (gốc ổ đĩa, home) và từ chối thư mục
   * không tồn tại — đó là lớp bảo vệ thật, không phải kiểm tra hình thức.
   *
   * Không có `VYEN_WORKSPACE` thì CLI chỉ chat, không đụng đĩa. Đây là mặc định
   * an toàn: một CLI ghi file mà không cần người dùng chỉ định thư mục là một
   * CLI không có ranh giới. */
  const yolo = process.env.VYEN_YOLO === '1';
  let tools: ToolSet | undefined;
  let disposeHost: (() => void) | undefined;
  // Readline giữ stdin mở, nên nếu không đóng thì tiến trình không thoát dù đã
  // in xong. Đóng quá sớm thì lượt hỏi duyệt sau sẽ treo — nên đóng ở `finally`.
  let closeStdin: (() => void) | undefined;
  const workspace = process.env.VYEN_WORKSPACE ?? process.cwd();
  // KHAI TRƯỚC `try` vì REPL dùng `userDataDir` và `docDong` — khai trong thì phạm
  // vi khối, TypeScript đúng ra báo "không tìm thấy tên" dù runtime có giá trị.
  const userDataDir =
    process.env.VYEN_STATE_DIR ??
    path.join(os.homedir(), '.vyen', 'cli');
  /* Bản rỗng trước: nếu `createNodeHost` ném, REPL vẫn chạy được (chỉ mất tool) và
   * `docDong` không bao giờ là `undefined` — gọi hàm `undefined` là crash. */
  let docDong: (q: string) => Promise<string> = async () => '';
  try {
    const host = createNodeHost({ workspaceRoot: workspace, userDataDir });
    disposeHost = host.dispose;

    // Cổng duyệt: hỏi trên console, trừ khi người dùng tự bật YOLO — và khi
    // bật thì PHẢI in ra, vì đó là lúc bỏ hết lớp bảo vệ giữa người và máy.
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    closeStdin = () => rl.close();
    docDong = (q: string) => rl.question(q);
    const approve = yolo
      ? (() => {
          console.error('\n!!! VYEN_YOLO=1 — TU DONG DUYET MOI LENH GHI/XOA, KHONG HOI !!!');
          return createAutoApprover(true);
        })()
      : createConsoleApprover(docDong);
    const built = buildIpcTools(host, { approve });
    // `buildIpcTools` trả `Record<string, unknown>` vì hình dạng tool của AI SDK
    // rộng hơn thứ lớp cầu biết. Ép kiểu ở đây là ranh giới duy nhất; nếu để
    // rò vào trong thì mọi call site lại phải tự ép, và lệch kiểu là im lặng.
    tools = built as ToolSet;
    console.error(`> cong cu: ${Object.keys(built).length} (workspace: ${workspace})`);
    if (yolo) console.error('> YOLO BAT — moi thay doi deu khong hoi xac nhan');
  } catch (e) {
    console.error(`> KHONG bat cong cu: ${e instanceof Error ? e.message : String(e)}`);
    console.error('> van chat binh thuong, chi khong dung duoc cong cu.');
  }

  /* ---- Session transcript: thứ làm "đóng terminal rồi mở lại còn nhớ" ----
   *
   * Session gắn với **thư mục**, không gắn với người — đúng cách opencode dùng cột
   * `directory` trong `session_v2`. Hỏi trong `C:\du-an` là một dòng transcript;
   * chuyển sang `C:\du-an-khac` là dòng khác, không bị lẫn.
   *
   * File cũ GIỮ NGUYÊN — mở lại là đọc tiếp, không phải chọn lại. */
  let session: ReturnType<typeof openSession> | undefined;
  try {
    session = openSession(userDataDir, workspace);
    const soMessage = session.messages.length;
    if (soMessage > 0) {
      console.error(`> lich su: ${soMessage} message o "${session.header.directory}"`);
      console.error('> gõ /new neu muon bat dau moi. /exit de thoat.');
    }
  } catch (e) {
    console.error(`> KHONG doc duoc transcript: ${e instanceof Error ? e.message : String(e)}`);
    console.error('> chay tiep, chi khong nho duoc.');
  }

  console.error(`> ${kind} / ${model}${cfg.baseUrl ? ` / ${cfg.baseUrl}` : ''}`);
  console.error(`> toi da ${maxTokens} token`);
  console.error('> (ket qua se do la day)\n');

  try {
    const lm = kind === 'anthropic' ? resolveAnthropicModel(cfg) : resolveOpenAIModel(cfg);

    /* Đo 2026-10-18 với key sai: stream lỗi **không** ném ra `for await` — nó kết
     * thúc im lặng sau 0 chunk, và `finishReason` không bao giờ settle. Nếu nuốt,
     * CLI in ra CÂU RỖNG rồi exit 0, tức báo thành công cho một lần gọi thất bại —
     * tệ hơn cả crash. `runAgentTurn` vì thế ném lại lỗi provider ra đây. */
    if (!session) {
      console.error('> khong co session, thoat. Van xong lich su? khong.');
      process.exitCode = 1;
      return;
    }

    /* `-p` = chạy MỘT lượt rồi thoát, giữ hành vi cũ của `npm run cli -- "..."`.
     * Không có `-p` thì vào REPL: đóng terminal là mất session, mở lại là đọc
     * tiếp. Câu hỏi truyền qua argv là **lượt đầu tiên**, rồi CLI tiếp tục. */
    if (args.print) {
      // `prompt` chắc chắn có: `main()` đã kiểm và thoát nếu `-p` mà thiếu.
      await chayMotLuot({ lm, session, question: prompt as string, tools, maxTokens, apiKey, model });
      return;
    }

    await runRepl({
      model: lm,
      tools,
      session,
      system: SYSTEM_PROMPT,
      maxTokens,
      ...(prompt ? { initial: prompt } : {}),
      // Một readline dùng cho CẢ hỏi duyệt lẫn nhận lệnh — nếu mở hai thì stdin
      // bị hai tiến trình cùng chia, người dùng gõ một câu mà CLI lắng nghe hai
      // lần, và kết quả là bản được xoá bởi bản kia.
      //
      // `rl.question` KHÔNG trả `null` khi hết dòng — nó **ném** lỗi kiểu
      // "readline was closed". Đo thật 2026-10-19 bằng `... | npm run cli`:
      // nếu không bắt, `Ctrl+D` (hay nối ống vào) là in ra một dòng lỗi rác
      // thay vì thoát sạch. `null` ở đây là EOF.
      ask: async () => {
        try {
          return (await docDong('> ')) ?? null;
        } catch {
          return null;
        }
      },
      out: (s) => process.stdout.write(s),
      note: (s) => console.error(s),
    });
  } catch (err) {
    /* Chỉ bắt được lỗi CỐ Ý ném ra (ví dụ config sai lúc dựng model). Lỗi từ
     * provider đã được bắt và chẩn đoán ở `catch` bên trên. */
    console.error(`\n> LOI: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    // `process.exit()` sẽ bỏ qua `finally` và cắt cụt stdout khi đang stream —
    // nên dùng `process.exitCode` và để tiến trình tự thoát sau khi dọn xong.
    closeStdin?.();
    disposeHost?.();
  }
}

main();
