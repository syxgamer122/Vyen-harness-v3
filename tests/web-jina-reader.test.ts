/**
 * Lưới cứu trang JS-heavy — Jina Reader (không cần API key).
 *
 * Lịch sử: bản đầu của file này test TinyFish Search + Fetch (2 engine cần
 * key). Cả hai đã gỡ khi dự án chuyển sang BYOK 100% — không giữ dịch vụ cần
 * key của bên thứ ba. Phần còn lại (đọc trang SPA/JS-heavy khi bộ trích tại
 * chỗ trả rỗng) chuyển sang Jina Reader `r.jina.ai`, cũng công khai.
 *
 * Vì sao chỉ ở đường phụ: nó đẩy URL người dùng qua bên thứ ba, chậm hơn nhiều
 * và hạn mức mơ hồ — trang tĩnh bình thường phải đi đường chính (regex tại
 * chỗ), không được gọi lưới này.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchReadablePage, __clearSearchCache, __setFetchImpl } from '@/lib/web-backend';

const SPA_HTML = '<html><head><title>App</title></head><body><div id="root"></div></body></html>';
const STATIC_HTML =
  '<html><head><title>Tĩnh</title></head><body><article><p>Nội dung thật, đủ dài.</p></article></body></html>';

const JINA_OK =
  'Title: Trang SPA\n\nURL Source: https://spa.example/\n\nMarkdown Content:\n# Tiêu đề\n\nNội dung do Jina render.';

function htmlRes(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
function textRes(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

beforeEach(() => __clearSearchCache());
afterEach(() => {
  __setFetchImpl(null);
  vi.unstubAllGlobals();
  __clearSearchCache();
});

describe('fetchReadablePage — Jina Reader là lưới cứu duy nhất', () => {
  it('trang SPA rỗng → Jina render được', async () => {
    __setFetchImpl(
      
      vi.fn(async (url: string) =>
        String(url).startsWith('https://r.jina.ai/') ? textRes(JINA_OK) : htmlRes(SPA_HTML),
      ),
    );

    const page = await fetchReadablePage('https://spa.example/');
    expect(page.title).toBe('Trang SPA');
    expect(page.content).toContain('Jina render');
  });

  it('Jina hỏng → giữ nguyên lỗi gốc WEB_EMPTY_CONTENT', async () => {
    __setFetchImpl(
      
      vi.fn(async (url: string) =>
        String(url).startsWith('https://r.jina.ai/') ? textRes('', 503) : htmlRes(SPA_HTML),
      ),
    );

    await expect(fetchReadablePage('https://spa.example/')).rejects.toMatchObject({
      code: 'WEB_EMPTY_CONTENT',
    });
  });

  it('trang tĩnh bình thường KHÔNG gọi Jina (đường chính vẫn nhanh)', async () => {
    const urls: string[] = [];
    __setFetchImpl(
      
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return htmlRes(STATIC_HTML);
      }),
    );

    const page = await fetchReadablePage('https://static.example/');
    expect(page.content).toContain('Nội dung thật');
    expect(urls.some((u) => u.includes('r.jina.ai'))).toBe(false);
  });

  it('SSRF guard chặn URL private TRƯỚC khi chạm Jina', async () => {
    const spy = vi.fn();
    __setFetchImpl(spy);
    await expect(fetchReadablePage('http://169.254.169.254/latest/meta-data')).rejects.toMatchObject(
      { code: 'WEB_URL_BLOCKED' },
    );
    expect(spy).not.toHaveBeenCalled();
  });
});