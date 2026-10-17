import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Bug B1 (nhánh desktop): `content` cắt bởi `maxChars` nhưng `endLine` lấy
 * từ `selected` CHƯA cắt — cùng lỗi với lib/fs-access.ts. Đo thật trên
 * desktop: fs_read trả `endLine` = số dòng file trong khi content dừng dở.
 *
 * Đảo điều kiện (tính endLine từ `endIndex` cũ) → describe này ĐỎ.
 */
const BIG = Array.from({ length: 500 }, (_, i) => `line${i + 1} ${'x'.repeat(200)}`).join('\n');

describe('B1 (desktop) — endLine phản ánh nội dung thực sự trả về', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Bật bridge desktop giả với một file `big.txt`. */
  async function readDesktop() {
    vi.stubGlobal('window', {
      vyen: {
        desktop: true,
        fs: { read: async () => ({ content: BIG, size: BIG.length }) },
      },
    });
    const { desktopFsRead } = await import('@/lib/desktop-fs');
    return desktopFsRead('big.txt');
  }

  it('endLine khớp dòng cuối trong content', async () => {
    const r = await readDesktop();
    expect(r.truncated).toBe(true);
    expect(r.endLine).toBe(r.content.split('\n').length);
    expect(r.content.split('\n').at(-1)).toMatch(/^line\d+ /);
    expect(r.endLine).toBeLessThan(500);
  });

  it('line_count không cắt ký tự → endLine đúng số dòng yêu cầu', async () => {
    vi.stubGlobal('window', {
      vyen: {
        desktop: true,
        fs: { read: async () => ({ content: BIG, size: BIG.length }) },
      },
    });
    const { desktopFsRead } = await import('@/lib/desktop-fs');
    const r = await desktopFsRead('big.txt', { startLine: 1, lineCount: 10 });
    expect(r.endLine).toBe(10);
    expect(r.content.split('\n')).toHaveLength(10);
  });
});
