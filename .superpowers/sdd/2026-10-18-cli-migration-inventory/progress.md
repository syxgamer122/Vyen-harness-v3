# SDD ledger — plan: docs/superpowers/plans/2026-10-18-cli-migration-inventory.md

Spec: docs/superpowers/specs/2026-10-18-cli-core-design.md §4
Workspace gốc dự kiến: `.superpowers/sdd/2026-10-18-cli-migration-inventory/`

## Setup

- **Ruling: tạo workspace thủ công thay vì chạy `sdd-workspace`** — máy không có
  bash (PowerShell 5.1 báo `bash is not recognized`), script đó là shell script.
  Tạo đúng đường dẫn skill quy định: `<repo-root>/.superpowers/sdd/<plan-basename>/`.
  Chi phí nếu sai: không có — cấu trúc thư mục đúng như skill mô tả.
- **Ruling: không tạo git worktree riêng.** Lý do: repo dùng `node_modules` đã cài,
  tạo worktree sẽ phải cài lại dependency (chậm, và Plan 0 chỉ thêm script chứ không
  đụng dependency). Chuyển nhánh trong cùng thư mục là đủ cô lập cho 3 task thêm file
  mới. Chi phí nếu sai: không có gì để cô lập vì không sửa file đang chạy.
- Nhánh: `feat/cli-migration`, mọc từ `feat/tool-result-spill` (9bc4b46) — vì phần
  `agent-tools-server` + `tool-result-server` mà Task 2/4 của spill đã làm **là tiền
  đề** của lõi CLI. Plan 0 phải đứng trên nó, không phải trên main.
- Trước khi tạo nhánh đã commit phần spill còn treo: `9bc4b46`.

## Pre-flight: xung đột giữa các task

| Task tiêu thụ | Task sản xuất | Cần dùng | Tìm thấy |
|---|---|---|---|
| 2 | 1 | `tests/cli-migration-scan.test.ts` | **Cùng file test.** Task 2 thêm 3 test vào file Task 1 tạo. Plan đã ghi "Modify" nên đúng — nhưng phải chạy lại test của Task 1 mỗi lần thêm, nếu không sẽ hỏng mà không ai thấy. |
| 2 | 1 | `BROWSER_APIS` | Task 2 **không** dùng. Đã xoá khỏi Interfaces của Task 2 trong lúc tự review. |
| 3 | 1 | `scanBrowserApis(root)` | Khớp chữ ký. |
| 3 | 2 | `CORE_ENTRIES`, `reachableFrom(entries)` | Khớp. Danh sách entry chỉ khai một lần ở Task 2 — đã gộp trong lúc tự review, tránh hai bộ hằng trùng tên. |

Đếm test kỳ vọng: Task 1 → 3. Task 2 → 6. Task 3 → 8. Khớp với `Expected:` trong plan.

## Nợ chưa trả (không thuộc plan này)

- Mutation `eval('require')` trong `tests/spill-wiring.test.ts`: mutation của tôi đặt
  `eval` ở **top-level module**, bản 1 đặt **trong hàm**. Không tương đương nên
  mutation không làm đỏ. Giả thuyết (minifier xử lý hai hình thức khác nhau) **chưa
  kiểm**. Không được ghi là "mutation 3/3" cho tới khi kiểm. Sẽ quay lại khi có
  build rảnh.

## Task 1: Ruling: script viết bằng `.ts` chứ không phải `.mjs`

Plan ban đầu ghi `scripts/cli-migration/*.mjs`. Suy ra sẽ vỡ `tsc`: `tsconfig.json`
có `allowJs: true` nhưng `include` chỉ liệt kê `**/*.ts` và `**/*.tsx`, nên file
`.mjs` không được kiểm và file test `.ts` import nó sẽ nhận `any` dưới
`strict: true`. Máy không có `tsx` hay `ts-node`.

Đã **kiểm chứng** thay vì giả định: `node --version` → v24.18.0, và chạy thử một
file `.ts` có type annotation + interface → chạy được, in ra `TS chay duoc: 42 ok`.

Nên `.ts` thắng trên cả ba tiêu chí: `tsc` kiểm được, `node script.ts` chạy được,
vitest import native được. Đã sửa 14 chỗ trong plan.

Chi phí nếu sai: không có — `.ts` là lựa chọn chặt hơn, không nới gì.

## Task 1: complete (tests: npx vitest run tests/cli-migration-scan.test.ts → 4 passed)

- **RED:** `Cannot find package '@/scripts/cli-migration/scan-browser-apis'` — đúng lý do plan dự đoán.
- **GREEN:** 4/4. typecheck 0 lỗi.
- **Mutation:** đổi `Dexie: /\bDexie\b/` → `/\bZZZNOKHOP\b/` → **2 failed | 2 passed**.
  - Test tự kiểm đỏ với đúng thông báo dự kiến: `lib/db.ts chắc chắn có Dexie`.
  - Test thứ tư (chuẩn hoá đường dẫn) vẫn xanh — đúng, nó kiểm thuộc tính khác
    (đường dẫn), không kiểm API. Đây là bằng chứng các test **không** bị gộp
    chung một điều kiện, nên đỏ của test kia không kéo theo test này.
- **Ruling: bỏ `BROWSER_APIS` khỏi import của test.** Plan Task 1 viết
  `import { scanBrowserApis, BROWSER_APIS }` nhưng không test nào dùng
  `BROWSER_APIS`. Import thừa sẽ bị lint bắt và cũng là dấu hiệu test viết
  cho interface thay vì viết cho hành vi. Chi phí nếu sai: không có.

## Task 2: complete (tests: npx vitest run tests/cli-migration-scan.test.ts → 8 passed)

- **RED:** `Cannot find package '@/scripts/cli-migration/import-graph'`.
- **Quy tắc "ném khi không giải được" bắt được 2 lỗi của chính tôi.** Đây là
  bằng chứng quy tắc đó đáng giá:
  1. Tôi giả định `@/` trỏ tới `lib/`, thực ra trỏ tới **gốc repo** — spec đã có
     `lib/` sẵn. Nếu im lặng bỏ qua, đồ thị thiếu mấy file và kết luận "xoá" sai.
  2. Tôi nối thêm đuôi vào spec **đã có sẵn đuôi** (`@/lib/ipc.cjs` → `ipc.cjs.cjs`).
  Cả hai đều ra thông báo tường minh thay vì đồ thị sai lặng lẽ.
- **GREEN:** 8/8. typecheck 0 lỗi.
- **Mutation:** `['"]` → `["]` trong regex import → **2 failed | 6 passed**, với
  `expected 1 to be greater than 5`. Đồ thị sụp từ 8 xuống 1 file và test tự kiểm
  bắt được. Đây chính là hướng hại nhất của công việc này — đồ thị rỗng dẫn tới
  kết luận "xoá hết" — và giờ nó bị chặn bằng test chứ không bằng hy vọng.
- **Ruling: thêm test thứ tư cho Task 2 — `mọi entry mặc định đều là file có thật`.**
  Không có trong plan. Lý do: `CORE_ENTRIES` là đầu vào của cả bảng kiểm kê; một
  entry sai đường dẫn làm mọi file ngoài đồ thị bị gán `XOA` — tức kết luận sai
  theo cả diện. Chi phí nếu bỏ: một gõ nhầm đường dẫn đủ để bảng báo xoá hàng loạt.

## Task 3: complete (tests: npx vitest run tests/cli-migration-scan.test.ts → 11 passed)

- **RED:** `Cannot find package '@/scripts/cli-migration/build-inventory'`.
- **Test bắt được lỗi THẬT trong plan của tôi:** bảng 44 dòng nhưng plan yêu cầu so
  với `countTsFiles('lib')` = 167. Plan giả định bảng liệt kê MỌI file `.ts`, trong
  khi render chỉ liệt kê file **có** dính API trình duyệt — 123 dòng "sạch" là nhiễu.
  - **Sửa:** so với **quét sống** (`new Set(scanBrowserApis('lib')…)`), tức so bảng
    trên đĩa với script chạy lúc test. Đây mới là cái bắt đúng thứ cần chặn: thêm
    file mới dùng `localStorage` mà quên chạy lại generator thì hai bên lệch.
  - `countTsFiles` giữ lại vì còn dùng trong assert thứ hai (bảng không vượt quá
    tổng file thật) và trong dòng tóm tắt của generator.
- **Đính chính con số 46 → 44.** Con số 46 tôi đưa hôm nay lấy từ
  `Select-String -Path lib\*.ts,lib\**\*.ts` — PowerShell đếm trùng file ở thư mục
  gốc. Script đệ quy một lần cho **44**. Spec và plan đã ghi con số này.
- **Kết quả đo được:** **VIET-LAI 4 — XOA 40.** Đây là câu trả lời đo được cho lo
  lắng "mất bao nhiêu": phần lõi vướng trình duyệt ít hơn nhiều so với 44 file.
- **Ruling: tách cột LÝ DO ra `ly-do.ts`.** Thiết kế ban đầu để LÝ DO nằm trong
  file markdown, mà generator ghi đè toàn bộ file mỗi lần chạy — tức mỗi lần sinh
  lại bảng là **xoá sạch công sức điền tay**. Nay phán đoán của người sống trong
  `ly-do.ts`, generator chỉ hợp nhất. Chi phí nếu không tách: mất cột LÝ DO mỗi
  lần sinh lại, và người đọc sẽ tưởng đó là phần máy sinh.
- **Ruling: bật `allowImportingTsExtensions` trong tsconfig.** Script dùng
  `from './x.ts'` vì Node khi chạy file TypeScript native **bắt buộc** có đuôi tường
  minh (ESM không tự nối đuôi). Không bật thì `tsc` báo TS5097. Cờ này chỉ là
  chẩn đoán của `tsc`, tương thích với `noEmit: true` sẵn có, và Next build dùng
  SWC chứ không qua `tsc` — nên không ảnh hưởng gói build. Chi phí nếu sai: một
  cờ bật thêm, không nới gì.
- Gate: typecheck 0 lỗi · test 11/11 · lint 0 lỗi (8 warning là baseline repo) ·
  docs:check OK (10 tài liệu, 547 file).

## Còn nợ để mở khoá kế hoạch sau

`CORE_ENTRIES` hiện có 7 file. Test chặn được **entry sai đường dẫn**, nhưng KHÔNG
chặn được **entry còn thiếu** — thêm một đường vào lõi mà quên khai báo thì mọi
file ngoài đồ thị bị gán `XOA`, tức kế hoạch tương lai xoá nhầm hàng loạt.
Mỗi plan lõi sau này phải có ở Global Constraints: *thêm entry mới vào
`CORE_ENTRIES` và chạy lại `node scripts/cli-migration/build-inventory.ts`; dùng
`unreached(...)` để kiểm không file lõi nào lọt vào nhóm `XOA`.*

## Final review (reviewer độc lập) — 4 Critical, 8 Important, 12 Minor

Reviewer dựng script AST riêng và đo, không tin lời tôi. Hai phát hiện nặng nhất:

- **C1:** quét bằng regex dòng thô nên đếm CẢ comment lẫn string. **105 hit thô →
  27 hit trong code thật, 5 file.** 39/44 dòng bảng không có dòng code nào dùng
  API nào; có dòng còn phủ định chính nó (`lib/turns.ts:32`: "không kéo Dexie vào
  đúng import"). Reviewer còn chỉ ra coupling thật đi **qua thư viện** thì quét
  trượt: `lib/store.ts` dùng `persist` của zustand (ghi localStorage) mà code
  không bao giờ chữ `localStorage`.
- **C3:** đồ thị import bỏ qua `./x`, `../x` và `import(...)`. **Đo: đồ thị giao 23
  file; đồ thị đúng 38.** `lib/zeromem/tools.ts` (CORE_ENTRY) import `./store`
  nên `lib/zeromem/store.ts` bị gán `XOA` trong khi lõi thật sự dùng — đúng hướng
  hại nhất: bảng dẫn dắt kế hoạch **xoá code đang chạy**.

Tôi tự kiểm chứng C3 trước khi hành động (không tin lời reviewer): đọc
`lib/zeromem/tools.ts:12` → `from './store'`. Đúng.

### Final: fixed C1 — quét bằng AST — test `KHÔNG đếm API nằm trong comment` + `KHÔNG đếm API nằm trong string literal` RED→GREEN, suite 3373/3375
Dùng TypeScript compiler API, chỉ đếm `Identifier` trong code. Bỏ regex thay bằng
`BROWSER_APIS` là mảng tên. **Bảng 44 dòng → 5 dòng.** Kết quả của tôi khớp số
reviewer đo độc lập (5 file) — hai cách làm khác nhau, cùng một con số.
- **VIET-LAI: 0.** Đảo ngược C2: 4 nhãn `VIET-LAI` cũ **chỉ dựa trên bằng chứng
  nằm trong comment**, nên chúng biến mất hẳn khi quét đúng.

### Final: fixed C3 — import tương đối + dynamic — test `đi được qua import TƯƠNG ĐỐI` RED→GREEN, suite 3373/3375
Đồ thị **23 → 38 file**, khớp số reviewer đo.

### Final: fixed C4 — ngôn ngữ nhãn — thêm nhãn `THAY-THE` cho `db.ts` + `fs-access.ts`, suite 3373/3375
`XOA` khiến người đọc lên kế hoạch **xoá** hai file mà spec §5 bắt **viết lại**.
`FORCE_LABEL` trong `ly-do.ts` cho phép người đè nhãn khi máy không đủ thông tin.

### Final: fixed I2 — lý do `model-meta.ts` sai sự thật
Tự kiểm chứng: `context-budget.ts:17` import `capabilityFor` từ `@/lib/models`,
**không** phải `model-meta`. Sửa thành "chỉ UI dùng, lõi KHÔNG cần".

### Final: minor (deferred)
- **I5** test bảng stale chỉ so số đếm chứ không so tập file.
- **I7** 7/10 API trong danh sách không khớp gì ở `lib/` → gõ sai tên thì không ai canh.
- **I8** thiếu API browser-only thật đang dùng: `BroadcastChannel`, `Worker`, `atob`/`btoa`, `Blob`, `File`.
- **I3/I4** cột LÝ DO mô tả chức năng chứ không mô tả **hậu quả khi xoá** như plan yêu cầu.
- **M3** `allowImportingTsExtensions` là cờ toàn repo, chưa kiểm bằng `next build` thật.
- **M11** spec và plan vẫn ghi 46, bảng ghi 5 — lệch số.

### Final: Ruling — không truy vết phụ thuộc xuyên trong lần này
`lib/tool-permissions.ts` **không xuất hiện trong bảng** dù spec §7 nói duyệt tool
nguy hiểm là thứ người dùng tin CLI nhất. Lý do: nó không dùng Dexie trực tiếp, nó
gọi `db.toolPermissions.put` mà `db` mới là Dexie — **quét thấy API trực tiếp, không
thấy phụ thuộc xuyên**.
- Sửa đúng nghĩa là thêm chiều "file này có phụ thuộc vào file trong bảng không"
  vào đồ thị. Đó là một plan riêng, không gộp vào fix pass này.
- `FORCE_LABEL['lib/tool-permissions.ts']` hiện **không có tác dụng** vì file đó
  không xuất hiện trong bảng. Ghi lại để không ai tưởng nó đang bảo vệ gì.
- **Chi phí nếu sai:** bảng bỏ sót file lõi cần viết lại nhưng chỉ gọi tới Dexie
  gián tiếp. Người đọc bảng phải kiểm chéo với spec, không được tin bảng một mình.