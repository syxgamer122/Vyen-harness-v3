/**
 * Bridge (`/api/bridge`) chỉ được trả lời request thật sự từ máy này.
 *
 * ============ VÌ SAO TÁCH `0.0.0.0` RA ============
 *
 * `isSafeLocalHostOrIp` dùng chung cho cả ba header: `Host`, `Origin`,
 * `Referer` — và coi `0.0.0.0` là "an toàn".
 *
 * Với **Host** thì đúng: `0.0.0.0` là địa chỉ bind của chính server (launcher
 * mở app tại `http://0.0.0.0:port` cũng phải chạy), và trình duyệt không cho
 * giả mạo Host ⇒ không rủi ro.
 *
 * Với **Origin/Referer** thì sai: đây là header do BÊN GỬI gửi ⇒ nội dung
 * ngoài kiểm soát ⇒ `http://0.0.0.0:3000` không phải "trang trên máy này" mà là
 * một trang bất kỳ nào có thể tự khai là vậy. Chặn riêng cho Origin/Referer.
 *
 * Lớp bảo vệ còn lại (token 256-bit + rate-limit) không đổi.
 */
import { describe, expect, it } from 'vitest';
import { isLocalRequest, isSafeLocalHostOrIp } from '@/lib/bridge/server-bridge';

function req(headers: Record<string, string>): Request {
  return new Request('http://127.0.0.1:3000/api/bridge', { headers });
}

describe('bridge — kiểm nguồn request', () => {
  it('Origin 0.0.0.0 bị chặn', () => {
    expect(isLocalRequest(req({ host: '127.0.0.1:3000', origin: 'http://0.0.0.0:3000' }))).toBe(false);
  });

  it('Referer 0.0.0.0 bị chặn', () => {
    expect(isLocalRequest(req({ host: '127.0.0.1:3000', referer: 'http://0.0.0.0:3000/x' }))).toBe(false);
  });

  it('Origin lạ (không phải 0.0.0.0) vẫn bị chặn', () => {
    expect(isLocalRequest(req({ host: '127.0.0.1:3000', origin: 'https://evil.example' }))).toBe(false);
  });

  it('Host 0.0.0.0 (địa chỉ bind của chính server) vẫn được phép', () => {
    expect(isLocalRequest(req({ host: '0.0.0.0:3000' }))).toBe(true);
  });

  it('Origin/Referer localhost thật vẫn được phép', () => {
    expect(isLocalRequest(req({ host: '127.0.0.1:3000', origin: 'http://localhost:3000' }))).toBe(true);
    expect(isLocalRequest(req({ host: '127.0.0.1:3000', referer: 'http://127.0.0.1:3000/x' }))).toBe(true);
  });

  it('cross-site (sec-fetch-site) vẫn bị chặn', () => {
    expect(
      isLocalRequest(req({ host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' })),
    ).toBe(false);
  });

  it('predicate Host vẫn chấp nhận 0.0.0.0 (hợp đồng cũ giữ nguyên)', () => {
    expect(isSafeLocalHostOrIp('0.0.0.0:3000')).toBe(true);
  });
});
