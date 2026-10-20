/**
 * `web_fetch` phải bị chặn khi hostname resolve ra **bất kỳ** địa chỉ IP riêng nào.
 *
 * ============ LỖI ĐÃ KIỂM CHỨNG ============
 *
 * `guardedFetch` (lib/web-backend.ts) gọi `dns.lookup(hostname)` KHÔNG có
 * `{ all: true }` ⇒ nhận về **MỘT** địa chỉ ⇒ chỉ kiểm tra địa chỉ đó. Một
 * domain có cả A record công khai lẫn A record riêng (127.0.0.1 / 10.x /
 * 169.254.169.254) sẽ lọt nếu resolver trả về bản công khai trước ⇒ server tự
 * fetch vào mạng nội bộ.
 *
 * Sửa: resolve **toàn bộ** địa chỉ và chặn nếu **bất kỳ** địa chỉ nào là IP
 * riêng.
 *
 * Rủi ro còn lại (đã biết, ghi rõ trong mã): đổi DNS giữa lúc kiểm và lúc nối
 * (rebinding). Chặn được phần xác định — domain nhiều A record — bằng cách này.
 */
import { describe, expect, it } from 'vitest';
import { assertFetchableIps } from '@/lib/web-url-guard';

describe('assertFetchableIps — mọi địa chỉ resolve ra đều phải là IP công khai', () => {
  it('chặn khi CÓ MỘT địa chỉ riêng trong danh sách', () => {
    const kq = assertFetchableIps(['93.184.216.34', '127.0.0.1']);
    expect(kq.ok).toBe(false);
  });

  it('chặn cả link-local của cloud (metadata endpoint)', () => {
    const kq = assertFetchableIps(['93.184.216.34', '169.254.169.254']);
    expect(kq.ok).toBe(false);
  });

  it('chặn IPv6 riêng (fc00::/7, ::1, ::ffff:127.0.0.1)', () => {
    expect(assertFetchableIps(['::1']).ok).toBe(false);
    expect(assertFetchableIps(['fd00::1']).ok).toBe(false);
    expect(assertFetchableIps(['::ffff:127.0.0.1']).ok).toBe(false);
  });

  it('cho qua khi TẤT CẢ địa chỉ đều công khai', () => {
    expect(assertFetchableIps(['93.184.216.34']).ok).toBe(true);
    expect(assertFetchableIps(['93.184.216.34', '93.184.216.35']).ok).toBe(true);
  });

  it('không có địa chỉ nào thì chặn (không kiểm được = không cho qua)', () => {
    expect(assertFetchableIps([]).ok).toBe(false);
  });
});
