/**
 * Nạp sao lưu kiểu "ghi đè" phải xoá CẢ ảnh chụp workspace (`wsSnapshots`).
 *
 * ============ VÌ SAO ============
 *
 * `importBackup` (lib/backup.ts) ở nhánh `overwrite` chỉ xoá `messages` và
 * `chats`. Nhưng `db.wsSnapshots` là bảng ảnh chụp trạng thái file TRƯỚC khi
 * agent ghi (dùng để "khôi phục"), gắn theo `chatId`. Giữ lại ⇒ các ảnh chụp
 * cũ vẫn khớp `chatId` của chat vừa nạp ⇒ thao tác "Khôi phục" có thể ghi
 * nội dung file CŨ xuống đĩa người dùng.
 *
 * Test dùng db giả (`vi.mock`) vì repo không có `fake-indexeddb` ⇒ không mở
 * được Dexie thật trong test.
 */
import { describe, expect, it, vi } from 'vitest';

const cleared = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/db', () => {
  const mkTable = (ten: string) => ({
    clear: async () => {
      cleared.push(ten);
    },
    put: async () => {},
    bulkPut: async () => {},
    toCollection: () => ({ primaryKeys: async () => [] }),
  });
  return {
    db: {
      /* Dexie transaction: chạy hàm cuối cùng. */
      transaction: async (...args: unknown[]) => {
        const fn = args[args.length - 1] as () => Promise<void>;
        return fn();
      },
      chats: mkTable('chats'),
      messages: mkTable('messages'),
      wsSnapshots: mkTable('wsSnapshots'),
    },
  };
});

import { importBackup } from '@/lib/backup';

function tepSaoLuu(): File {
  const noiDung = {
    format: 'vyen-backup',
    version: 1,
    exportedAt: Date.now(),
    app: 'vyen',
    chats: [],
    messages: [],
  };
  return new File([JSON.stringify(noiDung)], 'sao-luu.json', {
    type: 'application/json',
  });
}

describe('nạp sao lưu kiểu ghi đè', () => {
  it('xoá cả ảnh chụp workspace, không chỉ messages và chats', async () => {
    cleared.length = 0;
    await importBackup(tepSaoLuu(), 'overwrite');
    expect(cleared).toContain('messages');
    expect(cleared).toContain('chats');
    expect(cleared, 'ảnh chụp workspace cũ phải bị xoá').toContain('wsSnapshots');
  });

  it('kiểu gộp thì KHÔNG xoá gì (không phá dữ liệu người dùng)', async () => {
    cleared.length = 0;
    await importBackup(tepSaoLuu(), 'merge');
    expect(cleared).toEqual([]);
  });
});
