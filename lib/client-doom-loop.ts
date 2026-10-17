/**
 * Doom-loop guard cho tool chạy phía CLIENT (fs_*, shell, git, plan_*,
 * MCP… trên máy user).
 *
 * Vì sao cần ở client: fs_* KHÔNG có execute() phía server — route chỉ relay
 * kết quả, server không đếm được call client. Trần bước cũ (CLIENT_MAX_STEPS)
 * từng là "chốt chặn" ngầm cho vòng lặp client; khi bỏ trần (agent không tự
 * cản tay mình), cần một guard thực sự: cùng một (tool, args) lặp LIÊN TIẾP
 * tới ngưỡng thì KHÔNG thực thi nữa — trả note điều hướng để model đổi hướng.
 *
 * Đọc nhiều file / gọi nhiều lệnh khác nhau không bao giờ dính: chữ ký gồm
 * cả args, và chỉ đếm chuỗi LIÊN TIẾP ở đuôi (call khác xen vào reset chuỗi).
 *
 * File này trước đây chứa một bản SAO CHÉP toàn bộ máy trạng thái của
 * `lib/tool-call-budget.ts` (bucket, TTL, sweep, cửa sổ 12, ngưỡng, đếm chuỗi).
 * Nay chỉ còn: tên hàm, kiểu trả về (`blocked` thay vì `triggered`) và chữ ký
 * riêng — mọi thuật toán dùng chung với detector server. State vẫn TÁCH
 * (`namespace: 'client'`) vì một call tool server chen giữa hai call client
 * giống hệt không được reset chuỗi lặp phía client.
 */

import {
  BUDGET_NAMESPACES,
  checkDoomLoop,
  getToolCallBudget,
  __clearAllToolCallBudgets,
} from '@/lib/tool-call-budget';

export interface ClientDoomVerdict {
  /** true khi call NÀY là lần lặp thứ >= ngưỡng — KHÔNG thực thi. */
  blocked: boolean;
  /** Số lần lặp liên tiếp tính cả call hiện tại (khi blocked). */
  counted: number;
}

/** Chữ ký call client — giống stableKey của agent-tools (tên + args JSON). */
export function clientToolSignature(toolName: string, args: unknown): string {
  let raw: string;
  try {
    raw = JSON.stringify(args ?? {});
  } catch {
    raw = String(args);
  }
  return `${toolName}:${raw.slice(0, 300)}`;
}

/**
 * Ghi nhận call client sắp thực thi. Trả blocked=true khi đây là lần lặp
 * LIÊN TIẾP thứ ngưỡng trở lên — caller trả note thay vì chạy.
 *
 * `chatKey` là bucket theo hội thoại. Giữ module-level thay vì ref trong
 * closure: callback của useChat được tạo lại mỗi render, có thể đếm trùng khi
 * StrictMode double-invoke.
 */
export function checkClientDoomLoop(chatKey: string, signature: string): ClientDoomVerdict {
  const result = checkDoomLoop(
    getToolCallBudget(chatKey, BUDGET_NAMESPACES.client),
    signature,
  );
  return { blocked: result.triggered, counted: result.counted };
}

/** Chỉ dùng trong test. */
export function __clearAllClientDoomLoops(): void {
  // Bản sao state đã bị xoá nên bucket client giờ nằm chung map — xoá luôn
  // namespace server cho sạch, giống hàm reset chung.
  __clearAllToolCallBudgets();
}