/**
 * Escape arg trước khi đi qua `cmd.exe /d /c <wrapper.cmd>` (CVE-2024-27998).
 *
 * ============ TẠI SAO TEST Ở ĐÂY ============
 *
 * Bản đầu test này gọi `lib/safe-spawn.ts` — file ĐÃ BỊ XOÁ 2026-10-20 vì là
 * code chết (grep toàn cây: chỉ test này dùng). Nhưng **hành vi** nó canh thì
 * ĐANG CHẠY THẬT trong `lib/ipc.cjs` (`escapeBatchArg` — dùng cho mọi wrapper
 * `.cmd`/`.bat`), nên phải chuyển test sang đó chứ không xoá luôn.
 *
 * Wrapper batch của pnpm/yarn/corepack nội suy `%*`, nên `&` hay `%VAR%` nằm trong
 * arg THÔ sẽ bị cmd diễn giải thành lệnh thật (second-order expansion).
 */
import { describe, it, expect } from 'vitest';
import { escapeBatchArg } from '@/lib/ipc.cjs';

describe('escapeBatchArg — chuẩn bị arg cho cmd.exe', () => {
  it('TỪ CHỐI ký tự điều khiển (null byte, CR, LF)', () => {
    expect(() => escapeBatchArg('hello\0world')).toThrow();
    expect(() => escapeBatchArg('hello\rworld')).toThrow();
    expect(() => escapeBatchArg('hello\nworld')).toThrow();
  });

  it('NHÂN ĐÔI % để chặn nội suy biến môi trường cmd.exe', () => {
    expect(escapeBatchArg('%PATH%')).toBe('%%PATH%%');
    expect(escapeBatchArg('echo %USERPROFILE%')).toBe('"echo %%USERPROFILE%%"');
    expect(escapeBatchArg('%COMSPEC% & calc.exe')).toBe('"%%COMSPEC%% & calc.exe"');
  });

  it('BỌC DẤU NHÁY khi có khoảng trắng hoặc metacharacter', () => {
    expect(escapeBatchArg('hello world')).toBe('"hello world"');
    expect(escapeBatchArg('a\tb')).toBe('"a\tb"');
    for (const ch of ['&', '|', '^', '<', '>', '(', ')']) {
      expect(escapeBatchArg(`a${ch}b`)).toBe(`"a${ch}b"`);
    }
  });

  it('NHÂN ĐÔI dấu nháy kép bên trong', () => {
    expect(escapeBatchArg('param"value')).toBe('"param""value"');
    expect(escapeBatchArg('"already_quoted"')).toBe('"""already_quoted"""');
  });

  it('KHÔNG đụng vào arg đơn giản', () => {
    expect(escapeBatchArg('build')).toBe('build');
    expect(escapeBatchArg('--filter=package-a')).toBe('--filter=package-a');
    expect(escapeBatchArg('file_name.ts')).toBe('file_name.ts');
  });
});
