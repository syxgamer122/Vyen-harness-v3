/**
 * Thang mức suy luận — nguồn duy nhất (`Effort`, menu UI, validate ở route).
 *
 * Tách riêng thành module KHÔNG import gì: `provider-url` kéo
 * `reasoning-capability` (để parse metadata), nếu `reasoning-capability` lại
 * kéo `provider-url` để lấy hằng thì hai bên đứng trước nhau trong vòng import
 * và hằng chưa khởi tạo lúc đọc.
 *
 * `none` = tắt suy luận, chỉ dùng khi model khai chấp nhận.
 */
export const THINKING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'high';

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value);
}
