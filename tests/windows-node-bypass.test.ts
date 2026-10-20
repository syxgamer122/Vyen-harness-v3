/**
 * Bypass cmd.exe cho công cụ Node (npm/npx) — hành vi ĐANG CHẠY THẬT trong
 * `lib/ipc.cjs` (`resolveSpawnTarget`).
 *
 * ============ TẠI SAO TEST Ở ĐÂY ============
 *
 * Bản đầu test này gọi `lib/safe-spawn.ts` — file ĐÃ BỊ XOÁ 2026-10-20 vì là
 * code chết (grep toàn cây: chỉ test này dùng). Hành vi thì vẫn sống (qua
 * `lib/ipc.cjs`) nên test được chuyển sang đó.
 *
 * Vì sao quan trọng: `npm.cmd`/`npx.cmd` là wrapper batch ⇒ chạy qua
 * `cmd.exe /d /c` ⇒ cmd nội suy `%*` ⇒ `%VAR%` và `!VAR!` trong arg sẽ bị cmd
 * **diễn giải thành lệnh thật** (CVE-2024-27998). Chạy thẳng `node npm-cli.js`
 * là cách né hẳn lớp diễn giải đó.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveSpawnTarget } from '@/lib/ipc.cjs';

/** `resolveSpawnTarget` nhận `{bin, args}` — cùng hình dạng `compileShellCommand` trả về. */
function target(bin: string, args: string[]) {
  const r = resolveSpawnTarget({ bin, args });
  if (!r.ok) throw new Error(`resolveSpawnTarget that bai cho ${bin}`);
  return r;
}

describe('resolveSpawnTarget — bypass cmd.exe cho công cụ Node', () => {
  it('npm/npx chạy thẳng node (không qua cmd.exe)', () => {
    if (process.platform !== 'win32') return;
    const npm = target('npm', ['install', '--save-exact']);
    expect(npm.spawnBin).toBe(process.execPath);
    expect(npm.spawnArgs[0].endsWith(path.join('node_modules', 'npm', 'bin', 'npm-cli.js'))).toBe(true);
    expect(npm.spawnArgs).toContain('install');

    const npx = target('npx', ['vitest']);
    expect(npx.spawnBin).toBe(process.execPath);
    expect(npx.spawnArgs[0].endsWith(path.join('node_modules', 'npm', 'bin', 'npx-cli.js'))).toBe(true);
  });

  it('arg phức tạp giữ nguyên (không bị cmd.exe diễn giải)', () => {
    if (process.platform !== 'win32') return;
    const msg = '--msg="Hello !VAR! World"';
    const r = target('npm', ['run', 'build', msg]);
    expect(r.spawnBin).toBe(process.execPath);
    expect(r.spawnArgs[r.spawnArgs.length - 1]).toBe(msg);
  });

  it('wrapper .cmd KHÔNG phải của Node thì rơi về cmd.exe /d /c, arg được escape', () => {
    if (process.platform !== 'win32') return;
    /* `winrm.cmd` là wrapper batch thật trong System32 ⇒ `resolveSpawnTarget`
     * resolve được nó và bọc qua cmd.exe. Wrapper KHÔNG tồn tại thì bị TỪ CHỐI
     * (không có binary trong thư mục hệ thốc tin cậy) — đó cũng là hành vi
     * đúng, và test bên dưới canh riêng. */
    const r = target('winrm.cmd', ['foo', 'bar & baz', '%TEMP%']);
    expect(r.spawnBin.toLowerCase().endsWith('cmd.exe')).toBe(true);
    expect(r.spawnArgs[0]).toBe('/d');
    expect(r.spawnArgs[1]).toBe('/c');
    expect(r.spawnArgs[2].toLowerCase().endsWith('winrm.cmd')).toBe(true);
    expect(r.spawnArgs[3]).toBe('foo');
    /* metacharacter → bọc dấu nháy; `%` → nhân đôi (chặn nội suy). */
    expect(r.spawnArgs[4]).toBe('"bar & baz"');
    expect(r.spawnArgs[5]).toBe('%%TEMP%%');
  });

  it('binary lạ (không có trong thư mục hệ thống tin cậy) thì bị TỪ CHỐI', () => {
    if (process.platform !== 'win32') return;
    const r = resolveSpawnTarget({ bin: 'definitely-not-a-real-binary-xyz.cmd', args: [] });
    expect(r.ok).toBe(false);
  });

  it('binary thường thì spawn thẳng, không bọc cmd.exe', () => {
    if (process.platform !== 'win32') return;
    const r = target('git', ['status']);
    expect(r.spawnBin.toLowerCase().endsWith('cmd.exe')).toBe(false);
    expect(r.spawnArgs).toEqual(['status']);
  });
});
