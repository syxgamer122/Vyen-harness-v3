# TUI cho CLI Vyen — full-screen, học OpenCode, màu Vyen

Ngày: 2026-10-20 · Trạng thái: **chờ duyệt** — 7 phép đo ở §3 chạy trên máy thật
(Node 26.12.0, Windows x64, không Bun), không phải suy đoán.

Bản 2 — sau khi dựng thử OpenTUI thật và một lượt builder check độc lập.

## 1. Vì sao

CLI hiện là REPL readline in từng dòng:

- Tool call chỉ hiện `[goi tool] fs_read` — **không thấy tham số, không thấy kết quả**.
- Trạng thái (đang chạy / đang chờ duyệt / lỗi) nằm lẫn trong dòng chữ, không nhìn ra.
- Không có chỗ cho số liệu: token, context %, model, thư mục.
- Lịch sử và output cuộn lẫn nhau; không có "màn hình" nào cả.

Người dùng đã chốt chuẩn thẩm mỹ: **TUI phải đẹp như OpenCode**
(`anomalyco/opencode`, ảnh `packages/web/src/assets/lander/screenshot.png`), nhưng
**màu phải là màu Vyen**, không phải bản sao.

Đây là mặt tiền của sản phẩm: CLI là thứ mở ra mỗi ngày. Nó xấu thì mọi thứ
phía sau đều bị đánh giá thấp theo.

## 2. Mục tiêu / Không mục tiêu / Anti-goal

### Mục tiêu

1. Full-screen TUI (alternate screen) khi chạy `npm run cli` trong terminal thật.
2. Bố cục học từ OpenCode: header 1 dòng có số liệu; transcript là trung tâm;
   tool call là **dòng ngắn**; ô nhập + status line + footer; chỉ 3 khối có viền
   (header, ô nhập, hộp duyệt).
3. Màu Vyen: accent xanh `#2F9462`, lime `#82E767` chỉ cho con trỏ/điểm nhấn.
4. Giữ nguyên hành vi: `/exit` `/new` `/compact`, Esc cắt lượt, cổng duyệt mặc
   định **KHÔNG**, transcript JSONL, nén context, `-p` in một lượt.
5. Mọi thứ test được bằng vitest headless. Phần không test được (TTY thật) có
   checklist tay rõ ràng.

### Không mục tiêu (v1)

- Diff viewer, syntax highlighting, render markdown — chữ assistant giữ nguyên văn.
- Mouse, chọn/copy, session picker, nhiều tab/agent, đổi theme.
- Lịch sử `↑`/`↓` trong ô nhập (textarea đã dùng `↑`/`↓` để di chuyển con trỏ).
- Thêm runtime thứ hai (Bun, Ink). Chỉ thêm đúng `@opentui/*`.

### Anti-goal (thà không làm còn hơn làm sai)

- **Không fork vòng lặp hội thoại.** TUI phải chạy trên `runRepl` + `runTurn` hiện
  có. Cần thêm dữ kiện thì thêm callback, không chép logic nén/lỗi/ghi transcript.
- **Không làm hỏng đường pipe/`-p`.** Khi stdout không phải TTY, mọi thứ phải y
  như cũ, không một byte ANSI.
- **Không để terminal hỏng.** Mọi lỗi khởi tạo TUI phải rơi về REPL thường kèm lý
  do; không màn hình trắng, không bỏ quên raw mode/alternate screen.
- **Không dùng quá 4 màu trên một màn hình.** Màu là tín hiệu, không phải trang trí.

## 3. Ràng buộc đã đo

### 3.1 Bảng đo (probe ngoài repo, 2026-10-20)

| # | Phép đo | Kết quả | Hệ quả |
|---|---|---|---|
| 1 | `@opentui/core@0.6.6` + `@opentui/react@0.6.6` trên Node 26.12, Windows, không Bun | `createTestRenderer` + `TextRenderable` render ra frame, exit 0 | Đường Node khả thi, không cần cài Bun |
| 2 | CJS + `tsx` import `@opentui/core/testing` | `ERR_PACKAGE_PATH_NOT_EXPORTED` — exports không có điều kiện `require` | Không được static-import TUI từ file CJS |
| 3 | CJS + `tsx` import `@opentui/react` | esbuild: *"Top-level await is currently not supported with the cjs output format"* | Cùng kết luận với (2) |
| 4 | CJS entry → `await import()` file trong thư mục con có `package.json` `{"type":"module"}` | Render frame thật, import ngược được module CJS của repo, exit 0 | **Đây là kiến trúc chọn** |
| 5 | `vitest@4.1.11` + `@opentui/core/testing` + `@opentui/react/test-utils` | 2/2 test pass, 607ms | Test headless không cần TTY |
| 6 | `tsc --noEmit` với `/** @jsxImportSource @opentui/react */` | exit 0 | Typecheck repo không vỡ |
| 7 | Typings `@opentui/core` (đọc, không đoán) | `textarea.onSubmit`, `keyBindings` merge với default; `plainText`/`setText`/`clear`; `scrollbox.stickyScroll` + `stickyStart="bottom"`; `borderStyle="rounded"` | API cho plan là chắc |

Ghi chú đo (1): Node in `ExperimentalWarning: FFI is an experimental feature` ra
stderr. Vô hại, chỉ là tiếng ồn. Không thêm cờ gì vào `npm run cli` ở v1.

### 3.2 Vì sao phải có "đảo ESM"

`package.json` gốc **không có** `"type": "module"` (thêm vào sẽ phá Next.js —
ghi chú ở `cli/index.ts`). `tsx` vì thế dịch file `.ts` thành **CJS**. OpenTUI là
ESM thuần: exports không có `require`, và chunk React có top-level await. Kết quả
đo được: đo (2) và (3) ở trên.

Cách duy nhất không phải đổi cả repo sang ESM: **một thư mục con có
`package.json` riêng `{"type":"module"}`**, và CJS gọi vào bằng `await import()`.
Đo (4) xác nhận chạy được, kể cả import ngược module CJS của repo.

Luật kèm theo:

- Mọi file trong `cli/tui/` là ESM. Không file CJS nào được `import` tĩnh từ đây.
- `cli/index.ts` chỉ chạm TUI qua `await import('./tui/entry.tsx')`.
- File dùng chung như cổng vào / broker duyệt nằm **ngoài** đảo (`cli/tui-gate.ts`,
  `cli/approval-broker.ts`) để CJS import tĩnh được.

### 3.3 Những gì OpenTUI cho sẵn (đọc từ typings 0.6.6)

| Thứ cần | API thật | Ghi chú |
|---|---|---|
| Gửi tin | `<textarea onSubmit>` + `keyBindings` | Default: `return` = newline, `meta+return` = submit. Ta thêm `return` = submit, `shift+return` = newline. `keyBindings` được **merge** với default, không thay thế |
| Đọc/xoá nội dung | `textarea.plainText`, `setText()`, `clear()` | Textarea **không** controlled (không `value`/`onChange`) |
| Cuộn transcript | `<scrollbox stickyScroll stickyStart="bottom">` | Có `scrollToBottom()` nếu cần |
| Viền | `borderStyle="rounded"`, `borderColor`, `title` | |
| Phím | `useKeyboard(handler)`, `renderer.keyInput` | Không có `preventDefault` cho phím thường; Enter xử lý qua `onSubmit` |
| Kích thước | `useTerminalDimensions()`, `useOnResize()` | |
| Test | `@opentui/core/testing`, `@opentui/react/test-utils` | `renderOnce()`, `captureCharFrame()`, `renderer.keyInput.emit(...)` |

### 3.4 Hai guard của repo chặn layout — đọc mã, không đoán

Builder check tìm ra, đã đọc lại đúng dòng:

1. `tests/repo-hygiene.test.ts` — `duyet('cli')` **đã** gom cả `.tsx` (`PHU_MOI`),
   và đòi **mọi** file trong `cli/` phải có trong `CORE_ENTRIES`. Nhưng
   `CORE_ENTRIES` lại bị test riêng đòi **chỉ `.ts`**. Vậy 7 file `.tsx` mới vừa
   không được thiếu, vừa không được khai ⇒ `npm run test` không thể xanh.
2. `tests/cli-migration-scan.test.ts` — mọi dynamic import nội bộ từ file lõi phải
   nằm trong đồ thị lõi. `cli/index.ts` gọi `import('./tui/entry.tsx')` mà
   `entry.tsx` không nằm trong graph ⇒ đỏ. `resolveInternal` đã biết `.tsx`, nhưng
   `runtimeImportSpecs` parse mọi file bằng `ScriptKind.TS` (`.tsx` có JSX).

**Quyết định: mở rộng guard cho `.tsx`, không lách guard.**

- `CORE_ENTRIES` cho phép entry kết thúc `.ts` **hoặc** `.tsx`.
- `runtimeImportSpecs` chọn `ScriptKind.TSX` theo đuôi file.
- Mọi file trong `cli/tui/` được khai vào `CORE_ENTRIES` **trong cùng commit tạo
  ra nó** (đúng luật đã ghi ở chính file `import-graph.ts`).
- Giữ nguyên ý nghĩa guard, và chứng minh bằng mutation: tạo một
  `cli/tui/__probe.tsx` không khai ⇒ test hygiene **phải đỏ**; khai rồi ⇒ xanh;
  xoá file. Đổi `ScriptKind` về `TS` ⇒ test đồ thị `.tsx` **phải đỏ**.

Không chọn phương án "đưa đảo ra ngoài `cli/`": nó không cứu được
`cli-migration-scan` (dynamic import vẫn trỏ ra ngoài graph), và làm CLI mất tính
"một khối" — thứ guard này đang bảo vệ.

**Lỗ hổng thứ hai, đo 2026-10-20:** `browserBoundIn` quét
`[...listTsFiles('lib'), ...listTsFiles('cli')]` mà `listTsFiles` **chỉ lấy
`.ts`** ⇒ file `.tsx` của đảo TUI **không hề được soi**. Một file TUI import
`@/lib/db` (Dexie) sẽ không bị báo, và `lib/db` rơi vào đồ thị lõi mà không ai
thấy — đúng loại lỗi review 2026-10-19 đã bắt ở `cli/repl.ts`. Vậy ngoài
`ScriptKind.TSX` còn phải có một cách liệt kê **nguồn** (`.ts` + `.tsx`) cho
quét, mà **không** đổi `listTsFiles` (bảng kiểm kê đếm bằng nó).

**Đo thêm (probe ngoài repo):** `runtimeImportSpecs` với `ScriptKind.TS` thấy
import đứng trước JSX nhưng **không thấy** import đứng sau JSX. Nên `ScriptKind.TSX`
không phải phòng thủ mà là **load-bearing**, và fixture test phải đặt import sau
JSX thì mutation mới đỏ.

## 4. Quyết định thiết kế

### 4.1 Cổng vào: một hàm thuần, test được

`cli/tui-gate.ts`:

```ts
export type FrontendDecision =
  | { kind: 'print' }
  | { kind: 'plain'; reason: 'not-tty' | 'forced' | 'node-too-old' }
  | { kind: 'tui' };

export function chooseFrontend(input: {
  print: boolean;
  stdinIsTTY: boolean | undefined;
  stdoutIsTTY: boolean | undefined;
  env: { VYEN_PLAIN?: string };
  nodeVersion: string; // process.versions.node
}): FrontendDecision;
```

Thứ tự quyết định (dừng ở điều kiện đầu tiên đúng):

1. `print` ⇒ `{kind:'print'}` (đường `-p` giữ nguyên).
2. `!stdinIsTTY || !stdoutIsTTY` ⇒ `plain` lý do `not-tty` (pipe, CI, `> file`).
3. `VYEN_PLAIN === '1'` ⇒ `plain` lý do `forced` (van an toàn, luôn có).
4. Node < 26.4.0 ⇒ `plain` lý do `node-too-old` (FFI của OpenTUI cần mốc này).
5. Còn lại ⇒ `tui`.

Trả về **lý do**, không chỉ boolean: `main()` cần in đúng một dòng giải thích khi
rơi về plain, thay vì im lặng — im lặng là kiểu hỏng đã ghi ở AGENTS.md §2.

`VYEN_PLAIN=1` là đường thoát duy nhất, có chủ đích: khi TUI hỏng trên terminal
lạ, người dùng vẫn làm việc được ngay, không phải chờ sửa.

### 4.2 Tái dùng vòng lặp: TUI là lớp trình bày quanh `runRepl`

`runRepl` đã lo đúng những thứ khó: nén tự động, thử lại khi tràn context, ghi
transcript theo lô, `/new`, `/compact`, cắt lượt không để lại chuỗi hở. TUI
**không** chép lại. Nó truyền vào `runRepl`:

| Tham số | Bản plain | Bản TUI |
|---|---|---|
| `ask` | `terminal.hoiDong(lichSu)` | Promise chờ ô nhập submit |
| `out` | `process.stdout.write` | đẩy delta vào block assistant |
| `note` | `console.error` | đẩy dòng trạng thái vào transcript, **kèm mức độ** |
| `watchInterrupt` | `terminal.watchInterrupt` | phím Esc của renderer |
| `onToolCall/onToolResult` | không truyền (in như cũ) | cập nhật block tool |
| `onUsage` | không truyền | cập nhật header |

Ba callback cuối là **thêm mới, tuỳ chọn**. Không truyền thì hành vi plain y
nguyên từng byte — có test canh.

### 4.2.1 Sự kiện tool phải có `id`, không ghép theo thứ tự

AI SDK phát `tool-result` **theo lúc từng `execute` xong**, không theo thứ tự gọi.
Hai lời gọi cùng tên tool mà ghép theo tên/thứ tự thì UI hiện sai trạng thái, và
transcript live sẽ lệch với transcript nạp lại từ `CoreMessage[]`. Nên:

```ts
export interface ToolCallEvent { id: string; name: string; args: unknown }
export interface ToolResultEvent { id: string; name: string; result: unknown }
```

- Native (`cli/agent-turn.ts`): `id = p.toolCallId`, `args = p.args`.
- Giả lập (`cli/emulated.ts`): `id = annotation.tool.id`; `args` là **chuỗi đã tóm
  tắt** (`summarizeToolArgs` trả `string`), không phải object thô; `done` mang
  `summary`. Đây là khác biệt đã đo, ghi lại để UI không giả định sai kiểu.
- `blocks.ts` ghép call↔result **theo `id`**; quá khứ nạp từ `CoreMessage[]` cũng
  ghép theo `toolCallId` — cùng một quy tắc, không có hai cách hiểu.

### 4.3 Bố cục

```
╭────────────────────────────────────────────────────────────────────╮
│ # vyen · Vyen-harness-v3-main                    12,480 tok · 8%   │
╰────────────────────────────────────────────────────────────────────╯

  ▎ sửa lỗi token hết hạn trong api/chat

  Mình đọc route trước.

  * read   app/api/chat/route.ts
  * grep   "expiresAt"  → 3 chỗ

  So sánh thời gian đang sai múi giờ. Sửa ở dòng 42.

  ▎ chat · gpt-5
  ╭────────────────────────────────────────────────────────────────╮
  │ █                                                              │
  ╰────────────────────────────────────────────────────────────────╯
  esc dừng   /new phiên mới   /compact nén   ctrl+c thoát
```

- **Header**: `# vyen · <tên thư mục>` trái; `N tok · X%` phải. `X%` =
  `promptTokens / contextWindow` của lượt gần nhất.
- **Transcript**: `scrollbox` dính đáy. Người dùng có một vạch accent bên trái.
  Assistant là chữ thường. Tool là **một dòng**: `* <động từ>  <đối số ngắn>`.
- **Status line**: `▎ chat · <model>` — accent, ngay trên ô nhập.
- **Ô nhập**: hộp viền, con trỏ accent. Enter gửi, Shift+Enter xuống dòng.
- **Footer**: phím tắt, muted.
- **Hộp duyệt**: chỉ hiện khi có tool chờ; nội dung lấy từ `describeToolCall`
  (đã che bí mật), mặc định `[y/N]`.

Khi lượt đang chạy, status line đổi thành `▎ đang chạy · <model>`; khi bị cắt,
transcript thêm dòng muted `> đã cắt lượt`.

### 4.4 Màu

Nguồn: `brand/mark.json` → `palette.greenBot` (`#2F9462`), `greenTop`
(`#82E767`), `mouth` (`#158360`). Không bịa hex mới cho phần thương hiệu.

| Vai trò | Hex | Dùng cho | Tương phản trên `#0a0a0a` |
|---|---|---|---|
| `bg` | `#0a0a0a` | nền màn hình | — |
| `surface` | `#141414` | nền khối người dùng, ô nhập | — |
| `border` | `#333333` | viền hộp | 1.7:1 (trang trí) |
| `text` | `#eeeeee` | chữ assistant, nội dung nhập | 17.1:1 |
| `muted` | `#808080` | đối số tool, footer, gợi ý | 5.0:1 |
| `faint` | `#5a5a5a` | dấu phân cách | 3.0:1 (trang trí) |
| `accent` | `#2F9462` | con trỏ, vạch người dùng, đang chạy | 5.2:1 |
| `accentBright` | `#82E767` | **chỉ** con trỏ nhấp nháy / điểm nhấn | 12.8:1 |
| `error` | `#ff6369` | tool lỗi, lỗi provider | 6.8:1 |
| `warning` | `#f5a742` | nén context, cảnh báo | 9.9:1 |

Luật:

- Mọi hex sống **duy nhất** trong `cli/tui/theme.ts`. Component không tự viết hex.
- `tests/tui-theme.test.ts` giữ hợp đồng: `accent === mark.palette.greenBot`,
  `accentBright === greenTop`, `accentDeep === mouth`; và kiểm tương phản WCAG
  của `text`/`muted`/`accent` trên `bg` ≥ 4.5.
- Một màn hình dùng tối đa 4 màu: `text`, `muted`, `accent`, `error` (khi cần).

### 4.5 Trạng thái và phím

| Trạng thái | Hiện ra | Ô nhập | Phím toàn cục |
|---|---|---|---|
| `idle` | con trỏ trong ô nhập, status `chat · model` | **focused** | Enter gửi; `/...` là lệnh; Ctrl+C thoát |
| `running` | status `đang chạy · model`, tool đang chạy có dấu `*` | **blur** | **Esc cắt lượt**; Ctrl+C thoát |
| `approval` | hộp duyệt, `[y/N]` | **blur** | `y`/`c` duyệt; `n`/Enter/Esc từ chối |
| `error` | dòng đỏ trong transcript, quay về `idle` | focused | như idle |

**Vì sao ô nhập phải blur:** OpenTUI **không** có `preventDefault` cho phím thường
(đo ở §3.3). Nếu textarea còn focus trong lúc duyệt thì gõ `y` vừa sửa bản nháp
vừa trả lời duyệt, Enter vừa từ chối vừa gửi tin — hai bên cùng nhận một phím.
`focused` là prop có thật của `@opentui/react` (`components.d.ts`), và
`TextareaRenderable` có `focus()`/`blur()`. Blur là cách duy nhất chắc chắn chỉ
một bên nhận phím.

Esc trong lúc hỏi duyệt **không phải** cắt lượt — nó là câu trả lời "không".
Đây là hành vi hiện tại của `cli/terminal.ts` (`dangHoi`), phải giữ. Nên
`watchInterrupt` của TUI phải hỏi `broker.pending()` trước khi gọi `cancel()`:
đang có hộp duyệt thì Esc thuộc về hộp duyệt.

### 4.6 Duyệt tool: broker thay cho readline

`cli/approval-broker.ts` (CJS, test được, không cần terminal):

```ts
export interface ApprovalRequest {
  id: number;
  tool: string;
  moTa: string; // describeToolCall(tool, args) — đã che bí mật
}
export interface ApprovalBroker {
  approve(tool: string, args: Record<string, unknown>): Promise<boolean>;
  pending(): ApprovalRequest | undefined;
  traLoi(id: number, dongY: boolean): void;
  onPending(cb: (r: ApprovalRequest | undefined) => void): () => void;
}
```

- Không có listener ⇒ `approve` trả `false` ngay (mặc định an toàn, không treo).
- Nhiều yêu cầu cùng lúc ⇒ xếp hàng, trả lời theo `id`; trả lời hai lần bị bỏ qua.
- Plain path **không dùng broker** — vẫn `createConsoleApprover`.

### 4.7 Ghi chú: mức độ, khởi động, và che bí mật

Ba thứ builder check chỉ ra là thiếu, xử lý ngay trong thiết kế:

**a) `note` có mức độ.** `note(text)` toàn chuỗi ⇒ TUI phải dò chữ `"LOI"` để tô
đỏ, đúng kiểu "so khớp chuỗi ngầm" mà AGENTS.md §2 cảnh báo. Đổi thành:

```ts
export type NoteLevel = 'info' | 'warn' | 'error';
note: (text: string, level?: NoteLevel) => void;
```

Plain path bỏ qua tham số thứ hai ⇒ **stderr y nguyên từng byte**. Các chỗ gắn
mức: `> LOI:` và lỗi tool = `error`; `> het context`, `> nen`, `> da cat`,
`> N message da hoan thanh` = `warn`; còn lại `info`.

**b) Ghi chú khởi động không được biến mất.** `main()` đang in công cụ, cảnh báo
`KHONG bat cong cu`, YOLO, file hướng dẫn, số message cũ, provider/model, trần
token. Vào alternate screen là mất. Nên `main()` gom chúng vào `startupNotes:
string[]` (plain path vẫn `console.error` như cũ) và `createTui` render chúng thành
các dòng note ở đầu transcript. Cảnh báo "không bật được công cụ" vì thế vẫn nằm
trong tầm mắt — nếu không, agent từ chối việc file mà người dùng không hiểu vì sao.

**c) Che bí mật trước khi hiện.** Tool line mới là bề mặt **mới** cho tham số
tool (`fs_read .env`, `shell_run` mang bearer token). `cli/session.ts` đã che khi
ghi đĩa, `describeToolCall` đã che khi hỏi duyệt — TUI không được là lỗ hổng thứ
ba. Nên `blocks.ts` chạy `redactSecretText` trên dòng tóm tắt, và **dùng lại**
`summarizeToolArgs` của `lib/agent-tools.ts` (đã có, đừng viết bản thứ hai), chỉ
thêm nhánh: `args` là chuỗi (đường giả lập) thì dùng thẳng.

### 4.8 Lỗi khởi tạo TUI

`cli/index.ts` import TUI **trước khi** dựng host/tool, và `createTui()` (tạo
renderer + mount) cũng chạy trước bước đó. Nếu một trong hai ném:

1. In `> khong mo duoc TUI: <lý do> — dung REPL thuong.`
2. Chuyển sang plain path bình thường (lúc này chưa có tool nào được dựng).

Vì tool được dựng sau bước này, không có chuyện tool cầm broker không listener.
Nếu TUI đã mount xong rồi mới hỏng ở `run()` thì đó không còn là lỗi khởi tạo:
`runRepl` tự bắt lỗi provider, còn lỗi bất ngờ thì đóng renderer và thoát với
`exitCode = 1` — không để terminal ở alternate screen.

### 4.9 Những gì KHÔNG đụng

`cli/session.ts`, `cli/compaction.ts`, `cli/approve.ts`, `lib/tools/*`,
`lib/provider/*`, `cli/instructions.ts`. `runRepl` chỉ thêm chỗ gọi callback,
không đổi nhánh xử lý nào.

## 5. Cấu trúc file

| File | Loại | Vai trò |
|---|---|---|
| `cli/tui-gate.ts` | mới (CJS) | `chooseFrontend()` thuần, test được |
| `cli/approval-broker.ts` | mới (CJS) | hàng đợi duyệt tool, mặc định KHÔNG |
| `cli/tui/package.json` | mới | `{"type":"module"}` — đảo ESM |
| `cli/tui/theme.ts` | mới | bảng màu duy nhất |
| `cli/tui/blocks.ts` | mới | `CoreMessage[] → Block[]`; nhãn/đối số tool thuần |
| `cli/tui/app.tsx` | mới | bố cục + trạng thái |
| `cli/tui/header.tsx` | mới | header + số liệu |
| `cli/tui/transcript.tsx` | mới | danh sách block trong scrollbox |
| `cli/tui/composer.tsx` | mới | textarea + status line |
| `cli/tui/approval.tsx` | mới | hộp duyệt |
| `cli/tui/footer.tsx` | mới | phím tắt |
| `cli/tui/bridge.ts` | mới | adapter cho `runRepl`, hàng đợi `ask` |
| `cli/tui/entry.tsx` | mới | `createTui()`: renderer + root; `run(core)` gọi `runRepl` |
| `cli/agent-turn.ts` | sửa | `onToolCall(ToolCallEvent)`, thêm `onToolResult(ToolResultEvent)` |
| `cli/emulated.ts` | sửa | chuyển tiếp `{id, args}` / `{id, summary}` từ annotation |
| `cli/repl.ts` | sửa | 3 callback tuỳ chọn + `onUsage` + `note` có mức độ |
| `cli/index.ts` | sửa | chọn frontend, import động, broker, `startupNotes` |
| `vitest.config.mts` | sửa | include thêm `tests/**/*.test.tsx` |
| `tests/repo-hygiene.test.ts` | sửa | `CORE_ENTRIES` cho phép `.tsx` (giữ nguyên guard) |
| `scripts/cli-migration/import-graph.ts` | sửa | parse `.tsx` bằng `ScriptKind.TSX`; khai file TUI |
| `tests/cli-migration-scan.test.ts` | sửa | test đồ thị đi qua `.tsx` |
| `tests/tui-*.test.ts(x)` | mới | 8 file test |
| `AGENTS.md`, `cli/index.ts` header | sửa | bản đồ + hướng dẫn |

Mọi file mới trong `cli/` (kể cả `.tsx`) phải vào `CORE_ENTRIES` **trong cùng
commit tạo nó** — `tests/repo-hygiene.test.ts` canh điều này.

Không tạo file mới cho thứ đã có. Không đụng web.

## 6. Rủi ro và cách chặn

| Rủi ro | Chặn bằng |
|---|---|
| TUI không chạy trong terminal thật trên Windows (probe chỉ là headless) | Task 2 là **cổng**: mở TUI thật từ `npm run cli` trước khi xây UI. Hỏng thì dừng, cân nhắc lại (Ink) — chưa xây gì thêm |
| CJS/ESM vỡ khi đóng gói | Test spawn `node --import tsx` trên fixture import `cli/tui/entry.tsx`; giữ đảo ESM |
| `runRepl` đổi hành vi plain | Test mới: không truyền callback thì `note` vẫn nhận `[goi tool]` y như cũ |
| Duyệt tool treo khi UI chết | Broker: không listener ⇒ `false` ngay; test canh |
| Stream làm UI giật | Đo ở bước tay; nếu cần, gộp delta theo 30ms (không làm sớm) |
| Màu lệch brand | Test parity với `brand/mark.json` |
| `docs:check` đỏ vì file mới chưa `git add` | Task cuối `git add` trước khi chạy check |
| Nới guard làm mất tác dụng canh | Mutation bắt buộc: `.tsx` không khai ⇒ đỏ; `ScriptKind` về `TS` ⇒ đỏ |

### 6.1 Đã cân nhắc và loại: `@zenbu-labs/pixel` (pixelgui.com)

Người dùng hỏi ngày 2026-10-20. Đọc trang chủ + README + metadata npm
(`@zenbu-labs/pixel` 0.2.6, cập nhật 2026-10-19). **Loại**, vì:

1. **Không có bản Windows native.** `optionalDependencies` chỉ có
   `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`. Trang chủ ghi rõ:
   *"You can use pixel on Windows today through WSL. Native Windows support is a
   work in progress."* Máy chạy Vyen là Windows x64, không WSL.
2. **Cần kitty graphics protocol.** Nó vẽ **pixel**, không vẽ ô chữ. Danh sách
   terminal hỗ trợ không có Windows Terminal. Nghĩa là kể cả chạy được, TUI sẽ
   trắng/không hiện trong đúng terminal người dùng đang dùng.
3. **React 18.** `peerDependencies: react ^18.3.1`, `react-reconciler ^0.29.2`;
   repo đang React 19.2.8. Cài là ERESOLVE hoặc chạy trên reconciler sai đời.
4. **Sai bản chất.** Pixel là framebuffer + engine Rust + WebView Chromium; text
   selection, copy/paste, scrollback, accessibility đều phải tự làm lại. Mục tiêu
   của Vyen là TUI chữ đẹp như OpenCode, không phải GUI pixel.

Giữ nguyên: **OpenTUI** (text, ANSI, chạy trong terminal thường, Windows native).
Pixel chỉ có thể là lựa chọn cho một tính năng tương lai kiểu "khung xem ảnh/web
trong terminal" — không phải nền của TUI hội thoại.

## 7. Builder check — 6 câu, đã trả lời

Builder check độc lập (đọc spec + mã thật) nêu 6 chỗ phải đoán. Đã chốt:

| # | Câu hỏi | Trả lời |
|---|---|---|
| 1 | Guard nào được đổi? | §3.4 — mở rộng `.tsx` cho `CORE_ENTRIES` + `ScriptKind.TSX`, **không** lách guard; mutation chứng minh |
| 2 | Sự kiện tool mang gì, ghép thế nào? | §4.2.1 — `{id, name, args|result}`, ghép theo `toolCallId`; đường giả lập `args` là chuỗi đã tóm tắt |
| 3 | Phân biệt note lỗi/cảnh báo? | §4.7a — `note(text, level?)`; plain path bỏ qua level |
| 4 | Bàn phím thuộc về ai? | §4.5 — ô nhập **blur** khi `running`/`approval`; Esc hỏi `broker.pending()` trước khi cắt |
| 5 | Ghi chú khởi động đi đâu? | §4.7b — `startupNotes[]` → note đầu transcript |
| 6 | Có che bí mật trong tool line? | §4.7c — `redactSecretText` + dùng lại `summarizeToolArgs` |

Còn lại cho người xây: chia task, tên test, thứ tự commit → plan
`docs/superpowers/plans/2026-10-20-vyen-tui.md`.
