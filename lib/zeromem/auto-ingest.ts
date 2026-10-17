/**
 * Ghi tự động hoạt động của lượt vào kho Zero-Mem (2026-10-16).
 *
 * VÌ SAO CHỈ GHI HOẠT ĐỘNG, KHÔNG GHI NGUYÊN VĂN:
 * kết quả tool **không còn bản đầy đủ ở đâu cả** — cắt 24k khi lên model
 * (`lib/tool-limits.ts`), 24k khi ghi Dexie (`lib/db.ts`), 4k khi vào annotation.
 * Nên "ghi mọi thứ" về mặt kỹ thuật cũng chỉ ghi được phần đã cắt, trong khi
 * tin nhắn người dùng thì toàn văn và dài nhất. Trace của ta là **một dòng cô
 * đọng mỗi lần hoạt động**: tên tool, đích, kết quả, mã lỗi. Phần lớt giá trị
 * truy hồi nằm ở định danh (tên file, symbol, mã lỗi) — mà định danh không dấu
 * nên BM25 không bị lệch. Đây là LỰA CHỌN CỦA TÔI, ghi ở PLAN.md §17.
 *
 * QUY TẮC AN TOÀN:
 * 1. Chỉ chạy khi `settings.zeromemEnabled` bật — mặc định TẮT.
 * 2. Tôn trọng `toolPermissions['memory'] === 'deny'`: ghi tự động không đi qua
 *    bảng quyền nên nếu không tự kiểm, nhóm memory bị chặn vẫn ghi thầm.
 * 3. Dữ liệu lấy từ kết quả **đã redact** trong `executeClientToolCall`, không
 *    đọc lại dữ liệu thô: `redactSecretText` bỏ qua bí mật ngắn hơn 8 ký tự.
 * 4. Không được ném — ghi bộ nhớ lỗi thì lượt chat vẫn phải chạy bình thường.
 */
import { redactSecretText } from '@/lib/secret-registry';
import { ZeroMemStore } from './store';
import { markZeroMemDirty } from './persistence';

/** Một dòng hoạt động đã cô đọng, chưa ghi. */
export interface ZeroMemActivity {
  toolName: string;
  /** Đích: path/command, đã rút gọn. */
  target?: string;
  /** true nếu tool thất bại. */
  failed?: boolean;
  /** Tóm tắt kết quả đã cắt (phải là output ĐÃ redact). */
  summary?: string;
}

/** Trần độ dài một dòng hoạt động — tránh trace phình to. */
export const ACTIVITY_LINE_MAX_CHARS = 200;

/** Chiết một dòng hoạt động thành văn bản cô đọng, có che bí mật. */
export function formatActivityLine(activity: ZeroMemActivity): string {
  const parts = [activity.toolName];
  if (activity.target) parts.push(`-> ${activity.target}`);
  parts.push(activity.failed ? 'FAILED' : 'ok');
  if (activity.summary) parts.push(activity.summary);
  const line = parts.join(' ');
  return redactSecretText(line).slice(0, ACTIVITY_LINE_MAX_CHARS);
}

/** Rút gọn đích: path dài thì chỉ giữ đuôi, command thì cắt đầu. */
export function normalizeActivityTarget(target: string | undefined): string | undefined {
  if (!target) return undefined;
  const trimmed = target.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 80) return trimmed;
  // Giữ phần CUỐI với đường dẫn dài (đuôi mang thông tin nhất) và phần ĐẦU với
  // lệnh dài (lệnh đầu quyết định nó làm gì).
  return trimmed.includes('/') || trimmed.includes('\\')
    ? `...${trimmed.slice(-77)}`
    : `${trimmed.slice(0, 77)}...`;
}

export interface AutoIngestOptions {
  /** settings.zeromemEnabled */
  enabled: boolean;
  /** toolPermissions['memory'] — 'deny' thì không ghi gì. */
  memoryPermission?: string;
  sessionId: string;
  activities: ZeroMemActivity[];
}

/**
 * Ghi một lượt vào kho. Trả về số trace đã thêm (0 = không ghi gì).
 * Không ném lỗi — bộ nhớ lỗi không được làm hỏng lượt chat.
 */
export function autoIngestTurn(
  store: ZeroMemStore,
  options: AutoIngestOptions,
): number {
  try {
    if (!options.enabled) return 0;
    if (options.memoryPermission === 'deny') return 0;
    if (options.activities.length === 0) return 0;

    /* Đếm trace THỰC SỰ ghi, không đếm số hoạt động đưa vào. Hook dùng số này
       để biết có nên đánh dấu lượt "đã ingest" hay không — trả số hoạt động
       khiến lượt có dòng rỗng bị coi như đã ghi và mất vĩnh viễn. */
    let written = 0;
    for (const activity of options.activities) {
      const line = formatActivityLine({
        ...activity,
        target: normalizeActivityTarget(activity.target),
      });
      if (!line) continue;
      store.appendTrace({
        sessionId: options.sessionId,
        role: 'tool',
        content: line,
        toolName: activity.toolName,
      });
      written += 1;
    }
    if (written === 0) return 0;
    markZeroMemDirty();
    return written;
  } catch {
    // Bộ nhớ là tối ưu: hỏng thì lượt chat vẫn phải chạy.
    return 0;
  }
}