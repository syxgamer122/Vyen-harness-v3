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
 *
 * ============ VÌ SAO KHÔNG SIẾT NHÁNH KHỚP OAN ============
 *
 * Đo 2026-10-20: nhánh `(?:unsupported|invalid|unknown|…) … (tool|function)` khớp
 * oan `Invalid schema for function 'fs_read'` và `unknown tool name`. Trông như lỗi
 * ⇒ dễ nghĩ phải siết. NHƯNG đường giả lập gửi tool dạng **VĂN BẢN** (không gửi
 * JSON schema) ⇒ lỗi "Invalid schema" / "unknown tool" ở đường native CÓ THỂ chạy
 * được ở đường giả lập ⇒ hạ cấp 10 phút không phải tổn thất thật, mà là cứu.
 *
 * Còn siết mẫu dùng chung thì rủi ro làm hỏng hành vi web đang chạy (web dùng đúng
 * mẫu này để thử lại không tools khi gateway chê). ⇒ Chỉ BỔ SUNG, không siết.
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
    /* Cách diễn đạt mà mẫu cũ BỎ SÓT — đo 2026-10-20 bằng chính mẫu này (không
     * suy đoán): 4 cách gateway thật dùng mà mẫu cũ không khớp ⇒ tính năng
     * không bật được đúng lúc cần. Chỉ BỔ SUNG ⇒ không làm hỏng case nào đang
     * chạy (web dùng đúng mẫu này để thử lại không tools). */
    String.raw`function\s+calling\s+(?:is|are)\s+(?:not\s+supported|unsupported|not\s+available)`,
    String.raw`(?:unsupported|invalid|unknown)\s+parameter[:\s]+['"]?\s*(?:tools?|functions?|tool_choice|function_call)\b`,
    String.raw`tools?\s+parameter\s+(?:is\s+)?(?:not\s+supported|unsupported|not\s+allowed)`,
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
