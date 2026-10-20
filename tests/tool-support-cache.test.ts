/**
 * Mẫu nhận diện "model/gateway không hỗ trợ function calling" — dùng chung cho web và CLI.
 *
 * ============ VÌ SAO KHỚP CÂU TRẢ LỜI, KHÔNG KHỚP CHỮ "tool" ============
 *
 * Mẫu cũ `/tool|function/i` ăn vào **mọi** lỗi có chứa substring đó — kể cả lỗi tool
 * của CHÍNH app ("Error executing tool web_search: fetch failed") ⇒ tước agent của model
 * đó trong 10 phút (negative cache), vĩnh viễn trong TTL, chỉ vì một lần tool hỏng mạng.
 *
 * ⇒ Chỉ khớp khi thông điệp nói **đúng ý**: từ chối tools.
 */
import { describe, expect, it } from 'vitest';
import { isToolsUnsupportedMessage } from '@/lib/tool-support-cache';

describe('isToolsUnsupportedMessage', () => {
  it('khớp câu trả lời "không hỗ trợ tools"', () => {
    expect(isToolsUnsupportedMessage('This model does not support tools')).toBe(true);
    expect(isToolsUnsupportedMessage('tools are not supported')).toBe(true);
    expect(isToolsUnsupportedMessage('tool use is not supported')).toBe(true);
    expect(isToolsUnsupportedMessage('This model does not support function calling')).toBe(true);
    expect(isToolsUnsupportedMessage('this model does not currently accept tools')).toBe(true);
  });

  it('KHÔNG khớp lỗi tool của chính app', () => {
    expect(isToolsUnsupportedMessage('Error executing tool web_search: fetch failed')).toBe(false);
    expect(isToolsUnsupportedMessage('rate limit exceeded')).toBe(false);
    expect(isToolsUnsupportedMessage('prompt is too long: 213462 tokens > 200000 maximum')).toBe(false);
  });

  it('KHÔNG khớp lỗi auth hay lỗi mạng', () => {
    expect(isToolsUnsupportedMessage('401 Unauthorized')).toBe(false);
    expect(isToolsUnsupportedMessage('fetch failed')).toBe(false);
  });
});


/* ============ E: CÁCH DIỄN ĐẠT CÒN THIẾU ============
 *
 * Đo 2026-10-20 (bằng chính mẫu đang ship, không suy đoán): 4 cách diễn đạt mà
 * gateway thật dùng KHÔNG khớp mẫu cũ ⇒ tính năng không bật được đúng lúc cần.
 */
describe('isToolsUnsupportedMessage — cách diễn đạt còn thiếu', () => {
  it('khớp "function calling is not supported"', () => {
    expect(isToolsUnsupportedMessage('function calling is not supported')).toBe(true);
    expect(isToolsUnsupportedMessage('Function calling is not supported for this model')).toBe(true);
  });

  it('khớp "Unsupported parameter: tools"', () => {
    expect(isToolsUnsupportedMessage('Unsupported parameter: tools')).toBe(true);
    expect(
      isToolsUnsupportedMessage("Unsupported parameter: 'tools' is not supported with this model"),
    ).toBe(true);
  });

  it('khớp "tools parameter is not supported"', () => {
    expect(isToolsUnsupportedMessage('tools parameter is not supported')).toBe(true);
  });

  it('KHÔNG khớp lỗi tham số KHÁC (sai số/giá trị thường)', () => {
    expect(isToolsUnsupportedMessage('invalid parameter: temperature')).toBe(false);
    expect(isToolsUnsupportedMessage('invalid parameter: max_tokens')).toBe(false);
  });
});
