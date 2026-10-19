/**
 * Kho transcript của CLI — thứ làm "mở terminal lên là còn nhớ" thành hiện thực.
 *
 * ============ VÌ SAO TEST NÀY TẬP TRUNG VÀO DÒNG CỤT ============
 *
 * Claude Code từng sửa đúng lỗi này (CHANGELOG 2.1.300): *"Fixed the first
 * transcript entry written after resuming a session being lost when a crash had
 * cut the transcript's last line short"*. Đó không phải lo ngại giả định — họ đã
 * dính và mất dữ liệu thật.
 *
 * Cơ chế: `appendFileSync` bị kill giữa lúc ghi để lại dòng nửa vời. Lần mở sau
 * nối tiếp vào **sau** dòng đó, tức bản ghi mới dính liền vào dòng hỏng và không
 * đọc được nữa. Một lần crash = mất vĩnh viễn một lượt, và lượt đó lại là lượt
 * bạn vừa làm việc.
 *
 * Vì vậy: dòng cuối hỏng thì **BỎ**. Nhưng dòng giữa hỏng thì **ném** — bỏ đi
 * âm thầm là nuốt lịch sử mà người dùng không hề biết.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CoreMessage } from 'ai';
import { openSession, sessionFileFor } from '@/cli/session';

function mk() {
  const state = mkdtempSync(path.join(tmpdir(), 'vyen-sess-'));
  return { state, dir: 'C:\\du-an\\vidu', cleanup: () => rmSync(state, { recursive: true, force: true }) };
}

const userMsg = (text: string): CoreMessage => ({ role: 'user', content: text });
const asstMsg = (text: string): CoreMessage => ({ role: 'assistant', content: text });

describe('mở session lần đầu', () => {
  it('tạo file, header có đường dẫn thật', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      expect(s.header.directory).toBe(dir);
      expect(s.messages).toEqual([]);
      s.close();
    } finally {
      cleanup();
    }
  });

  it('mỗi thư mục một session riêng — không lẫn vào nhau', () => {
    const { state, cleanup } = mk();
    try {
      expect(sessionFileFor(state, 'C:\\a')).not.toBe(sessionFileFor(state, 'C:\\b'));
    } finally {
      cleanup();
    }
  });

  /* Đường dẫn Windows có `:` và `\` — tên file thẳng sẽ không tạo được trên
   * Windows. Bắt buộc phải mã hoá. */
  it('tên file dùng được trên Windows dù đường dẫn có ký tự cấm', () => {
    const { state, cleanup } = mk();
    try {
      const f = sessionFileFor(state, 'C:\\Users\\Admin\\dự án');
      expect(/[<>:"/\\|?*]/.test(path.basename(f)), `tên file còn ký tự cấm: ${f}`).toBe(false);
      expect(f.endsWith('.jsonl')).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe('ghi rồi đọc lại', () => {
  it('giữ nguyên thứ tự và nội dung qua nhiều lần mở', () => {
    const { state, dir, cleanup } = mk();
    try {
      const a = openSession(state, dir);
      a.append(userMsg('cau 1'));
      a.append(asstMsg('tra loi 1'));
      a.close();

      const b = openSession(state, dir);
      expect(b.messages).toHaveLength(2);
      expect(b.messages[0]).toEqual(userMsg('cau 1'));
      expect(b.messages[1]).toEqual(asstMsg('tra loi 1'));
      b.close();
    } finally {
      cleanup();
    }
  });

  it('sessionId giữ nguyên khi mở lại — cùng một cuộc hội thoại', () => {
    const { state, dir, cleanup } = mk();
    try {
      const a = openSession(state, dir);
      const id = a.header.sessionId;
      a.close();
      const b = openSession(state, dir);
      expect(b.header.sessionId).toBe(id);
      b.close();
    } finally {
      cleanup();
    }
  });

  it('ghi là APPEND — mở lại không xoá dữ liệu cũ', () => {
    const { state, dir, cleanup } = mk();
    try {
      const a = openSession(state, dir);
      a.append(userMsg('x'));
      a.close();
      const truoc = readFileSync(sessionFileFor(state, dir), 'utf8');

      const b = openSession(state, dir);
      b.append(userMsg('y'));
      b.close();
      const sau = readFileSync(sessionFileFor(state, dir), 'utf8');
      expect(sau.startsWith(truoc), 'lịch sử cũ bị mất').toBe(true);
    } finally {
      cleanup();
    }
  });

  /* Nội dung nhiều dòng là chuyện thường — không được làm hỏng file. */
  it('nội dung nhiều dòng vẫn là MỘT dòng JSONL', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.append(userMsg('dong 1\ndong 2\ndong 3'));
      s.close();
      const s2 = openSession(state, dir);
      expect(s2.messages[0]).toEqual(userMsg('dong 1\ndong 2\ndong 3'));
      s2.close();
    } finally {
      cleanup();
    }
  });

  it('nội dung chứa dấu nháy kép và dấu gạch chéo ngược vẫn đúng', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      const kho = 'heo "x" \\ backslash\ttab';
      s.append(userMsg(kho));
      s.close();
      const s2 = openSession(state, dir);
      expect(s2.messages[0]).toEqual(userMsg(kho));
      s2.close();
    } finally {
      cleanup();
    }
  });
});

describe('crash giữa lúc ghi — dòng cuối cụt', () => {
  /* Đây là lỗi Claude Code từng dính. Dòng cuối bị cắt cụt phải bị BỎ, và bản
   * ghi tiếp theo phải vào được chứ không dính vào dòng hỏng. */
  it('dòng cuối hỏng thì bỏ, các dòng trước giữ nguyên', () => {
    const { state, dir, cleanup } = mk();
    try {
      const a = openSession(state, dir);
      a.append(userMsg('luot 1'));
      a.append(userMsg('luot 2'));
      a.close();

      // Mô phỏng crash: cắt cụt dòng cuối.
      const f = sessionFileFor(state, dir);
      const nd = readFileSync(f, 'utf8');
      writeFileSync(f, `${nd}{"seq":3,"role":"user","cont`, 'utf8');

      const b = openSession(state, dir);
      expect(b.messages).toHaveLength(2);
      expect(b.messages[1]).toEqual(userMsg('luot 2'));
      b.close();
    } finally {
      cleanup();
    }
  });

  it('sau khi bỏ dòng hỏng thì ghi tiếp VÀO ĐƯỢC và không dính dòng hỏng', () => {
    const { state, dir, cleanup } = mk();
    try {
      const a = openSession(state, dir);
      a.append(userMsg('luot 1'));
      a.close();
      const f = sessionFileFor(state, dir);
      writeFileSync(f, `${readFileSync(f, 'utf8')}{"seq":2,"role":"us`, 'utf8');

      const b = openSession(state, dir);
      b.append(userMsg('luot 2'));
      b.close();

      const c = openSession(state, dir);
      expect(c.messages).toHaveLength(2);
      expect(c.messages[1]).toEqual(userMsg('luot 2'));
      c.close();
    } finally {
      cleanup();
    }
  });

  it('file rỗng thì mở được, không ném', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.close();
      writeFileSync(sessionFileFor(state, dir), '');
      const b = openSession(state, dir);
      expect(b.messages).toEqual([]);
      b.close();
    } finally {
      cleanup();
    }
  });
});

describe('file hỏng ở GIỮA — phải nói chứ không nuốt', () => {
  /* Dòng giữa hỏng khác hẳn dòng cuối cụt. Bỏ đi âm thầm là mất lịch sử mà
   * người dùng không biết — tệ hơn là báo lỗi rồi hỏi. */
  it('ném lỗi nói rõ dòng nào hỏng', () => {
    const { state, dir, cleanup } = mk();
    try {
      const a = openSession(state, dir);
      a.append(userMsg('luot 1'));
      a.append(userMsg('luot 2'));
      a.append(userMsg('luot 3'));
      a.close();

      // File có header + 3 bản ghi. Hỏng bản ghi GIỮA (số 2) để dòng hỏng không
      // còn là dòng cuối — nếu chỉ có 2 bản ghi thì dòng hỏng luôn là dòng cuối
      // và đi vào nhánh "bỏ" chứ không chứng minh được gì.
      const f = sessionFileFor(state, dir);
      const dong = readFileSync(f, 'utf8').split('\n');
      dong[2] = '{"seq":2,"role":"user" KHONG PHOI JSON';
      writeFileSync(f, dong.join('\n'));

      expect(() => openSession(state, dir)).toThrow(/dong 3/);
    } finally {
      cleanup();
    }
  });
});

/* ============ CHE BÍ MẬT KHI GHI ĐĨA ============
 *
 * Kết quả `fs_read` nằm trong lịch sử, tức nằm trong JSONL. Đọc một `.env` là
 * key của mọi thứ khác rơi thẳng vào file đó. Đây là đường lưu duy nhất trong
 * repo không che trước khi ghi — `lib/db.ts`, `lib/tool-result-server.ts`,
 * `lib/audit-log.ts` đều đã che, và spec §7 yêu cầu rõ.
 */
/* ============ CHUỖI HỞ KHI NẠP ============
 *
 * Một lượt có tool sinh ra CHUỖI message: `assistant(tool-call)` → `tool` →
 * `assistant`. Nếu `appendAll` bị đứt giữa chừng (mất điện, hết đĩa), file có
 * thể chỉ còn `assistant(tool-call)` mà không có dòng `tool` — và **mọi provider
 * đều từ chối** phiên đó, vĩnh viễn.
 *
 * Đo 2026-10-19 (reviewer độc lập): file như vậy mở lại **không hề báo lỗi**,
 * messages = ["user","assistant"], và lượt tiếp theo là hỏng. Đây đúng là yêu cầu
 * số 5 mà repo từng khẳng định đã giữ.
 */
describe('nạp transcript hở thì phải BÁO, không im lặng nạp vào', () => {
  /** Dựng transcript có assistant(tool-call) nhưng KHÔNG có tool-result. */
  function taoFileHung(f: string, seq: number) {
    // Thư mục `sessions/` chưa tồn tại cho tới lần `openSession` đầu — tạo trước,
    // nếu không `writeFileSync` ném ENOENT chứ không phải lỗi ta muốn kiểm.
    mkdirSync(path.dirname(f), { recursive: true });
    const lines = [
      JSON.stringify({ kind: 'header', sessionId: 's', directory: 'd', createdAt: 't' }),
      JSON.stringify({ seq: 1, message: { role: 'user', content: 'doc file' } }),
      JSON.stringify({
        seq: 2,
        message: {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: { path: 'a' } },
          ],
        },
      }),
    ];
    writeFileSync(f, `${lines.slice(0, seq).join('\n')}\n`, 'utf8');
  }

  it('báo rõ chuỗi bị hở thay vì nạp vào rồi để provider từ chối', () => {
    const { state, dir, cleanup } = mk();
    try {
      const f = sessionFileFor(state, dir);
      taoFileHung(f, 3);
      expect(() => openSession(state, dir)).toThrow(/tool/i);
    } finally {
      cleanup();
    }
  });

  /* Bỏ kiểm tra thì phải đỏ — tức bản "mở được" chính là lỗi. */
  it('lượt ĐẦY ĐỦ thì mở bình thường', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.append(userMsg('doc file'));
      s.appendAll([
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: { path: 'a' } },
          ],
        } as CoreMessage,
        {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: 't1', toolName: 'fs_read', result: { ok: 1 } }],
        } as CoreMessage,
        { role: 'assistant', content: 'xong' } as CoreMessage,
      ]);
      s.close();
      const moi = openSession(state, dir);
      expect(moi.messages).toHaveLength(4);
      moi.close();
    } finally {
      cleanup();
    }
  });

  it('`tool_call_id` không khớp tool-result cũng phải bị bắt', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.appendAll([
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: { path: 'a' } },
          ],
        } as CoreMessage,
        {
          role: 'tool',
          content: [
            { type: 'tool-result', toolCallId: 'KHAC', toolName: 'fs_read', result: { ok: 1 } },
          ],
        } as CoreMessage,
      ]);
      s.close();
      expect(() => openSession(state, dir)).toThrow(/tool/i);
    } finally {
      cleanup();
    }
  });
});

/* ============ CÙNG MỘT THƯ MỤC PHẢI LÀ CÙNG MỘT FILE ============
 *
 * `sessionFileFor` băm `realpathSync.native(path)`. Nếu không chuẩn hoá, cùng một
 * thư mục mà gõ khác (`C:\a` vs `C:\a\.\` vs `C:\a\..\a`) sẽ sinh **hai file
 * transcript khác nhau** ⇒ lịch sử "bị mất" một cách rất khó hiểu.
 *
 * Lời hứa này trước đây chỉ nằm trong comment, không có test.
 */
describe('cùng một thư mục thì phải là cùng một file transcript', () => {
  it('đường dẫn ghi khác nhau cùng trỏ tới một thư mục thì ra cùng một file', () => {
    const { state, cleanup } = mk();
    try {
      const a = sessionFileFor(state, 'C:\\du-an');
      const b = sessionFileFor(state, 'C:\\du-an\\.');
      const c = sessionFileFor(state, 'C:\\du-an\\..\\du-an');
      expect(b, 'cung mot thu muc phai ra cung mot file').toBe(a);
      expect(c).toBe(a);
    } finally {
      cleanup();
    }
  });

  it('hai thư mục khác nhau thì ra hai file khác nhau', () => {
    const { state, cleanup } = mk();
    try {
      expect(sessionFileFor(state, 'C:\\du-an-a')).not.toBe(sessionFileFor(state, 'C:\\du-an-b'));
    } finally {
      cleanup();
    }
  });
});

describe('che bí mật trước khi ghi đĩa', () => {
  const KHOA = 'sk-abc123secret456789xyz';

  it('khóa trong kết quả đọc file KHÔNG xuất hiện nguyên văn trong file JSONL', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.append({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 't1',
            toolName: 'fs_read',
            result: { content: `DATABASE_URL=postgres://a\nOPENAI=${KHOA}` },
          },
        ],
      } as CoreMessage);
      s.close();
      const raw = readFileSync(sessionFileFor(state, dir), 'utf8');
      expect(raw, 'khoa bi ghi nguyen van xuong dia').not.toContain(KHOA);
    } finally {
      cleanup();
    }
  });

  it('khoá xuất hiện trong NỘI DUNG lịch sử nạp lại cũng phải che', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.append({
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 't1', toolName: 'x', result: { k: KHOA } }],
      } as CoreMessage);
      s.close();
      const moi = openSession(state, dir);
      const chuoi = JSON.stringify(moi.messages);
      expect(chuoi, 'nap lai van thay khoa').not.toContain(KHOA);
      moi.close();
    } finally {
      cleanup();
    }
  });

  /* Kết quả tool KHÔNG đi qua `append` — nó đi qua `appendAll`
   * (`cli/repl.ts` và `cli/index.ts` chỉ dùng `appendAll` cho message sinh ra
   * bởi lượt). Bản đầu chỉ test `append`, nên gỡ che khỏi `appendAll` thì cả ba
   * test vẫn xanh — tức đúng cái rò `.env` mà mục này sinh ra để chặn lại không
   * ai canh. Reviewer bắt đúng. */
  it('che qua `appendAll` — đường mà kết quả tool thật sự đi', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.appendAll([
        userMsg('doc file .env'),
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 't1',
              toolName: 'fs_read',
              result: { content: `OPENAI=${KHOA}` },
            },
          ],
        } as CoreMessage,
      ]);
      s.close();
      const raw = readFileSync(sessionFileFor(state, dir), 'utf8');
      expect(raw, 'khoa rut qua appendAll van ghi nguyen').not.toContain(KHOA);
    } finally {
      cleanup();
    }
  });

  it('không che nhầm nội dung thường', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.append(userMsg('sua ham parseConfig trong lib/provider/adapter.ts'));
      s.close();
      const moi = openSession(state, dir);
      expect(moi.messages[0]).toEqual(userMsg('sua ham parseConfig trong lib/provider/adapter.ts'));
      moi.close();
    } finally {
      cleanup();
    }
  });
});

describe('tính toàn vẹn của một lượt', () => {
  /* Tool call mà không có kết quả đi kèm thì provider trả 400. Nếu chỉ lưu "mọi
   * thứ" thì một lượt hỏng làm hỏng **mọi** lượt sau. */
  it('nạp được lượt có tool-call kèm tool-result', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.append(userMsg('doc file'));
      s.append({
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: { path: 'a.txt' } },
        ],
      } as CoreMessage);
      s.append({
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 't1', toolName: 'fs_read', result: { content: 'NOI DUNG' } }],
      } as CoreMessage);
      s.close();

      const s2 = openSession(state, dir);
      expect(s2.messages).toHaveLength(3);
      expect(s2.messages[1].role).toBe('assistant');
      expect(s2.messages[2].role).toBe('tool');
      s2.close();
    } finally {
      cleanup();
    }
  });
});