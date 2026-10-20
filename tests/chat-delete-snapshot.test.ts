/**
 * Xoá chat trong khung chat phải dọn CẢ ảnh chụp workspace (`wsSnapshots`).
 *
 * ============ LỖ HỔNG ĐÃ KIỂM CHỨNG (verifier 2026-10-20) ============
 *
 * Bản xoá chat trong khung chat xoá tay `messages` + `chats` mà **KHÔNG** đụng
 * `db.wsSnapshots` ⇒ ảnh chụp của chat bị xoá còn nằm lại (mồ côi).
 *
 * Chuỗi lỗ hổng đầy đủ:
 *   1. Agent ghi file trong chat C ⇒ `saveTurnCapture` lưu ảnh chụp (nội dung
 *      file TRƯỚC khi ghi) cho `chatId = C`.
 *   2. Người dùng bấm "xoá chat" trong khung chat ⇒ chat + messages mất,
 *      **ảnh chụp C còn**.
 *   3. Người dùng nạp lại file sao lưu có đúng chat C (chế độ `merge` — mặc
 *      định của UI) ⇒ chat C được tạo lại.
 *   4. Thanh "Hoàn tác thay đổi của AI" hiện ảnh chụp C ⇒ bấm "Hoàn tác" ⇒
 *      **nội dung file CŨ được ghi đè lên đĩa** (hoặc file chưa tồn tại bị xoá).
 *
 * ============ VÌ SAO TEST Ở MỨC NGUỒN ============
 *
 * Đường xoá nằm giữa một hook React 6.000 dòng (`use-chat-orchestration.ts`) và
 * repo KHÔNG có `fake-indexeddb` (không mở được Dexie thật trong test) ⇒ không
 * dựng được đồ vật giả cho Dexie. Repo đã có tiền lệ: `tests/startup-weight.test.ts`
 * và `tests/cli-migration-scan.test.ts` canh bằng cách đọc mã nguồn — làm vậy
 * ở đây, và kèm một canh hành vi cho `deleteChatCascade` ở `lib/db.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ORCH = readFileSync(
  path.join(process.cwd(), 'react', 'use-chat-orchestration.ts'),
  'utf8',
);
const DB = readFileSync(path.join(process.cwd(), 'lib', 'db.ts'), 'utf8');

describe('xoá chat trong khung chat — không bỏ sót ảnh chụp workspace', () => {
  it('dùng deleteChatCascade (xoá cả messages + chats + wsSnapshots)', () => {
    expect(
      ORCH,
      'đường xoá chat phải dùng deleteChatCascade để dọn cả wsSnapshots',
    ).toContain('deleteChatCascade(currentChatId)');
    expect(
      ORCH,
      'không được xoá chat bằng tay (thiếu wsSnapshots)',
    ).not.toMatch(/db\.chats\.delete\(/);
  });

  it('deleteChatCascade xoá wsSnapshots trong CÙNG transaction', () => {
    const i = DB.indexOf('export async function deleteChatCascade');
    expect(i, 'phải còn deleteChatCascade trong lib/db.ts').toBeGreaterThan(-1);
    const than = DB.slice(i, i + 700);
    expect(than).toContain('db.wsSnapshots');
    expect(than).toContain('delete()');
  });
});
