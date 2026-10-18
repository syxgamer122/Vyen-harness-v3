/**
 * Registry agent: nguồn sự thật duy nhất cho "hệ thống có những agent nào".
 *
 * Server KHÔNG có đường dẫn workspace — `.vyen/skills` đã được client quét và
 * gửi `skillIndex` xuống, `.vyen/agents` đi đúng đường đó. Vì vậy registry ở đây
 * KHÔNG tự đọc đĩa; nó nhận danh sách `{name, content}` do client gửi lên.
 *
 * Tên agent là tên file, khớp CHÍNH XÁC, phân biệt hoa thường. Không có wildcard:
 * ký tự `*` không hợp lệ trong tên file trên Windows, nên pattern matching sẽ là
 * code không bao giờ chạy được trên đúng platform — đúng thứ đợt dọn này loại bỏ.
 * Claude Code và OpenCode cũng chỉ dùng tên tường minh.
 *
 * Phụ thuộc: `lib/agents/agent-definition.ts`. Không biết gì về tool hay về
 * delegate — phần đó thuộc `agent-tool-scope.ts`.
 */

import { parseAgentDefinition, type AgentDefinition } from './agent-definition';

export interface AgentRegistry {
  /** Đã sắp xếp theo name. */
  agents: readonly AgentDefinition[];
  /** Mỗi dòng là một lý do bỏ qua một file. */
  warnings: readonly string[];
}

export type AgentResolution =
  | { ok: true; definition: AgentDefinition }
  | { ok: false; error: string; available: string[] };

export function loadAgentRegistryFromEntries(
  entries: readonly { name: string; content: string }[]
): AgentRegistry {
  const agents: AgentDefinition[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    // Tên lặp: client gửi theo danh sách thư mục nên hiếm, nhưng nếu xảy ra thì
    // giữ bản đầu — im lặng thay thế sẽ khiến model gọi nhầm agent.
    if (seen.has(entry.name)) {
      warnings.push(`Bỏ qua agent "${entry.name}": trùng tên.`);
      continue;
    }
    const parsed = parseAgentDefinition(entry.name, entry.content);
    if (parsed.ok) {
      agents.push(parsed.definition);
      seen.add(entry.name);
    } else {
      warnings.push(`Bỏ qua agent "${entry.name}": ${parsed.error}`);
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, warnings };
}

export function resolveAgentDefinition(registry: AgentRegistry, name: string): AgentResolution {
  const hit = registry.agents.find((a) => a.name === name);
  if (hit) return { ok: true, definition: hit };

  const available = registry.agents.map((a) => a.name);
  // Liệt kê tên hợp lệ trong chính error: model đọc xong tự sửa được ngay trong
  // lượt đó, thay vì phải thử từng tên.
  const hint = available.length > 0 ? ` Có sẵn: ${available.join(', ')}.` : ' Chưa có agent nào.';
  return { ok: false, error: `Không có agent tên "${name}".${hint}`, available };
}

/**
 * Dòng danh sách agent nhét vào mô tả tool `delegate`.
 *
 * Chỉ tên + mô tả. KHÔNG kèm `tools:` — danh sách đó dài và biến động theo file,
 * đưa vào description sẽ làm prompt phình mỗi lần agent được thêm. Phần tool lọc
 * ở tầng schema, model không cần đọc để biết agent nào có tool nào.
 */
export function describeAgents(registry: AgentRegistry): string {
  return registry.agents.map((a) => `${a.name} — ${a.description}`).join('\n');
}
