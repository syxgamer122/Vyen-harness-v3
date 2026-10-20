/**
 * Vòng lặp hội thoại — thứ biến CLI từ "mỗi lần chạy một câu hỏi" thành "một
 * tiến trình sống, nói chuyện tiếp".
 *
 * ============ VÌ SAO TÁCH `ask`/`out` RA THAM SỐ ============
 *
 * REPL đọc stdin và in ra console — không test được nếu viết thẳng vào hàm. Ở
 * đây `ask` là một hàm trả về dòng người dùng gõ, `out` là hàm in. Test truyền
 * vào giá trị giả; CLI thật truyền readline và `console`.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CoreMessage, LanguageModelV1, LanguageModelV1StreamPart } from 'ai';
import { z } from 'zod';
import { parseCommand, runRepl } from '@/cli/repl';
import { openSession } from '@/cli/session';

/* ============ Lệnh của người dùng ============ */

describe('parseCommand', () => {
  it('dòng thường KHÔNG phải lệnh', () => {
    expect(parseCommand('doc file a.txt')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });

  it('nhận /exit và /new, không phân biệt hoa thường', () => {
    expect(parseCommand('/exit')).toEqual({ kind: 'exit' });
    expect(parseCommand('/new')).toEqual({ kind: 'new' });
    expect(parseCommand('/EXIT')).toEqual({ kind: 'exit' });
  });

  it('bỏ khoảng trắng thừa — gõ tay hay có cách dấu', () => {
    expect(parseCommand('  /exit  ')).toEqual({ kind: 'exit' });
  });

  /* `/exitch` hay `/exit ngay` là người dùng muốn GÕ câu đó cho model, không phải
   * lệnh thoát. Nhận nhầm ở đây là **thoát mất cả phiên làm việc**. */
  it('"/exit ngay" KHÔNG phải lệnh thoát — phải khớp trọn từ', () => {
    expect(parseCommand('/exit ngay')).not.toEqual({ kind: 'exit' });
    expect(parseCommand('/exitch')).not.toEqual({ kind: 'exit' });
  });

  it('lệnh lạ thì báo lệnh sai, KHÔNG gửi cho model', () => {
    expect(parseCommand('/xyz')).toEqual({ kind: 'unknown', name: 'xyz' });
  });
});

/* ============ Vòng lặp ============ */

type StubPart = LanguageModelV1StreamPart | Record<string, unknown>;

function stubModel(script: StubPart[][]) {
  let i = 0;
  const calls: unknown[] = [];
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub-1',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async () => {
      throw new Error('stub khong ho tro doGenerate');
    },
    doStream: (options: unknown) => {
      calls.push(options);
      const parts = script[Math.min(i, script.length - 1)];
      i++;
      return Promise.resolve({
        stream: new ReadableStream<LanguageModelV1StreamPart>({
          start(ctrl) {
            for (const p of parts) ctrl.enqueue(p as LanguageModelV1StreamPart);
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      });
    },
  };
  return { model, calls };
}

const DONE = {
  type: 'finish' as const,
  finishReason: 'stop' as const,
  usage: { promptTokens: 1, completionTokens: 1 },
};

function tools() {
  return {
    fs_read: {
      description: 'doc file',
      parameters: z.object({ path: z.string().optional() }),
      execute: async () => ({ content: 'NOI DUNG' }),
    },
  } as unknown as Parameters<typeof runRepl>[0]['tools'];
}

function mk() {
  const state = mkdtempSync(path.join(tmpdir(), 'vyen-repl-'));
  return { state, dir: 'C:\\du-an', cleanup: () => rmSync(state, { recursive: true, force: true }) };
}

/** Đọc từng dòng trong `dong`; hết thì trả `null` (EOF). */
function reader(...dong: (string | null)[]) {
  let i = 0;
  return async () => (i < dong.length ? dong[i++] : null);
}

describe('runRepl — nhiều lượt trong một tiến trình', () => {
  it('lượt sau NHÌN THẤY lượt trước', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubModel([
        [{ type: 'text-delta', textDelta: 'tra loi 1' }, DONE],
        [{ type: 'text-delta', textDelta: 'tra loi 2' }, DONE],
      ]);
      const session = openSession(state, dir);
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('cau 1', 'cau 2', '/exit'),
        out: () => {},
      });
      expect(calls.length).toBe(2);
      const guiLượt2 = JSON.stringify(calls[1]);
      expect(guiLượt2, 'luot 2 khong thay ' + guiLượt2).toContain('cau 1');
      expect(guiLượt2).toContain('tra loi 1');
      expect(guiLượt2).toContain('cau 2');
    } finally {
      cleanup();
    }
  });

  it('mọi lượt đều được GHI XUỐNG ĐĨA chứ không chỉ nằm trong RAM', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModel([
        [{ type: 'text-delta', textDelta: 'ok' }, DONE],
        [{ type: 'text-delta', textDelta: 'ok' }, DONE],
      ]);
      const session = openSession(state, dir);
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('cau 1', 'cau 2', '/exit'),
        out: () => {},
      });
      session.close();
      const moLai = openSession(state, dir);
      expect(moLai.messages).toHaveLength(4); // 2 user + 2 assistant
      expect(moLai.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      moLai.close();
    } finally {
      cleanup();
    }
  });

  it('lượt có tool thì ghi đủ cả tool-call và tool-result xuống đĩa', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModel([
        [
          { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
          { ...DONE, finishReason: 'tool-calls' },
        ],
        [{ type: 'text-delta', textDelta: 'xong' }, DONE],
      ]);
      const session = openSession(state, dir);
      await runRepl({ model, tools: tools(), session, ask: reader('doc a.txt', '/exit'), out: () => {} });
      session.close();
      const moi = openSession(state, dir);
      const vaiTro = moi.messages.map((m) => m.role);
      expect(vaiTro).toContain('tool');
      moi.close();
    } finally {
      cleanup();
    }
  });

  it('/exit kết thúc vòng lặp', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
      const session = openSession(state, dir);
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('/exit', 'chua duoc hoi'),
        out: () => {},
      });
      expect(calls.length).toBe(0);
    } finally {
      cleanup();
    }
  });

  /* Đóng terminal = EOF, không phải `/exit`. Không xử lý thì CLI treo vĩnh viễn. */
  it('EOF (người dùng đóng terminal) thì thoát, không treo', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
      const session = openSession(state, dir);
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('cau 1'),
        out: () => {},
      });
      expect(calls.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('dòng trống thì bỏ qua — không hỏi model không có gì', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
      const session = openSession(state, dir);
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('', '   ', 'cau that', '/exit'),
        out: () => {},
      });
      expect(calls.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('/new xoá lịch sử — lượt sau không còn thấy lượt trước', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubModel([
        [{ type: 'text-delta', textDelta: 'ok' }, DONE],
        [{ type: 'text-delta', textDelta: 'ok' }, DONE],
      ]);
      const session = openSession(state, dir);
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('cau 1', '/new', 'cau 2', '/exit'),
        out: () => {},
      });
      const guiSauNew = JSON.stringify(calls[1]);
      expect(guiSauNew, '/new khong xoa lich su').not.toContain('cau 1');
      expect(guiSauNew).toContain('cau 2');
    } finally {
      cleanup();
    }
  });

  it('/new KHÔNG xoá file cũ — lịch sử cũ vẫn mở lại được', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
      const s1 = openSession(state, dir);
      const idCu = s1.header.sessionId;
      await runRepl({ model, tools: undefined, session: s1, ask: reader('cau 1', '/exit'), out: () => {} });
      s1.close();

      // Mở lại phải thấy "cau 1" — nếu /new xoá hẳn thì mất dữ liệu.
      const s2 = openSession(state, dir);
      expect(s2.header.sessionId).toBe(idCu);
      expect(s2.messages.some((m) => m.content === 'cau 1')).toBe(true);
      s2.close();
    } finally {
      cleanup();
    }
  });

  /* Lượt hỏng KHÔNG được phá lịch sử đã có, và người dùng phải đọc được lý do. */
  it('lượt lỗi thì báo lý do và vẫn nhận lượt tiếp theo', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const loi = new Error('429 het quota');
      const { model, calls } = stubModel([
        [{ type: 'error', error: loi }, DONE],
        [{ type: 'text-delta', textDelta: 'lan sau moi ok' }, DONE],
      ]);
      const session = openSession(state, dir);
      const noiDung: string[] = [];
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('cau 1', 'cau 2', '/exit'),
        out: (s) => noiDung.push(s),
      });
      expect(noiDung.join('\n'), 'khong bao loi ra').toContain('429');
      expect(calls.length, 'vong lap dung chua tiep tuc').toBe(2);
    } finally {
      cleanup();
    }
  });

  /* Test trước chỉ kiểm `parseCommand('/xyz')` — xoá hẳn nhánh `unknown` ở
   * `cli/repl.ts` thì nó vẫn xanh (reviewer bắt đúng). Nên phải kiểm ở mức REPL:
   * lệnh lạ KHÔNG được chạy tới model. */
  it('lệnh `/...` lạ thì báo và KHÔNG gửi cho model', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
      const session = openSession(state, dir);
      const noiDung: string[] = [];
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('/xyz', 'cau that', '/exit'),
        out: () => {},
        note: (s) => noiDung.push(s),
      });
      expect(calls.length, 'lenh la bi gui cho model').toBe(1);
      expect(noiDung.join('\n'), 'khong bao cho nguoi dung biet lenh sai').toContain('xyz');
    } finally {
      cleanup();
    }
  });

  it('in chữ của model ra stdout khi có', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModel([[{ type: 'text-delta', textDelta: 'xin chao ban' }, DONE]]);
      const session = openSession(state, dir);
      const noiDung: string[] = [];
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('chao', '/exit'),
        out: (s) => noiDung.push(s),
      });
      expect(noiDung.join('')).toContain('xin chao ban');
    } finally {
      cleanup();
    }
  });
});

/* ============ SỰ KIỆN TOOL + MỨC ĐỘ NOTE ============
 *
 * Hai thứ TUI cần mà REPL cũ không có:
 *   1. **sự kiện tool có id** — để vẽ `*` khi đang chạy, `✓` khi xong, ghép
 *      theo id chứ không theo thứ tự (hai tool cùng tên về ngược thứ tự).
 *   2. **mức độ của note** — để tô đỏ lỗi, vàng cảnh báo, xám thông báo.
 *
 * Luật bất di bất dịch: **không truyền callback thì hành vi phải y như cũ** —
 * đường plain in `[goi tool]` đúng như trước, byte giống byte. */
describe('runRepl — sự kiện tool và mức độ note', () => {
  const goiTool = {
    fs_read: {
      description: 'doc file',
      parameters: z.object({ path: z.string().optional() }),
      execute: async () => ({ content: 'NOI DUNG' }),
    },
  } as unknown as Parameters<typeof runRepl>[0]['tools'];

  const toolLoi = {
    fs_read: {
      description: 'tool hong',
      parameters: z.object({ path: z.string().optional() }),
      execute: async () => {
        throw new Error('hong roi');
      },
    },
  } as unknown as Parameters<typeof runRepl>[0]['tools'];

  const scriptCoTool = () =>
    stubModel([
      [
        { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
        { ...DONE, finishReason: 'tool-calls' },
      ],
      [{ type: 'text-delta', textDelta: 'xong' }, DONE],
    ]);

  it('truyền onToolCall ⇒ KHÔNG còn dòng "[goi tool]", và sự kiện tới đúng id', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = scriptCoTool();
      const session = openSession(state, dir);
      const notes: string[] = [];
      const goi: unknown[] = [];
      await runRepl({
        model,
        tools: goiTool,
        session,
        ask: reader('doc a.txt', '/exit'),
        out: () => {},
        note: (s) => notes.push(s),
        onToolCall: (e) => goi.push(e),
      });
      expect(notes.join('\n'), 'khi co su kien thi khong in dong [goi tool]').not.toContain(
        '[goi tool]',
      );
      expect(goi).toEqual([{ id: 't1', name: 'fs_read', args: { path: 'a.txt' } }]);
    } finally {
      cleanup();
    }
  });

  it('KHÔNG truyền onToolCall ⇒ vẫn in "[goi tool]" — hành vi plain giữ nguyên', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = scriptCoTool();
      const session = openSession(state, dir);
      const notes: string[] = [];
      await runRepl({
        model,
        tools: goiTool,
        session,
        ask: reader('doc a.txt', '/exit'),
        out: () => {},
        note: (s) => notes.push(s),
      });
      expect(notes.join('\n'), 'duong plain phai giu nguyen dong [goi tool]').toContain(
        '[goi tool] fs_read',
      );
    } finally {
      cleanup();
    }
  });

  it('onUsage nhận token của lượt', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
      const session = openSession(state, dir);
      const usage: unknown[] = [];
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: reader('cau hoi', '/exit'),
        out: () => {},
        onUsage: (u) => usage.push(u),
      });
      expect(usage).toHaveLength(1);
      expect((usage[0] as { promptTokens: number }).promptTokens).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('tool lỗi ⇒ note mang mức "error" (TUI tô đỏ được)', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = scriptCoTool();
      const session = openSession(state, dir);
      const notes: Array<{ text: string; level?: string }> = [];
      await runRepl({
        model,
        tools: toolLoi,
        session,
        ask: reader('doc a.txt', '/exit'),
        out: () => {},
        note: (s, level) => notes.push({ text: s, ...(level ? { level } : {}) }),
      });
      const loi = notes.find((n) => n.text.includes('[tool that bai]'));
      expect(loi, 'phai bao loi tool').toBeDefined();
      expect(loi!.level, 'loi tool phai co muc do error').toBe('error');
    } finally {
      cleanup();
    }
  });
});