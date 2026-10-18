/**
 * Quyết định agent con nhìn thấy tool nào.
 *
 * Đây là nơi biến "agent không được phép" thành "agent không nhìn thấy". Công cụ
 * vắng mặt khỏi schema thì model không thể gọi — không phụ thuộc vào việc có dạy
 * nó "đừng gọi" hay không, và không phụ thuộc vào một lớp kiểm tra ở tầng dưới
 * có bị lách hay không. Đây là cơ chế chống đệ quy duy nhất: `delegate` không có
 * trong bảng schema của con, nên con không thể gọi `delegate`.
 *
 * Bộ tool con = giao(bộ tool cha, tools khai báo). Giao chứ không phải hợp: cha
 * không có `shell_run` thì con khai `shell_run` cũng không được — nếu không, người
 * viết agent sẽ có một đường nâng quyền chỉ bằng cách tạo file agent.
 *
 * Phụ thuộc: `lib/tool-catalog.ts` (danh sách tool hợp lệ) và kiểu
 * `AgentDefinition`. Không phụ thuộc registry — nhận sẵn object đã phân giải.
 */

import { TOOL_CATALOG } from '@/lib/tool-catalog';
import type { AgentDefinition } from './agent-definition';

/** Tool không bao giờ tới được agent con, bất kể khai báo gì. */
const NEVER_INHERITED = new Set(['delegate']);

const KNOWN_TOOL_NAMES = new Set(TOOL_CATALOG.map((entry) => entry.name));

export function isKnownToolName(name: string): boolean {
  return KNOWN_TOOL_NAMES.has(name);
}

export interface ToolScopeResult {
  names: Set<string>;
  /** Tên trong `tools:` không có trong catalog — đã bị bỏ khỏi kết quả. */
  dropped: readonly string[];
}

export function resolveAgentToolNames(
  parentNames: ReadonlySet<string>,
  definition: AgentDefinition | null
): ToolScopeResult {
  if (definition?.tools === undefined) {
    // Kế thừa nguyên bộ của cha, trừ `delegate`.
    const names = new Set(parentNames);
    for (const t of NEVER_INHERITED) names.delete(t);
    return { names, dropped: [] };
  }

  const dropped: string[] = [];
  const names = new Set<string>();
  for (const t of definition.tools) {
    if (!isKnownToolName(t)) {
      // Gõ sai tên là lỗi soạn thảo, không phải lý do làm agent không chạy.
      dropped.push(t);
      continue;
    }
    if (parentNames.has(t)) names.add(t);
  }
  for (const t of NEVER_INHERITED) names.delete(t);
  return { names, dropped };
}
