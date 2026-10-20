# SDD ledger — plan: docs/superpowers/plans/drafts/2026-10-20-vyen-tui.md

## Pre-flight (đọc plan + spec; 7 interface dùng chung)

| # | Task sản xuất | Task tiêu thụ | Tìm được | Quyết định |
|---|---|---|---|---|
| 1 | Task 1: `@opentui/core@0.6.6`, `@opentui/react@0.6.6` | Task 2/6/7/8 | version đã ghim; peer do npm tự cài | không xung đột |
| 2 | Task 2: `chooseFrontend`, `theme`, `entry.tsx::createTui` (placeholder) | Task 6 (theme), Task 8 | placeholder Task 2 **không** có tham số `approval`; Task 8 cần | Ruling: Task 8 viết lại `entry.tsx` trọn vẹn, **đường dẫn giữ nguyên** ⇒ CORE_ENTRIES không đổi. Chi phí nếu sai: một lần viết lại file (rẻ) |
| 3 | Task 4: `ToolCallEvent`/`ToolResultEvent`/`NoteLevel`, `ReplOptions.onToolCall/onToolResult/onToolError/onUsage` | Task 7 (store), Task 8 | đã grep mọi caller: agent-turn.ts:56,300 / emulated.ts:109,177,221,272,302 / repl.ts:206 / index.ts:250 / tests/cli-agent-turn.test.ts:140 | không xung đột |
| 4 | Task 3: `ApprovalBroker`, `ApprovalRequest {id, tool, moTa}` | Task 7 (store), Task 8 | khớp | không xung đột |
| 5 | Task 5: `Block` + `nhanTool`/`tomTatDoiSo`/`messagesToBlocks` | Task 6 (transcript), Task 7 (store) | shape `Block` dùng nguyên vẹn ở cả hai | không xung đột |
| 6 | Task 2: đổi `CORE_ENTRIES` (thêm `cli/tui/*`) | Task 9 (docs) | generator `build-inventory.ts` ghi cột "còn dùng bởi lõi?" + **danh sách CORE_ENTRIES** ⇒ `docs/cli-migration-inventory.md` sẽ **lệch**, mà test chỉ so TẬP tên dòng nên **không** bắt | Ruling: thêm bước "chạy lại `node scripts/cli-migration/build-inventory.ts` + commit file sinh ra" ngay trong Task 2. Chi phí nếu sai: bảng kiểm kê nói dối về file nào còn dùng bởi lõi |
| 7 | Task 5: `cli/tui/blocks.ts` import `@/lib/agent-tools` + `@/lib/secret-registry` | Task 2 (guard GUỐ) | `lib/agent-tools.ts` **không** nằm trong CORE_ENTRIES ⇒ import nó sẽ kéo file đó vào đồ thị lõi | Ruling: dùng lại `summarizeToolArgs` (AGENTS §6) và **chạy `tests/cli-migration-scan.test.ts` ngay sau khi khai `blocks.ts`**; chỉ xét bản tóm tắt cục bộ nếu guard đỏ. Chi phí nếu sai: đổi một hàm tóm tắt |

## Ruling: chạy trên worktree, không phải `main`

Skill `executing-plans` yêu cầu cách ly, và `main` chưa được phép. Đã tạo worktree
`C:\Users\Admin\.local\share\opencode\worktree\e739c0\vyen-tui`, nhánh
`feature/vyen-tui` từ commit 29529c6. `main` của user giữ nguyên.
Chi phí nếu sai: một lần merge khi xong.

## Ruling: script của skill là bash, máy này KHÔNG có bash

`Get-Command bash` trả rỗng. Đã viết lại bằng PowerShell tại
`.superpowers/sdd/2026-10-20-vyen-tui/tools/sdd.ps1` (workspace / brief / done /
ledger) — cùng tên tệp, cùng định dạng, để đổi executor giữa chúng không vòng.

Lưu ý kỹ thuật: **ghi ledger bằng tool `write`, không dùng here-string của
PowerShell** — backtick trong chuỗi là ký tự escape, nó nuốt ký tự đứng sau
(`theme` → `heme`, `approval` → `pproval`). Đã hỏng một lần, đã viết lại.

## Ruling: plan nằm ở `docs/superpowers/plans/drafts/`

`tests/plan-traceability.test.ts` đòi **file test trong bảng phải tồn tại**; 9 file
test của plan chưa có ⇒ để plan ở `plans/` làm suite đỏ trong lúc làm việc. Task 9
chuyển lên `plans/` khi đã đủ 9 file. Chi phí nếu sai: một lần `git mv`.
Task 0: complete (commits 29529c6..ee56e56, tests: npx vitest run tests/repo-hygiene.test.ts tests/cli-migration-scan.test.ts -> pass)
Task 1: complete (commits ee56e56..fcd1dac, tests: npx vitest run tests/tui-smoke.test.ts -> pass)

## Task 2 - Ruling: do dac cu SAI, da sua o ca spec lan plan

Lần đo trước ("ScriptKind.TS khong thay import sau JSX") la **artefact**: file probe
duoc viet bang PowerShell voi `\n` (PowerShell KHONG hieu `\n` la xuong dong) => file
sai cu phap => parser hong ca file. Do lai bang newline that tren 3 hinh dang `.tsx`
thuc te => `ScriptKind.TS` **van** thay import. Ruling: `ScriptKind.TSX` la PHONG
THU (khong co test bat duoc khac biet) - ghi ro trong `import-graph.ts`; phan
load-bearing la `listSourceFiles` (mutation ve chi `.ts` => test `.tsx` DO, da kiem).
Chi phi neu sai: mot dong chu sai trong spec/plan doc lai (da sua ca hai).

## Task 2 - Ruling: cong terminal tu dong hoa duoc

Ke hoach ghi "kiem tay". Do thay may lo duoc: spawn `node --import tsx
cli/tui/entry.tsx`, kiem alt-screen bat / Esc => exit 0 / alt-screen tat. Ruling:
viet thanh `tests/tui-terminal-gate.test.ts` (cong may) + giu phan mat thay o Task 8
buoc 8. Chi phi neu sai: them mot file test (re). Neu giu "kiem tay" thi khong co
gi chan lan sau no hong.

## Task 2 - Ruling: `import.meta.main` can khai bao types tai cho

Runtime Node 26 co `import.meta.main` (cong terminal xanh => chay dung), nhung
`@types/node` cua repo la ban 20 => `tsc` bao TS2339. Ruling: khai
`declare global { interface ImportMeta { readonly main?: boolean } }` trong
`cli/tui/entry.tsx`, thay vi ep kieu hay nang `@types/node` (nang la thay doi lan
man ca repo). Chi phi neu sai: mot khai bao 5 dong.

## Task 2 - phat hien them: bang kiem ke bi CU so dong

Chay lai `build-inventory.ts` (ruling pre-flight #6) khong chi them 3 entry TUI ma
con **va** so dong `lib/db.ts` trong bang (29 -> 32, 503 -> 532...) - tuc bang tren
dia da cu tu truoc, ma test chi so TAP ten dong nen khong bat. Ruling: commit bang
sinh lai. Chi phi neu sai: bang kiem ke noi doi ve vi tri API trinh duyet.
Task 2: complete (commits fcd1dac..1b13263, tests: npx vitest run tests/tui-gate.test.ts tests/tui-theme.test.ts tests/tui-node-load.test.ts tests/tui-terminal-gate.test.ts tests/repo-hygiene.test.ts tests/cli-migration-scan.test.ts -> pass)
Task 3: complete (commits 1b13263..3cf751c, tests: npx vitest run tests/cli-approval-broker.test.ts tests/repo-hygiene.test.ts tests/cli-migration-scan.test.ts -> pass)
