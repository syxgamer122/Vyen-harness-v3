# Bảng kiểm kê di cư sang CLI

Sinh bằng `node scripts/cli-migration/build-inventory.ts`. Cột **LÝ DO** lấy từ
`scripts/cli-migration/ly-do.ts` — sửa ở đó, chạy lại script sẽ không mất.

## Tiêu chí

| nhãn | điều kiện |
|---|---|
| `GHIU` | không chạm API trình duyệt |
| `VIET-LAI` | chạm API trình duyệt **và** nằm trong đồ thị lõi → lõi cần, phải có bản Node |
| `XOA` | chạm API trình duyệt và **không** nằm trong đồ thị lõi → thuộc tính năng web |
| `THAY-THE` | máy gán sai — lõi vẫn cần chức năng này qua đường khác. Nhãn do người đặt trong `ly-do.ts`, **đọc trước khi lên kế hoạch** |

> Bảng dưới chỉ liệt kê file chạm API trình duyệt **trực tiếp**.
>
> **Đừng suy ra phần còn lại chạy được trên Node.** Một file không viết chữ
> `Dexie` vẫn có thể gọi `db.…` mà `db` mới là Dexie — xem mục kế bên.

## Điểm vào của lõi

- `lib/agent-tools-server.ts`
- `lib/tool-result-server.ts`
- `lib/emulated-agent.ts`
- `lib/tool-limits.ts`
- `lib/context-budget.ts`
- `lib/secret-registry.ts`
- `lib/mcp/tool-mapper.ts`
- `lib/provider/adapter.ts`
- `lib/provider/openai-adapter.ts`
- `lib/provider/anthropic-adapter.ts`
- `lib/provider/upstream-diagnosis.ts`

## Bằng chứng dòng

| file | API trình duyệt | nằm trong đồ thị lõi | nhãn | lý do |
|---|---|---|---|---|
| `lib/auto-backup.ts` | localStorage, showDirectoryPicker | không | XOA | Sao lưu lịch sử chat tự động trong IndexedDB |
| `lib/chat-broadcast.ts` | localStorage | không | XOA | Báo tab khác biết chat bị xoá, qua BroadcastChannel |
| `lib/client-identity.ts` | localStorage | không | XOA | Nhận diện client qua localStorage |
| `lib/db.ts` | Dexie | không | THAY-THE | Kho hội thoại / message / memory bằng Dexie (IndexedDB) |
| `lib/fs-access.ts` | showDirectoryPicker | không | THAY-THE | Đọc workspace bằng File System Access API của trình duyệt |

## Kéo trình duyệt vào qua phụ thuộc xuyên

- `lib/audit-log.ts` — Nhật ký hành động; subtle crypto chỉ dùng ở nhánh trình duyệt
- `lib/auto-pilot.ts` — Đánh dấu lượt cho taint-tracking và ngân sách ở client
- `lib/backup.ts` — Đọc/ghi file backup dạng base64
- `lib/chat-recall.ts` — Tra cứu full-text toàn bộ lịch sử trò chuyện (P2-8)
- `lib/chat-search.ts` — Tìm full-text trong lịch sử chat; bỏ là mất tìm kiếm hội thoại
- `lib/memory/agent-memory-client.ts` — Lấy workspaceKey bền (desktop hỏi bridge, web đọc cache)
- `lib/memory/store.ts` — Chống trùng lặp digest cho memory của agent
- `lib/providers.ts` — Cấu hình nhà cung cấp lưu trong Dexie; bỏ là mất provider đã cấu hình
- `lib/recipes/store.ts` — Cập nhật bản ghi recipe hiện có
- `lib/skills/client-adapters.ts` — Bọc khác biệt desktop bridge ↔ web FSA cho disk skills + hints
- `lib/tool-permissions.ts` — Map tool sang 8 nhóm phân quyền
- `lib/tree-repair.ts` — Sửa cây hội thoại hỏng — ưu tiên deepest leaf, sentinel __ROOT__
- `lib/use-cross-tab-chat-sync.ts` — Hook React đồng bộ chat giữa các tab
- `lib/workspace-checkpoints.ts` — Trần số checkpoint mỗi lượt
- `lib/zeromem/auto-ingest.ts` — Nạp trace vào memory khi hội thoại đóng
- `lib/zeromem/memory-block.ts` — Dựng khối memory gửi kèm lượt
- `lib/zeromem/persistence.ts` — Giới hạn số trace zeromem giữ lại

17 file **không tự chạm** API trình duyệt nào, nhưng kéo được
một module chạm, nên cũng không chạy được trên Node. Chúng không có mặt ở bảng
trên vì quét chỉ thấy phụ thuộc TRỰC TIẾP — `lib/tool-permissions.ts` là ví dụ:
không viết chữ `Dexie`, chỉ gọi `db.toolPermissions.put`.

**Chưa phân loại giữ/xoá.** Cột nhãn của bảng trên chỉ áp cho file chạm trực
tiếp; ở đây máy chỉ biết "không chạy được trên Node", còn việc lõi có còn cần
chức năng này thì là phán đoán của người — đặt `FORCE_LABEL` trong `ly-do.ts`.

Test `GUỐ — lõi CLI không được kéo trình duyệt vào` trong
`tests/cli-migration-scan.test.ts` canh rằng **không file nào trong đồ thị lõi**
rơi vào danh sách này. Thêm `CORE_ENTRIES` mà kéo theo Dexie thì test đỏ.


## File chạm API trình duyệt

`lib/auto-backup.ts`:29,32,59,59,77,87,88,97,132,133<br>`lib/chat-broadcast.ts`:48,57<br>`lib/client-identity.ts`:37,37,45<br>`lib/db.ts`:1,503,1034,1035,1041,1041<br>`lib/fs-access.ts`:79,91
