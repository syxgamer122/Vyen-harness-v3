/**
 * Negative cache "model này không hỗ trợ function calling" — tránh lặp lại
 * 1 lượt fail + retry mỗi tin nhắn với gateway/model đã biết chê tools.
 *
 * Cùng triết lý với lib/model-negative-cache nhưng tách riêng vì điều kiện
 * khác nhau (lỗi nhắc tool/function thay vì 404 unknown-model). TTL ngắn:
 * gateway có thể được nâng cấp giữa chừng — sau 10 phút thử lại.
 */

import { modelCacheKey } from '@/lib/model-negative-cache';

const TTL_MS = 10 * 60_000;
const entries = new Map<string, number>();

/**
 * Key chuẩn hoá dùng CHUNG với model-negative-cache
 * (host lowercase + model lowercase). Trước đây key dùng nguyên chuỗi baseUrl
 * nên cùng một gateway viết khác nhau (có/không dấu `/` cuối, khác hoa thường)
 * tạo ra entry riêng → cache miss, phải fail thêm một lượt vô ích.
 */
function key(base: string, model: string): string {
  return base ? modelCacheKey(base, model) : `default::${model.toLowerCase()}`;
}

/** true nếu cặp base+model vừa bị đánh dấu chê tools trong TTL hiện tại. */
export function isToolUnsupported(base: string, model: string, now = Date.now()): boolean {
  const at = entries.get(key(base, model));
  if (at === undefined) return false;
  if (now - at >= TTL_MS) {
    entries.delete(key(base, model));
    return false;
  }
  return true;
}

export function markToolsUnsupported(base: string, model: string, now = Date.now()): void {
  // Chống phình: vượt 100 entry thì dọn hết các entry hết hạn.
  if (entries.size >= 100) {
    for (const [k, at] of entries) {
      if (now - at >= TTL_MS) entries.delete(k);
    }
  }
  entries.set(key(base, model), now);
}

/**
 * Mẫu thật đo được: gateway/model nói "tôi không nhận tools / function calling".
 *
 * ============ VÌ SAO KHỚP CÂU TRẢ LỜI, KHÔNG KHỚP CHỮ "tool" ============
 *
 * Mẫu cũ `/tool|function/i` ăn vào **mọi** lỗi có chứa substring đó — kể cả lỗi tool
 * của CHÍNH app ("Error executing tool web_search: fetch failed") ⇒ tước agent của model
 * đó trong 10 phút (negative cache), vĩnh viễn trong TTL, chỉ vì một lần tool hỏng mạng.
 *
 * ⇒ Chỉ khớp khi thông điệp nói **đúng ý**: từ chối tools.
 */
export const TOOLS_UNSUPPORTED_RE = new RegExp(
  [
    String.raw`(?:does ?n[o']t|does not|doesn't|not)\s+(?:currently\s+)?support(?:s)?\s+(?:\w+\s+){0,2}?(?:tool|function|function[- ]calling|tool[- ]use)`,
    String.raw`tool\s*(?:use|calling)?\s*(?:is\s+)?(?:not\s+supported|unsupported|is\s+not\s+available)`,
    String.raw`(?:unsupported|invalid|unknown|unrecognized|unexpected)\s+(?:\w+\s+){0,2}?(?:tool|function)`,
    String.raw`tried to call unavailable tool`,
    String.raw`no tools are available`,
    String.raw`tools?\s+(?:are|is)\s+(?:not\s+supported|unsupported|not\s+allowed|not\s+permitted|not\s+accepted|disabled)`,
    String.raw`(?:does ?n[o']t|does not|doesn't)\s+(?:currently\s+)?accept\s+(?:\w+\s+){0,2}?tools?`,
    String.raw`functions?\s+(?:are|is)\s+(?:not\s+supported|unsupported|not\s+allowed|not\s+permitted)`,
  ].join('|'),
  'i',
);

/** true nếu thông điệp lỗi nói đúng ý "không hỗ trợ tools". */
export function isToolsUnsupportedMessage(msg: string): boolean {
  return TOOLS_UNSUPPORTED_RE.test(msg ?? '');
}
/** Test helper. */
export function resetToolSupportCache(): void {
  entries.clear();
}
