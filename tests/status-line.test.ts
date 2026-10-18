/**
 * Hàng trạng thái "đang soạn câu trả lời" — không được mang ký tự trang trí.
 *
 * Quyết định 2026-10-18 (chủ repo): dòng này xấu và đọc sai. Nó từng mở đầu bằng
 * `<span>$</span>` — motif terminal mà sáu panel khác vẫn dùng — nhưng nó nằm
 * trong `role="status"`, tức vùng mà trình đọc màn hình công bố. Người dùng nghe
 * bằng tai nghe được câu *"dollar, đang soạn câu trả lời"*: một ký tự KHÔNG mang
 * nghĩa lọt vào phần được đọc thành tiếng.
 *
 * Ở `environment: 'node'` nên không render được React — assert soi SOURCE.
 * Xem chú thích đầu `tests/composer-affordances.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Nội dung phần tử có `role="status"` đầu tiên, hoặc `null` nếu không có. */
function statusRegion(rel: string): string | null {
  const m = code(rel).match(/<p[^>]*role="status"[^>]*>([\s\S]*?)<\/p>/);
  return m ? m[1] : null;
}

describe('hàng trạng thái đang soạn', () => {
  const region = statusRegion('components/chat/message-list.tsx');

  it('tồn tại vùng role="status"', () => {
    // Chống test xanh vì lý do sai: nếu phần tử biến mất, phần dưới sẽ
    // "không tìm thấy ký tự $ nào" và xanh — tức canh nhầm thứ.
    expect(region).not.toBeNull();
  });

  it('không chứa ký tự trang trí rơi trần, kể cả dạng text node lơ lửng', () => {
    expect(region).not.toBeNull();
    // `>$<` = một text node chỉ chứa `$`. `>\s*` để bắt cả `$` lẻ trước
    // thẻ kế cận. Chỉ soi TRONG vùng status, không soi cả file: sáu panel
    // khác cố ý giữ `$` làm nhãn mở đầu, không phải thứ cần gỡ ở đây.
    expect(region!).not.toMatch(/>\s*\$\s*</);
  });

  it('vẫn nói rõ đang làm gì', () => {
    expect(region).toContain('đang soạn câu trả lời');
  });

  it('còn hiện số giây đã chờ — đó mới là tín hiệu "còn sống"', () => {
    expect(region!).toMatch(/tabular-nums/);
  });
});
