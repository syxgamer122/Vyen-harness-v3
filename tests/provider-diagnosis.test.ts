/**
 * Task 4 — chẩn đoán lỗi upstream, bóc ra khỏi `app/api/chat/route.ts`.
 *
 * Đây là bản chẩn đoán SAI ĐẤT ĐẤT: chuyển nguyên văn logic của route.ts. Vì
 * vậy test ở đây khoá **hành vi hiện có**, không phải hành vi plan mong muốn.
 * Ba chỗ plan sai đã ghi ở ledger, tóm tắt:
 *   - 401 → `stopFailover` là FALSE (code chỉ chuyển true khi scope là `request`
 *     hoặc status 404); plan viết true.
 *   - `[429]: {...}` KHÔNG cho status 429 — `diagnoseUpstreamError` gọi thẳng
 *     `getStatusCode`, không qua `normalizeGatewayStreamError`, và regex của
 *     hàm đó tìm `HTTP NNN`, không phải `[NNN]:`.
 *   - Định dạng gateway thật là `Upstream returned HTTP 502`.
 *
 * Plan: docs/superpowers/plans/2026-10-18-provider-layer.md
 */
import { describe, expect, it } from 'vitest';
import {
  diagnoseUpstreamError,
  normalizeGatewayStreamError,
  sanitizeErrorMessage,
  getStatusCode,
} from '@/lib/provider/upstream-diagnosis';

const ctx = { requestId: 'req-1', model: 'gpt-4o', keyLabel: 'sk-abc...wxyz' };

/** Lỗi có status kiểu gateway trả về — object thô, không phải APICallError. */
function statusError(status: number): Record<string, unknown> {
  return { statusCode: status, message: `upstream ${status}` };
}

describe('diagnoseUpstreamError', () => {
  it('lỗi mạng không kèm status → blameKey false, stopFailover false, scope transient', () => {
    const d = diagnoseUpstreamError(new Error('fetch failed'), ctx);
    expect(d.status).toBeUndefined();
    expect(d.blameKey).toBe(false);
    expect(d.stopFailover).toBe(false);
    expect(d.scope).toBe('transient');
  });

  /* `stopFailover` FALSE là hành vi cũ: người dùng KHÔNG bị chặn thử key khác —
   * 401 là lỗi key này, nên vẫn nên thử key còn lại. `blameKey: true` mới là
   * tín hiệu để failover bỏ qua key này. */
  it('401 từ key sai → blameKey true, scope key-auth, nhưng KHÔNG stopFailover', () => {
    const d = diagnoseUpstreamError(statusError(401), ctx);
    expect(d.blameKey).toBe(true);
    expect(d.stopFailover).toBe(false);
    expect(d.scope).toBe('key-auth');
  });

  /* Review Focus #2: gateway bọc lỗi trong chính stream HTTP 200. Định dạng
   * thật là `Upstream returned HTTP NNN`; `normalizeGatewayStreamError` gắn
   * `statusCode` vào để cả pipeline đi đúng nhánh 5xx. Không có bước này thì
   * status rơi về undefined và bị gắn nhãn nhầm "không kết nối được". */
  it('gateway bọc lỗi trong chuỗi stream — HTTP 200 vẫn phải ra lỗi có status', () => {
    const raw = { message: 'Upstream returned HTTP 502', type: 'error' };
    const d = diagnoseUpstreamError(normalizeGatewayStreamError(raw), ctx);
    expect(d.status).toBe(502);
  });

  /* Review Focus #1: `userMessage` và `devLog` là HAI chuỗi khác nhau. Người dùng
   * phải thấy thông báo sạch; chi tiết chỉ được nằm ở log. Gộp làm một là rò
   * thông tin. */
  it('userMessage không chứa API key, devLog thì có', () => {
    const d = diagnoseUpstreamError(statusError(500), { ...ctx, keyLabel: 'sk-secret-abc' });
    expect(d.userMessage).not.toContain('sk-secret-abc');
    expect(d.devLog).toContain('sk-secret-abc');
  });
});

describe('getStatusCode', () => {
  it('đọc statusCode trên object thô', () => {
    expect(getStatusCode({ statusCode: 429 })).toBe(429);
  });

  it('lần theo `cause` khi lớp ngoài không có status', () => {
    expect(getStatusCode(new Error('x', { cause: { status: 503 } }))).toBe(503);
  });
});

describe('sanitizeErrorMessage', () => {
  it('cắt ngắn và luôn trả về chuỗi không rỗng', () => {
    expect(sanitizeErrorMessage(new Error('a'.repeat(900))).length).toBeLessThanOrEqual(500);
    expect(sanitizeErrorMessage(null)).not.toBe('');
  });
});
