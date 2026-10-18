/**
 * Lớp provider — kiểu cấu hình và cách chọn nhánh adapter.
 *
 * Vì sao tồn tại: `app/api/chat/route.ts` dành 153KB và biết mọi khác biệt giữa
 * Anthropic và OpenAI-compatible. Lõi CLI không nên phải biết những khác biệt
 * đó ở đâu — nó chỉ cần `resolveModel(cfg)`. Mọi thứ provider-specific nằm sau
 * `ProviderAdapter`.
 *
 * Cấu hình này là **runtime**, không đọc từ đâu cả: `lib/providers.ts` lưu cấu
 * hình trong Dexie nên lõi Node không dùng được, và lõi sẽ tự truyền cấu hình
 * đã giải sẵn (việc đó thuộc plan sau).
 *
 * Plan: docs/superpowers/plans/2026-10-18-provider-layer.md
 * Spec: docs/superpowers/specs/2026-10-18-cli-core-design.md §5
 */

/**
 * `anthropic` đi SDK native (`@ai-sdk/anthropic`); mọi thứ khác đi endpoint
 * OpenAI-compatible. Thêm hãng mới thì thêm giá trị ở đây, không rải điều kiện
 * `if` khắp lõi.
 */
export type AdapterKind = 'openai-compatible' | 'anthropic';

export interface ProviderRuntimeConfig {
  /** 'anthropic' dùng SDK native; mọi thứ khác dùng endpoint OpenAI-compatible. */
  kind: AdapterKind;
  /** base URL. Bỏ trống thì adapter dùng base URL mặc định của hãng. */
  baseUrl?: string;
  apiKey: string;
  /** id model theo quy ước của provider, ví dụ 'gpt-4o' hoặc 'claude-opus-5'. */
  model: string;
  /**
   * Ghi đè `fetch` của SDK. Bắt buộc cho mọi lần gọi **không** streaming:
   * `generateText` không gửi trường `stream`, mà nhiều gateway bỏ qua trường đó
   * và trả SSE — AI SDK ném "Invalid JSON response".
   *
   * Vì sao ở đây chứ không ở adapter: adapter chỉ dựng model, còn `fetch` là
   * thuộc tính của *đường gọi*, đúng như `toolChoice`. Truyền qua cấu hình là
   * cách duy nhất để một lần dựng model phục vụ được cả hai đường — xem
   * `app/api/chat/route.ts` (instance thứ hai cho đường emulated) và
   * `lib/non-streaming-fetch.ts`.
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Hàm thuần, không I/O — test được không cần mạng.
 *
 * Trả thẳng `cfg.kind`, KHÔNG thêm bảng ánh xạ tên khác: kiểu `AdapterKind` đã
 * chặn mọi giá trị lạ lúc biên dịch, nên bảng ánh xạ chỉ thêm một chỗ có thể lệch
 * mà không ai đổi tới.
 */
export function resolveAdapterKind(cfg: Pick<ProviderRuntimeConfig, 'kind'>): AdapterKind {
  return cfg.kind;
}
