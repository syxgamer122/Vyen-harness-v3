/**
 * Chuyển `CoreMessage[]` (AI SDK v4) sang `BudgetMessageLike[]` (hình dạng UI message)
 * để phép đo token của `lib/context-budget.ts` nhìn thấy **cả** tool result.
 *
 * ============ VÌ SAO CẦN ============
 *
 * `lib/context-budget.ts` đếm token theo hình dạng **UI message** (`ai/react`):
 * `part.text` + `message.toolInvocations`. Còn `CoreMessage` thì:
 *
 *   - `ToolCallPart` / `ToolResultPart` **không có field `text`**;
 *   - `CoreMessage` **không có field `toolInvocations`**.
 *
 * Đo thật 2026-10-19: lịch sử chứa một tool result 24.000 ký tự bị ước lượng thành
 * **5** token thay vì **~6.000**. Thiếu 1.200× ⇒ compaction không bao giờ kích hoạt.
 *
 * ============ BẤT BIẾN 1:1 ============
 *
 * `splitForCompaction` trả `firstKept` là **chỉ số** vào mảng được truyền vào. Adapter
 * làm rơi message nào thì chỉ số lệch ⇒ điểm cắt rơi nhầm ⇒ phần giữ lại có thể bắt đầu
 * bằng `tool-result` mồ côi ⇒ provider từ chối **mọi** lượt sau của phiên.
 * Nên: **mỗi `CoreMessage` ra đúng một entry**, kể cả message `role:'tool'`.
 *
 * ============ MỘT TOOL CALL = MỘT INVOCATION ============
 *
 * `CoreMessage` tách tool-call (trong assistant) và tool-result (trong message `tool`)
 * thành hai message. Nhưng hình dạng UI message gộp chúng thành **một** invocation
 * (`ToolInvocation` có cả `args` lẫn `result`). Các hàm có sẵn của
 * `lib/context-compaction.ts` — `extractFileOps` đọc `inv.args.path`,
 * `describeToolInvocation` đọc cả `inv.args` lẫn `inv.result` — đều giả định hình dạng
 * gộp. Tách ra hai invocation thì `serializeForCompaction` sinh **hai** dòng mô tả cho
 * một tool call, và `toolInvocationChars` đếm trùng phần args.
 *
 * Nên: invocation **sống ở message chứa tool-result**, mang theo args của tool-call.
 * Tool-call chưa có kết quả thì invocation `state:'call'` nằm ở chính message assistant.
 */
import type { CoreMessage } from 'ai';
import type { BudgetMessageLike } from '@/lib/context-budget';

type Invocation = NonNullable<BudgetMessageLike['toolInvocations']>[number];

/**
 * Part của `CoreMessage`.
 *
 * Ép kiểu cục bộ vì `CoreMessage` là hợp của 4 kiểu message, mà `content` của chúng
 * là 4 hình dạng khác nhau (`string` | mảng part của user | mảng part của assistant |
 * mảng `ToolResultPart`). Thuộc tính `content` là chung, nhưng `part.type` thì không
 * thuộc hẹp — nên phải gom về một kiểu phẳng để so khớp `type`.
 */
type Part = {
  type?: string;
  text?: unknown;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
};

function partsOf(message: CoreMessage): Part[] {
  return Array.isArray(message.content) ? (message.content as Part[]) : [];
}

/** Phần text thuần của message — tool call/result không có `text` nên không vào đây. */
function textOf(message: CoreMessage): string {
  if (typeof message.content === 'string') return message.content;
  let out = '';
  for (const part of partsOf(message)) {
    if (typeof part.text === 'string') out += part.text;
  }
  return out;
}

/**
 * Chuyển `CoreMessage[]` sang `BudgetMessageLike[]` — 1:1, giữ nguyên thứ tự.
 *
 * Mỗi tool call sinh **đúng một** invocation: nếu đã có tool-result thì invocation
 * (kèm `args` + `result`) nằm ở message chứa kết quả; nếu chưa có thì invocation
 * `state:'call'` nằm ở message assistant.
 */
export function toBudgetMessages(messages: readonly CoreMessage[]): BudgetMessageLike[] {
  // Gom args theo toolCallId trước, để invocation của tool-result biết args.
  const argsById = new Map<string, unknown>();
  for (const message of messages) {
    for (const part of partsOf(message)) {
      if (part.type === 'tool-call' && part.toolCallId) argsById.set(part.toolCallId, part.args);
    }
  }
  // Id nào đã có kết quả — để tool-call không sinh invocation riêng nữa.
  const coKetQua = new Set<string>();
  for (const message of messages) {
    for (const part of partsOf(message)) {
      if (part.type === 'tool-result' && part.toolCallId) coKetQua.add(part.toolCallId);
    }
  }

  const out: BudgetMessageLike[] = [];
  for (const message of messages) {
    const invocations: Invocation[] = [];
    for (const part of partsOf(message)) {
      if (part.type === 'tool-call' && part.toolCallId) {
        if (coKetQua.has(part.toolCallId)) continue; // invocation nằm ở message kết quả
        invocations.push({
          toolName: part.toolName,
          state: 'call',
          args: part.args,
        });
      } else if (part.type === 'tool-result' && part.toolCallId) {
        invocations.push({
          toolName: part.toolName,
          state: 'result',
          args: argsById.get(part.toolCallId),
          result: part.result,
        });
      }
    }
    out.push({
      role: message.role,
      content: textOf(message),
      ...(invocations.length > 0 ? { toolInvocations: invocations } : {}),
    });
  }
  return out;
}
