/**
 * Registry agent: nguồn sự thật duy nhất cho "hệ thống có những agent nào".
 *
 * Đọc lại từ đĩa mỗi lần gọi, không cache: `.vyen/agents/` là file người dùng tự
 * viết và tự sửa giữa hai lượt chat, không có bước build nào để ghi cache vào.
 * Một registry cache sẽ liệt kê agent người dùng vừa xoá.
 *
 * Tên agent là tên file, khớp CHÍNH XÁC. Không có wildcard: ký tự `*` không hợp lệ
 * trong tên file trên Windows, nên pattern matching sẽ là code không bao giờ chạy
 * được trên đúng platform — đúng thứ đợt dọn này loại bỏ. Claude Code và OpenCode
 * cũng chỉ dùng tên tường minh.
 *
 * Phụ thuộc: `lib/agents/agent-definition.ts` và `node:fs`. Không biết gì về tool
 * hay về delegate — phần đó thuộc `agent-tool-scope.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

export function loadAgentRegistry(agentsDir: string): AgentRegistry {
  let names: string[];
  try {
    names = readdirSync(agentsDir);
  } catch {
    // Không có thư mục = người dùng chưa dùng tính năng này, KHÔNG phải lỗi.
    return { agents: [], warnings: [] };
  }

  const agents: AgentDefinition[] = [];
  const warnings: string[] = [];
  for (const entry of names.filter((n) => n.endsWith('.md')).sort()) {
    let raw: string;
    try {
      raw = readFileSync(join(agentsDir, entry), 'utf8');
    } catch (err) {
      warnings.push(`Bỏ qua .vyen/agents/${entry}: đọc lỗi — ${String(err)}`);
      continue;
    }
    const parsed = parseAgentDefinition(entry, raw);
    if (parsed.ok) agents.push(parsed.definition);
    else warnings.push(`Bỏ qua .vyen/agents/${entry}: ${parsed.error}`);
  }

  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, warnings };
}

/**
 * Dựng registry từ nội dung file do CLIENT gửi lên.
 *
 * Server không có đường dẫn workspace: `.vyen/skills` đã được client quét và gửi
 * `skillIndex` xuống, `.vyen/agents` đi theo đúng đường đó. Client gửi cặp
 * `{name, content}` vì `parseAgentDefinition` lấy tên agent từ TÊN FILE, mà tên
 * file không nằm trong nội dung markdown.
 *
 * File hỏng vẫn bị bỏ qua + ghi warning, y hệt nhánh đọc đĩa: một agent viết sai
 * không được làm hỏng các agent còn lại.
 */
export function loadAgentRegistryFromEntries(
  entries: readonly { name: string; content: string }[]
): AgentRegistry {
  const agents: AgentDefinition[] = [];
  const warnings: string[] = [];
  for (const entry of entries) {
    const parsed = parseAgentDefinition(entry.name, entry.content);
    if (parsed.ok) agents.push(parsed.definition);
    else warnings.push(`Bỏ qua agent "${entry.name}": ${parsed.error}`);
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
