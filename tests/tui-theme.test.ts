/**
 * Hợp đồng màu của TUI: phải khớp brand, và phải đọc được trên nền tối.
 *
 * ============ VÌ SAO CẦN TEST NÀY ============
 *
 * TUI có bảng màu RIÊNG (nền tối), khác hẳn bảng màu web (nền sáng). Nhưng
 * "riêng" không được nghĩa là "tự do chọn màu": màu nhấn phải là màu brand,
 * nếu không thì CLI trông như của sản phẩm khác.
 *
 * Và màu brand của web **không** dùng được ở đây: `--accent #0B7A53` trên nền
 * `#0a0a0a` chỉ đạt 3.70:1 — trượt WCAG AA cho chữ. Bảng màu terminal lấy màu
 * sáng hơn của chính brand (`greenBot`/`greenTop`/`mouth`) vì nền đảo ngược.
 */
import { describe, expect, it } from 'vitest';
import mark from '@/brand/mark.json';
import { theme } from '../cli/tui/theme';

/** Độ sáng tương đối theo WCAG (sRGB → linear → luminance). */
function linear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string): number {
  const [cao, thap] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (cao + 0.05) / (thap + 0.05);
}

describe('bảng màu TUI', () => {
  it('màu nhấn là màu brand, không phải màu riêng', () => {
    expect(theme.accent).toBe(mark.palette.greenBot);
    expect(theme.accentBright).toBe(mark.palette.greenTop);
    expect(theme.accentDeep).toBe(mark.palette.mouth);
  });

  it('mọi màu dùng để viết chữ đạt WCAG AA trên nền TUI', () => {
    for (const ten of ['text', 'muted', 'accent', 'error', 'warning'] as const) {
      const c = contrast(theme[ten], theme.bg);
      expect(c, `${ten} trên nền chỉ đạt ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('con trỏ (accentBright) nổi hơn hẳn màu nhấn thường', () => {
    expect(contrast(theme.accentBright, theme.bg)).toBeGreaterThan(
      contrast(theme.accent, theme.bg),
    );
  });

  it('mọi màu là hex 6 ký tự — OpenTUI không nhận số hay hex thiếu #', () => {
    for (const gia of Object.values(theme)) {
      /* Chữ hoa phải được chấp nhận: `brand/mark.json` viết hoa (`#2F9462`), và
         test parity đòi khớp **chính xác** với file đó — nên bảng màu TUI
         cũng phải hoa. Regex chỉ cho chữ thường sẽ bắt nhầm bảng màu đúng. */
      expect(gia).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
