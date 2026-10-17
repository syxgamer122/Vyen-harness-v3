import type { UIMessage } from 'ai';

/**
 * NGUYÊN NHÂN GỐC BUG 3:
 *   message.parts.map((p) => p.text).join('')
 * Trong AI SDK v5, parts gồm step-start | reasoning | tool-* | source | text.
 * Các part không phải 'text' có p.text === undefined, và Array.join()
 * chuyển undefined thành literal "undefined" => hiện trên UI.
 */
function extractTextFromMessage(message: UIMessage | { parts?: any[]; content?: unknown } | null | undefined): string {
  if (!message) return '';

  const parts = (message as any).parts;
  if (Array.isArray(parts)) {
    let out = '';
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      if (part.type !== 'text') continue;           // bỏ reasoning/tool/step-start
      if (typeof part.text !== 'string') continue;  // chặn undefined/null
      out += part.text;
    }
    return out;
  }

  const legacy = (message as any).content;
  return typeof legacy === 'string' ? legacy : '';
}

/** Text để lưu Dexie / gửi /api/chat — không bao giờ chứa artifact. */
export function toPersistableText(message: UIMessage | { parts?: any[]; content?: unknown } | null | undefined): string {
  return extractTextFromMessage(message).replace(/[\s\u200B]+$/, '');
}