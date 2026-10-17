/**
 * Subagent không được ghi file ngoài phạm vi được giao.
 *
 * Trước khi có lớp này, `SCOUT_DENIED_CLIENT_TOOLS` chặn theo TÊN TOOL và
 * comment của chính nó thừa nhận: git_add/git_commit vẫn gọi được, "muốn
 * chặn git phải qua permission layer". Nghĩa là một subagent được giao
 * `tests/a.test.ts` vẫn sửa được `src/` và `.git/` của workspace cha.
 *
 * Bản sửa bọc `resolveClientTool` bằng CapBAC trong executeDelegate — chặn
 * theo ĐƯỜNG DẪN. Test này khoá hành vi đó.
 */

import { describe, expect, it } from 'vitest';

describe('CapBAC — subagent bị chặn ghi ngoài phạm vi', () => {
  it('scope mặc định KHÔNG cho ghi vào src/', async () => {
    const { createCapabilityScope, validateSubagentPermission } = await import(
      '@/core/agent-runtime/capability-context'
    );
    const scope = createCapabilityScope({
      subagentId: 'test',
      parentChatId: 'p',
      allowedTools: ['fs_read', 'fs_list', 'fs_write', 'fs_edit'],
      writePatterns: ['tests/**', 'scratch/**', 'tmp/**'],
    });

    const blocked = validateSubagentPermission(scope, 'fs_write', { path: 'src/app.ts' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/bị cấm ghi/i);
  });

  it('scope mặc định cho ghi vào tests/', async () => {
    const { createCapabilityScope, validateSubagentPermission } = await import(
      '@/core/agent-runtime/capability-context'
    );
    const scope = createCapabilityScope({
      subagentId: 'test',
      parentChatId: 'p',
      // allowedTools phải khai rõ: mặc định của createCapabilityScope KHÔNG
      // có fs_write (chỉ fs_read/fs_list/run_code) — đó là allowlist đầu tiên,
      // kiểm trước cả quyền ghi theo path.
      allowedTools: ['fs_read', 'fs_list', 'fs_write', 'fs_edit'],
      writePatterns: ['tests/**', 'scratch/**', 'tmp/**'],
    });

    const ok = validateSubagentPermission(scope, 'fs_write', { path: 'tests/a.test.ts' });
    expect(ok.allowed).toBe(true);
  });

  it('CHẶN .git/ dù thoáng qua git tool', async () => {
    const { createCapabilityScope, validateSubagentPermission } = await import(
      '@/core/agent-runtime/capability-context'
    );
    const scope = createCapabilityScope({
      subagentId: 'test',
      parentChatId: 'p',
      allowedTools: ['fs_read', 'fs_list', 'fs_write', 'fs_edit'],
      writePatterns: ['tests/**'],
    });

    // deniedPatterns mặc định chặn .git/** — đây là lỗ hổng cũ của scout.
    for (const p of ['.git/config', '.git/hooks/pre-commit', 'node_modules/x/y.js']) {
      const v = validateSubagentPermission(scope, 'fs_write', { path: p });
      expect(v.allowed, `${p} phải bị chặn`).toBe(false);
    }
  });

  it('CHẶN file secret .env — lỗ hổng fail-open của matchesSimpleGlob cũ', async () => {
    const { createCapabilityScope, validateSubagentPermission } = await import(
      '@/core/agent-runtime/capability-context'
    );
    const scope = createCapabilityScope({
      subagentId: 'test',
      parentChatId: 'p',
      allowedTools: ['fs_read', 'fs_list', 'fs_write', 'fs_edit'],
      writePatterns: ['tests/**'],
    });

    // `.env*` KHÔNG khớp `.env` hay `.env.local` với glob so chuỗi thuần.
    for (const p of ['.env', '.env.local', 'config/.env.production']) {
      const v = validateSubagentPermission(scope, 'fs_write', { path: p });
      expect(v.allowed, `${p} phải bị chặn`).toBe(false);
    }
  });

  it('tool ngoài allowedTools bị chặn ở allowlist đầu tiên', async () => {
    const { createCapabilityScope, validateSubagentPermission } = await import(
      '@/core/agent-runtime/capability-context'
    );
    // createCapabilityScope mặc định KHÔNG cấp fs_write — chỉ fs_read,
    // fs_list, run_code. Đây là lớp chặn đầu, đứng trước cả quyền theo path.
    const scope = createCapabilityScope({ subagentId: 'test', parentChatId: 'p' });

    const v = validateSubagentPermission(scope, 'fs_write', { path: 'tests/a.test.ts' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/không có quyền gọi tool/i);
  });
});