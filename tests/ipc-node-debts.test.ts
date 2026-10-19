/**
 * Ba nợ còn lại từ review độc lập, gộp lại vì cùng một tầng và cùng một lý do:
 * cả ba đều là **khoảng hở an toàn**, không phải thiếu tiện nghi.
 *
 * 1. `fs_edit` chưa tồn tại → model thấy mô tả nhưng gọi không được.
 * 2. `fs_write` ghi đè file tồn tại không bắt buộc `expectedBaseHash`, nên chống
 *    TOCTOU của `ipc.cjs` **không tự bật**: diff người dùng duyệt có thể ghi đè lên
 *    file đã bị ai đó sửa sau lúc đọc.
 * 3. `audit` mặc định là hàm rỗng → CLI mất vết ghi ngay từ mặc định.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeHost, buildIpcTools, hostAuditLogPath } from '@/lib/tools/ipc-node';

type Tools = Record<string, { execute: (a: unknown) => Promise<Record<string, unknown>> }>;

/** Workspace tạm + userData. Mỗi test tự dọn trong `finally`. */
function mk() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vyen-debt-'));
  writeFileSync(path.join(dir, 'a.txt'), 'dong 1\ndong 2\ndong 3\n', 'utf8');
  const userData = mkdtempSync(path.join(tmpdir(), 'vyen-ud-'));
  const cleanup = () => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  };
  const tools = (approve: (t: string) => Promise<boolean> = async () => true): Tools => {
    const host = createNodeHost({ workspaceRoot: dir, userDataDir: userData });
    (tools as unknown as { host?: unknown }).host = host;
    return buildIpcTools(host, { approve }) as Tools;
  };
  const hostOf = () => (tools as unknown as { host: { dispose(): void } }).host;
  return { dir, userData, tools, hostOf, cleanup };
}

/* ============ NỢ 1 — fs_edit ============ */

describe('fs_edit — áp khối SEARCH/REPLACE', () => {
  it('thay đúng khối trong file', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      await tools().fs_edit.execute({
        path: 'a.txt',
        blocks: '<<<<<<< SEARCH\ndong 2\n=======\nDONG HAI\n>>>>>>> REPLACE',
      });
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('dong 1\nDONG HAI\ndong 3\n');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  /* SEARCH không khớp phải NÓM chứ không im lặng ghi đè — đó là cách mất dữ liệu
   * kinh điển, và `ApplyResult` có sẵn trường `hint` để nói cho model biết sửa lại. */
  it('SEARCH không khớp thì TỪ CHỐI và file không đổi', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      await expect(
        tools().fs_edit.execute({
          path: 'a.txt',
          blocks: '<<<<<<< SEARCH\nkhong ton tai trong file\n=======\nX\n>>>>>>> REPLACE',
        }),
      ).rejects.toThrow();
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('dong 1\ndong 2\ndong 3\n');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  it('SEARCH khớp NHIỀU chỗ thì từ chối — không đoán chỗ nào', async () => {
    const { dir, userData, cleanup } = mk();
    try {
      writeFileSync(path.join(dir, 'dup.txt'), 'x\nx\n', 'utf8');
      const host = createNodeHost({ workspaceRoot: dir, userDataDir: userData });
      const t = buildIpcTools(host, { approve: async () => true }) as Tools;
      await expect(
        t.fs_edit.execute({
          path: 'dup.txt',
          blocks: '<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE',
        }),
      ).rejects.toThrow();
      host.dispose();
    } finally {
      cleanup();
    }
  });

  it('nhiều khối trong một lần gọi', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      await tools().fs_edit.execute({
        path: 'a.txt',
        blocks:
          '<<<<<<< SEARCH\ndong 1\n=======\nMOT\n>>>>>>> REPLACE\n' +
          '<<<<<<< SEARCH\ndong 3\n=======\nBA\n>>>>>>> REPLACE',
      });
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('MOT\ndong 2\nBA\n');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  it('fs_edit phải HỎI DUYỆT như fs_write', async () => {
    const { dir, userData, cleanup } = mk();
    try {
      const host = createNodeHost({ workspaceRoot: dir, userDataDir: userData });
      const asked: string[] = [];
      const t = buildIpcTools(host, {
        approve: async (tool) => {
          asked.push(tool);
          return true;
        },
      }) as Tools;
      await t.fs_edit.execute({
        path: 'a.txt',
        blocks: '<<<<<<< SEARCH\ndong 1\n=======\nZ\n>>>>>>> REPLACE',
      });
      expect(asked).toContain('fs_edit');
      host.dispose();
    } finally {
      cleanup();
    }
  });
});

/* ============ NỢ 2 — chống TOCTOU tự bật ============ */

describe('fs_write ghi đè file tồn tại thì phải kèm hash lúc đọc', () => {
  it('đọc rồi ghi: hash được truyền lại nên ghi thành công', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      await t.fs_read.execute({ path: 'a.txt' });
      await t.fs_write.execute({ path: 'a.txt', content: 'sua' });
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('sua');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  /* Cốt lõi: file BỊ ĐỔI sau lúc đọc thì ghi phải bị chặn. `ipc.cjs` có máy bắt,
   * nhưng máy chỉ chạy khi caller gửi `expectedBaseHash` — không gửi thì máy
   * không bao giờ chạy, tức lớp bảo vệ có sẵn bị bỏ không. */
  it('file bị đổi NGOÀI chương trình sau lúc đọc thì ghi bị chặn', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      await t.fs_read.execute({ path: 'a.txt' });
      writeFileSync(path.join(dir, 'a.txt'), 'NHAU BI DOI\n', 'utf8');
      await expect(t.fs_write.execute({ path: 'a.txt', content: 'de che' })).rejects.toThrow(
        /TOCTOU|thay doi/i,
      );
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('NHAU BI DOI\n');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  /* ĐÂY LÀ TEST QUYẾT ĐỊNH, và nó ĐỎ trên bản sửa đầu tiên của tôi.
   *
   * ============ VÌ SAO KHÔNG CÒN "GIAO ĐỒ CỦA AI ĐÃ BỊ GHI ĐÈ" ============
   *
   * Đo 2026-10-19: `fs_edit` **đọc lại** file rồi áp khối lên nội dung hiện tại,
   * nên thay đổi của người khác **được giữ**. Reviewer lần trước nói "ghi đè mất
   * nội dung mới" là sai về mặt sự kiện — và tôi đã bác bỏ bằng đo.
   *
   * ============ NHƯNG CÁI ĐÚNG LÀ HÀNH ĐỘNG KHÔNG ĐƯỢC PHÉP ============
   *
   * Người dùng duyệt một diff dựa trên H0. Nếu file đã đổi thành H1 rồi ta ghi,
   * thì thứ thật sự bị ghi đè là **phần người dùng đã duyệt**. Không mất dữ liệu
   * của người khác, nhưng lỡ một thao tác mà họ không hề thấy — đúng cái mà cổng
   * duyệt sinh ra để chặn.
   *
   * ============ VÀ BẢN SỬA ĐẦU CỦA TÔI KHÔNG BẮT ĐƯỢC ============
   *
   * Tôi ghi `hashes.set(path, sha256(noiDungVuaDoc))` ở lần đọc nội bộ. Vậy là
   * **ghi đè H0 bằng H1**, rồi phép so thành H1 với H1 ⇒ **qua**. Lớp bảo vệ có
   * vẻ mà không chặn đúng ca nó sinh ra để chặn.
   *
   * Cách đúng: chỉ ghi hash khi chưa có, tức giữ lại H0 để phép so thấy khác biệt.
   */
  it('fs_edit phải CHẶN khi file đổi sau lần đọc — nội dung đã duyệt không được ghi đè', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      // Người dùng đọc a.txt — đây là H0, cơ sở của cái họ sẽ duyệt.
      await t.fs_read.execute({ path: 'a.txt' });
      // Có người sửa file ngoài phiên (IDE tự lưu, git checkout, agent khác…).
      writeFileSync(path.join(dir, 'a.txt'), 'dong 1\nNGUOI KHAC SUA\ndong 3\n', 'utf8');
      await expect(
        t.fs_edit.execute({
          path: 'a.txt',
          blocks: '<<<<<<< SEARCH\ndong 1\n=======\nDONG MOT\n>>>>>>> REPLACE',
        }),
      ).rejects.toThrow(/TOCTOU|thay doi/i);
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  /* Ngược lại: chưa từng đọc thì không có H0 để so — `fs_edit` vẫn phải chạy được,
   * không phải vì "đúng" mà vì không có gì để đối chiếu. */
  it('fs_edit khi CHƯA từng đọc thì vẫn chạy — không có gì để so', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      await tools().fs_edit.execute({
        path: 'a.txt',
        blocks: '<<<<<<< SEARCH\ndong 2\n=======\nHAI\n>>>>>>> REPLACE',
      });
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('dong 1\nHAI\ndong 3\n');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  /* Đọc xong rồi sửa mà không ai đụng vào — phải qua, nếu không lớp bảo vệ chặn
   * nhầm mọi lần sửa bình thường. */
  it('đọc xong rồi sửa, không ai đổi file thì CHẠY ĐƯỢC', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      await t.fs_read.execute({ path: 'a.txt' });
      await t.fs_edit.execute({
        path: 'a.txt',
        blocks: '<<<<<<< SEARCH\ndong 2\n=======\nHAI\n>>>>>>> REPLACE',
      });
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('dong 1\nHAI\ndong 3\n');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  it('sửa hai lần liên tiếp thì lần sau vẫn chạy — hash cập nhật sau lần ghi', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      await t.fs_edit.execute({
        path: 'a.txt',
        blocks: '<<<<<<< SEARCH\ndong 2\n=======\nHAI\n>>>>>>> REPLACE',
      });
      await t.fs_edit.execute({
        path: 'a.txt',
        blocks: '<<<<<<< SEARCH\nHAI\n=======\nHAI_MOI\n>>>>>>> REPLACE',
      });
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('dong 1\nHAI_MOI\ndong 3\n');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  it('fs_edit khi file KHÔNG đổi thì vẫn ghi bình thường', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      await t.fs_edit.execute({
        path: 'a.txt',
        blocks: '<<<<<<< SEARCH\ndong 2\n=======\nHAI\n>>>>>>> REPLACE',
      });
      expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('dong 1\nHAI\ndong 3\n');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  it('file MỚI thì không cần hash — không có gì để đối chiếu', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      await tools().fs_write.execute({ path: 'moi.txt', content: 'x' });
      expect(existsSync(path.join(dir, 'moi.txt'))).toBe(true);
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });
});

/* ============ NỢ 3 — audit không mặc định rỗng ============ */

describe('audit mặc định ghi ra đĩa', () => {
  it('có file audit ngay khi host tạo', () => {
    const { userData, tools, hostOf, cleanup } = mk();
    try {
      tools();
      expect(existsSync(hostAuditLogPath(userData))).toBe(true);
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  it('ghi lại hành động vào file audit', async () => {
    const { dir, userData, cleanup } = mk();
    try {
      const host = createNodeHost({ workspaceRoot: dir, userDataDir: userData });
      // Gọi thẳng `workspace-get` KHÔNG sinh dòng audit — chỉ workspace-set và
      // lỗi mới ghi. Dùng một lệnh chắc chắn đi qua nhánh lỗi của `handler()`.
      await host
        .call('vyen:fs-read', { relPath: path.join(dir, '..', 'tho.txt') })
        .catch(() => {});
      host.dispose();
      const log = readFileSync(hostAuditLogPath(userData), 'utf8');
      expect(log.length, 'audit log rong').toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});
