# Settings Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa 9 lỗ hổng đã kiểm chứng trong phần Cài đặt — 3 bug gây mất cấu hình/sai hành vi người dùng thấy ngay, 3 tính năng "UI nói dối", và 3 lỗi chỉ mục tìm kiếm.

**Architecture:** Không đụng engine phê duyệt, không đụng `partialize` persist (trừ khi nêu rõ), không migrate dữ liệu người dùng. Nguyên tắc chỉ đạo: phần lớn lỗ hổng là **sợi dây đứt** chứ không phải xung đột thiết kế — nên sửa bằng cách cho UI nói đúng sự thật, không phải nối lại tính năng chết.

**Tech Stack:** Next.js (App Router) · React 19 · TypeScript · Zustand persist · Dexie (IndexedDB) · Vitest · Tailwind v4

**Spec:** Không có file spec riêng. Kế hoạch này thay cho spec — nó là nguồn sự thật cho những gì quyết định ở đây. Bối cảnh gốc nằm trong `DESIGN.md` (§2 token màu, §7 light-only) và `PLAN.md`.

## Global Constraints

- **Cấm chạy test qua OpenCode.** `vitest`, `tsc`, `docs:check`, `eslint` — người dùng tự chạy ngoài. Mỗi task kết thúc bằng bước **bàn giao kiểm thử**, không phải bước "chạy test".
- **Mọi lệnh git phải có `--no-pager`.**
- **Cấm `setsid`, `nohup`,** và dấu ống phức tạp trong bash (`| tail`, `| wc`, `| grep`).
- **Không đổi tên, không xoá, không thêm/bớt khoá `ALL_TOOL_CATEGORIES`** (`lib/tool-catalog.ts:30-32`). 6 file test đang canh đúng 8 khoá và đúng thứ tự: `tests/chat-tools-router-projection.test.ts:397-405`, `tests/tool-catalog.test.ts:143-149`, `tests/tools-panel.test.ts:53-56`, `tests/tool-deny.test.ts:37`, `tests/redteam-permissions.test.ts:45-73`, `tests/redteam-catalog.test.ts:84-86`.
- **Không xoá khoá nào khỏi `partialize`** trong `lib/store.ts:374-416`. Xoá khoá = mất cấu hình người dùng.
- **Mọi chữ hiển thị ra UI viết bằng tiếng Việt có dấu.** Đây là quy ước của toàn repo.
- Copy trong UI phải nói **đúng sự thật hiện tại của code**. Không mô tả tính năng chưa được nối.
- Đừng dùng emoji làm icon (`ui-ux-pro-max` hạng 4) — dùng icon Lucide đã import.
- Dùng đúng token sẵn có: `.settings-card` · `.settings-card-body` · `.field-label` · `.field-hint` · `.field` · `.field-sm` · `.select-field` · `.checkbox-box` · `.btn-secondary` · `.btn-primary` · `.notice-warn` · `.notice-error` · `.icon-btn.icon-btn-sm.icon-btn-danger`.

## Review Focus

Năm lớp input mà spec im lặng, dễ cắm vào người dùng nhất — mỗi dòng được ghim bằng một test trong task sở hữu code đó:

1. **Người dùng đã đặt quyền nhóm trước khi bản này ship.** Dexie của họ có khoá `fs_read` (tức là nhóm Đọc file). Task 2 phải đọc được và giữ nguyên, không được coi là dữ liệu hỏng. → Task 2
2. **Người dùng không có desktop bridge.** `listMcpTools()` trả về rỗng, bảng phân quyền chỉ có 36 dòng. Mọi copy trong Task 6 và 7 phải đúng với con số 36, không giả định có MCP. → Task 6, 7
3. **`provider.models` rỗng** (người dùng mới cài, chưa bấm kiểm tra kết nối). Bảng phân quyền và model chains phải render được, không crash. → Task 3, 4
4. **Người dùng bấm `/tools` khi Settings đang mở sẵn.** `resolveSettingsTab` phải chuyển tab, không phải chỉ mở modal. → Task 1
5. **Persist cũ của người dùng có `theme` trong localStorage** từ các phiên trước. Xoá khoá ở `partialize` không được làm phiên đó hỏng/reload loop. → Task 5

---

### Task 1: `/tools` mở đúng tab + dọn tham số `autoPilot` chết

**Files:**
- Modify: `react/use-chat-orchestration.ts:6240` (sửa `'chung'` → `'safety'`)
- Modify: `react/use-chat-orchestration.ts:6304-6318` (bỏ `autoPilot` khỏi 4 lệnh gọi `updateSettings`)
- Test: `tests/slash-commands.test.ts`

**Interfaces:**
- Consumes: `useAppStore.getState().openSettings(tab: string)` (`lib/store.ts:243`), `resolveSettingsTab` (`components/settings/settings-tabs.ts:95`).
- Produces: không có symbol mới. Kết quả mong đợi: `'safety'` là id tab hợp lệ đi qua nhánh `default` của `resolveSettingsTab` (`settings-tabs.ts:115`) và trả về `'safety'`.

Bối cảnh cần hiểu trước khi sửa: `lib/store.ts:355-357` đã tự tính `next.autoPilot` và `next.agentTools` từ `approvalPolicy` và **ghi đè** mọi giá trị `autoPilot` truyền vào. Bốn lệnh gọi ở `use-chat-orchestration.ts:6308,6310,6312,6314` đang truyền thừa. Không hỏng hôm nay, nhưy đọc code tưởng `autoPilot` còn là nút độc lập.

`resolveSettingsTab` map `'chung'` → `'appearance'` (`settings-tabs.ts:98-99`), còn map `'tools'` → `'safety'` (`:103-104`). `'chung'` là **alias cũ** còn sót. Toast ở `use-chat-orchestration.ts:6242` nói "đã mở cài đặt công cụ" nhưng tab `appearance` không có cài đặt công cụ nào.

- [ ] **Step 1: Viết test đỏ**

Thêm vào `tests/slash-commands.test.ts`. Dùng đúng convention source-scan của repo — `fs.readFileSync(path.resolve(__dirname, '...'), 'utf8')`, copy từ `tests/tool-deny.test.ts:107`. **Đừng** tạo helper `readRel` dùng chung: helper đó là `const` cục bộ trong `tests/design-system.test.ts:13`, không phải export.

```ts
describe('slash /tools mở đúng tab cài đặt', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../react/use-chat-orchestration.ts'), 'utf8');

  it("không còn truyền alias cũ 'chung' cho lệnh tools", () => {
    expect(src).not.toMatch(/slash\.kind === 'tools'[\s\S]{0,200}openSettings\('chung'\)/);
  });

  it('lệnh tools mở tab safety', () => {
    expect(src).toMatch(/slash\.kind === 'tools'[\s\S]{0,200}openSettings\('safety'\)/);
  });
});
```

`readRel` là helper đọc source đã có sẵn trong repo — dùng đúng helper mà `tests/tool-deny.test.ts` import, đừng viết helper mới.

- [ ] **Step 2: Sửa `use-chat-orchestration.ts:6240`**

Đổi đúng một từ: `openSettings('chung')` → `openSettings('safety')`.

- [ ] **Step 3: Bỏ `autoPilot` khỏi 4 lệnh gọi trong `onCycleAutoPilot`**

Sửa `use-chat-orchestration.ts:6307-6317` thành:

```ts
const current = approvalPolicy ?? (autoPilot ? 'smart' : 'always');
if (current === 'always') {
  updateSettings({ approvalPolicy: 'smart' });
} else if (current === 'smart') {
  updateSettings({ approvalPolicy: 'never' });
} else if (current === 'never') {
  updateSettings({ approvalPolicy: 'chat_only' });
} else if (current === 'chat_only') {
  updateSettings({ approvalPolicy: 'always' });
} else {
  updateSettings({ approvalPolicy: 'smart' });
}
```

Giữ nguyên `current` đọc `autoPilot` — đó là fallback hợp lệ cho persist cũ. Chỉ bỏ phần **ghi**. Cập nhật dep-array ở `:6318` nếu `autoPilot` không còn được dùng bên trong thì không cần đổi ( nó vẫn được đọc ở `current`).

- [ ] **Step 4: Viết test khoá hành vi store**

Thêm vào `tests/store-persist.test.ts`, cạnh khối `partialize`:

```ts
it('updateSettings chỉ cần approvalPolicy — autoPilot và agentTools tự suy ra', () => {
  useAppStore.getState().updateSettings({ approvalPolicy: 'never' });
  expect(useAppStore.getState().settings.approvalPolicy).toBe('never');
  expect(useAppStore.getState().settings.autoPilot).toBe(true);
  expect(useAppStore.getState().settings.agentTools).toBe(true);

  useAppStore.getState().updateSettings({ approvalPolicy: 'chat_only' });
  expect(useAppStore.getState().settings.autoPilot).toBe(false);
  expect(useAppStore.getState().settings.agentTools).toBe(false);
});
```

- [ ] **Step 5: Bàn giao kiểm thử cho người dùng**

Gửi user: `npx vitest run tests/slash-commands.test.ts tests/store-persist.test.ts`. Không tự chạy.

- [ ] **Step 6: Commit**

```bash
git add react/use-chat-orchestration.ts tests/slash-commands.test.ts tests/store-persist.test.ts
git commit -m "fix(settings): /tools mở đúng tab safety, bỏ tham số autoPilot chết"
```

---

### Task 2: Đồng bộ Dexie khi đổi quyền ở panel Công cụ (chống mất cấu hình sau F5)

**Files:**
- Modify: `components/tools-panel.tsx:189-208` (thêm lời gọi `saveToolPermissionToDb`)
- Test: `tests/tools-panel.test.ts`

**Interfaces:**
- Consumes: `saveToolPermissionToDb(toolName: string, permission: PermissionOverride): Promise<void>` (`lib/tool-permissions.ts:308`). `PermissionOverride` = `'default' | 'auto' | 'ask' | 'deny'` (`lib/store.ts:100`).
- Produces: không có symbol mới.

Bối cảnh: lỗi này làm **mất cấu hình thật**, không phải lỗi hiển thị.

- `components/tools-panel.tsx:193-199` (đổi quyền nhóm) chỉ gọi `updateSettings` — **không** ghi Dexie.
- `components/tool-permissions-table.tsx:109-110` (đổi quyền từng tool) ghi **cả hai**.
- `syncToolPermissionsToDb` (`lib/tool-permissions.ts:345`) chỉ được gọi từ `tests/`.
- Lúc khởi động app: `react/use-chat-orchestration.ts:493-499` làm `{ ...cur, ...dbPerms }` ⇒ **Dexie thắng Zustand theo từng khoá**.

Nghĩa là: người dùng đổi quyền nhóm "Đọc file" → F5 → quay về giá trị cũ trong Dexie, vĩnh viễn.

- [ ] **Step 1: Viết test đỏ**

Thêm vào `tests/tools-panel.test.ts`. File này chưa đọc source; dùng cùng convention `fs.readFileSync` như Task 1 và nói rõ đường dẫn để người đọc không phải đoán:

```ts
it('đổi quyền nhóm thì ghi Dexie, không chỉ ghi store', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../components/tools-panel.tsx'), 'utf8');
  expect(src).toMatch(/saveToolPermissionToDb/);
});
```

- [ ] **Step 2: Thêm import và lời gọi**

Trong `components/tools-panel.tsx`, thêm vào nhóm import hiện có:

```ts
import { saveToolPermissionToDb } from '@/lib/tool-permissions';
```

Trong `onChange` của `<select>` ở khoảng `:192-199`, sau khi gọi `updateSettings`, thêm:

```ts
void saveToolPermissionToDb(section.category, e.target.value as PermissionOverride);
```

`section.category` là đúng tên khoá nhóm (`ToolCategory`), khớp cột `toolName` trong bảng Dexie (`lib/db.ts:777`).

- [ ] **Step 3: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/tools-panel.test.ts tests/tool-permissions.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add components/tools-panel.tsx tests/tools-panel.test.ts
git commit -m "fix(permissions): ghi Dexie khi đổi quyền nhóm, không mất sau reload"
```

---

### Task 3: Làm bảng phân quyền từng tool trung thực với 3 khoá trùng tên

**Files:**
- Modify: `components/tool-permissions-table.tsx` (render 3 dòng trùng tên như dòng nhóm, kèm nhãn giải thích)
- Test: `tests/tool-permissions.test.ts`

**Interfaces:**
- Consumes: `ALL_TOOL_CATEGORIES: readonly ToolCategory[]` (`lib/tool-catalog.ts:30`), `TOOL_CATALOG`, `ToolRowItem.name` / `.group` (từ `getAllToolRows`, `lib/tool-permissions.ts:120`).
- Produces: không có symbol mới. **Không đổi format lưu trữ, không migrate.**

Bối cảnh — đây là lỗi **fail-open**, nguy hiểm hơn lỗi chặn nhầm:

`toolPermissions` là một `Record` phẳng. Ba chuỗi vừa là tên category vừa là tên tool thật trong `TOOL_CATALOG`: `fs_read` (`lib/tool-catalog.ts:199`), `fs_write` (`:245`), `delegate` (`:489`).

Trong `getEffectiveToolPermission` (`lib/tool-permissions.ts:229`):
- bước 3 (`:265`) đọc `permissions[toolName]`
- bước 6 (`:280-283`) đọc `permissions[category]`

Với `toolName = 'fs_read'`, hai bước này đọc **cùng một ô**. Bước 3 luôn thắng nên bước 6 chết cho tên trùng.

Kết quả quan sát được: đặt row `fs_read = auto` trong bảng per-tool ⇒ **cả 7 tool đọc file** (`fs_read, fs_list, fs_search, skill_load, code_skeleton, code_symbols, code_verify`) thành Tự duyệt, trong khi UI vẫn in "Mặc định" cho 6 tool kia. Người dùng tưởng mình chỉ mở 1 tool.

Phương án đã cân nhắc và **bác bỏ**: đổi tên khoá category thành `cat:fs_read`. Nó sửa đúng gốc nhưng đụng 6 file test tripwire (xem Global Constraints), và tệ hơn: `getEffectiveToolPermission` tách khoá tại dấu `:` **đầu tiên** (`lib/tool-permissions.ts:241-243`) nên `cat:fs_read` sẽ bị đọc thành path-rule `ruleTool='cat'`, `glob='fs_read'` — phải vá thêm parser.

Phương án chọn: **giữ nguyên định dạng dữ liệu, sửa để UI nói đúng.** Ở ba dòng trùng tên, đổi nhãn để người dùng hiểu ô đó điều khiển cả nhóm. Mọi nhu cầu thực tế vẫn diễn đạt được:

- "Chặn cả nhóm đọc file" → đặt nhóm `fs_read` (panel Công cụ)
- "Nhóm đọc file auto, trừ `fs_list` phải hỏi" → đặt `fs_read = auto` (dòng nhóm) rồi `fs_list = deny` (dòng riêng của nó, có slot riêng, bước 3 đọc trúng)
- Điều **không** diễn đạt được: "chặn cả nhóm, nhưng riêng tool `fs_read` thì auto" — một ý định vô nghĩa, đánh đổi này chấp nhận được.

`delegate` trùng tên nhưng vô hại: nhóm `delegate` chỉ có đúng một tool nên hai nghĩa là một.

- [ ] **Step 1: Viết test đỏ**

Thêm vào `tests/tool-permissions.test.ts`:

```ts
describe('dòng trùng tên category/tool được gắn nhãn nhóm', () => {
  const COLLIDING = ['fs_read', 'fs_write', 'delegate'] as const;

  it('mọi dòng có tên trùng 1 category đều được đánh dấu', () => {
    const cats = new Set<string>(ALL_TOOL_CATEGORIES);
    const rows = getAllToolRows([]);
    const colliding = rows.filter((r) => cats.has(r.name));
    expect(colliding.map((r) => r.name).sort()).toEqual([...COLLIDING].sort());
  });
});
```

- [ ] **Step 2: Tạo Set nhận biết tên trùng, ngay sau khi tính `allRows`**

Trong `components/tool-permissions-table.tsx`, ngay sau dòng tính `allRows` (khoảng `:88`), thêm:

```ts
const CATEGORY_KEYS = new Set<string>(ALL_TOOL_CATEGORIES);
```

Thêm `ALL_TOOL_CATEGORIES` vào import từ `@/lib/tool-catalog` nếu chưa có ở đó.

Đặt biến này **ngoài** component (cùng cấp với `KIND_ICONS` ở đầu file nếu có) để không tạo lại `Set` mỗi lần render.

- [ ] **Step 3: Render nhãn giải thích cạnh ô quyền của dòng trùng tên**

Trong khối render từng dòng (`filteredRows.map(...)`, khoảng `:250-313`), thêm ngay dưới dòng `shortLabel` của mỗi dòng có `CATEGORY_KEYS.has(row.name)`, một dòng chữ nhỏ:

```tsx
{CATEGORY_KEYS.has(row.name) && (
  <p className="field-hint mt-0.5 text-warning">
    Ô này đặt quyền cho TOÀN BỘ nhóm “{TOOL_CATEGORY_LABELS[row.name as ToolCategory].label}”,
    không riêng công cụ này.
  </p>
)}
```

Import thêm `TOOL_CATEGORY_LABELS` từ `@/lib/tool-catalog`.

- [ ] **Step 4: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/tool-permissions.test.ts tests/redteam-permissions.test.ts tests/chat-tools-router-projection.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add components/tool-permissions-table.tsx tests/tool-permissions.test.ts
git commit -m "fix(permissions): nhãn rõ 3 dòng trùng tên category điều khiển cả nhóm"
```

---

### Task 4: XOÁ HẲN Model Chains — tính năng chết, dữ liệu cũng xoá

**Files:**
- Modify: `components/routing-settings-panel.tsx` (xoá toàn bộ khối Model Chains, dọn handler + import chết)
- Modify: `lib/store.ts:23` (bỏ import `ChainEntry`/`CategoryId`/`DEFAULT_CHAINS`), `:218` (xoá field khỏi interface `Settings`), `:287` (xoá khỏi `DEFAULT_SETTINGS`), `:412` (xoá khỏi `partialize`)
- Modify: `components/settings/settings-tabs.ts:76` — **chuyển sang Task 6** (xem Pre-flight trong ledger)

**Interfaces:**
- Consumes: không có.
- Produces: **không có symbol mới**. `RoutingSettingsPanel` giữ nguyên export và vẫn render `LeadWorkerRoutingSection`.

> **Sửa đổi hướng theo yêu cầu user:** plan ban đầu chỉ ẨN UI và giữ `settings.modelChains`.
> User yêu cầu **xoá hẳn, không ẩn**. Task này xoá cả state lẫn persist.
> `tests/routing.test.ts` chỉ test hàm thuần trong `lib/routing/categories.ts` nên không bị ảnh hưởng.

Bối cảnh — đây không phải xung đột thiết kế, đây là **một sợi dây đứt**, và nó **nói dối người dùng**:

`chatRequestBody` (`react/use-chat-orchestration.ts:2896-2947`) **không chứa `customChains`**. Server đọc field này ở `app/api/chat/route.ts:742,1093` và dùng ở `:1196,1296`, nhưng không client nào gửi. `git log -S 'customChains' -- react/ components/` rỗng ⇒ chưa bao giờ được nối.

Thêm một lớp nữa: `use-chat-orchestration.ts:546-551` ép `model = MODELS[0].id` khi có provider, mà khai chains thì bắt buộc phải có provider ⇒ `model` luôn truthy ⇒ `route.ts:1191` luôn cho `activeCategory = undefined` ⇒ nhánh chains không bao giờ chạy, **dù đã gửi**.

Hệ quả lan: `route.ts:1223` hardcode `effort='medium'` ở nhánh không-chain ⇒ `lib/prompt/protocol.ts:154` (calibration chỉ chạy ở `high|max`) chưa bao giờ được chèn. `components/hud/agent-hud.tsx:91` vẫn hiện chip hạng mục cho một routing không từng xảy ra.

Lead/Worker Routing **giữ nguyên** — nó đã nối đúng vào body, đây là phần có ích.

**Phạm vi xoá — chỉ phía client.** `lib/routing/categories.ts` **giữ nguyên**: server vẫn dùng `resolveRoute`/`categoryChainHasModel` (`app/api/chat/route.ts:68`) và HUD dùng `CATEGORY_DESCRIPTIONS` (`components/hud/agent-hud.tsx:5`).

- [ ] **Step 1: Xoá render khối Model Chains khỏi `routing-settings-panel.tsx`**

Cấu trúc `RoutingSettingsPanel` hiện tại trong `components/routing-settings-panel.tsx`:

| Dải dòng | Nội dung | Hành động |
|---|---|---|
| `:193-362` | Toàn bộ khối Model Chains: header "Mixture-of-Models Routing", nút chọn 8 category, danh sách chuỗi, nút Export/Import/Reset, nút "Thêm model dự phòng vào chuỗi" | **XOÁ** |
| `:364-366` | `<div className="border-t border-subtle pt-3"><LeadWorkerRoutingSection /></div>` | **GIỮ** |

Sau khi xoá, thân `return` của `RoutingSettingsPanel` chỉ còn lại phần ở `:364-366`, và hàm chính sẽ là một wrapper mỏng quanh `LeadWorkerRoutingSection`.

Các handler chỉ phục vụ Model Chains và **phải xoá cùng lúc** vì sẽ thành biến chết (TypeScript `noUnusedLocals` sẽ đỏ):
- `handleExportJson` (`:157-169`)
- `handleImportJson` (`:171-189`)
- `handleAdd` (`handleModelChange` / `handleEffortChange` / `handleMove` / `handleRemove` — vùng `:113-155`)
- state `activeCat`, `chains`, `importStatus` (vùng `:101-112`)

Dọn import không còn dùng: `ALL_CATEGORIES`, `CATEGORY_DESCRIPTIONS`, `DEFAULT_CHAINS`, `validateModelChains`, `type CategoryId`, `type ChainEntry`, `EFFORT_LEVELS`, `type Effort`, `Download`, `Upload`, `RotateCcw`, `Plus`.

Giữ lại: `normalizeModelRoutingConfig`, `DEFAULT_MODEL_ROUTING`, `type ModelRoutingConfig`, `React`, `useState` (còn dùng ở `NumberField` và `RoutingModelSelect`), `Trash2`, `ArrowUp`, `ArrowDown`.

**Không** đụng `lib/routing/categories.ts` — server vẫn import từ đó
(`app/api/chat/route.ts:68`, `components/hud/agent-hud.tsx:5`).

- [ ] **Step 2: Sửa copy mục tìm kiếm `prov-routing`**

Trong `components/settings/settings-tabs.ts:76`, đổi:

```
title: 'Routing model (Lead/Worker & Mixture-of-Models)'
```
thành
```
title: 'Routing model (Lead/Worker)'
```

và sửa `description` để không nhắc Mixture-of-Models nữa (giữ `keywords` có `mixture` để người đã quen vẫn tìm thấy).

- [ ] **Step 3: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/routing.test.ts tests/a11y-contract.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add components/routing-settings-panel.tsx components/settings/settings-tabs.ts
git commit -m "fix(settings): ẩn khối Model Chains chưa được nối vào request, giữ dữ liệu"
```

---

### Task 5: Xoá dead state `theme`

**Files:**
- Modify: `lib/store.ts` — 6 vị trí: type `ThemePreference` (`:45`), `isThemePreference` (`:61-63`), khai báo state `theme` (`:234`), khai báo action `setTheme` (`:246`), implement `setTheme` (`:351`), persist `theme` (`:377`), merge `theme` (`:437`)
- Test: `tests/store-persist.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces: không có symbol mới. `PersistedShape.theme?: unknown` trong `tests/store-persist.test.ts:38` là tuỳ chọn nên không cần sửa test đó.

Bối cảnh: `setTheme` được khai báo và implement nhưng **không nơi nào gọi**. Theme cũng không được áp dụng ở đâu: không có `data-theme`, không có `<html class="dark">`, `app/globals.css:133-135` có `.dark { color-scheme: light }` — một no-op có chủ đích.

Đây là **hợp đồng thiết kế**, không phải sơ suất:
- `DESIGN.md:433-448` §7 "Light-only, không có nhánh tối"
- `DESIGN.md:32` ràng buộc cứng #6: thêm biến thể `dark:` là dựng nhánh sáng nửa vời thứ hai
- `DESIGN.md:41-44` dặn rõ "đừng xoá khối `.dark` và đừng biến nó thành theme tối"
- `tests/design-system.test.ts:1746-1754` và `tests/tool-trace.test.ts:772-774` cấm `dark:`

Vì sao **xoá** chứ không thêm UI: một nút bấm không đổi màu là bug tự tạo. Làm theme tối thật cần bảng token cho ~30 biến trong `app/globals.css:25-119`, mở khoá 2 test trên, sửa `DESIGN.md`, và tính lại contrast toàn bảng màu.

- [ ] **Step 1: Viết test khoá lại**

Thêm vào `tests/store-persist.test.ts`:

```ts
it('không còn dead state theme trong partialize', () => {
  const { partialize } = useAppStore.persist.getOptions() as PersistOptions;
  const persisted = partialize!(useAppStore.getState());
  expect(Object.keys(persisted)).not.toContain('theme');
});
```

- [ ] **Step 2: Xoá `theme` khỏi `lib/store.ts`**

Xoá dòng `:234` (`theme: ThemePreference;`), dòng `:246` (`setTheme: ...`), dòng `:351` (`setTheme: (theme) => set({ theme }),`), dòng `:377` (`theme: s.theme,`) trong `partialize`, và dòng `:437` trong `merge`.

Giữ `type ThemePreference` và `isThemePreference` nếu còn nơi nào import; nếu không còn ai import thì xoá nốt (kiểm bằng grep trước khi xoá).

- [ ] **Step 3: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/store-persist.test.ts tests/design-system.test.ts tests/tool-trace.test.ts`.

> Người dùng đang có `theme` trong localStorage từ phiên cũ sẽ không hỏng: Zustand `persist` bỏ qua khoá lạ trong object đã lưu. Đây là Review Focus #5.

- [ ] **Step 4: Commit**

```bash
git add lib/store.ts tests/store-persist.test.ts
git commit -m "refactor(store): xoá dead state theme — app light-only theo DESIGN.md §7"
```

---

### Task 6: Sửa chỉ mục tìm kiếm sai thực tế

**Files:**
- Modify: `components/settings/settings-tabs.ts` (`SETTINGS_SEARCH_ITEMS`, dòng 65-93)
- Test: tạo mới `tests/settings-tabs.test.ts`

**Interfaces:**
- Consumes: `SETTINGS_TABS` (`settings-tabs.ts:13`), `SettingsTab` (`:11`).
- Produces: `SETTINGS_SEARCH_ITEMS` thu còn 31 mục, mọi `tab` trong đó phải là `SettingsTab` hợp lệ.

Không có test nào khoá nội dung hay số lượng mục này (`SETTINGS_SEARCH_ITEMS` chỉ xuất hiện ở `settings-tabs.ts:65` và `settings-dialog.tsx:17,96`) — nên sửa không vỡ test nào.

- [ ] **Step 1: Tạo test mới `tests/settings-tabs.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { SETTINGS_TABS, SETTINGS_SEARCH_ITEMS } from '@/components/settings/settings-tabs';

describe('SETTINGS_SEARCH_ITEMS bám sự thật', () => {
  const tabIds = new Set(SETTINGS_TABS.map((t) => t.id));

  it('mọi mục trỏ tới một tab có thật', () => {
    for (const item of SETTINGS_SEARCH_ITEMS) {
      expect(tabIds.has(item.tab), `mục ${item.id} trỏ tab không tồn tại: ${item.tab}`).toBe(true);
    }
  });

  it('id không trùng nhau', () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('không mô tả tính năng không tồn tại', () => {
    const texts = SETTINGS_SEARCH_ITEMS.map((i) => `${i.title} ${i.description}`.toLowerCase());
    expect(texts.some((t) => t.includes('openai'))).toBe(false);
  });

  it('không hứa số công cụ vượt quá catalog', () => {
    const texts = SETTINGS_SEARCH_ITEMS.map((i) => i.description);
    expect(texts.some((t) => /\d+\s*\+/.test(t))).toBe(false);
  });

  it('có mục cho các tính năng quan trọng', () => {
    const ids = new Set(SETTINGS_SEARCH_ITEMS.map((i) => i.id));
    for (const id of ['mem-zeromem', 'safety-audit', 'safety-mcpgrants', 'data-storage']) {
      expect(ids.has(id), `thiếu mục tìm kiếm ${id}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Xoá mục `prov-openai`**

Dòng `:73`. Lý do: preset OpenAI **đã bị gỡ có chủ đích** (`lib/providers.ts:104-121`, comment `/* Seed — ĐÃ XOÁ */`). `api.openai.com` chỉ còn là placeholder ở `provider-manager.tsx:450`. Người dùng muốn dùng OpenAI phải tự bấm "Thêm nhà cung cấp" và dán URL. Mục này còn trùng mục tiêu với `prov-byok`.

- [ ] **Step 3: Thêm `openai` vào keywords của `prov-byok`**

Dòng `:74`. Đổi `keywords` thành `'nha cung cap provider openrouter openai anthropic custom url api key'`.

- [ ] **Step 4: Sửa mô tả `safety-perms`**

Dòng `:79`. Hiện ghi "60+ công cụ" nhưng `TOOL_CATALOG` chỉ có **36** entry (`lib/tool-catalog.ts:154-497`). Muốn vượt 60 phải có ≥25 tool MCP từ server của chính người dùng. Tệ hơn: bảng tự in số thật lên màn hình ở `tool-permissions-table.tsx:189,318` ⇒ mâu thuẫn ngay trên cùng màn hình.

Đổi `description` thành `'Cấu hình auto, ask, deny cho 36 công cụ tích hợp và tool MCP phát hiện lúc chạy'`.

- [ ] **Step 5: Thêm 4 mục còn thiếu**

Chèn trước dấu `];` ở dòng `:93`:

```ts
{ id: 'mem-zeromem', title: 'Ghi nhớ hoạt động (Zero-Mem)', description: 'Ghi tool, file và lỗi của mỗi lượt vào máy, truy hồi lúc sau mà không tốn token', tab: 'memory', keywords: 'zeromem ghi nho hoat dong 0 token bo nho lich su' },
{ id: 'safety-audit', title: 'Nhật ký kiểm toán an toàn (Audit log)', description: 'Lịch sử phê duyệt, can thiệp đĩa và lệnh shell gắn chuỗi băm SHA-256', tab: 'safety', keywords: 'audit log nhat ky kiem toan sha256 tamper phap duyet' },
{ id: 'safety-mcpgrants', title: 'Quyền MCP động & Schema Governance', description: 'Cấp hoặc thu hồi quyền công cụ MCP có thời hạn, phát hiện schema đổi', tab: 'safety', keywords: 'mcp quyen grant ttl schema drift governance cap quyen' },
{ id: 'data-storage', title: 'Dung lượng bộ nhớ (Storage Quota)', description: 'Xem phần trăm đã dùng và xin trình duyệt không tự xoá dữ liệu', tab: 'data', keywords: 'storage quota dung luong bo nho eviction persist' },
```

`mem-zeromem` là ưu tiên cao nhất trong nhóm này: đó là toggle **mặc định TẮT** điều khiển việc ghi vào IndexedDB của người dùng — không tìm được thì không bật được.

- [ ] **Step 6: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/settings-tabs.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add components/settings/settings-tabs.ts tests/settings-tabs.test.ts
git commit -m "fix(settings): sửa chỉ mục tìm kiếm — xoá mục bịa, đúng số tool, thêm 4 mục còn thiếu"
```

---

### Task 7: Dọn `resolveSettingsTab` và 4 call site dùng alias cũ

**Files:**
- Modify: `components/settings/settings-tabs.ts:95-118` (`resolveSettingsTab`)
- Modify: `react/use-chat-orchestration.ts:6230` (`'skills'` → `'extensions'`), `:6240` (đã sửa ở Task 1), `:6248` (`'stats'` → `'data'`)
- Test: `tests/settings-tabs.test.ts` (mở rộng từ Task 6)

**Interfaces:**
- Consumes: `SETTINGS_TABS` (`settings-tabs.ts:13`), `SettingsTab` (`:11`).
- Produces: `resolveSettingsTab(tab?: string): SettingsTab` — **giữ nguyên chữ ký**, chỉ rút gọn phần thân.

Bối cảnh: `resolveSettingsTab` có 10 nhánh `case`. Phân loại thật:

| Nhóm | Nhãn | Số |
|---|---|---|
| Alias cũ còn được gọi | `skills`, `chung`, `stats` | 3 |
| Trùng id hiện hành ⇒ `case` là no-op | `memory`, `data` | 2 |
| Không nơi nào truyền | `provider`, `routing`, `tools`, `prompts`, `schedules` | 5 |

Lập luận "tương thích ngược vì `settingsInitialTab` được persist" trong `PLAN-ui-audit.md:530-532` là **sai**: `partialize` (`lib/store.ts:374-416`) không có `settingsInitialTab`, và nó được xoá khi đóng Settings (`store.ts:315,323`). Nó thuần in-memory, không sống qua reload.

Sau khi Task 1 sửa `:6240`, còn 3 call site dùng alias.

- [ ] **Step 1: Viết test**

Thêm vào `tests/settings-tabs.test.ts`:

```ts
import { resolveSettingsTab } from '@/components/settings/settings-tabs';

describe('resolveSettingsTab', () => {
  const ids = SETTINGS_TABS.map((t) => t.id);

  it('mọi id tab hiện hành trả về chính nó', () => {
    for (const id of ids) expect(resolveSettingsTab(id)).toBe(id);
  });

  it('không xác định thì về appearance', () => {
    expect(resolveSettingsTab(undefined)).toBe('appearance');
    expect(resolveSettingsTab('khong-ton-tai')).toBe('appearance');
  });

  it('không còn nhánh alias cũ nào', () => {
    for (const legacy of ['chung', 'provider', 'routing', 'tools', 'skills', 'prompts', 'stats', 'schedules']) {
      expect(resolveSettingsTab(legacy), `alias cũ ${legacy} chưa dọn`).toBe('appearance');
    }
  });
});
```

- [ ] **Step 2: Rút gọn `resolveSettingsTab`**

Thay toàn bộ thân hàm ở `settings-tabs.ts:95-118` bằng:

```ts
export function resolveSettingsTab(tab?: string): SettingsTab {
  return SETTINGS_TABS.some((t) => t.id === tab) ? (tab as SettingsTab) : 'appearance';
}
```

- [ ] **Step 3: Cập nhật 3 call site còn lại**

Trong `react/use-chat-orchestration.ts`:
- dòng `:6230` `openSettings('skills')` → `openSettings('extensions')`
- dòng `:6248` `openSettings('stats')` → `openSettings('data')`
- dòng `:6240` đã sửa ở Task 1

Nếu bất kỳ call site nào khác trong repo truyền alias, sửa nốt. Grep `openSettings\('` trước khi kết thúc task.

- [ ] **Step 4: Sửa `PLAN-ui-audit.md:530-532`**

Gỡ lập luận "dữ liệu người dùng đã lưu từ phiên cũ" vì sai sự thật, và ghi chú `settingsInitialTab` không được persist.

- [ ] **Step 5: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/settings-tabs.test.ts tests/slash-commands.test.ts tests/first-run-empty-state.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add components/settings/settings-tabs.ts react/use-chat-orchestration.ts tests/settings-tabs.test.ts PLAN-ui-audit.md
git commit -m "refactor(settings): bỏ 8 nhánh alias chết trong resolveSettingsTab"
```

---

### Task 8: Bỏ card-trong-card ở Storage Quota

**Files:**
- Modify: `components/settings/data-tab.tsx:164-166`
- Test: không cần test — thay đổi thuần vị trí wrapper, không đổi hành vi.

**Interfaces:**
- Consumes: `StorageQuotaMeter` (`components/storage-quota-meter.tsx:10`).
- Produces: không có symbol mới.

Bối cảnh: `data-tab.tsx:164-166` bọc `<StorageQuotaMeter />` trong `settings-card settings-card-body`, trong khi chính component đó tự render thêm một `<div className="border border-subtle bg-raised p-3">` (`storage-quota-meter.tsx:67`) ⇒ **card lồng card**, phá nhịp thị giác của tab (mọi khối anh em đều là `settings-card` trần). `UsageStats` ngay dưới (`:168-171`) không có wrapper, nên hai khối cạnh nhau trông lệch nhau.

Lưu ý: giả định ban đầu "chỉ đọc" là **sai** — component có nút hành động thật gọi `navigator.storage.persist()` (`storage-quota-meter.tsx:38-46,143-151`). Không có UI nào khác cho việc đó.

- [ ] **Step 1: Bỏ wrapper**

Thay `data-tab.tsx:164-166` (khối `<div className="settings-card settings-card-body">` bọc `StorageQuotaMeter`) bằng:

```tsx
<StorageQuotaMeter />
```

- [ ] **Step 2: Chuẩn hoá class thô của component**

Trong `components/storage-quota-meter.tsx`, thay các class thô bằng token của repo, theo bảng:

| Cũ | Mới |
|---|---|
| `text-xs` (dòng tiêu đề `:71`) | `text-ui` |
| `text-xs` (các dòng số `:85,90`) | `text-meta` |
| `text-info` | giữ nguyên (là token Tailwind hợp lệ) |

- [ ] **Step 3: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/design-system.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add components/settings/data-tab.tsx components/storage-quota-meter.tsx
git commit -m "fix(settings): bỏ card lồng card ở Storage Quota"
```

---

## Ngoài phạm vi kế hoạch này

Ba việc còn lại cần quyết định riêng — **không** làm trong đợt này:

1. **`toolcallRules`** — không chỉ thiếu UI, nó **chưa bao giờ được truyền vào** `AutoApproveContext` ở cả 3 call site `shouldAutoApprove` (`use-chat-orchestration.ts:1143,1254,1294`). Trước khi nối phải vá 6 lỗi: `deny` chỉ mở modal chứ không chặn cứng (`auto-pilot.ts:326`); `message` không tới UI; `scope` là trường chết; `new RegExp` không escape + không try/cả 2 chỗ (`toolcall-rules.ts:69,79`); `pathGlob` bỏ qua `args.paths[]` nên fail-open khi ghi nhiều file; rule `allow` đè per-tool `ask` → đường leo thang đặc quyền.

2. **Editor khoá quyền dạng glob** — `getEffectiveToolPermission` tra `fs_read:src/**` và `*.env*` **trước mọi thứ** (`tool-permissions.ts:237-261`), nhưng không UI nào tạo được. Dev đã tự ghi nhận ở `tool-permissions-table.tsx:322-334`. Thêm UI sẽ trùng với Task 3 ở chỗ `:` parsing — nên làm SAU Task 3.

3. **Gộp 3 nơi điều khiển `approvalPolicy`** — hiện có 3 write site: `<select>` trong `safety-tab.tsx:49-61`, pill xoay vòng trong composer, và slash `/mode` (`use-chat-orchestration.ts:6192`). Nếu gộp: giữ `<select>` trong Settings (chọn trực tiếp, hữu ích nhất), để pill chỉ hiển thị rồi bấm → `openSettings('safety')`, giữ `/mode` làm lối vào thứ hai. Cần sửa `tests/composer-affordances.test.ts:353-476`.

Ngoài ra, `agentTools` **không** nên thêm toggle — nó là giá trị suy ra được persist, không phải setting bị ghi đè. Nếu muốn minh bạch thì thêm một dòng chữ read-only dưới `<select>` ở `safety-tab.tsx:71`, theo đúng pattern Chat Only đã làm ở `:82-97`.