/**
 * Fetch có **GHIM IP** — đóng lỗ hổng DNS rebinding.
 *
 * ============ LỖ HỔNG ĐÃ KIỂM CHỨNG (verifier 2026-10-20) ============
 *
 * `guardedFetch` (lib/web-backend.ts) làm đúng hai việc: (1) kiểm hostname
 * string, (2) `dns.lookup` rồi kiểm IP riêng. Nhưng nó gọi **`fetch(url)`** —
 * và `fetch` tự resolve DNS **LẦN THỨ HAI**. Giữa lần kiểm và lần nối, DNS
 * của kẻ tấn công đổi câu trả lời ⇒ server nối tới IP riêng.
 *
 * Probe của verifier: tầng kiểm thấy `93.184.216.34` (public) còn server nội
 * bộ `127.0.0.1:80` **nhận được request** ⇒ xác nhận lỗ hổng, không phải lý
 * thuyết.
 *
 * ============ CÁCH ĐÓNG ============
 *
 * Tự resolve MỘT lần, kiểm TẤT CẢ địa chỉ, rồi **ghim** địa chỉ đã kiểm vào
 * tầng nối (`lookup` của `node:http`/`node:https`) ⇒ `fetch`/`http` KHÔNG còn
 * tự resolve ⇒ **không còn cửa sổ** để đổi DNS.
 *
 * Chứng thương TLS vẫn kiểm theo **hostname** (SNI + `servername` lấy từ URL),
 * không theo IP ⇒ không phải hạ TLS, không cần thêm dependency nào.
 *
 * Đo cơ chế (probe thật, 2026-10-20): `https.request('https://example.com', {
 * lookup: (_h, _o, cb) => cb(null, ip, family) })` ⇒ HTTP 200, body đúng, cert
 * OK.
 *
 * ============ GHI CHÚ QUAN TRỌNG VỀ `lookup` ============
 *
 * Node 20+ bật `autoSelectFamily` ⇒ `lookup` được gọi với `{ all: true }` ⇒
 * callback phải trả **MẢNG** địa chỉ. Trả sai dạng ⇒ lỗi
 * "Invalid IP address: undefined" (đã dính ở lần thử đầu).
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { assertFetchableIps } from '@/lib/web-url-guard';

export interface PinnedAddress {
  address: string;
  family: number;
}

export interface PinnedFetchOptions {
  /** Timeout tổng (ms). */
  timeoutMs: number;
  /** Header gửi đi. */
  headers?: Record<string, string>;
  /**
   * Cho phép IP riêng — CHỈ dùng cho endpoint do chính người vận hành cấu
   * hình (vd reader nội bộ). Mặc định `false` ⇒ mọi IP riêng đều bị chặn.
   */
  allowPrivate?: boolean;
}

/**
 * Resolve hostname và kiểm TẤT CẢ địa chỉ trả về.
 *
 * @throws khi không resolve được, hoặc có BẤT KỲ địa chỉ nào là IP riêng.
 */
export async function resolveAndValidate(
  hostname: string,
  allowPrivate = false,
): Promise<PinnedAddress[]> {
  let addresses: PinnedAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (e) {
    throw new Error(
      `Không resolve được hostname "${hostname}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!addresses.length) {
    throw new Error(`Không resolve được hostname "${hostname}".`);
  }
  if (!allowPrivate) {
    const check = assertFetchableIps(addresses.map((a) => a.address));
    if (!check.ok) throw new Error(check.error);
  }
  return addresses;
}

/**
 * Chọn địa chỉ để ghim.
 *
 * Ưu tiên IPv4: nhanh hơn IPv6 trên nhiều mạng, và `autoSelectFamily` của Node
 * cũng ưu tiên IPv4. Ổn định (luôn cùng thứ tự) ⇒ không phụ thuộc thứ tự
 * trả về ngẫu nhiên của resolver.
 */
export function pickPinnedAddress(addresses: readonly PinnedAddress[]): PinnedAddress {
  return addresses.find((a) => a.family === 4) ?? addresses[0];
}

/**
 * GET một URL với IP đã resolve được **ghim** vào tầng nối.
 *
 * @throws khi không resolve được / có IP riêng / timeout / lỗi mạng.
 */
export async function fetchPinned(
  rawUrl: string,
  opts: PinnedFetchOptions,
): Promise<Response> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Giao thức không hỗ trợ: ${url.protocol}`);
  }

  const addresses = await resolveAndValidate(url.hostname, opts.allowPrivate);
  const pinned = pickPinnedAddress(addresses);

  const mod = url.protocol === 'https:' ? https : http;
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: 'GET',
        headers: {
          /* Tự giải nén thay vì để tầng transport lo: `fetch` tự giải nén,
           * `node:http` thì không. `identity` ⇒ phần lớn server trả văn bản thô
           * ⇒ không cần giải nén; nhưng vẫn xử lý `content-encoding` nếu
           * server không nghe lời. */
          'Accept-Encoding': 'identity',
          ...(opts.headers ?? {}),
        },
        /* GHIM: không gọi DNS nữa ⇒ không có cửa sổ để đổi IP giữa lúc kiểm
         * và lúc nối. */
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions && lookupOptions.all) {
            (callback as (e: Error | null, addrs: PinnedAddress[]) => void)(null, [
              { address: pinned.address, family: pinned.family },
            ]);
            return;
          }
          (callback as (e: Error | null, addr: string, family: number) => void)(
            null,
            pinned.address,
            pinned.family,
          );
        },
        timeout: opts.timeoutMs,
      },
      resolve,
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout ${opts.timeoutMs}ms khi tải ${url.hostname}`));
    });
    req.end();
  });

  /* Giải nén nếu server không nghe `Accept-Encoding: identity`. */
  let stream: Readable = res;
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'deflate' || encoding === 'br') {
    stream = res.pipe(
      encoding === 'gzip'
        ? zlib.createGunzip()
        : encoding === 'deflate'
          ? zlib.createInflate()
          : zlib.createBrotliDecompress(),
    );
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }

  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: res.statusCode ?? 502,
    headers,
  });
}
