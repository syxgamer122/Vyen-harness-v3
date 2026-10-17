'use client';

/**
 * Bảng phân quyền chi tiết từng công cụ (P1-6).
 *
 * Tính năng:
 * - Bảng phân quyền chi tiết per-tool: auto | ask | deny (hoặc default)
 * - Nhóm công cụ: fs / shell / git / mcp / web / plan / delegate / memory
 * - Tìm kiếm tool theo tên / mô tả
 * - Lọc theo nhóm
 * - Nút Reset: đặt lại toàn bộ quyền về mặc định
 * - Lưu đồng bộ: Zustand persist + Dexie v14 (toolPermissions)
 */

import { useEffect, useId, useMemo, useState } from 'react';
import {
  RotateCcw,
  Search,
  FolderOpen,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import { TOOL_CATEGORY_ICON_COMPONENTS } from '@/components/tool-category-icons';
import { useAppStore, PERMISSION_OPTIONS, type PermissionOverride } from '@/lib/store';
import { isMcpAvailable, listMcpTools } from '@/lib/mcp/bridge';
import { mcpToolKey, type McpToolInfo } from '@/lib/mcp/tool-mapper';
import {
  ALL_TOOL_CATEGORIES,
  TOOL_CATEGORY_LABELS,
  type ToolCategory,
} from '@/lib/tool-catalog';
import {
  getAllToolRows,
  TOOL_PERMISSION_GROUPS,
  type ToolPermissionGroup,
  type AdditionalMcpToolItem,
  saveToolPermissionToDb,
  resetToolPermissionsInDb,
} from '@/lib/tool-permissions';

/*
 * Tên tool TRÙNG TÊN một khoá category.
 *
 * `toolPermissions` là một `Record` PHẲNG dùng cho hai việc: quyền theo nhóm
 * (8 khoá `ALL_TOOL_CATEGORIES`) và quyền theo tên tool trần. Ba chuỗi vừa là
 * tên category vừa là tên tool thật trong `TOOL_CATALOG`:
 *
 *   fs_read   (tool-catalog.ts:199)  → nhóm "Đọc file"  gồm 7 tool
 *   fs_write  (tool-catalog.ts:245)  → nhóm "Sửa & ghi file" gồm 3 tool
 *   delegate  (tool-catalog.ts:489)  → nhóm chỉ có đúng 1 tool nên vô hại
 *
 * Hệ quả trong `getEffectiveToolPermission` (`lib/tool-permissions.ts`):
 * bước 1 đọc `permissions[toolName]` TRƯỚC bước 3 đọc `permissions[category]`
 * — với tên trùng, hai bước đọc CÙNG một ô, và bước 1 luôn thắng nên bước 3
 * không bao giờ tới với các tool mang tên trùng.
 *
 * (Số dòng cố tình không ghi ở đây: xoá tầng glob đã dịch mọi dòng trong
 * `lib/tool-permissions.ts`, và đánh số dòng trong comment là thứ hỏng ngay
 * ở lần sửa kế tiếp. Bám vào TÊN HÀM và TÊN KHOÁ.)
 *
 * Nên đặt `fs_read = auto` ở dòng này kéo theo CẢ 7 tool đọc file thành Tự
 * duyệt, trong khi 6 dòng kia vẫn in "Mặc định". Đây là lỗi fail-open: người
 * dùng tưởng chỉ mở một tool.
 *
 * Cách sửa ở đây là sửa NÓI DỐI, không phải đổi định dạng dữ liệu: đánh dấu
 * rõ dòng đó điều khiển cả nhóm. Mọi nhu cầu thực tế vẫn làm được — đặt ô
 * nhóm ở đây rồi tinh chỉnh từng tool qua dòng riêng của tool đó (`fs_list`,
 * `fs_search`, `skill_load`… có ô riêng, bước 3 đọc đúng ô riêng).
 *
 * Thứ MẤT đi là "chặn cả nhóm nhưng riêng tool `fs_read` thì auto" — một ý định
 * vô nghĩa, đánh đổi này chấp nhận được so với việc đổi namespace khoá (đụng
 * 6 file test tripwire và phải vá parser glob tách tại dấu `:` đầu tiên).
 */
const CATEGORY_KEYS: ReadonlySet<string> = new Set<string>(ALL_TOOL_CATEGORIES);

/** Nhãn hiện dưới ô quyền của dòng trùng tên, để ô không đọc như per-tool. */
function CollidesWithGroupNote({ toolName }: { toolName: string }) {
  const label = TOOL_CATEGORY_LABELS[toolName as ToolCategory]?.label ?? toolName;
  return (
    <p className="field-hint mt-0.5 text-warning">
      Ô này đặt quyền cho <strong>toàn bộ nhóm “{label}”</strong>, không riêng công cụ này.
      Muốn chỉ đổi một công cụ thì dùng dòng riêng của công cụ đó.
    </p>
  );
}

/*
 * Nhóm quyền → TÊN icon (không phải component). Tên icon tra tiếp qua
 * TOOL_CATEGORY_ICON_COMPONENTS — nguồn duy nhất, dùng chung với tools-panel.
 *
 * Trước đây file này tự dựng `GROUP_ICONS` ánh xạ thẳng sang component, tức bản
 * sao thứ ba của cùng một bảng; thêm nhóm mới là phải nhớ sửa cả ba nơi.
 */
const GROUP_ICON_NAMES: Record<ToolPermissionGroup, string> = {
  fs: 'folder-open',
  shell: 'terminal',
  git: 'git-branch',
  mcp: 'server',
  web: 'globe',
  plan: 'list-checks',
  delegate: 'users',
  memory: 'bookmark',
};

export function ToolPermissionsTable() {
  const searchInputId = useId();
  const groupFilterId = useId();
  const toolPermissions = useAppStore((s) => s.settings.toolPermissions ?? {});
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<ToolPermissionGroup | 'all'>('all');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [mcpTools, setMcpTools] = useState<AdditionalMcpToolItem[]>([]);

  // Nạp MCP tools nếu đang chạy trên desktop
  useEffect(() => {
    if (!isMcpAvailable()) return;
    let alive = true;
    void listMcpTools()
      .then((tools: McpToolInfo[]) => {
        if (!alive) return;
        const mapped: AdditionalMcpToolItem[] = tools.map((t: McpToolInfo) => ({
          name: mcpToolKey(t.serverId, t.name),
          description: t.description,
          serverName: t.serverName || t.serverId,
        }));
        setMcpTools(mapped);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Danh sách toàn bộ tool (gộp cả MCP tools nếu có)
  const allRows = useMemo(() => getAllToolRows(mcpTools), [mcpTools]);

  // Lọc theo search và nhóm
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allRows.filter((row) => {
      const matchGroup = selectedGroup === 'all' || row.group === selectedGroup;
      if (!matchGroup) return false;
      if (!query) return true;
      return (
        row.name.toLowerCase().includes(query) ||
        row.shortLabel.toLowerCase().includes(query) ||
        row.description.toLowerCase().includes(query) ||
        row.group.toLowerCase().includes(query)
      );
    });
  }, [allRows, search, selectedGroup]);

  // Xử lý thay đổi quyền cho một tool
  const handlePermissionChange = (toolName: string, val: PermissionOverride) => {
    const updated = { ...toolPermissions, [toolName]: val };
    updateSettings({ toolPermissions: updated });
    void saveToolPermissionToDb(toolName, val);
  };

  // Đặt lại toàn bộ về mặc định
  const handleReset = async () => {
    // Giữ lại 8 category mặc định nhưng clear các per-tool overrides
    const defaultCategories: Record<string, PermissionOverride> = {
      fs_read: 'default',
      fs_write: 'default',
      shell: 'default',
      git: 'default',
      web: 'default',
      memory: 'default',
      plan: 'default',
      delegate: 'default',
    };
    updateSettings({ toolPermissions: defaultCategories });
    await resetToolPermissionsInDb();
    setResetConfirm(false);
  };

  const getPermissionBadge = (perm: PermissionOverride) => {
    switch (perm) {
      case 'auto':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-micro font-medium text-success">
            <ShieldCheck size={11} /> Tự duyệt
          </span>
        );
      case 'ask':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-micro font-medium text-warning">
            <ShieldQuestion size={11} /> Luôn hỏi
          </span>
        );
      case 'deny':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-micro font-medium text-danger">
            <ShieldAlert size={11} /> Chặn
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-subtle/40 bg-overlay px-2 py-0.5 text-micro font-medium text-tertiary">
            <Shield size={11} /> Mặc định
          </span>
        );
    }
  };

  return (
    <div className="lift-sm space-y-3 rounded-xl border border-subtle bg-raised p-4 font-sans">
      {/* Header controls: Search, Group Filter, Reset */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Ô tìm kiếm */}
          <div className="relative min-w-[160px] flex-1 max-w-xs">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary"
            />
            <input
              id={searchInputId}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm kiếm tool theo tên, mô tả..."
              className="field-sm w-full pl-8 text-xs"
            />
          </div>

          {/* Lọc theo nhóm */}
          <select
            id={groupFilterId}
            aria-label="Lọc nhóm công cụ"
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value as ToolPermissionGroup | 'all')}
            className="field-sm text-xs"
          >
            <option value="all">Tất cả nhóm ({allRows.length} tool)</option>
            {TOOL_PERMISSION_GROUPS.map((g) => {
              const count = allRows.filter((r) => r.group === g.key).length;
              return (
                <option key={g.key} value={g.key}>
                  {g.label} ({count})
                </option>
              );
            })}
          </select>
        </div>

        {/* Nút reset */}
        <div className="flex items-center gap-1">
          {resetConfirm ? (
            <div className="flex items-center gap-1.5">
              <span className="text-meta text-warning">Xác nhận reset?</span>
              <button
                type="button"
                onClick={() => void handleReset()}
                className="rounded-lg bg-danger px-2.5 py-1 text-meta font-semibold text-on-fill hover:bg-danger/85"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setResetConfirm(false)}
                className="rounded-lg border border-subtle bg-overlay px-2.5 py-1 text-meta text-primary hover:bg-raised"
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setResetConfirm(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-overlay px-3 py-1 text-meta font-medium text-primary hover:bg-raised"
              title="Đặt lại toàn bộ quyền về mặc định"
            >
              <RotateCcw size={12} /> Đặt lại mặc định
            </button>
          )}
        </div>
      </div>

      {/* Bảng phân quyền */}
      <div className="max-h-[380px] overflow-y-auto rounded-xl border border-subtle text-xs">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-overlay font-medium text-primary">
            <tr className="border-b border-subtle">
              <th className="px-3 py-2">Công cụ</th>
              <th className="px-3 py-2">Nhóm</th>
              <th className="px-3 py-2">Mô tả</th>
              <th className="px-3 py-2 text-right">Quyền</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {filteredRows.map((row) => {
              const currentVal = toolPermissions[row.name] ?? 'default';
              const Icon = TOOL_CATEGORY_ICON_COMPONENTS[GROUP_ICON_NAMES[row.group]] ?? FolderOpen;
              const selectId = `perm-select-${row.name}`;

              return (
                <tr
                  key={row.name}
                  className="hover:bg-overlay/60 transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-ui">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-primary">
                        {row.name}
                      </span>
                      {row.desktopOnly && (
                        <span
                          className="rounded-full bg-overlay border border-subtle px-2 py-0.5 text-micro text-tertiary"
                          title="Chỉ khả dụng trên bản Desktop"
                        >
                          desktop
                        </span>
                      )}
                    </div>
                    <div className="text-micro text-tertiary">{row.shortLabel}</div>
                    {CATEGORY_KEYS.has(row.name) && <CollidesWithGroupNote toolName={row.name} />}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-meta text-tertiary">
                      <Icon size={12} className="text-tertiary" />
                      {row.group}
                    </span>
                  </td>
                  <td className="max-w-[280px] px-3 py-2 text-meta text-tertiary leading-snug">
                    {row.description}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      {getPermissionBadge(currentVal)}
                      <label htmlFor={selectId} className="sr-only">
                        {CATEGORY_KEYS.has(row.name)
                          ? `Quyền cho nhóm ${
                              TOOL_CATEGORY_LABELS[row.name as ToolCategory]?.label ?? row.group
                            } (cũng là công cụ ${row.name})`
                          : `Quyền cho tool ${row.name}`}
                      </label>
                      <select
                        id={selectId}
                        value={currentVal}
                        onChange={(e) =>
                          handlePermissionChange(row.name, e.target.value as PermissionOverride)
                        }
                        className="field-sm h-7 text-meta"
                      >
                        {PERMISSION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-tertiary">
                  Không tìm thấy tool nào khớp với bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-meta text-tertiary">
        <span>Hiển thị {filteredRows.length} / {allRows.length} công cụ</span>
        <span>Mọi thay đổi được lưu tự động (Zustand + Dexie v14)</span>
      </div>
    </div>
  );
}
