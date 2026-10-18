# Bảng kiểm kê di cư sang CLI

Sinh bằng `node scripts/cli-migration/build-inventory.ts`. Cột **LÝ DO** lấy từ
`scripts/cli-migration/ly-do.ts` — sửa ở đó, chạy lại script sẽ không mất.

## Tiêu chí

| nhãn | điều kiện |
|---|---|
| `GHIU` | không chạm API trình duyệt |
| `VIET-LAI` | chạm API trình duyệt **và** nằm trong đồ thị lõi → lõi cần, phải có bản Node |
| `XOA` | chạm API trình duyệt và **không** nằm trong đồ thị lõi → thuộc tính năng web |

> Chỉ file chạm API trình duyệt mới có mặt trong bảng. File không chạm thì không cần
> phân loại — chúng dùng được nguyên vẹn cho lõi Node.

## Điểm vào của lõi

- `lib/agent-tools-server.ts`
- `lib/tool-result-server.ts`
- `lib/emulated-agent.ts`
- `lib/tool-limits.ts`
- `lib/context-budget.ts`
- `lib/secret-registry.ts`
- `lib/mcp/tool-mapper.ts`

## Bằng chứng dòng

| file | API trình duyệt | nằm trong đồ thị lõi | nhãn | lý do |
|---|---|---|---|---|
| `lib/agent-tools-server.ts` | Dexie | có | VIET-LAI | Tool server của agent (web_search, web_fetch, memory) |
| `lib/agent-tools.ts` | Dexie | có | VIET-LAI | Định nghĩa tool phía client; lõi server import để dựng doc registry |
| `lib/audit-log.ts` | Dexie | không | XOA | Nhật ký hành động; subtle crypto chỉ dùng ở nhánh trình duyệt |
| `lib/auto-backup.ts` | localStorage, showDirectoryPicker | không | XOA | Sao lưu lịch sử chat tự động trong IndexedDB |
| `lib/auto-pilot.ts` | Dexie | không | XOA | Đánh dấu lượt cho taint-tracking và ngân sách ở client |
| `lib/backup.ts` | Dexie | không | XOA | Đọc/ghi file backup dạng base64 |
| `lib/chat-broadcast.ts` | localStorage | không | XOA | Báo tab khác biết chat bị xoá, qua BroadcastChannel |
| `lib/chat-recall.ts` | Dexie | không | XOA | chưa xác minh — cần đọc file |
| `lib/client-identity.ts` | localStorage | không | XOA | Nhận diện client qua localStorage |
| `lib/context-compaction.ts` | Dexie | không | XOA | Nén lịch sử khi ngữ cảnh đầy |
| `lib/db.ts` | Dexie | không | XOA | Kho hội thoại / message / memory bằng Dexie (IndexedDB) |
| `lib/debug-loop.ts` | Dexie | không | XOA | Trần số lần retry của lệnh debug |
| `lib/fs-access.ts` | showDirectoryPicker, Dexie | không | XOA | Đọc workspace bằng File System Access API của trình duyệt |
| `lib/goal-loop.ts` | Dexie | không | XOA | Vòng lặp mục tiêu, tiếp tục khi verdict là continue |
| `lib/lessons.ts` | Dexie | không | XOA | Lesson phân biệt với fact trong kho memories |
| `lib/memory/agent-memory-client.ts` | Dexie | không | XOA | Lấy workspaceKey bền (desktop hỏi bridge, web đọc cache) |
| `lib/memory/agent-memory.ts` | Dexie | không | XOA | Trần ký tự mỗi entry memory của agent |
| `lib/memory/store.ts` | Dexie | không | XOA | Chống trùng lặp digest cho memory của agent |
| `lib/message-text.ts` | Dexie | không | XOA | Chuẩn hoá text lưu/gửi, không chứa artifact |
| `lib/model-meta.ts` | localStorage | không | XOA | Tra cửa sổ ngữ cảnh theo model — lõi context-budget dùng |
| `lib/model-routing.ts` | Dexie, localStorage | không | XOA | Vai trò của model trong lượt (planner/coder) |
| `lib/post-edit-check.ts` | Dexie | không | XOA | Khoảng cách tối thiểu giữa hai vòng check sau khi sửa |
| `lib/provider-secure-key.ts` | Dexie | không | XOA | Kho API key mã hoá qua desktop secure store |
| `lib/provider-url.ts` | Dexie | không | XOA | Suy luận base URL khi gateway không khai báo (kiểu OpenRouter) |
| `lib/recipes/run.ts` | Dexie | không | XOA | Chạy recipe |
| `lib/recipes/schema.ts` | Dexie | không | XOA | Trần kích thước dùng chung cho recipe |
| `lib/recipes/store.ts` | Dexie | không | XOA | Cập nhật bản ghi recipe hiện có |
| `lib/run-lifecycle.ts` | Dexie | không | XOA | Ghi nhận run đang chạy để dừng giữa chừng |
| `lib/search-utils.ts` | Dexie | không | XOA | Chuẩn hoá code point khi tìm kiếm |
| `lib/skills/catalog.ts` | Dexie | không | XOA | Khớp tên skill |
| `lib/staging.ts` | Dexie | không | XOA | Chuẩn hoá path cho staging sandbox |
| `lib/store.ts` | localStorage | không | XOA | Snapshot nhà cung cấp đang active (chỉ trong store) |
| `lib/subtask-plan.ts` | Dexie | không | XOA | Danh sách file trong subtask, dùng cho highlight ở UI |
| `lib/tool-catalog.ts` | localStorage | có | VIET-LAI | Phân quyền riêng cho từng tool |
| `lib/tool-permissions.ts` | localStorage, Dexie | không | XOA | Map tool sang 8 nhóm phân quyền |
| `lib/turns.ts` | Dexie | không | XOA | Trường turn mới trong bản ghi hội thoại |
| `lib/use-cross-tab-chat-sync.ts` | Dexie | không | XOA | Hook React đồng bộ chat giữa các tab |
| `lib/use-title-generator.ts` | Dexie | không | XOA | Hook React sinh tiêu đề hội thoại |
| `lib/workspace-checkpoints.ts` | Dexie | không | XOA | Trần số checkpoint mỗi lượt |
| `lib/zeromem/auto-ingest.ts` | Dexie | không | XOA | Nạp trace vào memory khi hội thoại đóng |
| `lib/zeromem/memory-block.ts` | Dexie | không | XOA | Dựng khối memory gửi kèm lượt |
| `lib/zeromem/persistence.ts` | Dexie | không | XOA | Giới hạn số trace zeromem giữ lại |
| `lib/zeromem/store.ts` | Dexie | không | XOA | Bộ đếm turn cho zeromem |
| `lib/zeromem/tools.ts` | Dexie | có | VIET-LAI | Singleton store zeromem theo workspace |

## File chạm API trình duyệt

`lib/agent-tools-server.ts`:72<br>`lib/agent-tools.ts`:822<br>`lib/audit-log.ts`:4<br>`lib/auto-backup.ts`:17,29,32,58,59,64,77,87,88,97,132,133<br>`lib/auto-pilot.ts`:228<br>`lib/backup.ts`:365,385<br>`lib/chat-broadcast.ts`:48,57<br>`lib/chat-recall.ts`:27<br>`lib/client-identity.ts`:30,37,45,47<br>`lib/context-compaction.ts`:31<br>`lib/db.ts`:1,48,110,118,125,212,511,590,652,854,1042,1043,1049<br>`lib/debug-loop.ts`:8<br>`lib/fs-access.ts`:79,91,567<br>`lib/goal-loop.ts`:22<br>`lib/lessons.ts`:6,9<br>`lib/memory/agent-memory-client.ts`:2,5,150<br>`lib/memory/agent-memory.ts`:10<br>`lib/memory/store.ts`:2<br>`lib/message-text.ts`:29<br>`lib/model-meta.ts`:142<br>`lib/model-routing.ts`:10,63<br>`lib/post-edit-check.ts`:19<br>`lib/provider-secure-key.ts`:10<br>`lib/provider-url.ts`:3<br>`lib/recipes/run.ts`:7<br>`lib/recipes/schema.ts`:8<br>`lib/recipes/store.ts`:2,52<br>`lib/run-lifecycle.ts`:25,385<br>`lib/search-utils.ts`:56<br>`lib/skills/catalog.ts`:140,169<br>`lib/staging.ts`:12,173<br>`lib/store.ts`:110,229<br>`lib/subtask-plan.ts`:9<br>`lib/tool-catalog.ts`:26<br>`lib/tool-permissions.ts`:5,6,176,233,246,251,264,270,276<br>`lib/turns.ts`:32<br>`lib/use-cross-tab-chat-sync.ts`:13,43<br>`lib/use-title-generator.ts`:33,134<br>`lib/workspace-checkpoints.ts`:6,14<br>`lib/zeromem/auto-ingest.ts`:6<br>`lib/zeromem/memory-block.ts`:14<br>`lib/zeromem/persistence.ts`:5,6,32,35,55,84,91,109,164,178,191<br>`lib/zeromem/store.ts`:86,193<br>`lib/zeromem/tools.ts`:30
