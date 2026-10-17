/**
 * Quản lý quyền chi tiết theo từng tool và theo category (P1-6).
 *
 * Lưu trữ đồng thời:
 * - Zustand persist (localStorage 'ai-chat-settings' v2): truy cập đồng bộ tức thì lúc chạy tool
 * - Dexie IndexedDB v14 (`toolPermissions`): lưu trữ bền vững local-first, hỗ trợ query và export
 *
 * Hỗ trợ 4 chế độ:
 * - always: Manual (hỏi tất cả)
 * - smart: Smart (tự duyệt read & safe commands, hỏi ghi/destructive)
 * - never: Autonomous / YOLO (tự duyệt tất cả trừ ALWAYS_BLOCK)
 * - chat_only: Chat Only (vô hiệu toàn bộ tool, kể cả fs_read)
 */

import { db, type StoredToolPermissionRecord } from '@/lib/db';
import type { PermissionOverride, ToolPermissions } from '@/lib/store';
import { TOOL_CATALOG, TOOL_CATEGORY_MAP, type ToolCatalogEntry } from '@/lib/tool-catalog';

export type ToolPermissionGroup =
  | 'fs'
  | 'shell'
  | 'git'
  | 'mcp'
  | 'web'
  | 'plan'
  | 'delegate'
  | 'memory';

export interface ToolGroupMeta {
  key: ToolPermissionGroup;
  label: string;
  description: string;
  icon: string;
}

export const TOOL_PERMISSION_GROUPS: readonly ToolGroupMeta[] = [
  {
    key: 'fs',
    label: 'Tập tin & Thư mục (fs)',
    description: 'Đọc, liệt kê, tìm kiếm, sửa và tạo file trong workspace.',
    icon: 'folder-open',
  },
  {
    key: 'shell',
    label: 'Shell & Tiến trình nền',
    description: 'Chạy lệnh shell máy chủ và quản lý tiến trình nền (bg_*).',
    icon: 'terminal',
  },
  {
    key: 'git',
    label: 'Kiểm soát phiên bản (Git)',
    description: 'Xem trạng thái, log, diff, stage và commit git.',
    icon: 'git-branch',
  },
  {
    key: 'mcp',
    label: 'Model Context Protocol (MCP)',
    description: 'Các công cụ mở rộng từ các MCP server được kết nối.',
    icon: 'server',
  },
  {
    key: 'web',
    label: 'Tìm kiếm & Đọc web',
    description: 'Tìm kiếm web, cào dữ liệu URL và tiện ích thông tin.',
    icon: 'globe',
  },
  {
    key: 'plan',
    label: 'Kế hoạch (Plan)',
    description: 'Tạo và cập nhật subtasks trong kế hoạch công việc.',
    icon: 'list-checks',
  },
  {
    key: 'delegate',
    label: 'Subagent (Delegate)',
    description: 'Giao việc phân nhánh cho subagent chạy độc lập.',
    icon: 'users',
  },
  {
    key: 'memory',
    label: 'Bộ nhớ dài hạn & Ghi nhớ',
    description: 'Ghi nhớ quy tắc dự án và truy xuất kinh nghiệm đã lưu.',
    icon: 'bookmark',
  },
];

/** Map tool name sang 8 nhóm phân quyền chuẩn P1-6. */
export function getToolGroup(toolName: string): ToolPermissionGroup {
  if (toolName.startsWith('mcp__') || toolName === 'mcp' || toolName === 'tools_search' || toolName === 'tools_load') return 'mcp';
  if (toolName === 'run_code') return 'shell';
  const category = TOOL_CATEGORY_MAP[toolName];
  if (category === 'fs_read' || category === 'fs_write') return 'fs';
  if (category === 'shell') return 'shell';
  if (category === 'git') return 'git';
  if (category === 'web') return 'web';
  if (category === 'plan') return 'plan';
  if (category === 'delegate') return 'delegate';
  if (category === 'memory') return 'memory';
  return 'fs';
}

/**
 * Lấy danh sách toàn bộ tool chuẩn hóa kèm nhóm cho bảng phân quyền.
 */
export interface ToolRowItem {
  name: string;
  group: ToolPermissionGroup;
  shortLabel: string;
  description: string;
  kind: 'server' | 'client';
  desktopOnly?: boolean;
}

export interface AdditionalMcpToolItem {
  name: string;
  description: string;
  serverName?: string;
}

export function getAllToolRows(additionalMcpTools: AdditionalMcpToolItem[] = []): ToolRowItem[] {
  const rows: ToolRowItem[] = TOOL_CATALOG.map((entry) => ({
    name: entry.name,
    group: getToolGroup(entry.name),
    shortLabel: entry.shortLabel,
    description: entry.description,
    kind: entry.kind,
    desktopOnly: entry.desktopOnly,
  }));

  // Gộp các tool MCP nếu có
  for (const mcp of additionalMcpTools) {
    if (!rows.some((r) => r.name === mcp.name)) {
      rows.push({
        name: mcp.name,
        group: 'mcp',
        shortLabel: mcp.serverName ? `MCP (${mcp.serverName})` : 'MCP Tool',
        description: mcp.description || 'Tool từ MCP server',
        kind: 'client',
        desktopOnly: true,
      });
    }
  }

  return rows;
}

/**
 * Kiểm tra xem một tool có phải là dynamic MCP tool định dạng `mcp__<server>__<tool>` hay không.
 */
export function isDynamicMcpTool(toolName: string): boolean {
  return typeof toolName === 'string' && /^mcp__[a-zA-Z0-9_.-]+__[a-zA-Z0-9_.-]+$/.test(toolName);
}

/**
 * Lấy quyền hiệu lực cho một tool cụ thể (P3.6 Policy-as-Data).
 *
 * Thứ tự ưu tiên (2026-10-16 — đã bỏ tầng khoá glob, xem ghi chú dưới):
 * 1. Tool override cụ thể (`permissions[toolName]`)
 * 2. Dynamic MCP server-level pattern (`permissions['mcp__<server>__*']`)
 * 3. Category override (`permissions[category]`) hoặc `permissions['mcp']`
 * 4. Deny-by-default cho dynamic MCP tool chưa được phê duyệt (`mcp__<server>__<tool>`)
 * 5. 'default'
 *
 * KHÔNG có tầng khoá glob (`fs_read:src/**`, `*.env*`) nữa, dù trước đây engine
 * tra nó TRƯỚC mọi thứ. Ba lý do đã xoá:
 *
 *   - KHÔNG có UI nào tạo được khoá đó, chưa bao giờ có (`git log -S 'fs_read:'`
 *     chỉ trả về commit baseline). Bảng phân quyền chỉ ghi tên tool trần, panel
 *     Công cụ chỉ ghi 8 category.
 *   - `deny` qua tầng đó KHÔNG chặn cứng. `isToolDenied` (`tool-catalog.ts:89`)
 *     nhận đúng 2 tham số, không có `args`, nên không thể đọc khoá theo đường
 *     dẫn. Nơi duy nhất đọc tầng glob là `auto-pilot.ts`, và ở đó `deny` và
 *     `ask` đều chỉ `return false` — tức mở modal. Nhãn "Chặn" là lời nói dối.
 *   - Nó thắng theo THỨ TỰ CHÈN, không theo độ đặc hiệu: một khoá `**` viết
 *     trước sẽ `auto` mọi tool có tham số đường dẫn và đè cả per-tool. Tệ hơn,
 *     `toolName` là PK không có `++` trong Dexie nên `toArray()` trả thứ tự
 *     lexicographic — khoá thắng đổi giữa lúc tải trang và lúc restart.
 *
 * Use-case bảo mật nổi bật nhất (chặn ghi `.env`) đã hardcode sẵn ở
 * `targetsProtectedPath` (`auto-pilot.ts:213-226`), chạy TRƯỚC khối này — nên
 * xoá không mất lớp bảo vệ nào.
 *
 * Tham số `argsOrPath` từng được giữ cho một tầng path-scoped chưa bao giờ
 * được xây; nay đã bỏ khỏi chữ ký vì chỉ còn 2 call site truyền nó
 * (`auto-pilot.ts`) mà không dùng giá trị nào của nó.
 */
export function getEffectiveToolPermission(
  toolName: string,
  permissions: ToolPermissions,
): PermissionOverride {
  // 1. Tool override cụ thể (permissions[toolName])
  const specific = permissions[toolName];
  if (specific && specific !== 'default') return specific;

  // 2. Dynamic MCP server-level pattern (vd: mcp__github__*)
  if (isDynamicMcpTool(toolName)) {
    const serverMatch = toolName.match(/^mcp__([a-zA-Z0-9_.-]+)__/);
    if (serverMatch) {
      const serverWildcard = `mcp__${serverMatch[1]}__*`;
      if (permissions[serverWildcard] && permissions[serverWildcard] !== 'default') {
        return permissions[serverWildcard]!;
      }
    }
  }

  // 3. Category override
  const category = TOOL_CATEGORY_MAP[toolName];
  if (category && permissions[category] && permissions[category] !== 'default') {
    return permissions[category]!;
  }

  if (
    (toolName.startsWith('mcp__') || toolName === 'tools_search' || toolName === 'tools_load') &&
    permissions['mcp'] &&
    permissions['mcp'] !== 'default'
  ) {
    return permissions['mcp']!;
  }

  if (toolName === 'run_code' && permissions['shell'] && permissions['shell'] !== 'default') {
    return permissions['shell']!;
  }

  // 4. Enforce deny-by-default cho unapproved dynamic MCP tools (mcp__<server>__<tool>)
  if (isDynamicMcpTool(toolName)) {
    return 'deny';
  }

  return 'default';
}

/**
 * Lưu một quyền vào bảng Dexie `toolPermissions`.
 */
export async function saveToolPermissionToDb(
  toolName: string,
  permission: PermissionOverride,
): Promise<void> {
  try {
    await db.toolPermissions.put({
      toolName,
      permission,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn(`[tool-permissions] Lưu Dexie thất bại cho ${toolName}:`, err);
  }
}

/**
 * Đọc toàn bộ quyền từ bảng Dexie `toolPermissions`.
 */
export async function loadToolPermissionsFromDb(): Promise<Record<string, PermissionOverride>> {
  try {
    const list = await db.toolPermissions.toArray();
    const map: Record<string, PermissionOverride> = {};
    for (const item of list) {
      if (item.toolName && item.permission) {
        map[item.toolName] = item.permission;
      }
    }
    return map;
  } catch (err) {
    console.warn('[tool-permissions] Đọc Dexie thất bại:', err);
    return {};
  }
}

/**
 * Xóa sạch toàn bộ override trong Dexie và trả về cấu hình mặc định sạch.
 */
export async function resetToolPermissionsInDb(): Promise<void> {
  try {
    await db.toolPermissions.clear();
  } catch (err) {
    console.warn('[tool-permissions] Xóa Dexie thất bại:', err);
  }
}
