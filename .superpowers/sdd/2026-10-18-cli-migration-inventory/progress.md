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