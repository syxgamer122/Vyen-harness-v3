/**
 * Core Agent Runtime — Tool Runner (Tầng 1: Zero React Dependencies).
 *
 * ## Trạng thái: chỉ còn MỘT phần còn dùng thật
 *
 * File này từng là một engine thực thi công cụ đầy đủ (~900 dòng): điều phối
 * fs_/shell_run/git_/mcp_, kiểm TOCTOU bằng baseHash, CWD jail, sinh approval
 * token, abort plumbing. Tất cả đã bị thay bằng đường thật ở
 * `react/use-chat-orchestration.ts` + `lib/agent-tools.ts`:
 *
 *   - chat_only      → use-chat-orchestration.ts:1489 (chặn trước mọi tool)
 *   - plan mode      → :1843 (fs_edit), :1969 (fs_write)
 *   - CWD jail       → `lib/path-utils.ts` validateSafeRelativePath, dùng ở :2072
 *   - TOCTOU         → :2044-2053 (orchestration) + `lib/fs-access.ts:512` (tầng ghi)
 *   - approval token → :1151 gọi thẳng `lib/approval-binding.ts`
 *
 * `tests/tool-deny.test.ts:141` còn khóa rằng chat-interface.tsx KHÔNG chứa
 * `new ToolRunner(` — tức dự án đã cố ý bỏ đường dùng cuối cùng.
 *
 * Vì vậy phần còn lại chỉ giữ `validateShellAllowlist` — hàm duy nhất được
 * import từ đường sống thật (`use-chat-orchestration.ts:3`, dùng cho `bg_run`).
 *
 * XOÁ 14 export còn lại + class `ToolRunner` vào 2026-10-10: không export nào
 * trong số đó có caller sản phẩm, và mọi chốt an toàn nó can đều được enforce
 * mạnh hơn ở đường live. Bản gốc còn ở `.audit-backup-20261010/tool-runner.ts`
 * khi workspace chưa phải git repo.
 */

import { compileShellCommand } from '@/lib/shell-policy.cjs';

interface ShellValidationResult {
  ok: boolean;
  compiled?: { bin: string; args: string[] };
  reason?: string;
}

/**
 * Kiểm tra lệnh shell theo danh sách allowlist và từ chối các ký tự metacharacter nguy hiểm.
 *
 * Chạy cùng `compileShellCommand` mà `lib/ipc.cjs` dùng ở tiến trình chính, nên
 * kiểm ở đây chỉ là lớp thứ hai — không phải nơi duy nhất chặn.
 */
export function validateShellAllowlist(command: string): ShellValidationResult {
  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, reason: 'Lệnh shell rỗng hoặc không hợp lệ.' };
  }

  try {
    const compiled = compileShellCommand(command);
    return { ok: true, compiled };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message };
  }
}