/**
 * Bốn file nhỏ, bốn cái lỗi "nói thành chữ nhưng không đúng".
 *
 * 1. `lib/use-title-generator.ts` — tiêu đề phiên lấy từ tin nhắn ĐÃ bị hệ
 *    thống chèn tiền tố, và bị cắt theo số ký tự nên dán hai câu rời vào một
 *    mảnh vỡ ("Xin chào Trả lời đúng").
 * 2. `components/sidebar.tsx` — badge số "0" trên mọi phiên, không đổi theo
 *    nội dung. Số không có nguồn thì phải bỏ, không được giữ làm trang trí.
 * 3. `components/backup-reminder.tsx` — "Để sau" nhìn như tắt hẳn nhưng thật
 *    ra chỉ giấu 1 ngày, và con số đó không hiện ở đâu cả.
 * 4. `lib/provider-url.ts` — `supportsThinkingLevel` (hằng số luôn
 *    `return false`) đã bị XOÁ cùng đợt dọn 2026-10: route chat giờ chỉ còn
 *    đường `getReasoningCapability` đọc metadata gateway
 *    (`supportsMediaGeneration` đã xoá trước đó cùng lý do).
 *
 * vitest ở đây chạy `environment: 'node'` (vitest.config.mts) nên không render
 * được component: phần UI đọc SOURCE, phần logic gọi hàm thuần. Mọi source
 * đều normalize CRLF → LF trước khi assert (repo bật `core.autocrlf`).
 *
 * Mỗi `it` ghi rõ điều kiện đảo ngược nào làm nó ĐỎ. Không có `it` nào ở đây
 * mà câu hỏi "đổi dòng nào thì nó đỏ" không có câu trả lời.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TITLE, deriveTitle } from '@/lib/use-title-generator';
import { groupChatsByDate } from '@/lib/date-groups';
import { setLastBackupAt, shouldShowReminder, snoozeBackupReminder } from '@/lib/auto-backup';
import type { ChatSession } from '@/lib/db';

const ROOT = path.resolve(__dirname, '..');

/** Đọc source đã normalize CRLF → LF. */
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

const titleSource = read('lib/use-title-generator.ts');
const sidebarSource = read('components/sidebar.tsx');
const reminderSource = read('components/backup-reminder.tsx');

/** Thân một khai báo: từ `decl` tới `nextDecl` kế tiếp SAU đó. */
function body(source: string, decl: string, nextDecl: string): string {
  const start = source.indexOf(decl);
  expect(start, `không tìm thấy mốc: ${decl}`).toBeGreaterThan(-1);
  const end = source.indexOf(nextDecl, start + decl.length);
  expect(end, `không tìm thấy mốc kết thúc: ${nextDecl}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/* ================================================================== */
/* 1. Tiêu đề phiên                                                    */
/* ================================================================== */

describe('deriveTitle — tiêu đề phải là thứ người dùng định nói', () => {
  it('bỏ tiền tố [Chế độ ...] chèn trước lời người dùng', () => {
    // Đổi PREAMBLE_RE trong lib/use-title-generator.ts thành /\[.*?\]/g
    // hoặc bỏ hẳn -> ĐỎ.
    expect(deriveTitle('[Chế độ Boost Worktree] Hãy sửa lỗi đăng nhập')).toBe(
      'Hãy sửa lỗi đăng nhập',
    );
  });

  it('bỏ được nhiều tiền tố nối tiếp', () => {
    // Giữ PREAMBLE_RE nhưng đổi `(?:\[\[^\][\n]{1,160}\]\s*)+` thành
    // `(?:\[\[^\][\n]{1,160}\]\s*)` (một lần, không `+`) -> ĐỎ.
    expect(deriveTitle('[System note] [Cách dùng] Viết unit test')).toBe('Viết unit test');
  });

  it('tiền tố dài hơn bất kỳ hạn mức nào vẫn bị bỏ', () => {
    // Thêm `{1,160}` vào PREAMBLE_RE -> ĐỎ: hạn mức đó tạo ra một bậc thang
    // im lặng, tiền tố dài hơn là lọt.
    const preamble = `[Chế độ Boost Worktree ${'mô tả rất dài '.repeat(20)}]`;
    expect(deriveTitle(`${preamble} Sửa lỗi đăng nhập`)).toBe('Sửa lỗi đăng nhập');
  });

  it('CHỈ bỏ tiền tố ở đầu, không nuốt ngoặc vuông giữa câu', () => {
    // Bỏ neo `^\s*` trong PREAMBLE_RE -> ĐỎ. Ngoặc vuông giữa câu là của
    // người dùng (trích dẫn [1], link [nhãn](url)), không phải tiền tố.
    expect(deriveTitle('Câu hỏi của tôi [Chế độ Boost Worktree] nhé')).toBe(
      'Câu hỏi của tôi Chế độ Boost Worktree nhé',
    );
  });

  it('hai câu riêng không bị dán thành một mảnh vỡ nữa', () => {
    // Đây là lỗi quan sát được: "Xin chào. Trả lời đúng 3 dòng." ra
    // "Xin chào Trả lời đúng". Cắt ở ranh giới câu -> ĐỎ nếu mất firstSentence.
    expect(deriveTitle('Xin chào. Trả lời đúng 3 dòng.')).toBe('Xin chào');
  });

  it('câu một không có dấu kết thúc vẫn ra tiêu đề dùng được', () => {
    expect(deriveTitle('deploy staging')).toBe('deploy staging');
    expect(deriveTitle('Sửa lỗi đăng nhập trên mobile')).toBe('Sửa lỗi đăng nhập trên mobile');
  });

  it('dấu chấm trong số thập phân / tên file KHÔNG phải ranh giới câu', () => {
    // Nới `if (rest === '' || /^\s/.test(rest))` thành luôn cắt -> ĐỎ.
    // Và NOISE_RE nếu bỏ luôn `.` trong từ (đối cứ trả về `[^\p{L}\p{N}\s]+`)
    // -> ĐỎ: `3.5` thành `3 5`, tên file trong tiêu đề đọc như vô lý.
    expect(deriveTitle('Xem file 3.5 rồi báo lỗi ngay')).toBe('Xem file 3.5 rồi báo lỗi ngay');
  });

  it('câu dài không có dấu câu bị cắt ở bội từ, không cắt giữa từ', () => {
    const long = 'hãy giải thích chi tiết vì sao hook useEffect chạy hai lần khi component mount';
    const title = deriveTitle(long);
    // Đổi MAX_TITLE_CHARS, hoặc cắt bằng .slice() trần thay vì trimToWordBoundary -> ĐỎ.
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title).not.toMatch(/[^\s…]$/); // không đuôi bị dính dấu gạch
    const words = title.replace('…', '').trim().split(/\s+/);
    expect(words).toEqual(long.split(/\s+/).slice(0, words.length)); // cắt nguyên từ
  });

  it('chuỗi rỗng / chỉ khoảng trắng / chỉ tiền tố -> tên mặc định', () => {
    // Đổi DEFAULT_TITLE -> ĐỎ.
    expect(deriveTitle('')).toBe(DEFAULT_TITLE);
    expect(deriveTitle('   \n\t ')).toBe(DEFAULT_TITLE);
    expect(deriveTitle('[Chế độ Boost Worktree]')).toBe(DEFAULT_TITLE);
  });

  it('không còn cắt 5 từ rồi cắt 50 ký tự (đường sinh ra mảnh vỡ)', () => {
    // Dòng `words.slice(0, 5).join(' ').slice(0, 50)` của bản cũ là nguyên nhân
    // "Xin chào Trả lời đúng". Hết nó thì đỏ.
    expect(titleSource).not.toMatch(/\.slice\(0,\s*5\)/);
    expect(titleSource).not.toMatch(/\.slice\(0,\s*50\)/);
  });
});

/* ================================================================== */
/* 2. Badge "0" trên sidebar                                          */
/* ================================================================== */

describe('components/sidebar.tsx — không badge số giả', () => {
  const chatItem = body(
    sidebarSource,
    'const ChatItem = memo(function ChatItem({',
    'interface SearchState {',
  );

  it('mỗi phiên không render ô số nào, không riêng số 0', () => {
    // Thêm `<span>{0}</span>` hay `<span>{n}</span>` vào JSX của ChatItem -> ĐỎ.
    expect(chatItem).not.toMatch(/\{0\}/);
    expect(chatItem).not.toMatch(/>\s*\{?\d+\}?\s*</);
  });

  it('cả file không còn biểu thức số 0 nào', () => {
    expect(sidebarSource).not.toMatch(/\{0\}/);
  });

  it('nhóm ngày không mang số đếm để sidebar có cái gì để in ra', () => {
    // Thêm `count` vào DateGroup (lib/date-groups.ts) -> ĐỎ. Đây là nguồn dữ
    // liệu duy nhất mà tiêu đề nhóm trong sidebar đọc.
    const base: ChatSession = {
      id: 'a',
      title: 't',
      pinned: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const groups = groupChatsByDate([base], Date.now());
    expect(groups).toHaveLength(1);
    expect(Object.keys(groups[0]).sort()).toEqual(['chats', 'key', 'label']);
  });

  it('sidebar vẫn còn dư số nút (hợp đồng design-system: > 5)', () => {
    // Dùng lại đúng điều kiện tests/design-system.test.ts:896 nếu thêm badge
    // mới phải chứng minh không làm rơi dưới ngưỡng.
    expect(sidebarSource.split('<button').length - 1).toBeGreaterThan(5);
  });
});

/* ================================================================== */
/* 3. "Để sau" của banner sao lưu                                     */
/* ================================================================== */

const SNOOZE_KEY = 'vyen-backup-snoozed-at';
const LAST_BACKUP_KEY = 'vyen-last-backup-at';
const DAY = 86_400_000;

describe('backup-reminder — bỏ qua được nhớ, và nói ra hạn của nó', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('chưa bỏ qua lần nào thì nhắc', () => {
    expect(shouldShowReminder()).toBe(true);
  });

  it('bấm "Để sau" thì ghi đúng một khoá, và đọc lại được sau reload', () => {
    snoozeBackupReminder(1);
    expect([...store.keys()]).toEqual([SNOOZE_KEY]); // đổi tên khoá ở lib/auto-backup.ts:12 -> ĐỎ
    expect(store.get(SNOOZE_KEY)).toMatch(/^\d+$/);
    // "reload" = một lần đọc mới hoàn toàn, không phụ thuộc state React.
    expect(shouldShowReminder()).toBe(false);
  });

  it('khoá đặt theo quy ước vyen-* của lib/auto-backup.ts', () => {
    snoozeBackupReminder(1);
    expect(SNOOZE_KEY.startsWith('vyen-')).toBe(true);
    expect(LAST_BACKUP_KEY.startsWith('vyen-')).toBe(true);
  });

  it('bỏ qua có hạn, không giấu vĩnh viễn cảnh báo mất dữ liệu', () => {
    snoozeBackupReminder(1);
    expect(shouldShowReminder(Date.now() + 2 * DAY)).toBe(true);
  });

  it('sau khi sao lưu thật thì nhắc hết hạn, đồng thời xoá khoá bỏ qua', () => {
    snoozeBackupReminder(1);
    setLastBackupAt(Date.now());
    expect(store.has(LAST_BACKUP_KEY)).toBe(true);
    expect(store.has(SNOOZE_KEY)).toBe(false);
    expect(shouldShowReminder()).toBe(false);
  });

  it('component chỉ ghi ở nhánh bấm, không ghi mỗi render', () => {
    // Bỏ `const dismiss = () =>` và nhét snoozeBackupReminder vào useEffect
    // hoặc vào thân component -> số lần gọi không còn là 1 -> ĐỎ.
    const calls = reminderSource.match(/snoozeBackupReminder\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);

    const effect = body(reminderSource, 'useEffect(() => {', 'if (!visible) return null;');
    expect(effect).not.toContain('snoozeBackupReminder');

    const dismiss = body(reminderSource, 'const dismiss = () => {', 'const handleBackup');
    expect(dismiss).toContain('snoozeBackupReminder(SNOOZE_DAYS)');
    expect(dismiss).toContain('setVisible(false)');
  });

  it('cả hai lối thoát (nút "Để sau" và nút X) dùng chung dismiss', () => {
    // Đổi một onClick thành `snoozeBackupReminder()` rời -> số lần gọi thành 2 -> ĐỎ.
    expect(reminderSource).toMatch(/onClick=\{dismiss\}[\s\S]{0,160}?Để sau/);
    expect(reminderSource).toMatch(/aria-label="Đóng nhắc nhở"\s+onClick=\{dismiss\}/);
  });

  it('hạn của "Để sau" hiện ra cho người dùng, và lấy từ cùng hằng số', () => {
    // Xoá dòng `<p ...>Để sau chỉ ẩn banner này...` -> ĐỎ.
    expect(reminderSource).toMatch(
      /Để sau chỉ ẩn thông báo này\. Sau \{SNOOZE_DAYS\} ngày chưa sao lưu thì nó hiện lại\./,
    );
    // Sửa SNOOZE_DAYS thành số khác mà quên truyền vào hàm -> ĐỎ.
    expect(reminderSource).not.toMatch(/snoozeBackupReminder\s*\(\s*\)/);
  });
});
