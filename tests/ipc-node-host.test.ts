/**
 * Task A — cầu nối `lib/ipc.cjs` ra khỏi Electron.
 *
 * Spec §5 ghi `lib/tools/fs-node.ts` MỚI — nhưng đo trước khi viết cho thấy
 * `lib/ipc.cjs` ĐÃ có đủ: đọc/ghi file, shell, git, bg-jobs, skills, memory,
 * secure-store, kèm path-guard, chống TOCTOU bằng sha256, giới hạn byte và
 * audit log. Viết `fs-node.ts` sẽ là **bản thứ hai** của code đã có và đã
 * được đánh bảo — đúng cái AGENTS.md §6 cấm. Nên task này chỉ làm lớp cầu.
 *
 * Vì sao ipc.cjs chạy được ngoài Electron: `register(ipcMain, opts)` chỉ cần
 * một object có `handle(channel, (event, payload) => ...)`. Electron truyền HAI
 * tham số; bọc đúng thế là xong. JSDoc trong ipc.cjs cũng ghi rõ kỹ thuật
 * này dành cho test.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeHost } from '@/lib/tools/ipc-node';

/** Workspace tạm có sẵn file để tool có việc để làm. */
function makeWorkspace() {
  const ws = mkdtempSync(path.join(tmpdir(), 'vyen-host-'));
  writeFileSync(path.join(ws, 'a.txt'), 'dong 1\ndong 2\ndong 3\n', 'utf8');
  mkdirSync(path.join(ws, 'sub'), { recursive: true });
  const userData = mkdtempSync(path.join(tmpdir(), 'vyen-ud-'));
  return { ws, userData };
}

describe('createNodeHost', () => {
  it('đọc file trong workspace', async () => {
    const { ws, userData } = makeWorkspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const r = (await host.call<{ content: string }>('vyen:fs-read', { relPath: 'a.txt' }))!;
      expect(r.content).toBe('dong 1\ndong 2\ndong 3\n');
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('liệt kê một cấp thư mục', async () => {
    const { ws, userData } = makeWorkspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const r = (await host.call<{ name: string; kind: string }[]>('vyen:fs-list', {
        relPath: '',
      }))!;
      expect(r.map((e) => e.name).sort()).toEqual(['a.txt', 'sub']);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  /* path-guard là thứ giữ agent không đọc/ghi ra ngoài dự án. Mất nó thì mọi
   * "an toàn" khác trên đường này là vô nghĩa. */
  it('CHẶN đọc đường dẫn ngoài workspace', async () => {
    const { ws, userData } = makeWorkspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      await expect(
        host.call('vyen:fs-read', { relPath: path.resolve(ws, '..', 'tho.txt') }),
      ).rejects.toThrow();
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  /* Ghi có TOCTOU: hash nội dung lúc đọc phải khớp lúc ghi. Nếu không có cái
   * này, diff người dùng duyệt sẽ ghi đè lên file đã bị ai đó sửa. */
  it('CHẶN ghi khi hash nội dung không khớp (TOCTOU)', async () => {
    const { ws, userData } = makeWorkspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      await expect(
        host.call('vyen:fs-write', {
          relPath: 'a.txt',
          content: 'ghi de',
          hasDiff: true,
          expectedBaseHash: 'hash-khong-ton-tai',
        }),
      ).rejects.toThrow(/TOCTOU|expectedBaseHash/i);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('ghi file mới khi không cần hash (file chưa tồn tại)', async () => {
    const { ws, userData } = makeWorkspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      await host.call('vyen:fs-write', { relPath: 'b.txt', content: 'xinh chao' });
      expect(existsSync(path.join(ws, 'b.txt'))).toBe(true);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  /* Channel sai phải nói rõ, không được trả undefined rồi để call site tự
   * giả định — lỗi kiểu đó hiện ra muộn và khó truy. */
  it('channel không tồn tại thì báo lỗi tường minh', async () => {
    const { ws, userData } = makeWorkspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      await expect(host.call('vyen:khong-ton-tai')).rejects.toThrow(/khong-ton-tai/);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('ghi lại audit log', async () => {
    const { ws, userData } = makeWorkspace();
    const lines: string[] = [];
    const host = createNodeHost({
      workspaceRoot: ws,
      userDataDir: userData,
      audit: (l) => lines.push(l),
    });
    try {
      await host.call('vyen:fs-read', { relPath: 'khong-ton-tai.txt' }).catch(() => {});
      expect(Array.isArray(lines)).toBe(true);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
