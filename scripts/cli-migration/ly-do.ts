/**
 * Cột LÝ DO của bảng kiểm kê — phán đoán của người, TÁCH RA KHỎI script.
 *
 * Vì sao tách: `build-inventory.ts` ghi đè toàn bộ file markdown mỗi lần chạy.
 * Nếu lý do nằm trong script thì mỗi lần sinh lại bảng là mất sạch công sức
 * điền tay. File này là nơi duy nhất cần sửa khi phân loại thay đổi.
 *
 * File chưa có trong đây sẽ in ra `—` chứ không bịa lý do.
 *
 * `FORCE_LABEL` cho các file mà tiêu chí máy SAI — máy không biết lõi còn cần
 * chức năng đó qua đường khác hay không. Review độc lập (2026-10-18) bắt được
 * `db.ts` và `fs-access.ts` bị gán XOA, trong khi spec §5 nói rõ phải có
 * `lib/session/` (thay Dexie) và `lib/tools/fs-node.ts` (thay File System Access
 * API). Đọc "xoá" sẽ khiến kế hoạch sau xoá đúng hai thứ mà spec bắt phải viết lại.
 *
 * Quy ước: viết ngắn, đúng những gì file LÀM và điều MẤT nếu bỏ, không mô tả
 * cách nó làm. `chưa xác minh` = tôi chưa đọc file, đừng tin.
 */
export const FORCE_LABEL: Record<string, string> = {
  // Không nằm trong đồ thị lõi, nhưng spec §5 bắt phải có bản thay thế trên Node.
  'lib/db.ts': 'THAY-THE',
  'lib/fs-access.ts': 'THAY-THE',
  // spec §7: duyệt tool nguy hiểm là thứ người dùng tin CLI nhất. Bỏ thì mất
  // toàn bộ cơ chế duyệt, dù máy thấy nó không nằm trong đồ thị lõi.
  'lib/tool-permissions.ts': 'THAY-THE',
};

export const LY_DO: Record<string, string> = {
  'lib/agent-tools-server.ts': 'Tool server của agent (web_search, web_fetch, memory)',
  'lib/agent-tools.ts': 'Định nghĩa tool phía client; lõi server import để dựng doc registry',
  'lib/audit-log.ts': 'Nhật ký hành động; subtle crypto chỉ dùng ở nhánh trình duyệt',
  'lib/auto-backup.ts': 'Sao lưu lịch sử chat tự động trong IndexedDB',
  'lib/auto-pilot.ts': 'Đánh dấu lượt cho taint-tracking và ngân sách ở client',
  'lib/backup.ts': 'Đọc/ghi file backup dạng base64',
  'lib/chat-broadcast.ts': 'Báo tab khác biết chat bị xoá, qua BroadcastChannel',
  'lib/chat-recall.ts': 'Tra cứu full-text toàn bộ lịch sử trò chuyện (P2-8)',
  'lib/chat-search.ts': 'Tìm full-text trong lịch sử chat; bỏ là mất tìm kiếm hội thoại',
  'lib/chat-tree-persistence.ts': 'Logic lưu cây hội thoại — hàm thuần, tách khỏi chat-interface',
  'lib/client-identity.ts': 'Nhận diện client qua localStorage',
  'lib/context-compaction.ts': 'Nén lịch sử khi ngữ cảnh đầy',
  'lib/db.ts': 'Kho hội thoại / message / memory bằng Dexie (IndexedDB)',
  'lib/debug-loop.ts': 'Trần số lần retry của lệnh debug',
  'lib/fs-access.ts': 'Đọc workspace bằng File System Access API của trình duyệt',
  'lib/goal-loop.ts': 'Vòng lặp mục tiêu, tiếp tục khi verdict là continue',
  'lib/lessons.ts': 'Lesson phân biệt với fact trong kho memories',
  'lib/memory/agent-memory-client.ts': 'Lấy workspaceKey bền (desktop hỏi bridge, web đọc cache)',
  'lib/memory/agent-memory.ts': 'Trần ký tự mỗi entry memory của agent',
  'lib/memory/store.ts': 'Chống trùng lặp digest cho memory của agent',
  'lib/message-text.ts': 'Chuẩn hoá text lưu/gửi, không chứa artifact',
  'lib/model-meta.ts': 'Cửa sổ ngữ cảnh hiển thị theo model — chỉ UI dùng, lõi KHÔNG cần',
  'lib/model-routing.ts': 'Vai trò của model trong lượt (planner/coder)',
  'lib/post-edit-check.ts': 'Khoảng cách tối thiểu giữa hai vòng check sau khi sửa',
  'lib/providers.ts': 'Cấu hình nhà cung cấp lưu trong Dexie; bỏ là mất provider đã cấu hình',
  'lib/provider-secure-key.ts': 'Kho API key mã hoá qua desktop secure store',
  'lib/provider-url.ts': 'Suy luận base URL khi gateway không khai báo (kiểu OpenRouter)',
  'lib/recipes/run.ts': 'Chạy recipe',
  'lib/recipes/schema.ts': 'Trần kích thước dùng chung cho recipe',
  'lib/recipes/store.ts': 'Cập nhật bản ghi recipe hiện có',
  'lib/run-lifecycle.ts': 'Ghi nhận run đang chạy để dừng giữa chừng',
  'lib/search-utils.ts': 'Chuẩn hoá code point khi tìm kiếm',
  'lib/skills/catalog.ts': 'Khớp tên skill',
  'lib/skills/client-adapters.ts': 'Bọc khác biệt desktop bridge ↔ web FSA cho disk skills + hints',
  'lib/staging.ts': 'Chuẩn hoá path cho staging sandbox',
  'lib/store.ts': 'Snapshot nhà cung cấp đang active (chỉ trong store)',
  'lib/subtask-plan.ts': 'Danh sách file trong subtask, dùng cho highlight ở UI',
  'lib/tool-catalog.ts': 'Phân quyền riêng cho từng tool',
  'lib/tool-permissions.ts': 'Map tool sang 8 nhóm phân quyền',
  'lib/tree-repair.ts': 'Sửa cây hội thoại hỏng — ưu tiên deepest leaf, sentinel __ROOT__',
  'lib/tree-validation.ts': 'Kiểm tra chuỗi parent từ leaf lên root còn nguyên',
  'lib/turns.ts': 'Trường turn mới trong bản ghi hội thoại',
  'lib/use-cross-tab-chat-sync.ts': 'Hook React đồng bộ chat giữa các tab',
  'lib/use-title-generator.ts': 'Hook React sinh tiêu đề hội thoại',
  'lib/workspace-checkpoints.ts': 'Trần số checkpoint mỗi lượt',
  'lib/zeromem/auto-ingest.ts': 'Nạp trace vào memory khi hội thoại đóng',
  'lib/zeromem/memory-block.ts': 'Dựng khối memory gửi kèm lượt',
  'lib/zeromem/persistence.ts': 'Giới hạn số trace zeromem giữ lại',
  'lib/zeromem/store.ts': 'Bộ đếm turn cho zeromem',
  'lib/zeromem/tools.ts': 'Singleton store zeromem theo workspace',
};