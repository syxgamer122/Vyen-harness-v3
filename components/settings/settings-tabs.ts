/**
 * Metadata điều hướng của màn hình Cài đặt: danh mục tab, chỉ mục tìm kiếm và
 * hàm suy ra tab từ một khoá bất kỳ.
 *
 * Tách khỏi `components/settings-dialog.tsx` (component render) vì đây là DỮ LIỆU:
 * thêm một mục cấu hình chỉ nên phải sửa file này, không phải cuộn qua phần render.
 */

import { Brain, Database, Layers, Server, Shield, Sliders } from 'lucide-react';

export type SettingsTab = 'appearance' | 'providers' | 'safety' | 'extensions' | 'memory' | 'data';

export const SETTINGS_TABS: Array<{
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    id: 'appearance',
    label: 'Giao diện & trải nghiệm',
    icon: Sliders,
  },
  {
    id: 'providers',
    label: 'Model & Nhà cung cấp',
    icon: Server,
  },
  {
    id: 'safety',
    label: 'Quyền & An toàn',
    icon: Shield,
  },
  {
    id: 'extensions',
    label: 'Mở rộng',
    icon: Layers,
  },
  {
    id: 'memory',
    label: 'Bộ nhớ',
    icon: Brain,
  },
  {
    id: 'data',
    label: 'Dữ liệu & Tự động hoá',
    icon: Database,
  },
];

interface SearchItem {
  id: string;
  title: string;
  description: string;
  tab: SettingsTab;
  keywords: string;
}

export const SETTINGS_SEARCH_ITEMS: SearchItem[] = [
  { id: 'temp', title: 'Temperature', description: 'Độ sáng tạo và biến thiên của câu trả lời', tab: 'appearance', keywords: 'nhiet do sang tao chat chem' },
  { id: 'prompt', title: 'System Prompt', description: 'Chỉ thị hệ thống cốt lõi cho AI', tab: 'appearance', keywords: 'system prompt huong dan he thong' },
  { id: 'enter', title: 'Enter để gửi tin nhắn', description: 'Bật Enter gửi hoặc Ctrl+Enter gửi', tab: 'appearance', keywords: 'phim enter gui tin nhan xuong dong' },
  { id: 'steering', title: 'Tin xếp hàng (Steering / Follow-up)', description: 'Cách bắn hàng đợi tin nhắn khi AI bận', tab: 'appearance', keywords: 'queue steering follow up xep hang' },
  { id: 'compact', title: 'Nén tự động (Compaction)', description: 'Tự động tóm tắt khi gần trần ngữ cảnh', tab: 'appearance', keywords: 'nen tom tat context compaction' },
  { id: 'anim', title: 'Hiệu ứng chuyển động', description: 'Bật/tắt chuyển động trên máy yếu', tab: 'appearance', keywords: 'hieu ung chuyen dong animation giam giat' },
  { id: 'throttle', title: 'Tần suất vẽ lại khi stream', description: 'Điều chỉnh độ mượt và tần suất render token', tab: 'appearance', keywords: 'throttle streaming fps ve lai mượt' },
  { id: 'prov-byok', title: 'Nhà cung cấp API (BYOK)', description: 'Thêm endpoint tương thích OpenAI, OpenRouter...', tab: 'providers', keywords: 'nha cung cap provider openrouter openai anthropic custom url api key sk' },
  { id: 'prov-vision', title: 'Model đọc ảnh (Vision)', description: 'Model mô tả ảnh cho workspace và MCP', tab: 'providers', keywords: 'vision anh image camera mo ta' },
  { id: 'prov-routing', title: 'Routing model (Lead/Worker)', description: 'Model mạnh chạy lượt đầu rồi chuyển model rẻ thực thi, tự quay lại khi lỗi', tab: 'providers', keywords: 'routing lead worker fallback effort lan luoi mixture' },
  { id: 'safety-policy', title: 'Chế độ phê duyệt (Approval Policy)', description: 'Smart, Autonomous, Manual, hoặc Chat Only', tab: 'safety', keywords: 'phe duyet auto pilot smart autonomous yolo manual chat only' },
  { id: 'safety-staging', title: 'Staging Sandbox', description: 'Ghi vào bộ đệm, review batch trước khi chạm đĩa', tab: 'safety', keywords: 'staging sandbox bo dem review batch' },
  { id: 'safety-perms', title: 'Bảng phân quyền từng công cụ (Tool Permissions)', description: 'Cấu hình auto, ask, deny cho 36 công cụ tích hợp và tool MCP phát hiện lúc chạy', tab: 'safety', keywords: 'phan quyen tool permissions block allow deny bang nhom' },
  { id: 'safety-codemode', title: 'Code Mode (run_code)', description: 'LLM viết JavaScript gọi MCP trong sandbox', tab: 'safety', keywords: 'code mode run code js javascript sandbox' },
  { id: 'safety-emulated', title: 'Đường tool giả lập (Emulated tools)', description: 'Chạy tool qua protocol text cho gateway không hỗ trợ function calling', tab: 'safety', keywords: 'gia lap emulated tools text protocol' },
  { id: 'safety-audit', title: 'Nhật ký kiểm toán an toàn (Audit log)', description: 'Lịch sử phê duyệt, can thiệp đĩa và lệnh shell gắn chuỗi băm SHA-256', tab: 'safety', keywords: 'audit log nhat ky kiem toan sha256 tamper phap duyet' },
  { id: 'safety-mcpgrants', title: 'Quyền MCP động và Schema Governance', description: 'Cấp hoặc thu hồi quyền công cụ MCP có thời hạn, phát hiện schema đổi', tab: 'safety', keywords: 'mcp quyen grant ttl schema drift governance cap quyen' },
  { id: 'ext-mcp', title: 'Máy chủ MCP (Model Context Protocol)', description: 'Kết nối stdio / SSE / HTTP servers', tab: 'extensions', keywords: 'mcp servers model context protocol tools' },
  { id: 'ext-skills', title: 'Kỹ năng dạng file (SKILL.md)', description: 'Quản lý và tạo skill trong .vyen/skills/', tab: 'extensions', keywords: 'skill md disk skills ky nang' },
  { id: 'ext-slash', title: 'Lệnh gõ nhanh (Slash commands)', description: 'Gán lệnh / vào workflow recipe', tab: 'extensions', keywords: 'slash command lenh recipe' },
  { id: 'mem-candidates', title: 'Duyệt đề xuất ghi nhớ (Reviewer Gate)', description: 'Xét duyệt Nhớ / Từ chối / Hoãn các candidate', tab: 'memory', keywords: 'reviewer gate duyet de xuat pending' },
  { id: 'mem-active', title: 'Ký ức đã duyệt', description: 'Các quy tắc, gotcha, pattern đã được nạp vào recall', tab: 'memory', keywords: 'ky uc da duyet active reviewed recall' },
  { id: 'mem-agent', title: 'Bộ nhớ có cấu trúc (Agent Memory)', description: 'Quản lý theo category, tag, scope toàn cục/local', tab: 'memory', keywords: 'bo nho cau truc structured agent memory' },
  { id: 'mem-zeromem', title: 'Ghi nhớ hoạt động (Zero-Mem)', description: 'Ghi tên tool, file và lỗi của mỗi lượt vào máy, tra lại lúc sau mà không tốn token', tab: 'memory', keywords: 'zeromem ghi nho hoat dong 0 token bo nho lich su' },
  { id: 'data-autobackup', title: 'Tự động sao lưu', description: 'Định kỳ lưu bản sao lưu vào thư mục trên máy', tab: 'data', keywords: 'tu dong sao luu auto backup folder' },
  { id: 'data-backup', title: 'Sao lưu & Phục hồi (.json / .md)', description: 'Xuất hoặc nạp dữ liệu toàn bộ lịch sử chat', tab: 'data', keywords: 'sao luu phuc hoi export import json md backup' },
  { id: 'data-stats', title: 'Thống kê token sử dụng', description: 'Biểu đồ tiêu thụ token và chi phí ước tính', tab: 'data', keywords: 'thong ke token usage stats cost' },
  { id: 'data-storage', title: 'Dung lượng bộ nhớ (Storage Quota)', description: 'Xem phần trăm đã dùng và xin trình duyệt không tự xoá dữ liệu', tab: 'data', keywords: 'storage quota dung luong bo nho eviction persist' },
  { id: 'data-scheduler', title: 'Lịch chạy Recipe (Scheduler)', description: 'Chạy tác vụ định kỳ bằng biểu thức cron', tab: 'data', keywords: 'scheduler cron lich trinh hen gio' },
  { id: 'data-danger', title: 'Vùng nguy hiểm (Xóa dữ liệu)', description: 'Xóa sạch toàn bộ dữ liệu ứng dụng', tab: 'data', keywords: 'vung nguy hiem xoa sach reset clear database' },
  ];

export function resolveSettingsTab(tab?: string): SettingsTab {
  /*
   * Rút gọn từ 10 nhánh `case` còn một kiểm tra — 2026-10-16.
   *
   * Trước đây có nhánh alias cho `chung`, `provider`, `routing`, `tools`,
   * `skills`, `prompts`, `memory`, `stats`, `schedules`, `data`. Phân loại thật:
   * 3 alias còn được gọi, 2 trùng id hiện hành (case là no-op), 5 không ai
   * truyền. Định nghĩa chính thức của id nằm ở `SETTINGS_TABS` ngay trên, nên
   * bảng `case` là bản sao chết của nó — sửa `SETTINGS_TABS` mà quên `case`
   * thì tạo ra ngõ cụt.
   *
   * Lập luận "giữ alias để tương thích ngược" là SAI: `settingsInitialTab`
   * KHÔNG nằm trong `partialize` (`lib/store.ts`) và bị xoá khi đóng Settings,
   * nên nó thuần in-memory, không sống qua reload — không có dữ liệu phiên cũ
   * nào mang khoá cũ tới đây.
   */
  return SETTINGS_TABS.some((t) => t.id === tab) ? (tab as SettingsTab) : 'appearance';
}
