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
import { readFileSync } from 'node:fs';
import { APICallError } from 'ai';
import {
  diagnoseUpstreamError,
  normalizeGatewayStreamError,
  sanitizeErrorMessage,
  getStatusCode,
} from '@/lib/provider/upstream-diagnosis';

/** Lỗi có `responseBody` — chỉ `APICallError` mang được, nên nhánh 403 cần nó. */
function apiError(status: number, responseBody: string): APICallError {
  return new APICallError({
    message: `upstream ${status}`,
    url: 'https://gateway.test/v1/chat/completions',
    requestBodyValues: {},
    statusCode: status,
    responseHeaders: {},
    responseBody,
  });
}

const ctx = { requestId: 'req-1', model: 'gpt-4o', keyLabel: 'sk-abc...wxyz' };

/** Lỗi có status kiểu gateway trả về — object thô, không phải APICallError. */
function statusError(status: number): Record<string, unknown> {
  return { statusCode: status, message: `upstream ${status}` };
}

/**
 * Chống HAI nguồn sự thật.
 *
 * Lý do tồn tại: khi module này mới sinh ra mà `route.ts` còn giữ bản sao, thì
 * test chỉ phủ MỘT ĐƯỜNG KHÔNG BAO GIỜ CHẠY — `route.ts` phục vụ người dùng nhưng
 * không có test nào canh. Sửa bug ở module thì không tới ai; sửa ở `route.ts` thì
 * module (thứ CLI sẽ ship) không biết. Đây là ảo giác phủ, cùng loại với code
 * chết nhưng suite xanh.
 */
describe('route.ts dùng module chung', () => {
  const ROUTE = 'app/api/chat/route.ts';
  const src = () => readFileSync(ROUTE, 'utf8');

  it('import từ module chung', () => {
    expect(src()).toContain("from '@/lib/provider/upstream-diagnosis'");
  });

  it('không tự khai báo lại logic đã chuyển', () => {
    const duplicated = [
      'function diagnoseUpstreamError',
      'function normalizeGatewayStreamError',
      'function sanitizeErrorMessage',
      'function getStatusCode',
      'function rawMessageOf',
      'function redact(',
      'const NETWORK_FAILURE_RE',
      'const GATEWAY_WRAPPED_ERROR_RE',
      'const DEBUG_ERRORS',
    ];
    const still = duplicated.filter((d) => src().includes(d));
    expect(still, `route.ts còn khai báo: ${still.join(', ')}`).toEqual([]);
  });
});

/**
 * Review Focus #3 — `blameKey` ở 403.
 *
 * Đây là quyết định quyết định failover có đúng không: `blameKey: true` nghĩa là
 * đổi key, `false` nghĩa là lỗi nằm ở model/gateway. Gộp hai ca là đốt key
 * hoặc failover mãi trên một key chết.
 */
describe('403 — phân biệt lỗi key với lỗi model', () => {
  it('body RỖNG → gateway chặn riêng model này, KHÔNG phạt key', () => {
    // New API trả 403 body rỗng khi model không nằm trong allowlist của key.
    const d = diagnoseUpstreamError({ statusCode: 403, message: 'Forbidden' }, ctx);
    expect(d.code).toBe('UPSTREAM_MODEL_403');
    expect(d.blameKey).toBe(false);
    expect(d.modelUnsupported).toBe(true);
  });

  it('body thường → lỗi key thật, PHẢI phạt key để failover sang key khác', () => {
    // Body cố tình KHÔNG chứa quota / invalid api key: `restateUpstreamStatus`
    // sẽ viết lại status 403→429 hoặc 403→401 khi thấy hai chữ đó, và đó là
    // hành vi đúng — nhưng nó làm test này đo nhầm thứ. Xem test kế bên.
    const d = diagnoseUpstreamError(apiError(403, 'access denied for this model'), ctx);
    expect(d.code).toBe('UPSTREAM_FORBIDDEN_403');
    expect(d.blameKey).toBe(true);
    expect(d.modelUnsupported).toBe(false);
  });

  it('403 chứa chữ quota → bị restate thành 429 trước khi phân loại', () => {
    // Free gateway gắn nhãn sai: 403 kèm "quota" thật ra là rate-limit, nên
    // retry trên key khác mới đúng. Test này khoá việc restatement chạy TRƯỚC
    // khi `classifyUpstreamStatus` đọc status.
    const d = diagnoseUpstreamError(apiError(403, 'quota exceeded for this key'), ctx);
    expect(d.status).toBe(429);
    expect(d.code).toBe('UPSTREAM_RATE_LIMIT_429');
  });

  it('body có dấu Cloudflare → WAF chặn IP, đổi key cũng vô ích', () => {
    const d = diagnoseUpstreamError(apiError(403, 'Attention Required! | Cloudflare'), ctx);
    expect(d.code).toBe('UPSTREAM_WAF_403');
    expect(d.blameKey).toBe(false);
  });
});

/**
 * Review Focus #2 — ranh giới giữa "lỗi mạng" và "gateway đã trả lời".
 *
 * Lỗi nguy hiểm nhất ở đây không phải crash mà là **báo sai nguyên nhân**: bảo
 * người dùng kiểm tra Wi-Fi trong khi gateway thực sự đã phản hồi.
 */
describe('ranh giới lỗi mạng — gateway đã trả lời thì đừng bảo kiểm tra Wi-Fi', () => {
  it('gateway bọc lỗi dạng [401]: {...} → MODEL_REJECTED, KHÔNG phải NETWORK', () => {
    const d = diagnoseUpstreamError(
      new Error('[401]: {"error":{"message":"bad key"}}'),
      ctx,
    );
    expect(d.code).toBe('UPSTREAM_MODEL_REJECTED');
    expect(d.userMessage).toContain('Không phải lỗi mạng');
  });

  it('model từ chối vì lý do logic → MODEL_REJECTED', () => {
    const d = diagnoseUpstreamError(
      new Error("Model tried to call unavailable tool 'bash'"),
      ctx,
    );
    expect(d.code).toBe('UPSTREAM_MODEL_REJECTED');
  });

  it('lỗi mạng THẬT → NETWORK', () => {
    const d = diagnoseUpstreamError(
      new Error('Cannot connect to API: connect ECONNREFUSED'),
      ctx,
    );
    expect(d.code).toBe('UPSTREAM_NETWORK');
  });
});

/** Nửa còn lại của Focus #1: không chỉ nhãn, mà bí mật THẬT cũng phải được che. */
describe('bí mật thật phải được che', () => {
  it('sanitizeErrorMessage che API key trong thông điệp lỗi', () => {
    const out = sanitizeErrorMessage(new Error('key sk-abcdefgh12345678 bị từ chối'));
    expect(out).not.toContain('sk-abcdefgh12345678');
  });
});

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

  /* Review Focus #1: `userMessage` và `devLog` là HAI chuỗi khác nhau, không
   * phải một bản rút gọn của bản kia. Người dùng thấy thông báo sạch; logfile
   * mới được phép mang dấu vết vận hành.
   *
   * Test cũ tên là "userMessage không chứa API key" nhưng truyền `statusError(500)`
   * — mà nhánh 500 KHÔNG nội suy `keyLabel` vào `userMessage`, nên `not.toContain`
   * xanh vì lý do sai: nó không hề có đường để rò. Ở đây dùng body upstream có
   * chứa bí mật thật — đó mới là chỗ rò thực tế (gateway hay echo lại key). */
  it('bí mật trong body upstream bị che ở CẢ HAI chuỗi', () => {
    const d = diagnoseUpstreamError(apiError(500, 'gateway từ chối key sk-abcdefgh12345678'), ctx);
    expect(d.userMessage).not.toContain('sk-abcdefgh12345678');
    expect(d.devLog).not.toContain('sk-abcdefgh12345678');
  });

  it('devLog mang dấu vết vận hành mà userMessage không mang', () => {
    const d = diagnoseUpstreamError(apiError(500, 'lỗi server'), ctx);
    expect(d.devLog).toContain('req:req-1');
    expect(d.devLog).toContain('model=gpt-4o');
    expect(d.userMessage).not.toContain('req:req-1');
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
