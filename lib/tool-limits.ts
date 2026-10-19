/**
 * NGUỒN SỰ THẬT DUY NHẤT cho mọi trần liên quan tới vòng đời tool.
 *
 * Trước đây các trần này nằm rải rác và không dẫn xuất từ nhau:
 *   - route.ts        maxSteps: 8        (server, native)
 *   - chat-interface  maxSteps: 48       (client, resubmit fs_*)
 *   - emulated-agent  10 rounds × 3 calls, result 6.000 ký tự
 *   - context-budget  TOOL_RESULT_ESTIMATE_CHARS: 24.000
 *   - fs-access       MAX_READ_CHARS: 24.000
 *
 * Hệ quả: đường native để lọt tool result 24k vào context còn đường emulated
 * cắt còn 6k (lệch 4 lần cho cùng một tác vụ), và ước lượng ngân sách dùng
 * một con số thứ ba. File này buộc chúng dẫn xuất từ một gốc chung.
 */

/* ------------------------------------------------------------------ */
/* Kích thước kết quả                                                  */
/* ------------------------------------------------------------------ */

/**
 * Trần ký tự (JSON đã serialize) cho MỘT kết quả tool khi đưa vào ngữ cảnh
 * model. Áp cho CẢ hai đường native và emulated — trước đây chỉ emulated có.
 * Bằng đúng MAX_READ_CHARS của fs_read để một lần đọc file đầy trần không bị
 * cắt thêm lần nữa.
 */
/**
 * HẠN CHẾ CỦA FILE NÀY: phải chạy được trong bundle TRÌNH DUYỆT
 * (`react/use-chat-orchestration.ts:57` import từ đây). Vì vậy KHÔNG import
 * `lib/ipc.cjs` — nó kéo `child_process` + `net` và sẽ hỏng bản build trình
 * duyệt.
 *
 * Bản 1 đã vi phạm chính điều này: `serializeToolResult` nằm ở đây và nạp
 * `ipc.cjs` bằng `eval('require')` để lách bundler. Nó qua mọi gate — `tsc`,
 * `lint`, `next build`, và cả full suite — nhưng trong sản phẩm
 * `.next/server/chunks/` không có `ipc.cjs`, `require` ném `MODULE_NOT_FOUND`,
 * `try/catch` nuốt, và spill im lặng không bao giờ chạy. Phần spill đã chuyển
 * sang `lib/tool-result-server.ts` — cùng cách `lib/agent-tools-server.ts`
 * tách phần native.
 *
 * Ở đây chỉ còn phép tính thuần, không I/O.
 */
export const TOOL_RESULT_MAX_CHARS = 24_000;

/**
 * Độ dài JSON của một giá trị — dùng để cắt mảng mà không phá hình dạng,
 * và để ước lượng kích thước tool result.
 *
 * ============ VÌ SAO Ở ĐÂY ============
 *
 * Trước đây có BA bản sao: một private trong `lib/context-budget.ts`, một private
 * trong `lib/tool-result-server.ts`, và một `serializedLength` y hệt trong file đó.
 * Ba bản của cùng một phép tính là "hai nguồn sự thật" (`AGENTS.md` §6) — hôm nay
 * khớp, ngày mai lệch, và người sau không biết phải sửa bản nào.
 *
 * File này là chỗ chung: `lib/context-budget.ts` (chạy được cả trong bundle trình
 * duyệt) và `lib/tool-result-server.ts` (chỉ Node) đều import được, và ở đây chỉ
 * có phép tính thuần, không I/O.
 */
export function jsonLengthOf(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}


/**
 * Tỷ lệ giữ phần ĐẦU khi middle-truncate. Đầu thường là metadata/khai báo,
 * đuôi thường chứa kết luận — giữ cả hai, bỏ ruột.
 */
export const TOOL_RESULT_HEAD_RATIO = 0.7;
export const TOOL_RESULT_TAIL_RATIO = 0.25;

/**
 * Middle-truncate một kết quả tool đã serialize. Dùng chung cho native lẫn
 * emulated để hai đường nhận CÙNG lượng thông tin.
 */
export function truncateToolResult(
  serialized: string,
  maxChars: number = TOOL_RESULT_MAX_CHARS,
): string {
  if (serialized.length <= maxChars) return serialized;
  const head = serialized.slice(0, Math.floor(maxChars * TOOL_RESULT_HEAD_RATIO));
  const tail = serialized.slice(-Math.floor(maxChars * TOOL_RESULT_TAIL_RATIO));
  return `${head}\n...[đã cắt bớt ${serialized.length - head.length - tail.length} ký tự ở giữa]...\n${tail}`;
}

/* ------------------------------------------------------------------ */
/* Số lần gọi                                                          */
/* ------------------------------------------------------------------ */

/**
 * Số step tối đa của một request /api/chat phía server (native function
 * calling). Mỗi step = một vòng model↔tool.
 */
export const SERVER_MAX_STEPS = 8;

/**
 * KHÔNG CÒN TRẦN BƯỚC CLIENT.
 *
 * Số lần useChat tự resubmit sau khi client thực thi tool — trước đây là trần
 * 48 (CLIENT_MAX_STEPS). Trần cứng đó giết task agent dài: chạm 48 bước là
 * useChat ngừng resubmit, onFinish không chốt gì (finishReason vẫn
 * 'tool-calls'), stall detector 20s sau chỉ stop im lặng — agent "tắt ngóm"
 * giữa task mà không một thông báo. Không coding agent nào (Claude Code,
 * Codex CLI, Cline, Aider) tự đặt trần bước per-task kiểu này; họ chỉ dừng
 * khi model không còn gọi tool hoặc người dùng bấm dừng.
 *
 * useChat (ai v4.3) cần maxSteps >= 2 để bật auto-resubmit, nên dùng
 * MAX_SAFE_INTEGER làm "vô cực thực dụng". An toàn vì:
 *  - doom-loop guard phía client (executeClientToolCall) chặn lặp y hệt;
 *  - doom-loop guard phía server (guarded/checkDoomLoop) chặn web/memory;
 *  - run-lifecycle: RUN_DEADLINE_MS 10 phút + stall detector 20s vẫn hiển
 *    thị/dừng run chết thật (mất mạng, upstream treo);
 *  - người dùng luôn bấm được Dừng.
 * Chi phí token của vòng lặp dài là trách nhiệm của model + người dùng xem
 * thấy, không phải việc harness tự chặn tay mình.
 */
export const CLIENT_MAX_STEPS_UNBOUNDED = Number.MAX_SAFE_INTEGER;

/** Đường emulated: số vòng model↔tool. Round cuối bị ép trả prose. */
export const EMU_MAX_ROUNDS = 10;
/** Đường emulated: số tool call tối đa parse được trong MỘT phản hồi. */
export const EMU_MAX_CALLS_PER_ROUND = 5;

/**
 * Ngưỡng doom-loop: cùng một (tool, args) xuất hiện bao nhiêu lần LIÊN TIẾP
 * thì trả steering message thay vì kết quả tool. evot dùng 3 — ngưỡng này đủ
 * để bắt vòng lặp thật (model không nhận được gì mới sau 2 lần gọi) mà không
 * cản trở tác vụ lặp hợp lý (user có thể muốn đọc lại file sau khi sửa).
 */
export const DOOM_LOOP_THRESHOLD = 3;

/* ------------------------------------------------------------------ */
/* Kích thước payload tool-result gửi lên (sửa BAD_SCHEMA toolInvocations) */
/* ------------------------------------------------------------------ */

/**
 * Trần số `toolInvocations` trong MỘT message assistant khi gửi lên server.
 * Phải BẰNG `MAX_TOOL_INVOCATIONS_PER_REQUEST` của app/api/chat/route.ts — server
 * trả 400 BAD_SCHEMA (`too_big`) khi vượt, và useChat im lặng chết giữa lượt
 * agent. Bằng trần server, không hơn: client rộng hơn thì server vẫn 400 (vô
 * nghĩa), hẹp hơn thì cắt oan.
 */
export const MAX_TOOL_INVOCATIONS_PER_MESSAGE = 64;

/**
 * Số invocation cũ giữ lại khi phải cắt.
 *
 * Tiêu chí KHÔNG phải "cắt cho vừa 64" mà là "giữ đúng phần model còn dùng
 * được": mọi tool result đã sinh ra đều là dữ kiện mà model có thể cần đọc
 * lại (nó không tự biết mình đã đọc file nào trừ khi log còn trong ngữ cảnh).
 * Nhưng phần cũ đã được `content` của chính message đó tóm tắt lại — useChat
 * nối text mỗi vòng vào `message.content` (appendResponseMessages), nên đọc
 * dọn nhất là đọc `content` cho phần đầu, còn `toolInvocations` chỉ cần giữ
 * đuôi gần nhất ở dạng thô để model không phải đoán.
 *
 * 64 là trần TỔNG của cả message (kể cả phần giữ thêm này), nên con số này
 * chỉ là phần "nguyên văn" của ngân sách đó.
 */
export const RECENT_TOOL_INVOCATIONS_KEPT = 32;

/** Một invocation tool ở đúng hình dạng AI SDK gửi lên (`Message.toolInvocations`). */
export interface ToolInvocationLike {
  step?: number;
  toolCallId: string;
  toolName: string;
  state: string;
  args?: unknown;
  result?: unknown;
}

/**
 * Cắt `toolInvocations` của MỘT message assistant về trần payload.
 *
 * VÌ SAO CẦN: `useChat` không tạo message assistant mới mỗi vòng tool —
 * `appendResponseMessages` nối invocation mới vào ĐÚNG message assistant cuối
 * (`lastMessage.toolInvocations = [...cũ, ...mới]`, maxStep tăng 1 mỗi vòng).
 * Nên một lượt agent dài làm mảng này PHÌNH LÊN mãi: log thật của workspace
 * "Neurobics Dashboard Design (10)" có các vòng 2+4+5+8+13+12+9+8 = 61
 * invocation trước vòng cuối 26 → vượt trần 64 và giết cả lượt. Đây là lý do
 * nâng trần 12→64 không giải quyết được gì: con số chỉ bị đẩy lên cao hơn
 * trước khi lượt agent kịp dài tới.
 *
 * Cắt ở đuôi (giữ mới, bỏ cũ) vì thứ tự trong mảng là thứ tự thời gian và
 * `step` tăng dần: phần đuôi là vòng model vừa thực hiện, còn phần đầu đã nằm
 * trong `content` dạng tóm tắt. Hàm thuần, không mutate input.
 */
export function trimToolInvocations<T extends ToolInvocationLike>(
  invocations: readonly T[],
  max: number = MAX_TOOL_INVOCATIONS_PER_MESSAGE,
  keepRecent: number = RECENT_TOOL_INVOCATIONS_KEPT,
): T[] {
  if (invocations.length <= max) return invocations.slice();
  return invocations.slice(-keepRecent);
}

/* ------------------------------------------------------------------ */
/* Ước lượng ngân sách                                                 */
/* ------------------------------------------------------------------ */

/**
 * Trần ký tự khi ƯỚC LƯỢNG token của một tool result. Bằng trần thật để
 * ContextMeter không báo thấp hơn lượng thực sự gửi đi.
 */
export const TOOL_RESULT_ESTIMATE_CHARS = TOOL_RESULT_MAX_CHARS;

/**
 * Trần ký tự cho phần THÂN kết quả tool người dùng bấm vào xem (tool-trace
 * mở khoảng 1 tool call/lượt, và người dùng đọc để kiểm chứng chứ không để
 * nuôi model).
 *
 * Thấp hơn TOOL_RESULT_MAX_CHARS (24k) có chủ ý: TOOL_RESULT_MAX_CHARS bảo vệ
 * ngân sách CONTEXT của model, con số này bảo vệ render — 4k là đủ đọc một
 * stack trace hay một khối diff mà không làm khung chat nhảy layout.
 */
export const TOOL_PREVIEW_MAX_CHARS = 4_000;
