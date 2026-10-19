/**
 * `fs_read` của CLI phải nói cho model biết **đọc tiếp từ đâu**.
 *
 * ============ VÌ SAO ============
 *
 * Mô tả tool (`lib/agent-tools.ts`) bảo model: *"đọc tiếp bằng cách gọi lại với
 * `start_line` lớn hơn"*. Nhưng nếu kết quả không nói nó dừng ở dòng nào thì
 * "lớn hơn" là bao nhiêu? Model đoán ⇒ đọc lại trùng hoặc đọc hụt ⇒ tốn tiền mà
 * không tiến. Với file > 24.000 ký tự (nguồn lớn, lockfile, log) thì đây là
 * **mọi lượt**, không phải hiếm gặp.
 *
 * Bản web đã làm đúng: `lib/fs-access.ts:410-417` trả
 * `{path, content, truncated, size, startLine, endLine}`. CLI trả
 * `{content, size, truncated}` ⇒ thiếu `path`, `startLine`, `endLine`.
 *
 * ============ `endLine` PHẢI LÀ DÒNG CUỐI THẬT SỰ ĐÃ TRẢ ============
 *
 * Tính `endLine` từ phần **đã cắt**, không từ phần chưa cắt — nếu không, model đọc
 * `endLine` rồi báo "đã đọc tới dòng N" trong khi `content` dừng ở dòng M (M < N).
 * Đây đúng là lỗi mà comment ở `lib/fs-access.ts:404-408` đã cảnh báo.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeHost, buildIpcTools } from '@/lib/tools/ipc-node';

type Tools = Record<string, { execute: (a: unknown) => Promise<Record<string, unknown>> }>;

function mk() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vyen-read-'));
  const userData = mkdtempSync(path.join(tmpdir(), 'vyen-ud-'));
  const host = createNodeHost({ workspaceRoot: dir, userDataDir: userData });
  const tools = buildIpcTools(host, { approve: async () => true }) as Tools;
  return {
    dir,
    tools,
    cleanup: () => {
      host.dispose();
      rmSync(dir, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

describe('fs_read — nói model đọc tiếp từ đâu', () => {
  it('trả path, startLine và endLine', async () => {
    const { dir, tools, cleanup } = mk();
    try {
      writeFileSync(path.join(dir, 'lon.txt'), 'd1\nd2\nd3\nd4\nd5\n', 'utf8');
      const out = await tools.fs_read.execute({ path: 'lon.txt' });
      expect(out.path).toBe('lon.txt');
      expect(out.startLine).toBe(1);
      expect(out.endLine).toBe(5);
    } finally {
      cleanup();
    }
  });

  it('cửa sổ dòng thì startLine/endLine bám theo cửa sổ', async () => {
    const { dir, tools, cleanup } = mk();
    try {
      writeFileSync(path.join(dir, 'lon.txt'), 'd1\nd2\nd3\nd4\nd5\n', 'utf8');
      const out = await tools.fs_read.execute({ path: 'lon.txt', start_line: 2, line_count: 2 });
      expect(out.startLine).toBe(2);
      expect(out.endLine).toBe(3);
      expect(out.content).toBe('d2\nd3');
    } finally {
      cleanup();
    }
  });

  it('file bị cắt trần ký tự thì endLine là dòng CUỐI THẬT SỰ đã trả', async () => {
    const { dir, tools, cleanup } = mk();
    try {
      // 5.000 dòng × 10 ký tự = 50.000 ký tự ⇒ vượt trần 24.000 ⇒ bị cắt.
      const dong = Array.from({ length: 5_000 }, (_, i) => `d${i}`.padEnd(10, ' '));
      writeFileSync(path.join(dir, 'lon.txt'), dong.join('\n'), 'utf8');
      const out = await tools.fs_read.execute({ path: 'lon.txt' });
      expect(out.truncated).toBe(true);
      // endLine PHẢI nhỏ hơn tổng số dòng — nếu bằng thì model tưởng đã đọc hết
      // file rồi đọc lại từ đó ⇒ vòng lặp tốn tiền.
      expect(out.endLine).toBeLessThan(5_000);
      expect(out.endLine).toBeGreaterThan(1);
    } finally {
      cleanup();
    }
  });
});
