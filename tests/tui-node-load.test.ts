/**
 * CJS phải gọi được đảo ESM bằng `import()` — trong **tiến trình thật**.
 *
 * ============ VÌ SAO PHẢI SPAWN, KHÔNG TEST TRONG VITEST ============
 *
 * Vitest chạy mọi thứ trong hộp cát của Vite: nó nạp module bằng ESM, nên
 * `import()` ở đó **luôn** thành công — kể cả khi chạy Node thật thì lỗi tương
 * thích ESM/CJS hiện ra. Lỗi ta từng đo được (`ERR_PACKAGE_PATH_NOT_EXPORTED`,
 * "Top-level await is currently not supported with the cjs output format") xảy
 * ra ở **tiến trình thật**, không xảy ra trong vitest.
 *
 * Nên bài này spawn `node --import tsx` và kiểm **exit code** + **stdout** —
 * đúng ranh giới quan sát được (AGENTS.md §2.5 Luật 3).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('đảo ESM nạp được bằng Node thật', () => {
  it('node --import tsx nạp entry.tsx, in marker, exit 0', () => {
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', path.resolve('tests/fixtures/tui-esm-load.ts')],
      { encoding: 'utf8', timeout: 60_000 },
    );
    expect(out).toContain('TUI_ESM_OK');
  });
});
