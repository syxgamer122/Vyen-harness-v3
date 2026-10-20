/**
 * Cửa sổ đọc file — MỘT chỗ cho MỌI đường đọc (CLI, web FSA, desktop, staging).
 *
 * ============ VÌ SAO TÁCH RA FILE RIÊNG ============
 *
 * Trước đây có BA bản cắt cửa sổ, mỗi bản một chỗ:
 *   - `lib/tools/ipc-node.ts` (`applyReadWindow`) — CLI
 *   - `lib/fs-access.ts` (`fsRead`) — web (File System Access API)
 *   - `lib/desktop-fs.ts` (`desktopFsRead`) — desktop bridge
 * và chúng ĐÃ drift: bản web/desktop tính `endLine` bằng `content.split('\n').length`
 * ⇒ file có dấu xuống dòng cuối thì báo dòng **nhiều hơn thực tế** (file 5 dòng
 * bị báo là 6) ⇒ model đọc tiếp `start_line = endLine + 1` ⇒ nhận dòng rỗng rồi
 * lặp. Bản CLI đã sửa đúng chỗ đó; hai bản kia thì chưa.
 *
 * Ba bản cũng **không đọc tiếp được** phần đuôi của một dòng dài hơn trần:
 * cắt ở đúng trần ký tự, dòng bị cắt giữa chừng vẫn bị tính là "1 dòng" ⇒ model
 * gọi `start_line = endLine + 1` ⇒ **phần đuôi của dòng đó không bao giờ được
 * đọc**, và gọi lại `start_line` cũ thì nhận đúng chunk cũ ⇒ lặp tốn token.
 *
 * ============ HỢP ĐỒNG ============
 *
 * - `startChar` = offset ký tự **TUYỆT ĐỐI trong file**; khi có nó thì
 *   `startLine`/`lineCount` bị bỏ qua (đọc đúng `maxChars` ký tự từ offset đó).
 * - Khi kết quả bị cắt, trả kèm `nextStartChar` (offset đọc tiếp) và
 *   `nextStartLine` (dòng chứa offset đó) ⇒ đọc tiếp **KHÔNG mất ký tự nào**.
 * - `endLine` = dòng CUỐI CÙNG **thực sự nằm trong `content`** (dòng bị cắt giữa
 *   chừng vẫn được tính) — đây là điều model tin để phân trang.
 */
/** Trần ký tự cho một lần đọc file — MỘT hằng duy nhất cho mọi đường đọc. */
export const DEFAULT_READ_MAX_CHARS = 24_000;

export interface ReadWindowOptions {
  /** Dòng bắt đầu (1-based). Bỏ qua khi có `startChar`. */
  startLine?: number;
  /** Số dòng cần đọc. */
  lineCount?: number;
  /** Offset ký tự TUYỆT ĐỐI trong file — dùng để đọc tiếp sau khi bị cắt. */
  startChar?: number;
  /** Trần ký tự của một lần đọc. */
  maxChars?: number;
}

export interface ReadWindowResult {
  /** Nội dung đã cắt (≤ `maxChars`). */
  content: string;
  /** Còn dữ liệu phía sau không. */
  truncated: boolean;
  /** Dòng đầu tiên trong `content` (1-based, tuyệt đối trong file). */
  startLine: number;
  /** Dòng cuối cùng thực sự nằm trong `content` (1-based). */
  endLine: number;
  /** Offset ký tự để đọc tiếp — chỉ có khi `truncated`. */
  nextStartChar?: number;
  /** Dòng chứa ký tự tại `nextStartChar` (1-based) — chỉ có khi `truncated`. */
  nextStartLine?: number;
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) n++;
  }
  return n;
}

/**
 * Cắt cửa sổ đọc. `raw` là TOÀN BỘ nội dung file (mọi đường đọc đều đọc hết
 * rồi mới cắt — không đọc kiểu seek, nên trạng thái của hàm là thuần).
 */
export function applyReadWindow(
  raw: string,
  options: ReadWindowOptions = {},
): ReadWindowResult {
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? DEFAULT_READ_MAX_CHARS));
  const lines = raw.split('\n');

  /* Offset tuyệt đối của từng dòng — cần để biết vị trí thật của cửa sổ. */
  const lineStart: number[] = new Array(lines.length);
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStart[i] = off;
    off += lines[i].length + 1;
  }

  const rawStartChar = options.startChar;
  const hasStartChar =
    typeof rawStartChar === 'number' &&
    Number.isFinite(rawStartChar) &&
    rawStartChar > 0;

  if (hasStartChar) {
    const startChar = Math.min(Math.floor(rawStartChar as number), raw.length);
    /* Tìm dòng chứa ký tự tại `startChar` (nhị phân trên `lineStart`). */
    let lo = 0;
    let hi = lines.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStart[mid] <= startChar) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const content = raw.slice(startChar, startChar + maxChars);
    const newlines = countNewlines(content);
    const endsNl = content.endsWith('\n');
    const startLine = idx + 1;
    const truncated = startChar + content.length < raw.length;
    return {
      content,
      truncated,
      startLine,
      endLine: startLine + newlines - (endsNl ? 1 : 0),
      ...(truncated
        ? {
            nextStartChar: startChar + content.length,
            nextStartLine: startLine + newlines,
          }
        : {}),
    };
  }

  const start = Math.max(1, Math.floor(options.startLine ?? 1));
  const end = options.lineCount ? start + Math.floor(options.lineCount) - 1 : lines.length;
  const selected = lines.slice(start - 1, end);
  const joined = selected.join('\n');
  const content = joined.length > maxChars ? joined.slice(0, maxChars) : joined;
  const newlines = countNewlines(content);
  const endsNl = content.endsWith('\n');
  const truncated = end < lines.length || joined.length > maxChars;
  const base = lineStart[start - 1] ?? 0;
  return {
    content,
    truncated,
    startLine: start,
    /* Dòng cuối thực sự nằm trong `content` (dòng bị cắt giữa chừng vẫn tính). */
    endLine: start + newlines - (endsNl ? 1 : 0),
    ...(truncated
      ? {
          nextStartChar: base + content.length,
          nextStartLine: start + newlines,
        }
      : {}),
  };
}
