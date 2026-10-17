/**
 * Reasoning capability — đọc metadata suy luận của model từ /v1/models.
 *
 * Hai dạng đều được chấp nhận:
 *  - OpenRouter: `supported_parameters` chứa "reasoning" + object `reasoning`
 *    (`mandatory` + `supported_efforts`) → biết chính xác model nào nhận mức nào.
 *  - Gateway tổng hợp (9router & tương tự): `capabilities.reasoning` +
 *    `capabilities.thinkingCanDisable` + `capabilities.thinkingRange` →
 *    xem `parseCapabilitiesShape`.
 *
 * File này THUẦN, chỉ kéo hằng thang mức từ `provider-url`.
 */

import { THINKING_LEVELS, type ThinkingLevel } from '@/lib/thinking-levels';

export interface ReasoningCapability {
  /**
   * Các mức trong thang Vyen mà model khai báo hỗ trợ. Mảng rỗng = model chỉ
   * bật/tắt suy luận — gửi mức nào cũng được, gateway tự dịch.
   */
  efforts: ThinkingLevel[];
  /** Model BẮT BUỘC suy luận — không có chế độ tắt. */
  mandatory: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Bốn mức lõi, dùng khi gateway KHÔNG liệt kê mức. Không bịa `none`/`minimal`/
 * `xhigh` ở nhánh đó: không khai thì không có bằng chứng model nhận, mà
 * `reasoning_effort` lạ là 400 — và `none` cho model bắt buộc suy luận là nút chết.
 */
const CORE_LEVELS: readonly ThinkingLevel[] = THINKING_LEVELS.filter(
  (level) => level === 'low' || level === 'medium' || level === 'high' || level === 'max',
);

/**
 * Phân tích một entry model từ response /v1/models.
 * Trả null khi không khai báo hỗ trợ reasoning (hoặc dữ liệu không đọc được)
 * — caller giữ hành vi cũ cho model đó.
 */
export function parseModelReasoning(item: unknown): ReasoningCapability | null {
  if (!isRecord(item)) return null;

  const capabilities = parseCapabilitiesShape(item);
  if (capabilities) return capabilities;

  const supportedParameters = Array.isArray(item.supported_parameters)
    ? item.supported_parameters
    : [];
  if (!supportedParameters.includes('reasoning')) return null;
  if (!isRecord(item.reasoning)) return null;

  const mandatory = item.reasoning.mandatory === true;
  const rawEfforts = item.reasoning.supported_efforts;

  // null = gateway không liệt kê: chỉ map bốn mức lõi.
  if (rawEfforts === null) {
    return { efforts: [...CORE_LEVELS], mandatory };
  }

  if (Array.isArray(rawEfforts)) {
    const lowered = new Set(
      rawEfforts.filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase()),
    );
    const efforts = THINKING_LEVELS.filter((level) => lowered.has(level));
    // Khai báo có reasoning nhưng không khớp mức nào trong thang (vd chỉ "ultra"
    // hay "extra-high") → coi như toggle-only: gửi mức nào cũng dịch được.
    return { efforts, mandatory };
  }

  // Có object reasoning nhưng KHÔNG khai báo efforts (undefined/kiểu lạ):
  // semantics prime-agent — chỉ bật/tắt, không chọn được mức.
  return { efforts: [], mandatory };
}

/**
 * Dạng metadata của gateway tổng hợp (9router & tương tự): capability nằm trong
 * `capabilities` thay vì `supported_parameters` + `reasoning`.
 *
 * Nguyên tắc: chỉ tin cờ gateway gửi, không suy đoán từ tên model.
 *
 * `thinkingRange` thiếu = CHƯA KHAI, khác `reasoning: false` là model không suy
 * luận. Nếu coi là "không có mức nào" thì rơi về toggle-only và nút bị ẩn, nên
 * ở đây map bốn mức lõi (`CORE_LEVELS`).
 *
 * Hệ quả đã chấp nhận: gateway khai `reasoning: true` nhưng thực tế không nhận
 * `reasoning_effort` thì model có thể báo lỗi tham số. Đổi lại người dùng luôn
 * có nút chỉnh — im lặng tệ hơn lỗi thấy được.
 */
function parseCapabilitiesShape(item: Record<string, unknown>): ReasoningCapability | null {
  if (!isRecord(item.capabilities)) return null;
  if (item.capabilities.reasoning !== true) return null;

  /* `thinkingCanDisable: false` = model luôn suy luận, không có chế độ tắt
     → `mandatory` đúng nghĩa, nút phải hiện để nói rõ điều đó. Trường thiếu
     thì coi như KHÔNG bắt buộc: im lặng về chế độ tắt hơn là bịa ra ràng buộc. */
  const mandatory = item.capabilities.thinkingCanDisable === false;

  /* `thinkingRange` khai đúng danh sách mức thì tôn trọng nó. */
  const range = item.capabilities.thinkingRange;
  if (Array.isArray(range)) {
    const lowered = new Set(
      range.filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase()),
    );
    return { efforts: THINKING_LEVELS.filter((level) => lowered.has(level)), mandatory };
  }

  return { efforts: [...CORE_LEVELS], mandatory };
}

/** true nếu `candidate` là mức gần `requested` nhất trong danh sách hỗ trợ. */
function distance(a: ThinkingLevel, b: ThinkingLevel): number {
  return Math.abs(THINKING_LEVELS.indexOf(a) - THINKING_LEVELS.indexOf(b));
}

/**
 * Có nên hiện điều khiển mức suy luận cho model này không?
 *
 *  - `null` (không có metadata) → ẩn: không biết thì không giả vờ biết.
 *  - `efforts.length > 0` → hiện: model chọn được mức thật.
 *  - `mandatory === true` → hiện: cần nói rõ model không tắt được suy luận.
 *  - `{ efforts: [], mandatory: false }` (toggle-only) → ẩn: không có mức nào
 *    để chọn, `visibleLevelsFor` sẽ chỉ hiện chỗ trang trí.
 */
export function shouldShowThinkingControl(
  cap: ReasoningCapability | null | undefined,
): boolean {
  if (!cap) return false;
  return cap.efforts.length > 0 || cap.mandatory;
}


/**
 * Chọn mức sẽ gửi upstream: đúng mức yêu cầu nếu được hỗ trợ, ngược lại mức
 * GẦN NHẤT theo thang none→max. Toggle-only (efforts rỗng) hoặc danh sách trống
 * → gửi nguyên mức yêu cầu.
 */
export function resolveNearestEffort(
  requested: ThinkingLevel,
  cap: ReasoningCapability | null | undefined,
): ThinkingLevel {
  if (!cap || cap.efforts.length === 0) return requested;
  if (cap.efforts.includes(requested)) return requested;
  // Mức gần requested hơn thì thắng; hòa nhau giữ mức đứng TRƯỚC trong danh sách.
  return cap.efforts.reduce((best, level) =>
    distance(level, requested) < distance(best, requested) ? level : best,
  );
}
