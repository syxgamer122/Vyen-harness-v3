/**
 * Bảng màu của TUI — **nơi duy nhất** trong cả bề mặt terminal được viết hex.
 *
 * Component không tự chọn màu: nó lấy từ đây. Lý do không phải "cho gọn" mà
 * vì một màn hình màu rác thì không đọc được, và số màu nhiều hơn 4 thì mắt
 * không biết chỗ nào là trọng tâm.
 *
 * Màu nhấn lấy từ `brand/mark.json` (xanh của logo) chứ không phải từ bảng màu
 * web: web nền sáng nên dùng `--accent #0B7A53` (5.35:1 trên trắng), còn terminal
 * nền tối thì màu đó chỉ còn 3.70:1 — trượt AA cho chữ. Màu brand sáng hơn
 * (`greenBot` 5.22:1, `greenTop` 12.80:1) vừa là màu đúng vừa đọc được.
 * `tests/tui-theme.test.ts` canh cả hai điều đó.
 */

/** Nền, bề mặt, viền. */
export const theme = {
  /** Nền chính của màn hình. */
  bg: '#0a0a0a',
  /** Bề mặt nổi hơn nền (hộp duyệt, dải trạng thái). */
  surface: '#141414',
  /** Viền 1px — luôn mảnh, không đổ bóng (terminal không có đổ bóng). */
  border: '#333333',
  /** Chữ chính. */
  text: '#eeeeee',
  /** Chữ phụ: đối số, gợi ý, chi tiết. */
  muted: '#808080',
  /** Dấu phân cách, hoạ tiết. Trang trí thuần, không mang ý nghĩa. */
  faint: '#5a5a5a',
  /** Màu nhấn: con trỏ, vạch người dùng, trạng thái đang chạy. */
  accent: '#2F9462',
  /** Chỉ dùng cho điểm nhấn mạnh nhất (con trỏ nhấp nháy) — không dùng làm chữ thường. */
  accentBright: '#82E767',
  /** Nhấn sâu hơn, dùng cho nền/đường viền cần tách nền. */
  accentDeep: '#158360',
  /** Lỗi. Luôn đi kèm nhãn hoặc ký hiệu, không bao giờ đứng riêng. */
  error: '#ff6369',
  /** Cảnh báo. Cũng luôn kèm nhãn. */
  warning: '#f5a742',
} as const;

export type Theme = typeof theme;
