/**
 * `web_fetch`/`web_search` phải GHIM IP đã kiểm — đóng lỗ hổng DNS rebinding.
 *
 * ============ LỖ HỔNG ĐÃ KIỂM CHỨNG (verifier 2026-10-20) ============
 *
 * `guardedFetch` kiểm hostname + kiểm IP resolve ra, rồi gọi `fetch(url)` —
 * mà `fetch` tự resolve DNS **LẦN THỨ HAI**. Kẻ tấn công điều khiển DNS:
 * trả IP public lúc ta kiểm, trả IP riêng lúc ta nối ⇒ server nối vào mạng
 * nội bộ (probe của verifier: server `127.0.0.1:80` **nhận được request**).
 *
 * ============ CÁCH SỬA ============
 *
 * Tự resolve MỘT lần, kiểm TẤT CẢ địa chỉ, rồi ghim địa chỉ đã kiểm vào tầng
 * nối (`lookup` của `node:http`/`node:https`) ⇒ không còn lần resolve thứ hai.
 */
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { fetchPinned, pickPinnedAddress, resolveAndValidate } from '@/lib/web-fetch-pinned';
import { guardedFetch } from '@/lib/web-backend';

describe('ghim IP — không còn cửa sổ DNS rebinding', () => {
  it('chặn hostname resolve về IP RIÊNG (kiểm thật, không stub)', async () => {
    /* `localtest.me` resolve về 127.0.0.1 (DNS thật). Không stub gì cả ⇒
     * đây là kiểm chứng đường thật, không phải đường lý thuyết. */
    await expect(
      guardedFetch('http://localtest.me/', 5_000),
    ).rejects.toMatchObject({ code: 'WEB_FETCH_FAILED' });
  });

  it('hostname resolve về IP riêng thì resolveAndValidate ném (trừ khi cho phép)', async () => {
    await expect(resolveAndValidate('localtest.me')).rejects.toThrow();
    const ok = await resolveAndValidate('localtest.me', true);
    expect(ok.length).toBeGreaterThan(0);
  });

  it('IP không resolve được thì TỪ CHỐI (fail closed), không bỏ qua', async () => {
    await expect(
      resolveAndValidate('khong-ton-tai-mot-abc-xyz-123.invalid'),
    ).rejects.toThrow(/resolve/i);
  });

  it('chọn địa chỉ ổn định, ưu tiên IPv4', () => {
    expect(
      pickPinnedAddress([
        { address: '::1', family: 6 },
        { address: '93.184.216.34', family: 4 },
      ]),
    ).toEqual({ address: '93.184.216.34', family: 4 });
    expect(
      pickPinnedAddress([{ address: '::1', family: 6 }]),
    ).toEqual({ address: '::1', family: 6 });
  });

  it('ghim IP ⇒ request tới hostname vẫn nối đúng IP đã resolve (và giữ Host)', async () => {
    const daNhan: { url?: string; host?: string }[] = [];
    const server = http.createServer((req, res) => {
      daNhan.push({ url: req.url, host: req.headers.host });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body>NOI DUNG</body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      /* `allowPrivate: true` vì server thật của test nằm ở 127.0.0.1 — mục
       * tiêu của test là CHỨNG MINH việc ghim hoạt động (hostname → IP → nối),
       * còn việc chặn IP riêng đã có test ngay trên. */
      const res = await fetchPinned(`http://localtest.me:${port}/trang`, {
        timeoutMs: 8_000,
        allowPrivate: true,
      });
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).toContain('NOI DUNG');
      expect(daNhan[0]?.host, 'Host header phải là hostname gốc').toContain('localtest.me');
      expect(daNhan[0]?.url).toBe('/trang');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
