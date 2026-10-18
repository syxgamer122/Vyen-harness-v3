/**
 * Phần CHẠY SERVER của bộ tool agent.
 *
 * Tách khỏi `lib/agent-tools.ts` theo RUNTIME, không phải theo chủ đề (spec v2 §3).
 * Lý do cụ thể: `lib/ipc.cjs` kéo `child_process` + `net`. Trước đây phần server
 * nằm chung file với phần trình duyệt (`CLIENT_TOOL_DEFS`, `toolResultBody`), nên
 * không thể import ipc.cjs mà không kéo Node vào bundle trình duyệt.
 *
 * Bản 1 lách bằng `eval('require')('./ipc.cjs')` trong `lib/tool-limits.ts` — và
 * chết trong bản build: `.next/server/chunks/` không có `ipc.cjs`, `try/catch`
 * nuốt `MODULE_NOT_FOUND`, tính năng im lặng không chạy mà mọi gate vẫn xanh.
 *
 * Ở đây dùng IMPORT TĨNH: Turbopack đóng gói `ipc.cjs` đúng MỘT lần cho sản phẩm
 * server, nên đây là cùng instance mà `lib/bridge/server-bridge.ts:75` nạp — cùng
 * registry `savedShellOutputs` mà whitelist `fs_read` đọc. Đó là điều mà
 * require-theo-đường-dẫn không đạt được.
 *
 * Quy tắc: file này import được `@/lib/agent-tools`. Chiều ngược lại thì không.
 * Test `tests/spill-wiring.test.ts` canh ranh giới này.
 */
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import type { AgentRegistry } from '@/lib/agents/agent-registry';
import { describeAgents } from '@/lib/agents/agent-registry';
import { capHits, fetchReadablePage, searchWeb } from '@/lib/web-backend';
import { WEB_LIMITS } from '@/lib/web-context';
import { judgeInjection } from '@/lib/injection-guard';
import { getToolCallBudget, checkDoomLoop } from '@/lib/tool-call-budget';
import { TOOL_RESULT_MAX_CHARS, TOOL_PREVIEW_MAX_CHARS } from '@/lib/tool-limits';
import { redactSecretText, redactSecretsDeep } from '@/lib/secret-registry';
import { isMcpToolKey } from '@/lib/mcp/tool-mapper';
import { TOOL_CATALOG } from '@/lib/tool-catalog';
import { CLIENT_TOOL_DEFS, DELEGATE_PARAMETERS } from '@/lib/agent-tools';
import * as ipc from '@/lib/ipc.cjs';

/**
 * Ghi phần kết quả tool bị cắt ra file app tự ghi để `fs_read` đọc lại được.
 *
 * Best-effort: ghi lỗi trả `null` — caller rơi về cắt trần như cũ, KHÔNG ném.
 * Lỗi lưu không được biến một tool call thành công thành `isError`
 * (docs/subsystems/spill.md:92 của deepseek-harness).
 *
 * `content` PHẢI là bản đã redact — `capToolResult` nhận đã redact từ `guarded`.
 * Bí mật hay nằm ở phần giữa, tức phần bị lược khỏi ngữ cảnh, nên đây là ranh giới
 * redact thứ hai sau "trước khi cắt".
 */
const saveSpillText = (ipc as unknown as {
  saveSpillText?: (content: string, name: string) => { savedTo: string; bytes: number; notice: string } | null;
}).saveSpillText;

export type AgentToolSet = ReturnType<typeof buildAgentTools>;

export interface MemoryItem {
  id: string;
  text: string;
}

export interface AgentToolsOptions {
  memories?: MemoryItem[];
  /** Host được phép web_fetch: từ URL user gắn + kết quả search cùng lượt. */
  allowedHosts?: Iterable<string>;
  /** Tắt khi lượt hiện tại đã có webContext được người dùng yêu cầu. */
  includeWeb?: boolean;
  /**
   * Id hội thoại — khoá ngân sách gọi tool sống xuyên các resubmit của
   * client tool. Thiếu id thì rơi về hành vi cũ (đếm theo từng request).
   */
  conversationId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Tìm ghi nhớ (thuần, test được không cần Dexie)                      */
/* ------------------------------------------------------------------ */

/**
 * Tìm fact ghi nhớ khớp query — điểm số = số từ khóa xuất hiện, trả tối đa 5
 * fact tốt nhất.
 */
export function searchMemories(
  memories: MemoryItem[],
  query: string,
): Array<{ id: string; text: string }> {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length >= 2);
  if (!words.length) return [];
  const scored = memories.map((m) => {
    const lower = m.text.toLowerCase();
    const score = words.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);
    return { m, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => ({ id: s.m.id, text: s.m.text }));
}

/* ------------------------------------------------------------------ */
/* Summarizer cho UI tool-trace (annotation {tool:{...}})               */
/* ------------------------------------------------------------------ */

/** Args ngắn gọn hiển thị trên chip — KHÔNG đưa nội dung dài vào annotation. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Áp trần kích thước cho kết quả tool ở ĐƯỜNG NATIVE. Trước đây chỉ đường
 * emulated cắt (6k) còn native để nguyên — một web_fetch trang dài có thể
 * đẩy cả chục nghìn token vào context mà ContextMeter không kịp phản ánh.
 *
 * Cắt trên TỪNG trường string dài thay vì stringify cả object, để shape kết
 * quả (results[], content, note...) không đổi — model vẫn đọc được cấu trúc.
 *
 * PHẦN BỊ CẮT KHÔNG BỊ VĂN: ghi ra file app tự ghi trước khi cắt, để model
 * đọc lại bằng `fs_read` thay vì phải đoán. Đây là `shell_run` đã làm sẵn từ
 * trước (`saveShellOutput` trong lib/ipc.cjs); ở đây dùng chung `saveSpillText`.
 *
 * `result` tới đây ĐÃ được redact (xem `guarded`) — thứ ghi đĩa là thứ đã che.
 */
function capToolResult(result: Record<string, unknown>): Record<string, unknown> {
  let raw: string;
  try {
    raw = JSON.stringify(result) ?? '';
  } catch {
    return { note: 'Kết quả công cụ không đọc được.' };
  }
  if (raw.length <= TOOL_RESULT_MAX_CHARS) return result;

  /* Ghi đĩa TRƯỚC khi cắt. Best-effort: hỏng thì rơi về cắt trần như cũ,
     KHÔNG ném — lỗi lưu không được biến tool call thành lỗi (ipc.cjs:736). */
  const spilled = saveSpillText?.(raw, 'tool-result') ?? null;

  const out: Record<string, unknown> = {};
  let remaining = TOOL_RESULT_MAX_CHARS;
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string' && value.length > remaining) {
      out[key] = `${value.slice(0, Math.max(0, remaining))}\n…[đã cắt bớt vì quá dài]`;
      remaining = 0;
    } else {
      out[key] = value;
      if (typeof value === 'string') remaining -= value.length;
    }
  }
  out.truncated = true;
  if (spilled) out.spillNotice = spilled.notice;
  return out;
}

function stableKey(name: string, args: unknown): string {
  let raw: string;
  try {
    raw = JSON.stringify(args ?? {});
  } catch {
    raw = String(args);
  }
  // Chuẩn hoá thứ tự key đã đủ vì args đến từ zod-parse của SDK (thứ tự ổn định).
  return `${name}:${raw.slice(0, 300)}`;
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export function buildAgentTools(
  memoriesOrOptions: MemoryItem[] | AgentToolsOptions = [],
) {
  const opts: AgentToolsOptions = Array.isArray(memoriesOrOptions)
    ? { memories: memoriesOrOptions }
    : memoriesOrOptions ?? {};
  const memories = opts.memories ?? [];

  /* Ngân sách theo HỘI THOẠI (không phải theo request): mỗi lần client thực
     thi fs_* xong, useChat resubmit tạo request mới — nếu đếm theo request
     thì trần và dedupe reset sạch, đúng kịch bản vòng lặp fs_list vô hạn đã
     gặp. Không có conversationId → bucket dùng-một-lần (hành vi cũ). */
  const budget = getToolCallBudget(opts.conversationId);
  const knownHosts = budget.knownHosts;
  for (const h of opts.allowedHosts ?? []) {
    const host = hostOf(h);
    if (host) knownHosts.add(host);
  }

  /**
   * Wrapper chung: đếm tổng call, chặn gọi TRÙNG (cùng tool + cùng args).
   * Trùng thì trả note hướng dẫn model tổng hợp — rẻ hơn và đoán đúng ý hơn
   * việc để nó thử lại rồi nhận y hệt kết quả cũ.
   * `errorFallback` giữ nguyên SHAPE kết quả của từng tool khi lỗi upstream
   * (vd web_search vẫn có `results: []`) — model đọc được cấu trúc ổn định.
   */
  async function guarded(
    name: string,
    args: Record<string, unknown>,
    run: () => Promise<Record<string, unknown>>,
    errorFallback: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    budget.touchedAt = Date.now();
    const key = stableKey(name, args);
    /* Loop-guard DUY NHẤT còn lại: doom-loop — cùng một (tool, args) lặp
       LIÊN TIẾP tới ngưỡng thì trả steering message buộc model đổi hướng.
       Đã gỡ dedupe "gọi trùng thì từ chối" và trần tổng call/lượt: cả hai là
       quota kiểu web-chat, chặn oan lần gọi lại HỢP LỆ (vd search lại sau khi
       ngữ cảnh đổi). Số bước vẫn bị chặn ở tầng useChat/SERVER_MAX_STEPS nên
       không mở đường vòng lặp vô hạn. */
    const doom = checkDoomLoop(budget, key);
    if (doom.triggered) {
      return {
        ...errorFallback,
        note:
          `Bạn đã gọi cùng công cụ với cùng tham số ${doom.counted} lần LIÊN TIẾP ` +
          'mà không thu được gì mới. TUYỆT ĐỐI không lặp lại. Hãy: (1) thử một công cụ ' +
          'khác, (2) đổi tham số, hoặc (3) nếu đang vướng thì nói thẳng với người dùng ' +
          'bạn vướng ở đâu và cần họ hỗ trợ gì.',
      };
    }
    try {
      /* Che bí mật Ở ĐÂY vì đây là điểm duy nhất mọi kết quả tool SERVER đi qua:
         đường native không serialize gì (SDK tự nhét kết quả vào ngữ cảnh) nên
         không có hook nào khác chặn được. Chỉ áp lên KẾT QUẢ (observation) —
         TUYỆT ĐỐI không áp lên args model sinh ra: args bị che sẽ khiến model
         viết lại đúng nội dung đã che vào file ở step sau.

         THỨ TỰ QUAN TRỌNG: redact PHẢI chạy TRƯỚC cap. Lý do: `capToolResult`
         ghi phần bị cắt ra đĩa để `fs_read` đọc lại. Nếu cap chạy trước,
         `capToolResult` nhận nội dung CHƯA redact và ghi thẳng ra đĩa — bí mật
         nằm ở phần giữa (phần bị lược khỏi ngữ cảnh) sẽ thoát mọi lớp che, vì
         không còn gì che nó trên đường về context nữa. Che đúng thứ bị ghi đĩa,
         không phải đúng thứ bị cắt khỏi context. */
      return capToolResult(redactSecretsDeep(await run()));
    } catch {
      // Giữ hành vi cũ: lỗi network/upstream trả payload "trống + note" để
      // model tự chọn hướng đi thay vì văng exception làm đứt step.
      return { ...errorFallback, note: 'Công cụ tạm thời không khả dụng.' };
    }
  }

  const serverTools = {
    web_search: tool({
      description:
        'Tìm kiếm thông tin HIỆN TẠI trên web công khai (tin tức, giá cả, sự kiện sau thời điểm ' +
        'kiến thức của bạn). Trả về danh sách kết quả có title/url/snippet. Khi trình bày kết quả, ' +
        'luôn trích dẫn nguồn dạng [tên ngắn](url).',
      parameters: z.object({
        query: z
          .string()
          .min(1)
          .max(300)
          .describe('Cụm từ tìm kiếm — viết ngắn gọn, chứa từ khóa chính'),
        count: z.number().int().min(1).max(8).optional().describe('Số kết quả tối đa (mặc định 5)'),
      }),
      execute: async (args) =>
        guarded(
          'web_search',
          args,
          async () => {
            const { hits } = await searchWeb(args.query);
            // Host từ kết quả search trở nên HỢP LỆ để web_fetch ở step sau —
            // đây là đường provenance chính thống duy nhất.
            for (const hit of hits) {
              const host = hostOf(hit.url);
              if (host) knownHosts.add(host);
            }
            // Lọc injection trên title+snippet TRƯỚC khi trả cho model.
            const clean = hits.filter(
              (h) => judgeInjection(`${h.title}\n${h.snippet}`) !== 'block',
            );
            const results = capHits(clean, args.count ?? WEB_LIMITS.maxHits);
            return {
              results,
              ...(results.length === 0 && hits.length > 0
                ? { note: 'Mọi kết quả đều chứa mẫu prompt-injection nên đã bị lọc bỏ.' }
                : {}),
            };
          },
          { results: [] },
        ),
    }),

    web_fetch: tool({
      description:
        'Đọc nội dung văn bản của một URL public cụ thể (bài báo, tài liệu, trang chủ...). ' +
        'Chỉ đọc được trang tĩnh — không đăng nhập, không click. ' +
        'RÀNG BUỘC: URL phải xuất hiện trong kết quả web_search của cùng hội thoại hoặc do ' +
        'người dùng gửi; URL lấy từ nội dung một trang khác sẽ BỊ TỪ CHỐI. Cần đọc trang chưa ' +
        'từng thấy thì gọi web_search trước.',
      parameters: z.object({
        url: z.string().max(2048).describe('URL http(s) đầy đủ cần đọc'),
      }),
      execute: async (args) =>
        guarded(
          'web_fetch',
          args,
          async () => {
            /* Provenance check: host lạ (không nằm trong tin nhắn user hay kết
               quả search) → từ chối TRƯỚC khi fetch. Đây là hàng rào chống kịch
               bản "trang A bảo model đọc trang B" — B phải tự qua search/user. */
            const host = hostOf(args.url);
            if (!host || !knownHosts.has(host)) {
              return {
                url: args.url,
                content: null,
                blocked: 'provenance' as const,
                note:
                  'URL không có nguồn gốc rõ ràng (không nằm trong kết quả tìm kiếm hay tin nhắn ' +
                  'người dùng) nên không được đọc. Hãy tìm kiếm trước rồi mới đọc.',
              };
            }
            const page = await fetchReadablePage(args.url);
            // Injection guard trên NỘI DUNG trang — vector nguy hiểm nhất vì
            // model sẽ đọc nó ở step kế tiếp như "dữ liệu đáng tin".
            if (judgeInjection(page.content) === 'block') {
              return {
                url: page.url,
                title: page.title,
                content: null,
                blocked: 'injection' as const,
                note: 'Nội dung trang chứa mẫu prompt-injection rõ ràng nên đã bị chặn khỏi ngữ cảnh.',
              };
            }
            return {
              url: page.url,
              title: page.title,
              content: page.content,
              truncated: page.truncated,
            };
          },
          { url: args.url, content: null },
        ),
    }),

    ...(memories.length
      ? {
          memory_search: tool({
            description:
              'Tra kho GHI NHỚ DÀI HẠN mà người dùng đã yêu cầu lưu (sở thích, tên gọi, quy ước ' +
              'làm việc, ràng buộc cá nhân). CHỈ gọi khi: (a) người dùng nhắc tới thiết lập/sở ' +
              'thích cá nhân của chính họ, (b) họ hỏi "tôi đã nói gì về…", "bạn còn nhớ…", hoặc ' +
              '(c) yêu cầu cần biết quy ước riêng của họ mới làm đúng được. ' +
              'KHÔNG gọi cho câu hỏi kiến thức chung, câu hỏi về code, hay khi đã đủ thông tin ' +
              'để trả lời — kho ghi nhớ nhỏ và không liên quan tới kiến thức phổ thông.',
            parameters: z.object({
              query: z.string().min(1).max(200).describe('Từ khóa cần tra, ví dụ "ngôn ngữ ưa thích"'),
            }),
            execute: async (args) =>
              guarded(
                'memory_search',
                args,
                async () => {
                  const matches = searchMemories(memories, args.query);
                  return {
                    matches,
                    totalMemories: memories.length,
                    note: matches.length ? undefined : 'Không có ghi nhớ nào khớp.',
                  };
                },
                {},
              ),
          }),
        }
      : {}),

    /* memory_save LUÔN có mặt (kể cả khi memories rỗng — đó chính là cách
       fact đầu tiên được lưu). Execute phía server CHỈ validate và chấp nhận
       đề xuất: việc ghi thật vào IndexedDB thuộc về client (route phát
       annotation {memoryProposal}, chat-interface gọi addMemory) vì DB nằm
       trong trình duyệt của user. */
    memory_save: tool({
      description:
        'Lưu một THÔNG TIN DÀI HẠN về người dùng để các hội thoại sau nhớ lại (sở thích, tên gọi, ' +
        'quy ước làm việc, ràng buộc cá nhân). CHỈ gọi khi người dùng yêu cầu nhớ rõ ràng ("nhớ giúp ' +
        'mình...", "ghi lại...") hoặc khi họ chia sẻ fact quan trọng cần tái sử dụng. Một lần gọi = ' +
        'MỘT câu ngắn độc lập, không lưu nội dung nhạy cảm (mật khẩu, số thẻ).',
      parameters: z.object({
        text: z.string().min(4).max(400).describe('Câu ghi nhớ ngắn gọn, đứng độc lập, ví dụ "Người dùng thích code style functional TS"'),
      }),
      execute: async (args) =>
        guarded(
          'memory_save',
          args,
          async () => {
            const verdict = validateMemoryProposal(args.text, memories);
            if (!verdict.ok) {
              return {
                accepted: false,
                note: verdict.reason,
              };
            }
            // Chấp thuận KHÔNG có nghĩa là đã ghi — client mới là nơi ghi.
            return {
              accepted: true,
              text: verdict.text,
              note: undefined,
            };
          },
          { accepted: false },
        ),
    }),
  };

  /* Cờ include* CHỈ còn hiệu lực khi caller yêu cầu tường minh. Mặc định
     KHÔNG gỡ tool nữa dù lượt này đã prefetch dữ liệu: regex đoán ý định có
     thể trích sai địa điểm/truy vấn, gỡ tool đi thì model mất đường sửa sai.
     Route hiện dùng ghi chú trong system prompt thay cho việc gỡ. */
  if (opts.includeWeb === false) {
    Reflect.deleteProperty(serverTools, 'web_search');
    Reflect.deleteProperty(serverTools, 'web_fetch');
  }
  return serverTools;
}

/* ------------------------------------------------------------------ */
/* CLIENT TOOLS — agent coding trên trình duyệt                        */
/* ------------------------------------------------------------------ */

/**
 * fs_* tools KHÔNG có execute: AI SDK v4 phát tool-call rồi dừng step, client
 * (useChat onToolCall) thực thi trên File System Access API rồi tự resubmit
 * với kết quả (maxSteps phía useChat). File nằm trong máy user nên server
 * không thể — và không được phép — chạm vào.
 *
 * Chỉ hoạt động trên đường NATIVE function calling. Đường emulated lọc các
 * tool này ra (xem route) vì client-execution protocol của nó khác.
 */
/* ------------------------------------------------------------------ */
/* Manual sinh TỰ ĐỘNG từ schema thật                                  */
/* ------------------------------------------------------------------ */

/**
 * Trước đây danh mục tool được viết tay ở 3 nơi (bảng TOOL_PROTOCOL_LINES,
 * TOOLS_MANUAL trong emulated-agent, chuỗi [Tools] trong route) và đã drift
 * thật — bản emulated thiếu hẳn start_line/line_count của fs_read khiến model
 * luôn đọc full file. Giờ mọi mô tả đều sinh từ CHÍNH object tool đang chạy.
 */

/** Tên kiểu ngắn gọn cho một zod schema, phục vụ dòng `args: {...}`. */
function zodTypeName(schema: unknown): string {
  const def = (schema as { _def?: { typeName?: string; innerType?: unknown; type?: unknown } })?._def;
  switch (def?.typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodArray':
      return `${zodTypeName(def.type)}[]`;
    case 'ZodObject':
      return 'object';
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodNullable':
      return zodTypeName(def.innerType);
    default:
      return 'any';
  }
}

function isOptionalSchema(schema: unknown): boolean {
  const typeName = (schema as { _def?: { typeName?: string } })?._def?.typeName;
  return typeName === 'ZodOptional' || typeName === 'ZodDefault';
}

/** `{"path": string, "start_line"?: number}` từ schema z.object thật. */
function formatArgsSignature(parameters: unknown): string {
  const def = (parameters as { _def?: { typeName?: string; shape?: () => Record<string, unknown> } })?._def;
  if (def?.typeName !== 'ZodObject' || typeof def.shape !== 'function') return '{}';
  const shape = def.shape();
  const parts = Object.entries(shape).map(
    ([key, value]) => `"${key}"${isOptionalSchema(value) ? '?' : ''}: ${zodTypeName(value)}`,
  );
  return `{${parts.join(', ')}}`;
}

export interface ToolLikeForDocs {
  description?: string;
  parameters?: unknown;
}

/**
 * Registry dùng CHO TÀI LIỆU: chính các object tool sẽ chạy lúc runtime.
 * Server tool dựng một lần với memories giả để memory_search có mặt — chỉ
 * đọc `.description`/`.parameters` nên không chạm mạng.
 */
let docRegistryCache: Record<string, ToolLikeForDocs> | null = null;
function getDocRegistry(): Record<string, ToolLikeForDocs> {
  if (docRegistryCache) return docRegistryCache;
  docRegistryCache = {
    ...(buildAgentTools({
      memories: [{ id: '__doc__', text: '__doc__' }],
    }) as unknown as Record<string, ToolLikeForDocs>),
    ...(CLIENT_TOOL_DEFS as unknown as Record<string, ToolLikeForDocs>),
  };
  return docRegistryCache;
}

/**
 * Sinh từ TOOL_CATALOG, nguồn sự thật duy nhất. Bản viết tay trước đây đã
 * drift: thiếu delegate + bg_run/bg_status/bg_stop nên manual emulated không
 * bao giờ mô tả chúng. Ai thêm tool vào catalog là list này tự đủ.
 */
export const ALL_TOOL_PROTOCOL_NAMES: readonly string[] = Object.freeze(
  TOOL_CATALOG.map((t) => t.name),
);

/**
 * Render manual ĐẦY ĐỦ (mô tả + chữ ký args) cho các tool khả dụng.
 *
 * CHỈ dùng cho đường EMULATED: ở đó không có kênh tool-call native nên toàn
 * bộ schema phải nằm trong text. Mô tả lấy nguyên văn từ object tool đang
 * chạy nên ràng buộc (provenance của web_fetch, ngưỡng dòng của
 * fs_edit/fs_write...) luôn tới được model.
 *
 * KHÔNG dùng cho đường native: SDK đã gửi name/description/parameters qua
 * trường `tools` của API, chèn thêm manual là trả tiền token hai lần (~960
 * token mỗi request). Đường đó dùng formatToolNameList().
 */
export function formatToolProtocolManual(
  toolNames: Iterable<string>,
  /**
   * Tool không nằm trong registry tĩnh (MCP từ Electron main chẳng hạn) —
   * chúng chỉ tồn tại trong request hiện tại nên không thể cache vào
   * `docRegistryCache`.
   */
  extraRegistry?: Record<string, ToolLikeForDocs>,
): string {
  const registry = extraRegistry
    ? { ...getDocRegistry(), ...extraRegistry }
    : getDocRegistry();
  const lines: string[] = [];
  for (const name of toolNames) {
    const def = registry[name];
    if (!def) continue;
    const description = (def.description ?? '').replace(/\s+/g, ' ').trim();
    lines.push(`- ${name}: ${description} args: ${formatArgsSignature(def.parameters)}`);
  }
  return lines.join('\n');
}

/**
 * Danh sách TÊN tool kèm nhãn cực ngắn — dùng cho đường native, nơi mô tả
 * đầy đủ đã đi qua trường `tools` của API. Chỉ để nhắc model rằng những
 * capability này tồn tại và nên chủ động dùng. Nhãn lấy từ TOOL_CATALOG
 * (bản viết tay cũ thiếu delegate + bg_*).
 */
export const TOOL_SHORT_LABELS: Record<string, string> = Object.fromEntries(
  TOOL_CATALOG.map((t) => [t.name, t.shortLabel]),
);

export function formatToolNameList(toolNames: Iterable<string>): string {
  const parts: string[] = [];
  for (const name of toolNames) {
    const label = TOOL_SHORT_LABELS[name];
    parts.push(label ? `${name} (${label})` : name);
  }
  return parts.join(', ');
}
/* ------------------------------------------------------------------ */
/* Validate đề xuất ghi nhớ — thuần, test được                         */
/* ------------------------------------------------------------------ */

export interface MemoryVerdict {
  ok: boolean;
  /** Text đã chuẩn hóa khi ok. */
  text?: string;
  reason?: string;
}

/** Trần ký tự mỗi đề xuất — khớp MAX_MEMORY_CHARS ở db.ts. */
const MEMORY_TEXT_CHARS = 400;

export function validateMemoryProposal(
  rawText: string,
  existingMemories: MemoryItem[],
): MemoryVerdict {
  const text = (rawText ?? '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_TEXT_CHARS);
  if (text.length < 4) {
    return { ok: false, reason: 'Ghi nhớ quá ngắn/không có nội dung.' };
  }
  // Không cho nội dung web/injection chui vào kho dài hạn — đây là dữ liệu
  // sống sót qua nhiều phiên nên phải sạch hơn mọi nơi khác.
  if (judgeInjection(text) === 'block') {
    return { ok: false, reason: 'Nội dung chứa mẫu prompt-injection nên bị từ chối.' };
  }
  if (existingMemories.some((m) => m.text === text)) {
    return { ok: false, reason: 'Ghi nhớ này đã tồn tại.' };
  }
  return { ok: true, text };
}

/* ------------------------------------------------------------------ */
/* Subagent delegation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Tool `delegate` — giao việc cho agent con chạy context RIÊNG.
 *
 * HÀM chứ không phải hằng trong `CLIENT_TOOL_DEFS`: danh sách agent đọc từ đĩa ở
 * mỗi request, nên mô tả phải dựng lại. Hằng module-level bị đóng băng lúc
 * import và sẽ liệt kê agent người dùng vừa xoá, hoặc thiếu agent vừa thêm.
 *
 * `agent` là tên file trong `.vyen/agents/`. Model CHỌN tên theo `description`
 * rồi viết `task` — không soạn brief mỗi lần. Bỏ trống `agent` = bộ tool đầy đủ,
 * giữ được hành vi cũ cho người chưa tạo file agent nào.
 */
export function buildDelegateTool(registry: AgentRegistry): Tool {
  const catalog = describeAgents(registry);
  const agentHint = catalog
    ? `Agent có sẵn:\n${catalog}\n`
    : 'Chưa có file agent nào trong .vyen/agents/ — bỏ trống `agent` để chạy với bộ tool đầy đủ.\n';

  return tool({
    description:
      'GIAO VIỆC cho subagent chạy context RIÊNG (không thấy lịch sử chat này).\n\n' +
      agentHint +
      '\nChọn `agent` theo việc cần làm, rồi viết `task` cụ thể cho nó. ' +
      'Agent chỉ có đúng các tool trong khai báo của nó — ví dụ agent chỉ-đọc không có ' +
      'fs_write, nên đừng bảo nó sửa code.\n' +
      'context: "brief" kèm tóm tắt bối cảnh phiên cha, dùng khi task cần hiểu chuyện đã xảy ra trước đó.',
    parameters: DELEGATE_PARAMETERS,
  });
}
