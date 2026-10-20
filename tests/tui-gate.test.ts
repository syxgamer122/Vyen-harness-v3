/**
 * Cổng vào của TUI: một hàm THUẦN, không đụng process, không đụng terminal.
 *
 * ============ VÌ SAO TÁCH RA HÀM THUẦN ============
 *
 * Quyết định "mở TUI hay không" là quyết định **hành vi**, không phải chi tiết
 * cài đặt: `-p` (một lượt rồi thoát), pipe (không có TTY), `VYEN_PLAIN=1`
 * (đường thoát an toàn) và Node quá cũ đều phải rơi về REPL cũ, y nguyên.
 * Nếu quyết định này nằm rơi trong `cli/index.ts` thì không test được — mà
 * không test được thì không có gì chặn "lần sau lỡ tay bật TUI trong CI".
 *
 * Hàm trả về **lý do** chứ không chỉ true/false: khi rơi về plain, `main()`
 * cần in đúng một dòng giải thích, thay vì im lặng.
 */
import { describe, expect, it } from 'vitest';
import { chooseFrontend } from '@/cli/tui-gate';

const base = {
  print: false,
  stdinIsTTY: true,
  stdoutIsTTY: true,
  env: {} as { VYEN_PLAIN?: string },
  nodeVersion: '26.12.0',
};

describe('chooseFrontend', () => {
  it('-p luôn là print, kể cả trong TTY', () => {
    expect(chooseFrontend({ ...base, print: true })).toEqual({ kind: 'print' });
  });

  it('pipe stdin → plain, lý do not-tty', () => {
    expect(chooseFrontend({ ...base, stdinIsTTY: false })).toEqual({
      kind: 'plain',
      reason: 'not-tty',
    });
  });

  it('pipe stdout → plain, lý do not-tty', () => {
    expect(chooseFrontend({ ...base, stdoutIsTTY: undefined })).toEqual({
      kind: 'plain',
      reason: 'not-tty',
    });
  });

  it('VYEN_PLAIN=1 → plain, lý do forced', () => {
    expect(chooseFrontend({ ...base, env: { VYEN_PLAIN: '1' } })).toEqual({
      kind: 'plain',
      reason: 'forced',
    });
  });

  it('Node 26.3.9 → plain, lý do node-too-old', () => {
    expect(chooseFrontend({ ...base, nodeVersion: '26.3.9' })).toEqual({
      kind: 'plain',
      reason: 'node-too-old',
    });
  });

  it('Node 26.4.0 và TTY → tui', () => {
    expect(chooseFrontend({ ...base, nodeVersion: '26.4.0' })).toEqual({ kind: 'tui' });
  });

  it('Node 27 và TTY → tui', () => {
    expect(chooseFrontend({ ...base, nodeVersion: '27.0.0' })).toEqual({ kind: 'tui' });
  });
});
