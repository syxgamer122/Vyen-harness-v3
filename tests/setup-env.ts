/**
 * Dọn biến môi trường trước MỖI file test.
 *
 * Các engine tìm kiếm cần API key (SearXNG/TinyFish/Brave/Tavily) đã gỡ —
 * `lib/web-backend.ts` chỉ còn engine công khai không key, nên env của chúng
 * không còn ảnh hưởng tới kết quả. Vẫn dọn để key thật trên máy dev không bị
 * đọc nhầm, và vì `.env.local` có thể còn sót biến cũ.
 */

const SEARCH_BACKEND_ENV_VARS = [
  'TINYFISH_API_KEY',
  'SEARXNG_URL',
  'BRAVE_SEARCH_KEY',
  'TAVILY_API_KEY',
] as const;

for (const name of SEARCH_BACKEND_ENV_VARS) {
  delete process.env[name];
}
