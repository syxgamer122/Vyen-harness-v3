/**
 * Preview output shell không được BAO GIỜ rỗng khi còn dữ liệu, và phải đúng
 * giới hạn BYTE.
 *
 * ============ LỖI ĐÃ KIỂM CHỨNG ============
 *
 * `truncateShellOutput` (lib/ipc.cjs) cắt preview bằng vòng lặp:
 *
 *   let cutAt = preview.length - LIMITS.SHELL_OUTPUT_PREVIEW_BYTES;
 *   while (cutAt < preview.length && !Number.isFinite(parseInt(preview[cutAt], 10)) === false) cutAt += 1;
 *
 * Điều kiện đó KHÔNG kiểm tra surrogate (như chú thích còn lại nói) mà nhảy qua
 * các CHỮ SỐ (`parseInt` của ký tự số ra số hữu hạn ⇒ điều kiện đúng). Hệ quả:
 * với output là MỘT dòng dài toàn chữ số, vòng lặp đi tới cuối ⇒ `preview` bị
 * cắt hết ⇒ **rỗng** ⇒ model không thấy gì, chỉ còn dòng "full output saved to ...".
 *
 * Đo (probe trên đúng hàm production): output 60.000 chữ số ⇒ `text.length === 0`.
 */
import { describe, expect, it } from 'vitest';
import { truncateShellOutput, LIMITS } from '@/lib/ipc.cjs';

describe('preview output shell', () => {
  it('không bao giờ rỗng khi còn dữ liệu', () => {
    const r = truncateShellOutput('1'.repeat(60_000), 'stdout');
    expect(r.truncated).toBe(true);
    expect(r.text.length, 'preview phải có nội dung').toBeGreaterThan(0);
    expect(Buffer.byteLength(r.text, 'utf8')).toBeLessThanOrEqual(
      LIMITS.SHELL_OUTPUT_PREVIEW_BYTES,
    );
  });

  it('đúng giới hạn byte khi nội dung nhiều ký tự nhiều byte', () => {
    const r = truncateShellOutput('😀'.repeat(30_000), 'stdout');
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(r.text, 'utf8')).toBeLessThanOrEqual(
      LIMITS.SHELL_OUTPUT_PREVIEW_BYTES,
    );
  });

  it('output ngắn thì giữ nguyên, không cắt', () => {
    const r = truncateShellOutput('xin chào\n', 'stdout');
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('xin chào\n');
  });
});
