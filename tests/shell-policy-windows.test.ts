/**
 * Policy shell trên Windows — hai lỗi đã kiểm chứng bằng probe:
 *
 * 1. Tokenizer nuốt `\` (coi như escape kiểu POSIX) ⇒ mọi đường dẫn Windows bị
 *    bóp méo: `dir src\components` → `srccomponents`, `git -C C:\repo` → `C:repo`.
 *    Hệ quả bảo mật: `C:Users` KHÔNG còn là đường dẫn tuyệt đối ⇒ path-guard
 *    cho qua ⇒ lệnh đọc ngoài workspace được **tự duyệt** ở Smart mode.
 *
 * 2. Tokenizer không chặn `%VAR%` ⇒ cmd.exe nội suy biến thành đường dẫn thật
 *    (`dir %USERPROFILE%` ⇒ liệt kê `C:\Users\Admin`) trong khi guard chỉ thấy
 *    một tên file tưởng nằm trong workspace.
 *
 * Test ở đây canh **cả tầng biên dịch lệnh** lẫn **tầng auto-approve**
 * (`isSafeCommand`) — lỗi chỉ lộ ra ở tầng thứ hai.
 */
import { describe, expect, it } from 'vitest';
import {
  PolicyError,
  compileShellCommand,
  tokenizeCommandLine,
} from '@/lib/shell-policy.cjs';
import { isSafeCommand } from '@/lib/auto-pilot';

describe('tokenizer — đường dẫn Windows phải tới nguyên vẹn', () => {
  it('giữ dấu phân tách thư mục Windows', () => {
    expect(tokenizeCommandLine('dir src\\components', { windows: true })).toEqual([
      'dir',
      'src\\components',
    ]);
    expect(tokenizeCommandLine('git -C C:\\repo status', { windows: true })).toEqual([
      'git',
      '-C',
      'C:\\repo',
      'status',
    ]);
  });

  it('POSIX giữ luật escape cũ (\\ trước ký tự đặc biệt)', () => {
    expect(tokenizeCommandLine('cat a\\ b', { windows: false })).toEqual(['cat', 'a b']);
  });

  it('compileShellCommand truyền xuống chế độ Windows', () => {
    const compiled = compileShellCommand('dir src\\components', { windows: true });
    expect(compiled.args).toEqual(['src\\components']);
  });
});

describe('tokenizer — biến môi trường kiểu %VAR% bị từ chối', () => {
  it('chặn trên mọi nền tảng (quy tắc không phụ thuộc Windows)', () => {
    expect(() => compileShellCommand('dir %USERPROFILE%', { windows: true })).toThrow(PolicyError);
    expect(() => compileShellCommand('dir %USERPROFILE%', { windows: false })).toThrow(PolicyError);
    expect(() => compileShellCommand('echo %PATH%', { windows: true })).toThrow(PolicyError);
  });

  it('không chặn nhầm định dạng printf', () => {
    expect(compileShellCommand('printf %s', { windows: true }).bin).toBe('printf');
  });
});

describe('path-guard — đường dẫn tuyệt đối ngoài workspace bị chặn', () => {
  it('compileShellCommand chặn đường dẫn tuyệt đối ngoài workspace', () => {
    const root = process.cwd();
    expect(() =>
      compileShellCommand('dir C:\\Users', { workspaceRoot: root, windows: true }),
    ).toThrow(PolicyError);
  });

  it('đường dẫn trong workspace thì qua', () => {
    const root = process.cwd();
    const compiled = compileShellCommand('dir src\\components', {
      workspaceRoot: root,
      windows: true,
    });
    expect(compiled.args).toEqual(['src\\components']);
  });
});

describe('auto-approve (Smart mode) — không được tự chạy lệnh đọc ngoài workspace', () => {
  it('lệnh có %VAR% không được tự duyệt', () => {
    expect(isSafeCommand('dir %USERPROFILE%')).toBe(false);
    expect(isSafeCommand('echo %PATH%')).toBe(false);
  });

  it('đường dẫn Windows tuyệt đối không được tự duyệt', () => {
    expect(isSafeCommand('dir C:\\Users')).toBe(false);
    expect(isSafeCommand('cat C:\\Users\\Admin\\notes.txt')).toBe(false);
  });

  it('lệnh đọc bình thường trong workspace vẫn được tự duyệt', () => {
    expect(isSafeCommand('dir src\\components')).toBe(true);
    expect(isSafeCommand('rg pattern lib')).toBe(true);
  });
});
