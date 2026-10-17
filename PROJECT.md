# Project: Vyen Multi-Agent Architecture (Teamwork) — ĐÃ GỠ 2026-10-15

> **Trạng thái: đã gỡ khỏi repo.** Toàn bộ mã nguồn headless (thư mục teamwork trong
> `lib/`, entry bin/teamwork.ts, 27 suite test teamwork-*.test.ts) cùng CLI
> (entry bin/vyen.ts, thư mục `lib/cli`) đã bị xoá theo quyết định của chủ repo ngày
> 2026-10-15. File này được giữ lại **chỉ làm tombstone**: nó nằm trong danh sách
> contract doc của `npm run docs:check`, nên phải tồn tại; còn nội dung kiến trúc cũ
> đã không còn đường dẫn nào để trỏ tới.
>
> Lịch sử đầy đủ (phạm vi cắt, file phải giữ vì sao, và kết quả kiểm chứng) nằm ở
> `PLAN.md` §16. Muốn đọc lại thiết kế cũ thì đọc git: `git show 0e5760e:PROJECT.md`.

## Vì sao gỡ

Hệ headless có ba đặc điểm khiến nó không hợp với hướng sản phẩm của Vyen:

1. **Không có mặt trong UI.** Không component nào import thư mục teamwork trong `lib/`; nó chỉ
   chạy qua CLI, tức là một sản phẩm thứ hai song song với app chat.
2. **Diện tích test không tương xứng với giá trị sử dụng.** 27 suite test cho một
   đường chạy không ai dùng hằng ngày.
3. **Tài liệu đã lệch code trước khi cắt.** Mục M4 khai một thư mục `context/` bên trong teamwork
   (3-Tier Context Querying, Semantic Ontology) nhưng thư mục đó không tồn tại
   trong repo — tức phần "tính năng" đã bị báo cáo là IMPLEMENTED thực ra không
   có code.

## Còn lại gì từ kiến trúc cũ

| Mảng | Bền vững ở đâu |
|---|---|
| Phê duyệt trước khi ghi (HITL) | `lib/auto-pilot.ts` + bảng phân quyền per-tool + modal diff (`components/diff-confirm.tsx`) |
| Checkpoint trước khi sửa | `components/workspace-checkpoints.tsx` |
| Kiểm chứng sau khi sửa (auto-debug) | `lib/debug-loop.ts`, `lib/post-edit-check.ts` |
| Chạy song song có giới hạn | `lib/orchestrator/scheduler.ts` (runPool dùng bởi subagent + sub-recipe) |
| Diễn tập + patch nguyên tử | `lib/sarsed/` (`code_skeleton`, `code_symbols`, `code_patch`) |

## Cái bị mất và cách bù

| Mất | Bù bằng |
|---|---|
| `vyen teamwork` (DAG nhiều milestone, worktree tách nhánh) | Subagent `delegate` + sub-recipe batch trong app (`lib/subagent.ts`, `lib/recipes/subrecipe-exec.ts`) |
| `vyen run --recipe` headless cho CI | Scheduler cron chạy recipe nền + panel lịch trong Cài đặt → Dữ liệu |
| Ledger bitemporal + context tier | Chưa có bù; ZeroMem (`lib/zeromem/`) là hướng gần nhất nhưng hiện chưa có UI quản lý |

Còn muốn làm lại phần nào thì đặt thành kế hoạch mới, **không** viết vào file này —
file này chỉ ghi vì sao phần cũ đã bị gỡ.