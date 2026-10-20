import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  SYSTEM_BIN_DIRS,
  buildSafePath,
  getSafeEnv,
  resolveBinaryAbsolute,
} from '@/lib/shell-policy.cjs';

/**
 * S3 — đóng residual B1: không còn `shell: true` ở executor nội bộ, binary được
 * resolve TUYỆT ĐỐI trong thư mục hệ thống thay vì PATH kế thừa.
 *
 * Các test này là hàng rào chống tái phát: nếu ai đó đặt lại `shell: true` hoặc
 * trả `path` kế thừa vào SAFE_ENV, chúng đỏ ngay.
 */

describe('resolveBinaryAbsolute — không phụ thuộc PATH kế thừa', () => {
  it('trả đường dẫn tuyệt đối cho binary hệ thống', () => {
    if (process.platform === 'win32') return; // chỉ assert trên POSIX
    const resolved = resolveBinaryAbsolute('ls');
    expect(resolved).not.toBeNull();
    expect(resolved!.startsWith('/')).toBe(true);
    expect(resolved).toContain('/');
  });

  it('trả null cho binary không tồn tại — KHÔNG fallback sang PATH', () => {
    expect(resolveBinaryAbsolute('definitely-not-a-real-binary-xyz')).toBeNull();
  });

  it('từ chối đường dẫn tùy ý (tránh thoát khỏi thư mục hệ thống)', () => {
    expect(resolveBinaryAbsolute('../../bin/sh')).toBeNull();
    expect(resolveBinaryAbsolute('/bin/sh')).toBeNull();
    expect(resolveBinaryAbsolute('bin/sh')).toBeNull();
    expect(resolveBinaryAbsolute('')).toBeNull();
  });

  it('chỉ tra trong thư mục hệ thống tin cậy', () => {
    const allowed = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
    for (const dir of SYSTEM_BIN_DIRS) {
      if (process.platform === 'win32') {
        const lower = dir.toLowerCase();
        const isWindowsOrNodeOrGit = lower.includes('windows') || lower.includes('node') || lower.includes('git');
        expect(isWindowsOrNodeOrGit).toBe(true);
      } else {
        expect(allowed).toContain(dir);
      }
    }
  });
});

describe('buildSafePath / getSafeEnv — PATH không còn kế thừa', () => {
  it('PATH chỉ gồm thư mục hệ thống tin cậy, loại bỏ node_modules/.bin (C-01)', () => {
    const p = buildSafePath('/ws/project');
    expect(p).not.toContain('node_modules');
    expect(p).not.toContain('.bin');
    for (const dir of SYSTEM_BIN_DIRS) {
      expect(p).toContain(dir);
    }
  });

  it('không chứa thư mục PATH độc hại của người dùng', () => {
    const p = buildSafePath('/ws/project');
    expect(p).not.toContain('/tmp');
    expect(p).not.toContain('.local/bin');
    expect(p).not.toContain('/home/');
  });

  it('getSafeEnv đặt PATH mới, không giữ PATH kế thừa', () => {
    const inherited = process.env.PATH || '';
    const env = getSafeEnv('/ws/project');
    expect(env.PATH).toBeTruthy();
    expect(env.PATH).toBe(buildSafePath('/ws/project'));

    // Nếu PATH của môi trường test có thư mục lạ, nó KHÔNG được truyền xuống.
    const delimiter = path.delimiter;
    for (const dir of inherited.split(delimiter)) {
      if (!dir) continue;
      if (SYSTEM_BIN_DIRS.includes(dir)) continue;
      if (dir.includes('node_modules')) continue;
      expect(env.PATH?.split(delimiter)).not.toContain(dir);
    }
  });

  it('vẫn giữ biến an toàn và LANG, vẫn cắt biến nguy hiểm', () => {
    const env = getSafeEnv('/ws/project');
    expect(env.LANG).toBe('C.UTF-8');
    for (const key of Object.keys(env)) {
      const l = key.toLowerCase();
      expect(l.startsWith('node_')).toBe(false);
      expect(l.startsWith('ld_')).toBe(false);
      expect(l.startsWith('git_')).toBe(false);
      expect(l.startsWith('npm_')).toBe(false);
    }
  });
});

/**
 * `lib/safe-spawn.ts` ĐÃ BỊ XOÁ (2026-10-20).
 *
 * Grep toàn cây: `spawnArgv`/`runArgvCommand` chỉ còn được **test này** gọi —
 * executor nội bộ đã bị gỡ cùng CLI/teamwork headless (2026-10-15). Theo
 * AGENTS.md §6 ("code chết thì xoá hẳn") thì xoá cả file lẫn phần test của nó,
 * thay vì giữ lại "có thể sau này cần". Phần còn lại của file này kiểm
 * `lib/shell-policy.cjs` — đó là module ĐANG chạy thật (qua `lib/ipc.cjs`).
 */

/*
 * Khối "không còn shell:true trong executor nội bộ" đã bị XOÁ (2026-10-15): cả ba
 * file nó quét (`lib/teamwork/sandbox/process-manager.ts`,
 * `lib/teamwork/permission-broker.ts`, `lib/cli/cli-surface.ts`) đều bị gỡ cùng
 * CLI/teamwork headless. Để lại danh sách rỗng thì vòng lặp luôn xanh — test rỗng.
 */
