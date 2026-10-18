/**
 * Định nghĩa "một agent là gì" cho hệ sub-agent khai báo.
 *
 * File agent nằm ở `.vyen/agents/<tên>.md`: frontmatter YAML khai báo đặc tính,
 * phần thân markdown là system prompt riêng của agent đó. Tên agent CHÍNH LÀ tên
 * file — không khai báo `name` trong frontmatter, vì khai báo thêm chỉ tạo ra một
 * chỗ để file và tên lệch nhau.
 *
 * File này chỉ lo phần parse + validate. Nó KHÔNG đọc đĩa (registry lo), và không
 * biết agent dùng được tool nào (agent-tool-scope lo) — mỗi tầng một việc để
 * test được độc lập và không import vòng.
 *
 * Phụ thuộc: `yaml` (đã có sẵn trong repo) và `lib/frontmatter.ts`.
 */

import { parse as parseYaml } from 'yaml';
import { splitFrontmatter } from '@/lib/frontmatter';

export const AGENT_DESCRIPTION_MAX = 400;
export const AGENT_STEPS_MIN = 1;
export const AGENT_STEPS_MAX = 25;
export const AGENT_STEPS_DEFAULT = 10;

export interface AgentDefinition {
  /** Tên agent = tên file bỏ đuôi. */
  name: string;
  /** Model đọc để biết agent này làm được gì. 1..400 ký tự. */
  description: string;
  /** Tool agent được phép dùng. undefined = kế thừa toàn bộ bộ tool của cha. */
  tools?: readonly string[];
  /** undefined = dùng model của cha. */
  model?: string;
  /** Trần vòng agentic. Đã kẹp về [AGENT_STEPS_MIN, AGENT_STEPS_MAX]. */
  steps: number;
  /** Markdown sau frontmatter, làm system prompt của agent. */
  body: string;
}

export type ParseAgentResult =
  | { ok: true; definition: AgentDefinition }
  | { ok: false; error: string };

/**
 * `steps` viết sai không phải lỗi tử thế: người viết agent gõ `steps: 999` chỉ
 * là muốn "nhiều thôi", đẻ ra lỗi làm cả registry bỏ file đó. Nên kẹp thay vì từ chối.
 * Còn giá trị không phải số nguyên thì lấy mặc định — nghi ngờ không có giá trị nào.
 */
function clampSteps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return AGENT_STEPS_DEFAULT;
  if (value < AGENT_STEPS_MIN) return AGENT_STEPS_MIN;
  if (value > AGENT_STEPS_MAX) return AGENT_STEPS_MAX;
  return value;
}

export function parseAgentDefinition(fileName: string, raw: string): ParseAgentResult {
  const split = splitFrontmatter(raw);
  if (!split) {
    return { ok: false, error: 'Thiếu frontmatter YAML (file phải bắt đầu bằng dòng ---).' };
  }

  let front: unknown;
  try {
    front = parseYaml(split.frontRaw);
  } catch (err) {
    return {
      ok: false,
      error: `Frontmatter hỏng: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const rec = (front ?? {}) as Record<string, unknown>;
  const description = typeof rec.description === 'string' ? rec.description.trim() : '';
  if (!description) return { ok: false, error: 'description: bắt buộc.' };
  if (description.length > AGENT_DESCRIPTION_MAX) {
    return {
      ok: false,
      error: `description: tối đa ${AGENT_DESCRIPTION_MAX} ký tự, đang ${description.length}.`,
    };
  }

  const tools = Array.isArray(rec.tools)
    ? rec.tools.filter((t): t is string => typeof t === 'string')
    : undefined;
  const model = typeof rec.model === 'string' ? rec.model.trim() : '';

  return {
    ok: true,
    definition: {
      name: fileName.replace(/\.md$/, ''),
      description,
      ...(tools ? { tools } : {}),
      ...(model ? { model } : {}),
      steps: clampSteps(rec.steps),
      body: split.body.replace(/\s+$/, ''),
    },
  };
}
