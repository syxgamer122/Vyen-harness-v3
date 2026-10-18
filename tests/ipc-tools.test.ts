/**
 * Tool thật cho CLI: schema lấy từ `CLIENT_TOOL_DEFS`, thực thi đi qua
 * `lib/ipc.cjs`.
 *
 * ============ VÌ SAO TÁI DÙNG SCHEMA ============
 *
 * Schema của tool (`description` + tham số) đã được viết và kiểm thử ở
 * `lib/agent-tools.ts`, và model đã quen dùng đúng những câu mô tả đó. Viết
 * lại schema ở đây là tạo bản thứ hai — lần này lệch phí liên tục mà không ai
 * biết. Nên: mượn schema, chỉ thêm `execute`.
 *
 * ============ CỔNG DUYỆT ============
 *
 * spec §7: `fs_write`, `fs_edit`, `shell_run` phải hỏi xác nhận trước — "thứ
 * người dùng tin CLI nhất, bỏ là mất niềm tin". Ở web, việc này do UI đảm
 * nhiệm; ở CLI không có UI nên phải hỏi ở tầng này.
 *
 * Cổng duyệt là **tham số truyền vào**, không phải import Dexie. Nhờ vậy
 * module này không phụ thuộc `db.ts`, nên xây được trước cả khi thay `db.ts`.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeHost, buildIpcTools } from '@/lib/tools/ipc-node';

function workspace() {
  const ws = mkdtempSync(path.join(tmpdir(), 'vyen-tools-'));
  writeFileSync(path.join(ws, 'a.txt'), 'dong 1\ndong 2\n', 'utf8');
  return { ws, userData: mkdtempSync(path.join(tmpdir(), 'vyen-ud-')) };
}

describe('buildIpcTools', () => {
  it('mọi tool đều có description và schema lấy từ CLIENT_TOOL_DEFS', () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const tools = buildIpcTools(host, { approve: async () => true });
      // Tool nào không có mô tả thì model không biết dùng để làm gì.
      const mo = Object.entries(tools)
        .filter(([, t]) => !(t as { description?: string }).description)
        .map(([n]) => n);
      expect(mo, `tool thieu description: ${mo.join(', ')}`).toEqual([]);
      expect(Object.keys(tools)).toContain('fs_read');
      expect(Object.keys(tools)).toContain('fs_list');
      expect(Object.keys(tools)).toContain('fs_search');
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('gọi `fs_read` thật sự đọc file qua ipc.cjs', async () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const tools = buildIpcTools(host, { approve: async () => true }) as Record<
        string,
        { execute: (a: unknown) => Promise<unknown> }
      >;
      const out = (await tools.fs_read.execute({ path: 'a.txt' })) as { content: string };
      expect(out.content).toBe('dong 1\ndong 2\n');
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  /* CỔNG DUYỆT — phần quan trọng nhất của task này. */
  it('tool nguy hiểm KHÔNG chạy khi chưa được duyệt', async () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const tools = buildIpcTools(host, { approve: async () => false }) as Record<
        string,
        { execute: (a: unknown) => Promise<unknown> }
      >;
      await expect(tools.fs_write.execute({ path: 'b.txt', content: 'x' })).rejects.toThrow(
        /duyệt|duyet|cho phep|khong duoc phep/i,
      );
      // Quan trọng: KHÔNG được tạo file.
      expect(() => readFileSync(path.join(ws, 'b.txt'), 'utf8')).toThrow();
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('tool nguy hiểm chạy khi ĐÃ được duyệt', async () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const seen: string[] = [];
      const tools = buildIpcTools(host, {
        approve: async (t) => {
          seen.push(t);
          return true;
        },
      }) as Record<string, { execute: (a: unknown) => Promise<unknown> }>;
      await tools.fs_write.execute({ path: 'b.txt', content: 'duoc phep' });
      expect(seen).toContain('fs_write');
      expect(readFileSync(path.join(ws, 'b.txt'), 'utf8')).toBe('duoc phep');
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  /* Tool chỉ đọc thì hỏi cũng vô nghĩa — hỏi mọi lúc biến "duyệt" thành thói
   * quen và người dùng bấm "có" mà không đọc. */
  it('tool CHỈ ĐỌC không hỏi duyệt', async () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const asked: string[] = [];
      const tools = buildIpcTools(host, {
        approve: async (t) => {
          asked.push(t);
          return true;
        },
      }) as Record<string, { execute: (a: unknown) => Promise<unknown> }>;
      await tools.fs_read.execute({ path: 'a.txt' });
      expect(asked, `hỏi cả tool chỉ đọc: ${asked.join(', ')}`).toEqual([]);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('lỗi từ ipc.cjs phải nêu được tên tool, không trả về undefined', async () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const tools = buildIpcTools(host, { approve: async () => true }) as Record<
        string,
        { execute: (a: unknown) => Promise<unknown> }
      >;
      await expect(tools.fs_read.execute({ path: 'khong-ton-tai.txt' })).rejects.toThrow(
        /khong-ton-tai|fs_read/,
      );
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
