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
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
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