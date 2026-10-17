# Phase 2 — Dọn code chết trong Settings (đợt 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xoá 3 tầng policy chết đã được 4 điều tra độc lập xác nhận, sửa 1 bug effort thật, và gỡ 1 trong 3 đường ghi `approvalPolicy`.

**Spec:** Không có. Bốn báo cáo điều tra là nguồn sự thật; mỗi mục dưới đây trích kèm bằng chứng `file:line` từ chúng.

## Global Constraints

- **Cấm chạy test qua OpenCode** (`vitest`/`tsc`/`docs:check`/`eslint`) — user tự chạy.
- Git phải có `--no-pager`. Cấm `setsid`/`nohup`, cấm dấu ống phức tạp.
- **Script ghi file bằng python phải neo vào marker DUY NHẤT.** Đợt 1 đã ghi đè nhầm một comment vì dùng `lines.index()` trên chuỗi xuất hiện nhiều chỗ — phải kiểm `git diff` sau mỗi lần ghi.
- **Không đổi `ALL_TOOL_CATEGORIES`** (`lib/tool-catalog.ts:30-32`) — 6 file test tripwire canh đúng 8 khoá.
- Tiếng Việt có dấu trong mọi copy UI.
- Đừng xoá khoá persist trừ khi có lập luận "không mất gì" bằng chứng minh được.

---

### Task A: XOÁ tầng khoá glob trong `getEffectiveToolPermission`

**Files:**
- Modify: `lib/tool-permissions.ts` — xoá `extractTargetPath` (`:157-172`), `matchesGlobPattern` (`:179-215`), khối `if (targetPath)` (`:236-262`), biến `targetPath` (`:234`), và sửa JSDoc (`:217-228`)
- Modify: `components/tool-permissions-table.tsx` — xoá đoạn cảnh báo về khoá glob
- Test: `tests/tool-permissions.test.ts`, `tests/p2-p3-architectural.test.ts` — xoá test glob

**Interfaces:**
- Produces: `getEffectiveToolPermission(toolName: string, permissions: ToolPermissions, argsOrPath?: Record<string, unknown> | string): PermissionOverride` — **giữ nguyên chữ ký** (3 tham số). Tham số `argsOrPath` thành không dùng nhưng **giữ lại** để không phá call site; sẽ ghi chú lý do.
- Produces: `matchesGlobPattern` và `extractTargetPath` **không còn export**.

**Bằng chứng quyết định xoá:**

1. **Không có đường ghi nào, chưa bao giờ có.** `git log -S 'fs_read:'` chỉ trả về commit baseline `be6c8e8`. UI chỉ ghi tên tool trần (`tool-permissions-table.tsx:154-158` với `row.name`) hoặc 8 category (`tools-panel.tsx`).
2. **`deny` qua glob KHÔNG chặn cứng.** `isToolDenied(toolName, permissions)` (`lib/tool-catalog.ts:89-92`) nhận **2 tham số, không có `args`** ⇒ không thể đọc tầng glob. Cả 7 call site (`use-chat-orchestration.ts:1502,1582,1607,1625,1652,1671,1703`) truyền đúng 2 tham số. Nơi duy nhất đọc glob là `auto-pilot.ts:332,351`, và cả hai đều chỉ `return false` (mở modal). ⇒ `deny` qua glob **≡ `ask`**, nhãn "Chặn" là lời nói dối.
3. **Thắng tuỳ ý theo thứ tự chèn.** `:238-251` không phân biệt độ đặc hiệu (`ruleTool === toolName || '*' || 'path'`), `return` khoá khớp đầu tiên, không sort. Tệ hơn: Dexie `toolName` là PK không có `++` ⇒ `toArray()` trả thứ tự lexicographic; `use-chat-orchestration.ts:497` merge `{ ...cur, ...dbPerms }` đẩy khoá mới vào cuối ⇒ **khoá thắng đổi giữa lúc tải trang và lúc restart**.
4. **Use-case bảo mật nổi bật đã có sẵn.** `lib/path-utils.ts:122` hardcode `baseName.startsWith('.env')`, `auto-pilot.ts:213-226` `targetsProtectedPath` chạy ở `:319` **trước** khối permission ⇒ ghi `.env` đã bị buộc hỏi kể cả khi override là `auto`.

- [ ] **Step 1: Gỡ test glob trước (RED trước khi xoá code)**

Xoá `tests/tool-permissions.test.ts` khối `it('hỗ trợ path glob pattern trong toolPermissions (P3.6)')` và import không còn dùng.
Xoá trong `tests/p2-p3-architectural.test.ts`: `it` về `matchesGlobPattern`, `it` về `extractTargetPath`, `it('shouldAutoApprove respects path glob pattern permissions')`, và import 2 hàm đó.

- [ ] **Step 2: Thêm tripwire chống hồi sinh**

Thêm vào `tests/tool-permissions.test.ts` (theo convention source-scan sẵn có trong file):

```ts
it('KHÔNG còn tầng khoá glob trong engine — không có UI nào tạo được nó', () => {
  // Đột biến bị chặn: ai thêm lại bước 1&2/4 mà không kèm UI sẽ hồi sinh
  // tầng "tra trước mọi thứ, thắng tuỳ thứ tự chèn, không quản lý được".
  const src = fs.readFileSync(path.resolve(__dirname, '../lib/tool-permissions.ts'), 'utf8');
  expect(src).not.toMatch(/matchesGlobPattern/);
  expect(src).not.toMatch(/extractTargetPath/);
  expect(src).not.toMatch(/key\.indexOf\(':'\)/);
});
```

- [ ] **Step 3: Xoá code trong `lib/tool-permissions.ts`**

Xoá `extractTargetPath`, `matchesGlobPattern`, khối `if (targetPath) { ... }`, biến `const targetPath = ...`, và sửa JSDoc `:217-228` còn lại thứ tự: tool override → MCP server pattern → category → deny-by-default MCP → `'default'`.

Thêm vào JSDoc một ghi chú ngắn giải thích VÌ SAO không có tầng glob, để người sau không thêm lại.

- [ ] **Step 4: Xoá cảnh báo trong `tool-permissions-table.tsx`**

Xoá cả khối JSX comment lẫn `<p className="field-hint">` về khoá glob (dev tự thừa nhận ở khoảng `:322-334`).

- [ ] **Step 5: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/tool-permissions.test.ts tests/p2-p3-architectural.test.ts tests/redteam-permissions.test.ts`

---

### Task B: XOÁ `toolcallRules` — engine chưa từng được nối

**Files:**
- Delete: `lib/toolcall-rules.ts` (134 dòng)
- Delete: `tests/toolcall-rules.test.ts` (206 dòng)
- Modify: `lib/store.ts` — import, field, default, persist
- Modify: `lib/auto-pilot.ts` — import, field ctx, nhánh xử lý

**Interfaces:**
- Consumes: `evaluateToolcallRules(toolName, args, userRules)` (`lib/toolcall-rules.ts:89`) — xoá.
- Produces: `shouldAutoApprove(ctx: AutoApproveContext)` giữ nguyên chữ ký, **xoá field `toolcallRules?`** khỏi `AutoApproveContext`.

**Bằng chứng quyết định xoá:**

1. **Chưa từng chạy.** `shouldAutoApprove` chỉ có 3 call site sản xuất (`use-chat-orchestration.ts:1143,1254,1294`) — cả 3 truyền `toolPermissions` nhưng **không** truyền `toolcallRules`. Selector `:467` không lấy khoá này. Dep-array `:1181,1287,1343` cũng không. ⇒ `auto-pilot.ts:324` là code chết ngoài test.
2. **`deny` ≡ `ask`.** `auto-pilot.ts:326` `if (verdict.decision === 'deny' || verdict.decision === 'ask') return false;` — một lệnh cho cả hai, cả hai đều mở modal. `toolPermissions: 'deny'` thì bị `isToolDenied` chặn cứng (`use-chat-orchestration.ts:1703` trả `denied: true`, tool không chạy). ⇒ rule `deny` **yếu hơn hẳn** cờ deny của hệ thống.
3. **Phủ 3/40+ tool.** Chỉ `shell_run`, `run_code`, `fs_edit|fs_write|code_patch`. `fs_read`, `web_fetch`, `memory_save`, `plan_*`, `mcp__*`, `fs_delete` **không bao giờ** được hỏi.
4. **Leo thang đặc quyền đã được test củng cố.** `toolcallRules` ở `:324` chạy **trước** `getEffectiveToolPermission` `:331`; `allow` ⇒ `return true` ở `:327`, bỏ qua `toolPermissions[tool]='ask'`, MCP deny-by-default, và policy `always`. Test `:149-168` khẳng định đây là hành vi ĐÚNG. Nối lại tức là phải **đảo ngược** semantics.
5. **Nó không nói dối người dùng** — khác `modelChains`: không UI, không ô nhập, không copy nào nhắc. Nên xoá là đúng tiêu chí "không hữu ích", không phải sửa lỗi nói dối.

**Mất gì:** không mất chức năng chạy được nào. Không có UI để mất, không có copy, `toolcallRules` mặc định `[]` và sau reload vẫn `[]`.

- [ ] **Step 1: Xoá 2 file**

`rm lib/toolcall-rules.ts tests/toolcall-rules.test.ts`

- [ ] **Step 2: Dọn `lib/store.ts`**

Xoá import `ToolcallRule`, field `toolcallRules?` trong `Settings`, dòng `toolcallRules: []` trong `DEFAULT_SETTINGS`, và dòng `toolcallRules: s.settings.toolcallRules` trong `partialize`.

- [ ] **Step 3: Dọn `lib/auto-pilot.ts`**

Xoá import `evaluateToolcallRules`/`ToolcallRule`, field `toolcallRules?` trong `AutoApproveContext` + comment kèm theo, và khối `if (ctx.toolcallRules && ...) { ... }`.

- [ ] **Step 4: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/auto-pilot.test.ts tests/store-persist.test.ts tests/agent-coding-safety.test.ts tests/tool-deny.test.ts`

---

### Task C: XOÁ nhánh chains ở server + dọn `lib/routing/categories.ts`

**Files:**
- Modify: `app/api/chat/route.ts`
- Modify: `lib/routing/categories.ts`
- Modify: `tests/chat-media-retirement.test.ts`, `tests/routing.test.ts`, `tests/evidence-badge.test.ts` (copy)
- Modify: `components/routing-settings-panel.tsx` (comment cập nhật)

**Interfaces:**
- Consumes: `scoreRequest` (`lib/routing/score-request.ts`) — **GIỮ NGUYÊN**.
- Produces: `RouteReceipt.category` vẫn được tính (nằm ở nhánh else) ⇒ HUD `components/hud/agent-hud.tsx:91` không đổi.

**Bằng chứng chết 3 lớp:** `customChains` luôn `undefined` (không client nào gửi); `requestedCategory` luôn `undefined`; `route.ts:1191` `activeCategory = requestedCategory ?? (model ? undefined : ...)` mà client luôn gửi `model` (`use-chat-orchestration.ts:2898`) ⇒ `activeCategory === undefined` **dù có gửi `category`**. Nhánh `:1196-1206` và `:1296-1298` không bao giờ chạy.

**PHẢI GIỮ:** `CategoryId` (`lib/hud-store.ts:14`, `score-request.ts:11`), `RouteReceipt` (`route.ts:68`, `lib/prompt/protocol.ts:13`), `ChainEntry` (là `RouteReceipt.selected`), `CATEGORY_DESCRIPTIONS` (`agent-hud.tsx:5`), `ALL_CATEGORIES` (hợp đồng tập key HUD dựa vào), `scoreRequest` (nguồn `routeReceipt.category`).

**XOÁ:** `resolveRoute` (`:121-158`), `categoryChainHasModel` (`:60-66`), `DEFAULT_CHAINS` (`:44-53`), `validateModelChains` (`:160-205`), `export type { Effort }` (`:11`), và import `resolveContract`/`enforceContractEffort`/`EFFORT_LEVELS` ở `:9`.

- [ ] **Step 1: Xoá test server-side dựa trên chains**

`tests/chat-media-retirement.test.ts`: xoá 2 test `it` khoảng `:85-87` và `:89-91` (gửi `{category, customChains}` không kèm `model`).

- [ ] **Step 2: Rút `tests/routing.test.ts`**

Rút import còn `ALL_CATEGORIES`; xoá các `describe` về `resolveRoute` và `validateModelChains` (khoảng `:148-263`). **GIỮ** phần test `scoreRequest` (`:15-146`).

- [ ] **Step 3: Dọn `app/api/chat/route.ts`**

Xoá field `category` + `customChains` khỏi `BodySchema`, 2 dòng destructure, `const activeCategory`, nhánh `if (activeCategory && ...)` và cả `} else {`, `defaultChainModels`. Rút `let routeReceipt` thành `const`. Sửa 2 chỗ copy còn nhắc "khai chuỗi cho hạng mục ở Cài đặt → Định tuyến".

- [ ] **Step 4: Dọn `lib/routing/categories.ts`**

Xoá 5 symbol + import + `Effort` re-export. Sửa header comment (đang mô tả chains là mục đích chính của file). Làm `chainPosition?: number` trong `RouteReceipt` và bỏ dòng gán nó ở route.ts (giá trị `0` là bịa — không có chain nào).

- [ ] **Step 5: Sửa copy `tests/evidence-badge.test.ts`**

2 chỗ copy nhắc `validateModelChains` và "Settings → Routing" — **không** đổi assert, chỉ sửa chữ.

- [ ] **Step 6: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/routing.test.ts tests/evidence-badge.test.ts tests/chat-media-retirement.test.ts tests/prompt-protocol.test.ts tests/hud-usage-display.test.ts`

---

### Task D: Sửa `effort` receipt nói dối (bug thật)

**Files:**
- Modify: `app/api/chat/route.ts` — dòng `enforceContractEffort(contract, 'medium')`
- Test: `tests/store-persist.test.ts` hoặc test mới trong `tests/auto-pilot.test.ts`

**Interfaces:**
- Consumes: `settings.thinkingLevel` đã có sẵn trong destructure (`route.ts:1096`); `ThinkingLevel` (`lib/provider-url.ts:72`) và `Effort` (`lib/model-contracts.ts:13`) cùng tập 4 giá trị `low|medium|high|max` ⇒ drop-in.

**Bug:** `route.ts:1223` hardcode `'medium'`. `lib/prompt/protocol.ts:154-166` `calibrationFor` chỉ chạy khi effort `high|max` ⇒ khối `[ĐIỀU PHỐI <FAMILY>]` trong system prompt **không bao giờ được chèn** (trừ `claude-opus-5` có `effortFloor: 'high'`). HUD in effort receipt chứ không phải effort thật.

**Không phải lỗi của `thinkingLevel`:** effort thật gửi provider đi đường riêng — `settings.thinkingLevel` → `route.ts:2443-2450` → `providerOptions.openai.reasoningEffort` (`:2498`). Đường này **độc lập**, người dùng không mất mức suy luận.

- [ ] **Step 1: Sửa dòng effort**

Đổi `enforceContractEffort(contract, 'medium')` thành `enforceContractEffort(contract, thinkingLevel ?? 'medium')`, kèm comment giải thích vì sao receipt phải phản ánh `thinkingLevel` chứ không phải hằng số.

- [ ] **Step 2: Viết test**

Thêm vào `tests/auto-pilot.test.ts` một test source-scan trên `app/api/chat/route.ts` khẳng định dòng effort không còn hardcode `'medium'`, và trỏ tới `thinkingLevel`.

- [ ] **Step 3: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/auto-pilot.test.ts tests/prompt-protocol.test.ts tests/chat-route-fixes.test.ts`

---

### Task E: Gỡ 1 trong 3 đường ghi `approvalPolicy`

**Files:**
- Modify: `react/use-chat-orchestration.ts` — xoá `onCycleAutoPilot` + dòng trả về
- Modify: `components/composer.tsx` — pill thành read-only, xoá item TaskMenu, bỏ prop
- Modify: `components/chat-interface.tsx` — bỏ truyền prop
- Test: `tests/slash-commands.test.ts` (xoá describe đã thành rỗng), `tests/composer-affordances.test.ts` (giữ nguyên helper)

**Interfaces:**
- Produces: giữ nguyên 3 helper `approvalPillLabel` / `approvalShortLabel` / `approvalHint` (`composer.tsx:174-195`).
- Produces: xoá prop `onCycleAutoPilot?: () => void` khỏi `ComposerProps` (`:621`) và destructure (`:686`).

**Quyết định — bỏ pill xoay-vòng, GIỮ `/mode`:**

| Đường | Xử lý | Lý do |
|---|---|---|
| `<select>` trong Settings (`safety-tab.tsx:49-61`) | **GIỮ, nơi ghi duy nhất kiểu trực quan** | Duy nhất có `<option>` dài + `field-hint` giải thích hậu quả + cảnh báo "5 mục dưới đây mất tác dụng" |
| Pill xoay-vòng composer (`:1264-1293`) | **XOÁ hành vi xoay, giữ hiển thị read-only** | Xoay 4 lần mới tới chế độ muốn; nằm trong cụm `overflow-x-auto` nên **bị cuộn mất**; TaskMenu disable khi streaming còn pill thì không ⇒ cùng handler, khác quyền |
| Item TaskMenu (`:1084-1096`) | **XOÁ** | Trùng pill; menu hành động chứa mục read-only là sai bậc |
| `/mode` slash | **GIỮ** | Phím tắt cho người dùng thành thạo, có trong palette, **không phải bản trùng** của select |

**Sau khi xoá:** pill thành `<span>` read-only giữ nguyên class `text-ui text-tertiary` + icon `Zap` + `approvalShortLabel(...)`; `title` đổi sang `approvalHint(...)` + hướng dẫn "đổi ở Cài đặt › Quyền & An toàn". Điều đó **tái dùng** `approvalHint` — không xoá helper nào.

⚠️ `tests/composer-affordances.test.ts:810` assert lớp `text-ui text-tertiary` trong dải công cụ — phải **giữ** lớp đó trên `<span>` mới. `tests/boost-honesty.test.ts:56` dùng `if (slash.kind === 'mode') {` làm **delimiter** — giữ `/mode` nên file này không hỏng.

- [ ] **Step 1: Thêm test ghim hành vi mới**

Thêm vào `tests/slash-commands.test.ts` (thay describe `onCycleAutoPilot` cũ đã thành rỗng): assert `composer.tsx` không còn `onClick` gắn vào pill phê duyệt, và `onCycleAutoPilot` không còn trong `use-chat-orchestration.ts`.

- [ ] **Step 2: Xoá `onCycleAutoPilot`**

Xoá hàm và dòng `onCycleAutoPilot,` trong object trả về của `use-chat-orchestration.ts`.

- [ ] **Step 3: Sửa `components/composer.tsx`**

Xoá prop + destructure. Xoá block `if (onCycleAutoPilot) { ... }` (TaskMenu). Đổi `<button onClick={onCycleAutoPilot}>` thành `<span>`, bỏ `type`/`onClick`, đổi `title`. Bỏ điều kiện bọc để pill luôn hiện. **Giữ nguyên** class `inline-flex h-8 items-center gap-1 rounded-lg bg-raised px-3 text-ui text-tertiary` để không đỏ test `:810`.

- [ ] **Step 4: Bỏ truyền prop ở `chat-interface.tsx`**

- [ ] **Step 5: Dọn test rỗng trong `tests/slash-commands.test.ts`**

Xoá `describe('onCycleAutoPilot chỉ truyền approvalPolicy')` — nó assert `not.toMatch` nên xanh dù đã xoá hàm, tức bảo vệ một thứ không còn.

- [ ] **Step 6: Bàn giao kiểm thử**

Gửi user: `npx vitest run tests/slash-commands.test.ts tests/composer-affordances.test.ts tests/boost-honesty.test.ts tests/slash-palette-entry.test.ts`

---

## Ruling đã lấy trước khi viết plan

1. **`/mode` GIỮ, không xoá.** Điều tra khuyến nghị xoá cả `/mode` + `normalizeModeParam` + alias `/policy`, nhưng đó là quyết định **sản phẩm** (bỏ phím tắt của người dùng thành thạo), không phải dọn code chết. Tiêu chí user "không hữu ích thì xoá" không phủ lên nó — nó hữu ích. Xoá nó còn làm `tests/boost-honesty.test.ts` hỏng lúc collect vì dùng `if (slash.kind === 'mode') {` làm delimiter. **Giá nếu sai:** vẫn còn 2 đường ghi state, nhưng khác modality (trực quan vs bàn phím).
2. **XOÁ tầng glob thay vì "giữ + nói rõ".** Bảng hiện đã phải in 5 dòng cảnh báo cho tầng không ai gọi được — đó chính là "ẩn", chỉ là ẩn bằng chữ.
3. **Task C và Task D tách riêng** dù cùng sửa `route.ts`: C là dọn nhánh chết (không đổi hành vi), D là sửa bug (có đổi hành vi receipt). Trộn lại thì không tách được lỗi từ refactor.