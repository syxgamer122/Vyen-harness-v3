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

## Bằng chứng dòng

| file | API trình duyệt | nằm trong đồ thị lõi | nhãn | lý do |
|---|---|---|---|---|
| `lib/auto-backup.ts` | localStorage, showDirectoryPicker | không | XOA | Sao lưu lịch sử chat tự động trong IndexedDB |
| `lib/chat-broadcast.ts` | localStorage | không | XOA | Báo tab khác biết chat bị xoá, qua BroadcastChannel |
| `lib/client-identity.ts` | localStorage | không | XOA | Nhận diện client qua localStorage |
| `lib/db.ts` | Dexie | không | THAY-THE | Kho hội thoại / message / memory bằng Dexie (IndexedDB) |
| `lib/fs-access.ts` | showDirectoryPicker | không | THAY-THE | Đọc workspace bằng File System Access API của trình duyệt |

## Kéo trình duyệt vào qua phụ thuộc xuyên

- `lib/audit-log.ts`
- `lib/auto-pilot.ts`
- `lib/backup.ts`
- `lib/chat-recall.ts`
- `lib/chat-search.ts`
- `lib/chat-tree-persistence.ts`
- `lib/memory/agent-memory-client.ts`
- `lib/memory/store.ts`
- `lib/providers.ts`
- `lib/recipes/store.ts`
- `lib/skills/client-adapters.ts`
- `lib/tool-permissions.ts`
- `lib/tree-repair.ts`
- `lib/tree-validation.ts`
- `lib/use-cross-tab-chat-sync.ts`
- `lib/workspace-checkpoints.ts`
- `lib/zeromem/auto-ingest.ts`
- `lib/zeromem/memory-block.ts`
- `lib/zeromem/persistence.ts`

19 file **không tự chạm** API trình duyệt nào, nhưng kéo được
một module chạm, nên cũng không chạy được trên Node. Chúng không có mặt ở bảng
trên vì quét chỉ thấy phụ thuộc TRỰC TIẾP — `lib/tool-permissions.ts` là ví dụ:
không viết chữ `Dexie`, chỉ gọi `db.toolPermissions.put`.

Test `GUỐ — lõi CLI không được kéo trình duyệt vào` trong
`tests/cli-migration-scan.test.ts` canh rằng **không file nào trong đồ thị lõi**
rơi vào danh sách này. Thêm `CORE_ENTRIES` mà kéo theo Dexie thì test đỏ.


## File chạm API trình duyệt

`lib/auto-backup.ts`:29,32,59,59,77,87,88,97,132,133<br>`lib/chat-broadcast.ts`:48,57<br>`lib/client-identity.ts`:37,37,45<br>`lib/db.ts`:1,511,1042,1043,1049,1049<br>`lib/fs-access.ts`:79,91
