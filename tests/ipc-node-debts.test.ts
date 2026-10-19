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
import { createNodeHost, buildIpcTools, hostAuditLogPath, toIpcPayload, DANGEROUS_CHANNELS, READ_ONLY_CHANNELS } from '@/lib/tools/ipc-node';

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

/* ============ GÕ KHÁC ĐƯỜNG DẪN KHÔNG LÁCH ĐƯỢC ============
 *
 * Đo 2026-10-19: đọc `a.txt` → người khác sửa → ghi `a.txt` thì **bị chặn**; nhưng
 * ghi `./a.txt` hoặc `sub/../a.txt` thì **ghi thành công và mất thay đổi của họ**.
 * Vì `READ_HASHES` khoá theo đúng chuỗi `a.path` do model đưa, mà mọi cách viết
 * đó cùng trỏ tới một file.
 *
 * Không chỉ là lỗi của người dùng: văn bản do model sinh ra có thể bị chèn
 * (prompt injection) và bảo nó ghi `./package.json`.
 */
describe('khoá TOCTOU theo ĐƯỜNG DẪN ĐÃ GIẢI, không theo chuỗi người dùng gõ', () => {
  for (const spell of ['./a.txt', 'sub/../a.txt']) {
    it(`ghi "${spell}" cũng phải bị chặn khi file đổi sau lúc đọc`, async () => {
      const { dir, tools, hostOf, cleanup } = mk();
      try {
        const t = tools();
        await t.fs_read.execute({ path: 'a.txt' });
        writeFileSync(path.join(dir, 'a.txt'), 'NGUOI KHAC SUA\n', 'utf8');
        await expect(
          t.fs_write.execute({ path: spell, content: 'de che' }),
        ).rejects.toThrow(/TOCTOU|thay doi/i);
        expect(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'thay doi bi ghi de').toBe(
          'NGUOI KHAC SUA\n',
        );
      } finally {
        hostOf().dispose();
        cleanup();
      }
    });
  }

  /* Ghi file CHƯA từng đọc thì phải chạy — không có H0 để so. Khóa theo đường dẫn
   * đã giải mà không cẩn thận thì dễ thành "chặn nhầm mọi lần ghi". */
  it('ghi file CHƯA từng đọc thì vẫn chạy', async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      await tools().fs_write.execute({ path: './moi.txt', content: 'x' });
      expect(existsSync(path.join(dir, 'moi.txt'))).toBe(true);
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });
});

/* ============ ĐƠN VỊ KHÔNG KHỚP NHAU ============
 *
 * Đo 2026-10-19: `shell_run` chết vì tham số, không phải vì logic. Schema tool
 * cho `timeout_secs` 1…600 **giây**; `ipc.cjs` nhận `timeoutMs` **mili giây** với
 * `min(1_000)`. Bản đầu đổi tên thẳng nên `timeout_secs=120` thành `120` < 1000 ⇒
 * zod từ chối ⇒ **lệnh không bao giờ chạy**, và mọi giá trị schema cho phép đều
 * hỏng. Không đổi tên còn hơn: lệnh chạy với mặc định.
 *
 * Mutation xoá hẳn khối nhân này thì trước đây **không test nào đỏ** — đó là lý do
 * lỗi này sống dai qua hai vòng review.
 */
describe('đơn vị tham số phải khớp, không chỉ tên', () => {
  it('timeout_secs (giây) ra timeoutMs (mili giây)', () => {
    const p = toIpcPayload('shell_run', { command: 'dir', timeout_secs: 120 });
    expect(p.timeoutMs, '120 giay phai ra 120000 ms').toBe(120_000);
    expect(p.timeout_secs, 'khong giu ten cu').toBeUndefined();
  });

  it('giá trị nhỏ nhất schema cho phép vẫn vượt min(1000) của ipc.cjs', () => {
    const p = toIpcPayload('shell_run', { command: 'dir', timeout_secs: 1 });
    expect(p.timeoutMs).toBe(1_000);
  });

  it('giá trị lớn nhất schema cho phép', () => {
    const p = toIpcPayload('shell_run', { command: 'dir', timeout_secs: 600 });
    expect(p.timeoutMs).toBe(600_000);
  });

  it('giá trị vô nghĩa thì BỎ hẳn, để ipc.cjs dùng mặc định', () => {
    expect(toIpcPayload('shell_run', { command: 'dir', timeout_secs: 0 }).timeoutMs).toBeUndefined();
    expect(toIpcPayload('shell_run', { command: 'dir', timeout_secs: -5 }).timeoutMs).toBeUndefined();
    expect(
      toIpcPayload('shell_run', { command: 'dir', timeout_secs: Number.NaN }).timeoutMs,
    ).toBeUndefined();
  });

  it('không truyền thì không sinh gì', () => {
    expect(toIpcPayload('shell_run', { command: 'dir' }).timeoutMs).toBeUndefined();
  });
});

/* ============ ĐƠN VỊ PHẢI THEO TỪNG TOOL ============
 *
 * Bản sửa trước nhân `timeout_secs` cho **mọi** tool. Đo 2026-10-19 (review):
 * `bg_run` có schema `timeout_secs` 1…3600 **giây** và `ipc.cjs` cũng nhận
 * `timeout_secs` **giây** (`ipc.cjs:263`) — tức hai bên **đã khớp**, không cần đổi.
 * Phép nhân làm hỏng đúng cái nó cần giữ: mọi `bg_run` đều chạy với mặc định
 * 3600 giây, dù model yêu cầu 5.
 *
 * `toIpcPayload` nhận `toolName` mà **không dùng** — đó là lý do lỗi này không bị
 * bắt: đổi hành vi cho tất cả tool là mặc định "an toàn" về hình thức.
 */
describe('đơn vị timeout tính THEO TỪNG TOOL', () => {
  it('shell_run: giây → mili giây', () => {
    const p = toIpcPayload('shell_run', { command: 'dir', timeout_secs: 120 });
    expect(p.timeoutMs).toBe(120_000);
  });

  it('bg_run: giây GIỮ NGUYÊN giây — ipc.cjs đã nhận đơn vị này', () => {
    const p = toIpcPayload('bg_run', { command: 'dir', timeout_secs: 5 });
    expect(p.timeout_secs, 'bg_run phai giu timeout_secs nguyen ven').toBe(5);
    expect(p.timeoutMs, 'khong duoc sinh timeoutMs cho bg_run').toBeUndefined();
  });
});

/* ============ WINDOWS KHÔNG PHÂN BIỆT HOA/THƯỜNG ============
 *
 * Cùng lớp lỗi với `./a.txt`, khác một cách viết: đọc `a.txt` → người khác sửa →
 * ghi `A.TXT` thì **không bị chặn** (đo 2026-10-19, reviewer). `path.resolve` chuẩn
 * hoá `.`/`..` nhưng **không** chuẩn hoá hoa/thường, mà Windows thì không phân biệt.
 *
 * Và kịch bản prompt injection mà comment trong mã nêu — "bảo nó ghi
 * `./package.json`" — áp dụng nguyên văn cho `PACKAGE.JSON`.
 */
describe('trên Windows, HOA/THƯỜNG là cùng một file nên phải là cùng một khoá', () => {
  const laWindows = process.platform === 'win32';

  it(`ghi bằng chữ hoa khác chữ thường thì ${laWindows ? 'phải bị chặn' : 'bị bỏ qua (Linux phân biệt)'}`, async () => {
    const { dir, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      await t.fs_read.execute({ path: 'a.txt' });
      writeFileSync(path.join(dir, 'a.txt'), 'NGUOI KHAC SUA\n', 'utf8');
      const ghi = t.fs_write.execute({ path: 'A.TXT', content: 'de che' });
      if (laWindows) {
        await expect(ghi).rejects.toThrow(/TOCTOU|thay doi/i);
      } else {
        await ghi;
      }
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });
});

/* ============ MỌI CHANNEL PHẢI ĐƯỢC PHÂN LOẠI ============
 *
 * `DANGEROUS_CHANNELS` là bảng **phủ định**: channel không có trong đó thì bị
 * chặn. Nghe an toàn, nhưng nó không bắt được channel mới một cách có ý thức —
 * thêm channel ghi mới thì bị chặn (được), nhưng cũng không ai biết phải khai
 * báo; và nếu sau này có ai đó thêm channel ghi vào danh sách "đọc" để cho chạy
 * thì không ai thấy.
 *
 * Vì vậy: mọi channel `ipc.cjs` đăng ký phải rơi vào **đúng một** trong hai bảng.
 * Channel mới xuất hiện ⇒ test đỏ ⇒ buộc phải phân loại.
 */
describe('mọi channel của ipc.cjs đều phải được phân loại', () => {
  it('không channel nào bỏ trống, không channel nào thuộc cả hai bảng', async () => {
    const { dir, userData, cleanup } = mk();
    try {
      const host = createNodeHost({ workspaceRoot: dir, userDataDir: userData });
      const ds = host.channels();
      const chuaPhanLoai = ds.filter(
        (c) => !DANGEROUS_CHANNELS.has(c) && !READ_ONLY_CHANNELS.has(c),
      );
      const caHai = ds.filter((c) => DANGEROUS_CHANNELS.has(c) && READ_ONLY_CHANNELS.has(c));
      expect(chuaPhanLoai, 'channel chua duoc phan loai — hay de mac dinh chan?').toEqual([]);
      expect(caHai, 'channel bi gan vao ca hai bang').toEqual([]);
      host.dispose();
    } finally {
      cleanup();
    }
  });

  it('`workspace-set` phải bị chặn — nó đổi gốc workspace', async () => {
    const { dir, userData, cleanup } = mk();
    try {
      const host = createNodeHost({ workspaceRoot: dir, userDataDir: userData });
      await expect(
        host.call('vyen:workspace-set', { path: dir }),
      ).rejects.toThrow();
      host.dispose();
    } finally {
      cleanup();
    }
  });

  it('`llm-fetch` phải bị chặn — nó gọi URL tùy ý kèm header', async () => {
    const { dir, userData, cleanup } = mk();
    try {
      const host = createNodeHost({ workspaceRoot: dir, userDataDir: userData });
      await expect(
        host.call('vyen:llm-fetch', { url: 'https://example.com' }),
      ).rejects.toThrow();
      host.dispose();
    } finally {
      cleanup();
    }
  });
});

/* ============ VẾT GHI FILE PHẢI THẬT ============
 *
 * Đo 2026-10-19 (reviewer độc lập): `fs_write` để lại **0 dòng** audit, trong khi
 * `shell_run` để lại 1. Vì `ipc.cjs` chỉ audit lỗi/shell/git/bg-run, nên lời hứa
 * "vết của mọi lệnh ghi/xoá" trong `cli/index.ts` là SAI — và test audit cũ đi qua
 * **nhánh lỗi** nên vẫn xanh.
 *
 * Hai test cũ (`:387` và `ipc-node-host.test.ts:169`) chỉ khẳng định "log không rỗng".
 * Test ở đây khẳng định đúng thứ: **ghi file thì log phải nói tên file đó**.
 */
describe('vết ghi file phải có thật trong nhật ký audit', () => {
  it('`fs_write` để lại dòng audit nói tên file', async () => {
    const { dir, userData, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      await t.fs_write.execute({ path: 'a.txt', content: 'x' });
      const log = readFileSync(hostAuditLogPath(userData), 'utf8');
      expect(log, 'ghi file ma khong co vet').toContain('fs_write');
      expect(log).toContain('a.txt');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  it('`fs_edit` cũng để lại vết', async () => {
    const { dir, userData, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      await t.fs_edit.execute({
        path: 'a.txt',
        blocks: '<<<<<<< SEARCH\ndong 2\n=======\nHAI\n>>>>>>> REPLACE',
      });
      const log = readFileSync(hostAuditLogPath(userData), 'utf8');
      expect(log).toContain('fs_edit');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });

  it('lệnh THẤT BẠI thì KHÔNG được ghi là đã ghi — nhật ký không được nói dối', async () => {
    const { dir, userData, tools, hostOf, cleanup } = mk();
    try {
      const t = tools();
      // Đường dẫn ra ngoài workspace ⇒ `path-guard` chặn ⇒ lệnh KHÔNG chạy.
      // (Ghi vào thư mục chưa có thì lại THÀNH CÔNG — `ipc.cjs` tự tạo thư mục.)
      await t.fs_write.execute({ path: '../tho-ra-ngoai.txt', content: 'x' }).catch(() => {});
      const log = readFileSync(hostAuditLogPath(userData), 'utf8');
      expect(log, 'ghi that bai nhung van co vet "ghi file"').not.toContain('fs_write');
    } finally {
      hostOf().dispose();
      cleanup();
    }
  });
});

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
