/**
 * Lớp kiểm thứ hai cho phía renderer trên allowlist shell.
 *
 * Tách khỏi `core-state-machine.test.ts` khi xoá `core/agent-runtime/` — hàm
 * này sống ở `lib/shell-policy.ts` và còn dùng thật ở `use-chat-orchestration.ts`
 * (đường `bg_run`), nên nó không chết cùng phần còn lại của thư mục đó.
 */

import { describe, expect, it } from 'vitest';
import { validateShellAllowlist } from '@/lib/shell-policy';

describe('validateShellAllowlist', () => {
  it('cho qua lệnh đơn giản không có metacharacter', () => {
    expect(validateShellAllowlist('git status').ok).toBe(true);
    expect(validateShellAllowlist('npm test').ok).toBe(true);
  });

  it('chặn lệnh nối bằng dấu chấm phẩy', () => {
    expect(validateShellAllowlist('git status; rm -rf /').ok).toBe(false);
  });

  it('chặn node -e', () => {
    expect(validateShellAllowlist('node -e "process.exit()"').ok).toBe(false);
  });

  it('trả reason khi lệnh rỗng', () => {
    const r = validateShellAllowlist('   ');
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
