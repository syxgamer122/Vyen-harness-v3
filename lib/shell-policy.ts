/**
 * Chính sách allowlist cho lệnh shell, phía TypeScript.
 *
 * `compileShellCommand` (trong `shell-policy.cjs`) là nguồn sự thật và đã chạy ở
 * tiến trình chính qua `lib/ipc.cjs`. Hàm ở đây chỉ là lớp kiểm thứ hai cho phía
 * renderer — nó KHÔNG phải nơi duy nhất chặn, và không thay thế được lớp kia.
 *
 * Tách ra khỏi thư mục `core/agent-runtime/` khi đợt dọn code chết xoá cả thư mục
 * đó — mọi thứ bên trong lúc đó đã chết hoặc chỉ còn đúng một hàm còn dùng
 * thật. Xem mục 8 của `docs/superpowers/specs/2026-10-17-declarative-agent-definitions-design.md`.
 */

import { compileShellCommand } from '@/lib/shell-policy.cjs';

export interface ShellValidationResult {
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
