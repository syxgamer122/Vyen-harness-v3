/**
 * `fs_read` phải đọc được TRỌN phần đuôi của một dòng dài hơn trần 24.000 ký tự.
 *
 * ============ LỖI ĐÃ KIỂM CHỨNG ============
 *
 * `applyReadWindow` cắt nội dung ở đúng trần ký tự, rồi tính `endLine` từ phần
 * **đã cắt** ⇒ dòng bị cắt giữa chừng vẫn bị tính là "1 dòng". Model làm đúng
 * hướng dẫn trong mô tả tool ("gọi lại với `start_line` lớn hơn") ⇒ gọi
 * `start_line = endLine + 1` ⇒ **phần đuôi của dòng đó không bao giờ được đọc**.
 * Gọi lại `start_line` cũ thì nhận đúng 24.000 ký tự cũ ⇒ lặp vô ích, tốn token.
 *
 * Đo (probe trên hàm production): file một dòng 50.000 ký tự ⇒ lần 1 trả
 * 24.000 ký tự, `endLine = 2`; lần 2 (`start_line=3`) trả về "line3" ⇒ mất
 * 26.006 ký tự không bao giờ đọc được.
 *
 * ============ CÁCH SỬA ============
 *
 * Thêm tham số `start_char` = **offset ký tự tuyệt đối trong file**. Khi kết quả
 * bị cắt, công cụ trả kèm `nextStartChar` (offset đọc tiếp) ⇒ đọc tiếp KHÔNG
 * mất ký tự nào, và không cần đoán "dòng lớn hơn là bao nhiêu".
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeHost, buildIpcTools } from '@/lib/tools/ipc-node';

type Tools = Record<string, { execute: (a: unknown) => Promise<Record<string, unknown>> }>;

/** Trần ký tự của một lần đọc — hợp đồng công khai của `fs_read`. */
const TRAN = 24_000;

function mk() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vyen-longline-'));
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

/** Nội dung mà mỗi ký tự suy ra được vị trí của nó (để biết đọc đúng chỗ). */
function noiDungNgan(doDai: number): string {
  return Array.from({ length: doDai }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
}

describe('fs_read — đọc tiếp không mất ký tự nào của dòng dài', () => {
  it('đọc tiếp bằng start_char ⇒ nối lại đúng bằng toàn bộ file', async () => {
    const { dir, tools, cleanup } = mk();
    try {
      const dong = noiDungNgan(50_000);
      writeFileSync(path.join(dir, 'min.txt'), dong, 'utf8');

      let doc = '';
      let offset: number | undefined;
      let lan = 0;
      for (;;) {
        const out = await tools.fs_read.execute(
          offset === undefined ? { path: 'min.txt' } : { path: 'min.txt', start_char: offset },
        );
        doc += String(out.content);
        lan += 1;
        if (!out.truncated) break;
        expect(typeof out.nextStartChar, 'khi bị cắt phải nói đọc tiếp từ đâu').toBe('number');
        offset = out.nextStartChar as number;
        expect(lan, 'phải đọc được bằng số lần lớp vừa đủ').toBeLessThan(10);
      }

      expect(doc.length, 'không được mất ký tự nào').toBe(dong.length);
      expect(doc).toBe(dong);
      expect(lan, '50.000 ký tự / trần 24.000 ⇒ cần 3 lần đọc').toBe(3);
    } finally {
      cleanup();
    }
  });

  it('lần đọc thứ hai lấy đúng phần TIẾP THEO (không đọc lại, không đọc hụt)', async () => {
    const { dir, tools, cleanup } = mk();
    try {
      const dong = noiDungNgan(50_000);
      writeFileSync(path.join(dir, 'min.txt'), dong, 'utf8');

      const lan1 = await tools.fs_read.execute({ path: 'min.txt' });
      expect(String(lan1.content)).toBe(dong.slice(0, TRAN));

      const lan2 = await tools.fs_read.execute({
        path: 'min.txt',
        start_char: lan1.nextStartChar,
      });
      expect(String(lan2.content)).toBe(dong.slice(TRAN, TRAN * 2));
    } finally {
      cleanup();
    }
  });

  it('phân trang theo DÒNG cũ vẫn y hệt (không phá hợp đồng cũ)', async () => {
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
});
