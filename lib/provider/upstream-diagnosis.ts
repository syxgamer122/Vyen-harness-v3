/**
 * Chẩn đoán lỗi upstream — chuyển nguyên văn từ `app/api/chat/route.ts`.
 *
 * Tách ra để lõi CLI chạy được trên Node: `route.ts` là route của Next, và toàn
 * bộ chẩn đoán nằm trong đó lẫn với vòng `streamText`. Ở đây chỉ còn hàm thuần,
 * không import Next.
 *
 * **Không sửa logic.** Regex đã được chỉnh cho gateway thật; rút gọn hay "làm
 * gọn" là hồi quy âm thầm. Sửa duy nhất: đường dẫn import nội bộ trỏ sang
 * `@/lib/...` như một nơi duy nhất (thay vì một số import tương đối rải rác).
 *
 * `route.ts` giữ nguyên bản cũ trong lượt này — dọn ở plan sau.
 *
 * Plan: docs/superpowers/plans/2026-10-18-provider-layer.md
 */
import { APICallError } from 'ai';
import { redactSecretText } from '@/lib/secret-registry';
import { classifyUpstreamStatus } from '@/lib/api-keys';
import type { UpstreamScope } from '@/lib/api-keys';
import { restateUpstreamStatus } from '@/lib/upstream-status-rules';
import { isContextOverflowError } from '@/lib/context-budget';

/* Re-export, KHÔNG định nghĩa lại: định nghĩa thứ hai là hai nguồn sự thật, và
 * AGENTS.md §6 cấm đúng thứ đó. Cần cả `import type` ở trên vì lệnh re-export
 * không tạo binding cục bộ — thiếu nó thì `UpstreamDiagnosis` không resolve được,
 * và CHỈ `tsc` bắt được (vitest không typecheck nên test vẫn xanh). */
export type { UpstreamScope } from '@/lib/api-keys';

const DEBUG_ERRORS = ['1', 'true', 'yes'].includes(
  (process.env.CHAT_DEBUG_ERRORS ?? '').trim().toLowerCase(),
);

/* Che bí mật: dùng CHUNG registry (lib/secret-registry.ts — port secret-registry
   SecretRegistry) thay cho bản regex copy-paste ở 5 file đã drift nhau. Bản cũ
   thiếu cờ 'g' nên chỉ che vị trí ĐẦU TIÊN trong mỗi chuỗi. */
function redact(text: string): string {
  return redactSecretText(text);
}

function rawMessageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && typeof (e as any).message === 'string') return (e as any).message;
  return '';
}

export function sanitizeErrorMessage(e: unknown): string {
  const cleaned = redact(rawMessageOf(e)).trim().slice(0, 500);
  return cleaned || 'Lỗi không xác định từ AI Provider.';
}

export function getStatusCode(e: unknown): number | undefined {
  if (APICallError.isInstance(e)) return e.statusCode;
  if (e && typeof e === 'object') {
    const anyErr = e as any;
    for (const candidate of [
      anyErr.statusCode,
      anyErr.status,
      anyErr?.response?.status,
      anyErr?.data?.error?.status,
    ]) {
      if (typeof candidate === 'number') return candidate;
    }
    if (anyErr.cause) return getStatusCode(anyErr.cause);
  }
  return undefined;
}

/**
 * Lỗi trá hình lần 2 của gateway (sau pseudo-error HTTP 200 dạng "[Notion
 * is unavailable...]"): (New API) relay lỗi upstream trong stream 200
 * bằng chunk `data: {"error":{"message":"Upstream returned HTTP 502",...}}`.
 * AI SDK v4 (@ai-sdk/openai) với chunk kiểu này enqueue thẳng OBJECT THÔ của
 * gateway vào part 'error' — KHÔNG phải APICallError, không có `statusCode`.
 * Hậu quả khi đi thẳng vào `diagnoseUpstreamError`: status=none → phân loại
 * nhầm `UPSTREAM_NETWORK` ("Không kết nối được tới AI Provider") trong khi
 * gateway THỰC SỰ đã phản hồi, và retry-in-place cho 5xx bị bỏ qua vì nhánh
 * đó yêu cầu status xác định (502 nằm sẵn trong RETRYABLE_SAME_MODEL_STATUSES).
 *
 * Sửa: suy status từ message ("HTTP NNN" — định dạng relay) hoặc các
 * field status chuẩn mà gateway kèm theo, rồi gắn `statusCode` để toàn bộ
 * pipeline (restatement → classify → retry/failover → thông báo) đi đúng
 * nhánh 5xx. Chỉ đụng vào object THÔ; Error thật của SDK (đã có status) và
 * message không mã hoá status được giữ nguyên trạng.
 */
export function normalizeGatewayStreamError(e: unknown): unknown {
  if (!e || typeof e !== 'object' || e instanceof Error) return e;
  const rec = e as Record<string, unknown>;
  if (typeof rec.message !== 'string') return e;
  const alreadyHasStatus =
    typeof rec.statusCode === 'number' || typeof rec.status === 'number';
  if (alreadyHasStatus) return e;
  const fromMessage = /HTTP\s+(\d{3})/i.exec(rec.message);
  if (!fromMessage) return e;
  const status = Number(fromMessage[1]);
  if (status < 400) return e;
  return { ...rec, statusCode: status };
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * Lỗi KHÔNG kèm HTTP status (`status === undefined`) đi tới đây theo HAI đường
 * rất khác nhau, và bản cũ gộp chung thành "lỗi mạng":
 *
 *  - Lỗi kết nối THẬT: fetch/undici/TLS không có mã HTTP nào để báo
 *    ("Cannot connect to API: connect ECONNREFUSED", "fetch failed"…).
 *  - Yêu cầu bị TỪ CHỐI vì lý do logic nhưng phản hồi vẫn không mang status:
 *    gateway relay lỗi ngay trong stream 200 dưới dạng `[401]: {...}` /
 *    `[400]: {...}` (xem `normalizeGatewayStreamError`), hoặc chính AI SDK ném
 *    ra ("Model tried to call unavailable tool 'bash'. No tools are
 *    available."). Người dùng bị bảo kiểm tra mạng trong khi nguyên nhân thật
 *    là model gọi sai tên tool — bật lại Wi-Fi không giúp được gì.
 *
 * Nhánh `status === undefined` CHỈ sinh UPSTREAM_NETWORK khi thông điệp khớp
 * lỗi mạng; gateway đã bọc mã lỗi thì đó là câu trả lời của upstream, không
 * phải timeout. Phần còn lại thành UPSTREAM_MODEL_REJECTED — cả hai đều
 * `blameKey = false`.
 */
const NETWORK_FAILURE_RE =
  /cannot connect to api|fetch failed|socket hang up|econnrefused|econnreset|enotfound|eai_again|etimedout|epipe|und_err|getaddrinfo|\btls\b|\bssl\b|certificate|timed? ?out|\btimeout\b|network (?:error|request failed)|connection (?:refused|reset|closed|error)/i;

/** Gateway bọc lỗi upstream trong chính thông điệp: `[401]: {...}`, `[400]: {...}`. */
const GATEWAY_WRAPPED_ERROR_RE = /^\s*\[\d{3}\]/;

export interface UpstreamDiagnosis {
  status?: number;
  scope: UpstreamScope;
  code: string;
  userMessage: string;
  devLog: string;
  stopFailover: boolean;
  /** true = lỗi của key, false = lỗi của ta hoặc của request. */
  blameKey: boolean;
  /** true = gateway không có/không cho phép model này → ghi negative cache. */
  modelUnsupported: boolean;
}

export function diagnoseUpstreamError(
  e: unknown,
  ctx: { requestId: string; model: string; keyLabel: string; providerBase?: string },
): UpstreamDiagnosis {
  let status = getStatusCode(e);

  let url: string | undefined;
  let body: string | undefined;
  let cfRay: string | undefined;
  let upstreamServer: string | undefined;

  if (APICallError.isInstance(e)) {
    url = e.url;
    body = typeof e.responseBody === 'string' ? e.responseBody : undefined;
    const headers = (e.responseHeaders ?? {}) as Record<string, string>;
    cfRay = headers['cf-ray'];
    upstreamServer = headers['server'];
  }

  // Lỗi network/timeout không có url phản hồi — dùng provider thật của request
  // thay vì env, tránh báo sai địa chỉ khi user đang gọi provider riêng.
  const upstreamHost =
    hostOf(url) ?? hostOf(ctx.providerBase) ?? 'api.openai.com';
  const bodySnippet = body ? redact(body).replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const looksLikeCloudflare =
    Boolean(cfRay) ||
    /cloudflare|attention required|just a moment|error code: 1020/i.test(
      `${bodySnippet} ${upstreamServer ?? ''}`,
    );

  /* Status restatement: free gateway hay gắn nhãn sai (403 mang chữ quota,
     500 mang chữ rate-limit...). Sửa lại TRƯỚC khi phân loại để toàn bộ
     switch phía dưới + scope + blameKey đi đúng hướng. */
  let restateReason: string | undefined;
  {
    const r = restateUpstreamStatus(status, bodySnippet);
    if (r.status !== status && r.reason) {
      status = r.status;
      restateReason = r.reason;
    }
  }
  const scope = classifyUpstreamStatus(status);

  /* Lỗi VALIDATE PROMPT phía SDK (AI_InvalidPromptError): history chat nhiễm
     tin nhắn hỏng (vd text leaked từ upstream agent lạ như pool Notion của
     ). Không phải lỗi kết nối hay key — trước đây rơi vào nhánh
     status=undefined và bị gắn nhãn sai "Không kết nối được tới AI Provider",
     khiến người dùng tưởng provider mới chết trong khi chỉ cần bỏ tin hỏng. */
  const rawErrMsg = e instanceof Error ? e.message : String(e ?? '');
  if (
    (e instanceof Error && e.name === 'AI_InvalidPromptError') ||
    /invalid prompt|must be a (CoreMessage|UI message)/i.test(rawErrMsg)
  ) {
    return {
      status: undefined,
      scope,
      code: 'BAD_PROMPT_HISTORY',
      userMessage:
        'Lịch sử hội thoại chứa tin nhắn không hợp lệ (tin cũ trả nội dung lỗi). ' +
        'Tạo chat mới để tiếp tục — tin nhắn này không liên quan tới provider/key đang dùng.',
      devLog: `[req:${ctx.requestId}] [BAD_PROMPT_HISTORY] msg=${sanitizeErrorMessage(e)}`.trim(),
      stopFailover: true,
      blameKey: false,
      modelUnsupported: false,
    };
  }

  let code = `UPSTREAM_${status ?? 'NETWORK'}`;
  let userMessage: string;
  let blameKey = true;
  let modelUnsupported = false;
  let stopFailover = false;

  // (New API) trả 400 kèm "Unknown model" thay vì 404 cho model lạ.
  const unknownModel400 = status === 400 && /unknown model/i.test(bodySnippet);

  /* Port từ prime-agent `classifyStreamFailure`: từ chối do bộ lọc nội dung
     (refusal/safety) — đổi key/model cũng gần như vô ích vì nguyên nhân nằm
     ở NỘI DUNG, không phải hạ tầng; dừng failover để không đốt chuỗi model. */
  const looksLikeSafetyBlock =
    /content_filter|content.?policy|flagged|prohibited_content|recitation|\bsafety\b|guardrail/i.test(
      bodySnippet,
    );

  /* Port từ prime-agent `overflow.ts`: lỗi TRÀN CONTEXT — payload hiện tại
     vượt window model, nén/xoá hội thoại mới giải quyết được; failover sang
     key khác vô ích (chain thường cùng họ window nhỏ). Client nhận code
     UPSTREAM_CONTEXT_OVERFLOW sẽ tự nén rồi thử lại đúng một lần. */
  const looksLikeContextOverflow = isContextOverflowError(status, bodySnippet);

  switch (status) {
    case 401:
      code = 'UPSTREAM_AUTH_401';
      /* Provider yêu cầu key: auth_required cho cả request không key
         lẫn key rác. Người dùng chưa nhập key cần được chỉ đúng đường
         lấy key thay vì báo chung chung "key sai". */
      userMessage = /auth[_\s-]*required|log in at the site/i.test(bodySnippet)
        ? `${upstreamHost} yêu cầu đăng nhập/xác thực bằng API key. ` +
          'Hãy đăng ký tại trang của nhà cung cấp, tạo API key ' +
          'rồi dán vào phần Nhà cung cấp của ứng dụng (Settings).'
        : `AI Provider từ chối API Key (401 Unauthorized) tại ${upstreamHost}. ` +
          (ctx.providerBase
            ? 'Key sai hoặc đã bị thu hồi — kiểm tra lại API Key của nhà cung cấp này.'
            : 'Key sai, đã bị thu hồi, hoặc không hợp lệ với provider đang cấu hình.');
      break;
    case 402:
      code = 'UPSTREAM_PAYMENT_402';
      userMessage = `Tài khoản upstream tại ${upstreamHost} đã hết credit / hết hạn thanh toán (402).`;
      break;
    case 403:
      if (!bodySnippet && !cfRay && !upstreamServer) {
        // New API trả 403 với body RỖNG khi model không nằm trong allowlist
        // của gateway (đo trên gorouter/justwoker) — thông tin theo MODEL,
        // không phải lỗi key hay WAF: không phạt key, ghi negative cache.
        code = 'UPSTREAM_MODEL_403';
        blameKey = false;
        modelUnsupported = true;
        userMessage =
          `Model '${ctx.model}' không nằm trong danh mục mà ${upstreamHost} ` +
          `cho phép key ${ctx.keyLabel} dùng (403).`;
        break;
      }
      code = looksLikeCloudflare ? 'UPSTREAM_WAF_403' : 'UPSTREAM_FORBIDDEN_403';
      // WAF chặn theo IP của Vercel → đổi key vô ích, nhưng cũng không phải lỗi key.
      blameKey = !looksLikeCloudflare;
      userMessage = looksLikeCloudflare
        ? `Cloudflare/WAF của ${upstreamHost} chặn request từ IP của Vercel (403).` +
          (cfRay ? ` cf-ray=${cfRay}.` : '') +
          ' Cần whitelist IP Vercel, tắt bot-fight-mode cho endpoint API, hoặc đổi sang base URL khác.'
        : `AI Provider trả về 403 Forbidden tại ${upstreamHost} cho model '${ctx.model}'. ` +
          `Nguyên nhân thường gặp: key ${ctx.keyLabel} bị khóa, hoặc key không được cấp quyền dùng model này.`;
      break;
    case 404:
      code = 'UPSTREAM_MODEL_404';
      // Model không tồn tại trên gateway → đổi key không giúp gì.
      blameKey = false;
      modelUnsupported = true;
      userMessage = `Model '${ctx.model}' không tồn tại hoặc không được cấp quyền trên ${upstreamHost} (404).`;
      break;
    case 400:
    case 413:
    case 422:
      if (looksLikeSafetyBlock && !unknownModel400) {
        // Gateway trả 400/422 cho vi phạm content policy (không phải cú pháp):
        // dừng failover như nhánh 5xx-safety ở default.
        code = 'UPSTREAM_SAFETY_BLOCKED';
        blameKey = false;
        stopFailover = true;
        userMessage =
          `Yêu cầu bị ${upstreamHost} chặn bởi bộ lọc nội dung (${status}): ` +
          `${bodySnippet.slice(0, 160)}.`;
        break;
      }
      if (looksLikeContextOverflow) {
        code = 'UPSTREAM_CONTEXT_OVERFLOW';
        blameKey = false;
        stopFailover = true;
        userMessage =
          'Hội thoại đã vượt quá giới hạn ngữ cảnh của model. Hãy nén bớt hội thoại hoặc bắt đầu cuộc trò chuyện mới.';
        break;
      }
      code = `UPSTREAM_BAD_REQUEST_${status}`;
      blameKey = false;
      modelUnsupported = unknownModel400;
      userMessage = `Yêu cầu gửi lên AI Provider không hợp lệ (${status}). Đổi key cũng không giải quyết được.`;
      break;
    case 429:
      code = 'UPSTREAM_RATE_LIMIT_429';
      userMessage = `Key ${ctx.keyLabel} đang bị giới hạn tốc độ / hết quota (429) tại ${upstreamHost}.`;
      break;
    default:
      if (status && status >= 500) {
        // Luật "500-as-validation" (Free-Claude-Gateway): 500 kèm nội dung
        // validation nghĩa là CẤU TRÚC REQUEST của ta bị từ chối — retry trên
        // key/model khác cũng y hệt, chỉ đốt quota và kéo dài thời gian chờ.
        const looksLikeValidation =
          /field\s+\S+\s+is required/i.test(bodySnippet) ||
          /invalid_request|invalid request/i.test(bodySnippet) ||
          /missing required (parameter|field)/i.test(bodySnippet);
        if (looksLikeValidation) {
          code = 'UPSTREAM_INVALID_REQUEST_500';
          blameKey = false;
          stopFailover = true;
          userMessage =
            `Yêu cầu bị ${upstreamHost} từ chối (500 — dữ liệu không hợp lệ: ` +
            `${bodySnippet.slice(0, 160)}). Thử lại bằng key/model khác cũng không thay đổi được.`;
        } else if (looksLikeSafetyBlock) {
          // 5xx kèm nội dung safety/refusal (Anthropic "refusal", Gemini
          // "SAFETY", recitation...): lỗi của nội dung — dừng failover.
          code = 'UPSTREAM_SAFETY_BLOCKED';
          blameKey = false;
          stopFailover = true;
          userMessage =
            `Model từ chối trả lời vì bộ lọc nội dung của ${upstreamHost} ` +
            `(${bodySnippet.slice(0, 160)}). Đổi model/key thường không thay đổi được.`;
        } else if (looksLikeContextOverflow) {
          // 5xx kèm chữ tràn context (một số gateway trả 500/503 thay vì
          // 400): cùng xử lý với nhánh 400-overflow — dừng failover, client
          // sẽ nén hội thoại rồi thử lại.
          code = 'UPSTREAM_CONTEXT_OVERFLOW';
          blameKey = false;
          stopFailover = true;
          userMessage =
            'Hội thoại đã vượt quá giới hạn ngữ cảnh của model. Hãy nén bớt hội thoại hoặc bắt đầu cuộc trò chuyện mới.';
        } else if (status === 529 || /overloaded/i.test(bodySnippet)) {
          // 529 = "site overloaded" của Anthropic; một số gateway map overload
          // thành 503 kèm chữ overloaded. Quá tải là TẠM THỜI — không phạt key,
          // cho retry/failover như 5xx thường nhưng báo đúng bản chất.
          code = 'UPSTREAM_OVERLOADED';
          blameKey = false;
          userMessage =
            `${upstreamHost} đang quá tải (${status}). Vài giây nữa thử lại thường được.`;
        } else {
          code = `UPSTREAM_SERVER_${status}`;
          blameKey = false;
          userMessage = `AI Provider ${upstreamHost} đang gặp sự cố (${status}). Vui lòng thử lại sau ít phút.`;
        }
      } else if (looksLikeSafetyBlock) {
        // 4xx kèm chữ safety (một số gateway trả 400/422 cho content policy):
        // cùng logic với nhánh 5xx ở trên — dừng failover, báo rõ nguyên nhân.
        code = 'UPSTREAM_SAFETY_BLOCKED';
        blameKey = false;
        stopFailover = true;
        userMessage =
          `Yêu cầu bị ${upstreamHost} chặn bởi bộ lọc nội dung (${status}): ` +
          `${bodySnippet.slice(0, 160)}.`;
      } else if (status === undefined) {
        blameKey = false;
        /* Chỉ thông điệp THỰC SỰ là lỗi mạng/timeout/connection mới được
           dán nhãn UPSTREAM_NETWORK. Gateway đã bọc mã lỗi (`[401]: {...}`)
           hoặc model từ chối yêu cầu vì lý do logic đều KHÔNG phải mạng —
           báo "không kết nối được" khiến người dùng đi kiểm tra Wi-Fi vô ích. */
        if (NETWORK_FAILURE_RE.test(rawErrMsg)) {
          code = 'UPSTREAM_NETWORK';
          userMessage = `Không kết nối được tới AI Provider ${upstreamHost}: ${sanitizeErrorMessage(e)}`;
        } else {
          code = 'UPSTREAM_MODEL_REJECTED';
          userMessage =
            `AI Provider ${upstreamHost} đã nhận yêu cầu nhưng từ chối vì lý do của model/gateway` +
            (GATEWAY_WRAPPED_ERROR_RE.test(rawErrMsg) ? ' (lỗi trả về không kèm mã HTTP)' : '') +
            ` với model '${ctx.model}'. Không phải lỗi mạng — đổi key không giúp; ` +
            `thử model khác hoặc kiểm tra lại tên model/cấu hình của nhà cung cấp. ` +
            `Chi tiết: ${sanitizeErrorMessage(e)}`;
        }
      } else {
        userMessage = `AI Provider ${upstreamHost} trả về lỗi ${status}: ${sanitizeErrorMessage(e)}`;
      }
  }

  if (DEBUG_ERRORS && bodySnippet) userMessage += ` | upstream body: ${bodySnippet}`;

  const devLog = [
    `[req:${ctx.requestId}]`,
    `[${code}]`,
    `key=${ctx.keyLabel}`,
    `model=${ctx.model}`,
    `host=${upstreamHost}`,
    status ? `status=${status}${restateReason ? ` (${restateReason})` : ''}` : 'status=none',
    cfRay ? `cf-ray=${cfRay}` : '',
    bodySnippet ? `body=${bodySnippet}` : `msg=${sanitizeErrorMessage(e)}`,
  ]
    .filter(Boolean)
    .join(' ');

  // 403-WAF và 5xx: vẫn nên thử key khác (có thể route khác IP / retry may mắn).
  // 400 "Unknown model" ( trả thay vì 404) vẫn cho thử model kế tiếp.
  // Rule 500-validation tự đặt stopFailover trong switch — lỗi request của ta,
  // retry nơi khác vô ích.
  if (!stopFailover) {
    stopFailover = (scope === 'request' && !unknownModel400) || status === 404;
  }

  return {
    status,
    scope,
    code,
    userMessage,
    devLog,
    stopFailover,
    blameKey,
    modelUnsupported,
  };
}
