/**
 * Cắt trần kết quả tool cho CLI.
 *
 * ============ VÌ SAO CẦN ============
 *
 * Đo 2026-10-19: `git_diff` trả thẳng stdout của git, cap ở
 * `SHELL_OUTPUT_MAX_CHARS = 400_000` (`lib/ipc.cjs:1041`, handler ở `:1509-1516`) —
 * **không spill, không cắt**. Một lần `git_diff` vậy là ~100.000 token nằm trong ngữ
 * cảnh, trong khi phép ước lượng (`lib/context-budget.ts`) chỉ thấy 6.000 (cap
 * `TOOL_RESULT_ESTIMATE_CHARS = 24.000`) ⇒ thiếu **17×** ⇒ compaction không kích hoạt
 * đúng lúc, và provider vẫn từ chối.
 *
 * `shell_run` thì **đã** an toàn: `truncateShellOutput` (`lib/ipc.cjs:654-699`) spill
 * full output ra file rồi trả preview ≤ 10.000 byte + `savedTo`. Thiếu là **tầng
 * generic** cho mọi tool — giống opencode (`packages/core/src/tool-output.ts`).
 *
 * ============ BA HÌNH DẠNG KẾT QUẢ ============
 *
 * Tool của CLI trả ba kiểu khác nhau: `fs_list`/`fs_search` trả **mảng**,
 * `fs_read`/`fs_write` trả **object**, `git_diff`/`git_log` trả **chuỗi thô**. Nên cắt
 * trần phải giữ hình dạng — đổi mảng thành object thì model nhìn thấy thứ khác với
 * lúc nó gọi tool.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeHost, buildIpcTools } from '@/lib/tools/ipc-node';
import { capToolResult, capToolValue } from '@/lib/tool-result-server';
import { TOOL_RESULT_MAX_CHARS } from '@/lib/tool-limits';

describe('capToolValue — cắt trần kết quả tool', () => {
  it('chuỗi dài bị cắt và có notice', () => {
    const out = capToolValue('x'.repeat(100_000)) as string;
    expect(typeof out).toBe('string');
    expect(out.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS + 2_000);
    expect(out).toMatch(/đã cắt|spill|\.txt/);
  });

  it('object dài bị cắt, có truncated và spillNotice', () => {
    const out = capToolResult({ content: 'x'.repeat(100_000) });
    expect(out.truncated).toBe(true);
    expect(typeof out.spillNotice).toBe('string');
  });

  it('giá trị ngắn đi qua nguyên vẹn', () => {
    const o = { a: 1 };
    expect(capToolResult(o)).toBe(o);
    expect(capToolValue('ngan')).toBe('ngan');
  });

  it('mảng dài bị cắt nhưng VẪN LÀ MẢNG, và có dấu hiệu đã cắt', () => {
    const arr = Array.from({ length: 2_000 }, (_, i) => ({ name: `f${i}`, kind: 'file' }));
    const out = capToolValue(arr) as unknown[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeLessThan(arr.length);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS + 2_000);
  });
});

describe('CLI — mọi tool đều đi qua cắt trần', () => {
  it('fs_list trên thư mục nhiều file bị cắt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vyen-cap-'));
    const ud = mkdtempSync(path.join(tmpdir(), 'vyen-ud-'));
    const host = createNodeHost({ workspaceRoot: dir, userDataDir: ud });
    try {
      for (let i = 0; i < 600; i++) {
        writeFileSync(path.join(dir, `file-${String(i).padStart(5, '0')}.txt`), 'x');
      }
      const tools = buildIpcTools(host, { approve: async () => true }) as Record<
        string,
        { execute: (a: unknown) => Promise<unknown> }
      >;
      const out = await tools.fs_list.execute({ path: '.' });
      // Điều kiện tiên quyết: kết quả thô vượt trần — nếu không, test là rỗng.
      expect(Array.isArray(out)).toBe(true);
      expect((out as unknown[]).length).toBeLessThan(600);
      expect(JSON.stringify(out).length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS + 2_000);
    } finally {
      host.dispose();
      rmSync(dir, { recursive: true, force: true });
      rmSync(ud, { recursive: true, force: true });
    }
  });
});
