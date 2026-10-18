/**
 * Serialize + cắt trần kết quả tool cho ĐƯỜNG EMULATED — chỉ chạy ở server.
 *
 * Tách khỏi `lib/tool-limits.ts` theo RUNTIME (cùng nguyên tắc với
 * `lib/agent-tools-server.ts`). Lý do: file này ghi spill xuống đĩa nên cần
 * `lib/ipc.cjs` — mà `ipc.cjs` kéo `child_process` + `net`. `tool-limits.ts`
 * nằm trong bundle trình duyệt (qua `react/use-chat-orchestration.ts:57`), nên
 * không thể import tĩnh ở đó.
 *
 * Bản 1 lách bằng `eval('require')('./ipc.cjs')` ngay trong `tool-limits.ts`.
 * Cách đó qua được `tsc`, qua được `lint`, qua được cả `next build` — nhưng
 * trong sản phẩm `.next/server/chunks/` không có `ipc.cjs`, `require` ném
 * `MODULE_NOT_FOUND`, `try/catch` nuốt, và spill im lặng không bao giờ chạy.
 * Đây là lý do `tests/spill-wiring.test.ts` tồn tại: nó đọc artifact đã build.
 *
 * Ở đây import TĨNH. Turbopack đóng gói `ipc.cjs` đúng MỘT lần cho sản phẩm
 * server, nên đây là cùng instance mà `lib/bridge/server-bridge.ts:75` nạp —
 * cùng registry `savedShellOutputs` mà whitelist `fs_read` đọc.
 *
 * Quy tắc: file này import được `@/lib/tool-limits`. Chiều ngược lại thì không.
 */

import {
  TOOL_RESULT_HEAD_RATIO,
  TOOL_RESULT_MAX_CHARS,
  TOOL_RESULT_TAIL_RATIO,
  truncateToolResult,
} from '@/lib/tool-limits';
import { redactSecretText } from '@/lib/secret-registry';
import * as ipc from '@/lib/ipc.cjs';

const saveSpillText = (ipc as unknown as {
  saveSpillText?: (
    content: string,
    name: string,
  ) => { savedTo: string; bytes: number; notice: string } | null;
}).saveSpillText;

/** Serialize + cắt trần trong một bước. Không bao giờ ném. */
export function serializeToolResult(
  result: unknown,
  maxChars: number = TOOL_RESULT_MAX_CHARS,
): string {
  let raw: string;
  try {
    raw = JSON.stringify(result) ?? 'null';
  } catch {
    raw = '"[kết quả không serialize được]"';
  }
  /* Redact TRƯỚC mọi thứ — kể cả trước khi ghi spill xuống đĩa. Nếu cắt trước
     rồi redact, một khoá nằm vắt qua ranh giới cắt sẽ chỉ còn nửa chuỗi và
     không khớp rule nào nữa → lọt bí mật vào ngữ cảnh. Nếu spill bản thô thì
     khoá ở phần GIỮA (phần hay chứa bí mật nhất) nằm hẳn trên đĩa.
     Đây là chốt chặn cuối của đường emulated (mọi kết quả tool đều đi qua đây)
     — xem lib/secret-registry.ts (SecretRegistry). */
  const redacted = redactSecretText(raw);
  if (redacted.length <= maxChars) return redacted;

  /* Spill: lưu phần bị cắt ra file app tự ghi để fs_read đọc lại được.
     Best-effort — lỗi lưu thì rơi về truncateToolResult y hệt cũ, KHÔNG ném:
     lỗi lưu không được biến một tool call thành công thành isError
     (docs/subsystems/spill.md:92 của deepseek-harness). */
  const spilled = saveSpillText?.(redacted, 'tool-result.txt') ?? null;
  if (spilled) {
    // Chừa sẵn chỗ cho marker và notice rồi mới chia phần còn lại cho đầu/đuôi,
    // để TỔNG không bao giờ vượt maxChars — đó là hợp đồng của TOOL_RESULT_MAX_CHARS.
    const markerLen = 64;
    const room = Math.max(0, maxChars - markerLen - spilled.notice.length - 2);
    const split = TOOL_RESULT_HEAD_RATIO / (TOOL_RESULT_HEAD_RATIO + TOOL_RESULT_TAIL_RATIO);
    const headLen = Math.floor(room * split);
    const tailLen = room - headLen;
    const head = redacted.slice(0, headLen);
    const tail = tailLen > 0 ? redacted.slice(-tailLen) : '';
    const marker = `\n...[đã cắt bớt ${Math.max(0, redacted.length - headLen - tailLen)} ký tự ở giữa]...\n`;
    return `${head}${marker}${tail}\n\n${spilled.notice}`;
  }
  return truncateToolResult(redacted, maxChars);
}