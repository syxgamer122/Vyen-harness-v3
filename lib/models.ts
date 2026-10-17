/**
 * Model của dự án: KHÔNG còn danh mục built-in.
 *
 * BYOK 100% — model đến từ `GET /v1/models` của nhà cung cấp người dùng tự
 * khai, app không ship catalog nào. Vì vậy ở đây KHÔNG có `AVAILABLE_MODELS`,
 * không có `DEFAULT_MODEL_ID`: không có "model mặc định của máy chủ" để rơi về
 * khi người dùng chưa cấu hình gì.
 *
 * Phần còn lại của module là SỰ SUY LUẬN về một model id BYOK:
 *   - `resolveChainFor` — danh sách tên thử lần lượt trên upstream (id + biến
 *     thể gạch chấm, override qua env).
 *   - `defaultCapabilityFor` — capability BẢO THỦ cho model không khai báo:
 *     coi như không xem ảnh / không đọc PDF (xem `lib/vision-bridge.ts`).
 */

/**
 * Capability của model mà app dùng để quyết định cách gửi ảnh/PDF và tham số
 * chat. Model BYOK không khai báo capability trong `/v1/models`, nên đây là
 * cấu hình suy luận theo id — KHÔNG phải danh mục: id không trong bảng vẫn chạy
 * được, chỉ nhận giá trị mặc định bảo thủ ở dưới.
 */
export interface ModelCapabilityConfig {
  readonly supportsTemperature: boolean;
  readonly supportsImages: boolean;
  readonly supportsPdf: boolean;
  readonly maxOutputTokens: number;
}

/**
 * Model reasoning không chấp nhận `temperature` — gửi tham số này gateway trả
 * 400. Đây là danh sách id, không phải catalog: id ngoài danh sách vẫn chạy,
 * chỉ mất kiểm tra này.
 */
const NO_TEMPERATURE = /(o[134]|(^|[^a-z])reason|deepseek-r|qwq|thinking)/i;

const DEFAULT_CAPABILITY: ModelCapabilityConfig = {
  supportsTemperature: true,
  /* BẢO THỦ: model lạ coi như không xem được ảnh. Sai hướng này chỉ khiến ảnh
     bị mô tả bằng chữ qua vision-bridge (vẫn dùng được); sai hướng ngược lại
     gửi ảnh thô lên model chữ thuần và hỏng hẳn lượt chat. */
  supportsImages: false,
  supportsPdf: false,
  maxOutputTokens: 16_384,
};

/**
 * Bảng capability khai báo tay cho vài id phổ biến. KHÔNG phải danh mục
 * model của app — chỉ là ngoại lệ cho quy tắc mặc định ở trên. Thêm model ở
 * đây KHÔNG làm model đó xuất hiện trong picker: picker chỉ lấy danh sách từ
 * provider của người dùng.
 */
const CAPABILITY_OVERRIDES: ReadonlyMap<string, Partial<ModelCapabilityConfig>> = new Map([
  ['gpt-4o', { supportsImages: true, supportsPdf: true, supportsTemperature: true }],
  ['chatgpt-4o-latest', { supportsImages: true, supportsPdf: true }],
  ['gpt-4o-mini', { supportsImages: true, supportsPdf: true }],
  /* `o3`/`o3-mini` phải khai `supportsTemperature: false` TẠI ĐÂY, không dựa
     vào regex NO_TEMPERATURE bên dưới: entry trong bảng này `return` sớm nên
     regex không bao giờ chạy tới. Thiếu khai báo thì model reasoning gửi
     `temperature` lên gateway và bị 400. */
  ['o3', { supportsImages: true, supportsPdf: true, supportsTemperature: false }],
  ['o3-mini', { supportsImages: true, supportsPdf: true, supportsTemperature: false }],
  ['o1-mini', { supportsImages: false, supportsPdf: false, supportsTemperature: false }],
]);

function stripVendorPrefix(modelId: string): string {
  /* OpenRouter dùng `vendor/model`; hợp đồng model cũng tra theo id đã strip. */
  const slash = modelId.lastIndexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

/**
 * Capability suy luận cho một model id BYOK. Luôn trả về cấu hình dùng được —
 * không throw, không phụ thuộc model có "được biết" hay không.
 */
export function capabilityFor(modelId: string | null | undefined): ModelCapabilityConfig {
  const id = (modelId ?? '').trim().toLowerCase();
  if (!id) return DEFAULT_CAPABILITY;
  const override = CAPABILITY_OVERRIDES.get(id) ?? CAPABILITY_OVERRIDES.get(stripVendorPrefix(id));
  if (override) return { ...DEFAULT_CAPABILITY, ...override };
  return {
    ...DEFAULT_CAPABILITY,
    supportsTemperature: !NO_TEMPERATURE.test(id),
  };
}

/**
 * ENV override tên model: MODEL_ALIAS_MAP='{"gpt-4o":"gpt-4.1"}'.
 * Key = id nội bộ, value = tên thật trên upstream proxy của người dùng.
 * Cơ chế dùng chung, không phụ thuộc catalog.
 */
let aliasCache: Record<string, string> | null = null;
function aliasOverrides(): Record<string, string> {
  if (aliasCache) return aliasCache;
  try {
    const raw = process.env.MODEL_ALIAS_MAP;
    const parsed = raw ? JSON.parse(raw) : {};
    aliasCache =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
  } catch {
    console.warn('[models] MODEL_ALIAS_MAP không phải JSON hợp lệ, bỏ qua.');
    aliasCache = {};
  }
  return aliasCache;
}

/**
 * Chuỗi tên model thử lần lượt trên upstream: ENV alias → id gốc → biến thể
 * gạch chấm. KHÔNG có model dự phòng do app tự chọn — nếu hết tên trong chuỗi
 * thì báo lỗi thật, không âm thầm đổi sang model khác.
 */
export function resolveChainFor(modelId: string): readonly string[] {
  const chain: string[] = [];
  const push = (v?: string) => {
    const t = v?.trim();
    if (!t || chain.includes(t)) return;
    chain.push(t);
    // Một số upstream đặt tên model bằng gạch thay vì dấu chấm — thử biến thể
    // `.` -> `-` ngay sau id gốc để tự fallback khi nhà cung cấp đổi kiểu tên.
    const dashed = t.replace(/\./g, '-');
    if (dashed !== t && !chain.includes(dashed)) chain.push(dashed);
  };

  push(aliasOverrides()[modelId]);
  push(modelId);
  return Object.freeze(chain);
}

