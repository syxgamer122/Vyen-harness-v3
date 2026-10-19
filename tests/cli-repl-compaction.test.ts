/**
 * Nén context trong REPL của CLI — `/compact`, nén tự động, và tự cứu khi
 * provider từ chối vì tràn context.
 *
 * ============ VÌ SAO TÁCH FILE RIÊNG ============
 *
 * `tests/cli-repl.test.ts` đã có khuôn stub model + session. File này cần thêm:
 * stub model cho `generateText` (lượt tóm tắt), session dài 14 message (để có
 * chỗ cắt), và kiểm tra system prompt của lượt sau. Nhồi hết vào file cũ làm
 * file đó mất dễ đọc — tách thành file riêng, cùng nguyên tắc "mỗi file một
 * trách nhiệm" (`writing-plans`).
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CoreMessage, LanguageModelV1, LanguageModelV1StreamPart } from 'ai';
import { parseCommand, runRepl } from '@/cli/repl';
import { openSession } from '@/cli/session';

type StubPart = LanguageModelV1StreamPart | Record<string, unknown>;

const DONE = {
  type: 'finish' as const,
  finishReason: 'stop' as const,
  usage: { promptTokens: 1, completionTokens: 1 },
};

/** Model giả cho lượt CHAT — `doStream`. */
function stubChat(script: StubPart[][], failFirstWith?: string) {
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
      const lan = i++;
      if (failFirstWith !== undefined && lan === 0) {
        throw new Error(failFirstWith);
      }
      const parts = script[Math.min(lan, script.length - 1)];
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

/** Model giả cho lượt TÓM TẮT — `doGenerate`. */
function stubNen(text = 'TOM TAT') {
  const seen: unknown[] = [];
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub-nen',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async (o: unknown) => {
      seen.push(o);
      return {
        text,
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    doStream: () => {
      throw new Error('stub khong ho tro doStream');
    },
  };
  return { model, seen };
}

function mk() {
  const state = mkdtempSync(path.join(tmpdir(), 'vyen-replc-'));
  return { state, dir: 'C:\\du-an', cleanup: () => rmSync(state, { recursive: true, force: true }) };
}

/** Đọc từng dòng trong `dong`; hết thì trả `null` (EOF). */
function reader(...dong: (string | null)[]) {
  let i = 0;
  return async () => (i < dong.length ? dong[i++] : null);
}

/**
 * Lịch sử đủ dài để CÓ chỗ cắt.
 *
 * 14 message, trong đó có một tool result 30.000 ký tự. Với `windowTokens` 32.000
 * thì ngân sách phần giữ lại là ~7.300 token; 6 message đầu rơi ra ngoài ⇒ có
 * chỗ cắt thật. (Lịch sử ngắn hơn thì `splitForCompaction` trả null ⇒ không nén
 * được — đó là hành vi đúng, xem `cli/compaction.ts`.)
 */
function lichSuDai(): CoreMessage[] {
  const out: CoreMessage[] = [];
  for (let i = 0; i < 5; i += 1) {
    out.push({ role: 'user', content: `cau ${i}` });
    out.push({ role: 'assistant', content: `tra loi ${i}` });
    out.push({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: `t${i}`, toolName: 'fs_read', args: { path: `a${i}.txt` } },
      ] as never,
    });
    out.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: `t${i}`,
          toolName: 'fs_read',
          result: { content: 'x'.repeat(30_000) },
        },
      ] as never,
    });
  }
  return out;
}

describe('parseCommand — lệnh /compact', () => {
  it('nhận /compact', () => {
    expect(parseCommand('/compact')).toEqual({ kind: 'compact' });
    expect(parseCommand('/COMPACT')).toEqual({ kind: 'compact' });
  });

  it('"/compact them" KHÔNG phải lệnh — phải khớp trọn từ', () => {
    expect(parseCommand('/compact them')).toBeNull();
  });
});

/**
 * Lịch sử NHỎ: 14 tin ngắn, tổng ước lượng dưới ngưỡng nén.
 *
 * Dùng để cô lập nhánh TRÀN NGẦM: nếu ước lượng đã vượt ngưỡng thì nén tự động
 * nén trước, và test không chứng minh được gì về nhánh usage.
 */
function lichSuNho(): CoreMessage[] {
  const out: CoreMessage[] = [];
  for (let i = 0; i < 7; i += 1) {
    out.push({ role: 'user', content: `cau ${i}` });
    out.push({ role: 'assistant', content: `tra loi ${i}` });
  }
  return out;
}

describe('REPL — nén context', () => {
  it('/compact nén và lượt sau NHẬN bản tóm tắt trong system prompt', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubChat([
        [{ type: 'text-delta', textDelta: 'tra loi' }, DONE],
      ]);
      const { model: modelNen, seen } = stubNen('TOM TAT');
      const session = openSession(state, dir);
      for (const m of lichSuDai()) session.append(m);

      await runRepl({
        model,
        modelNen,
        tools: undefined,
        session,
        windowTokens: 32_000,
        ask: reader('/compact', 'cau moi', '/exit'),
        out: () => {},
      });

      expect(seen.length, 'phai co goi model tom tat').toBeGreaterThan(0);
      expect(session.compaction?.summary).toContain('TOM TAT');
      // Lượt sau phải mang bản tóm tắt trong system prompt.
      const guiLuotSau = JSON.stringify(calls[calls.length - 1]);
      expect(guiLuotSau).toContain('TOM TAT');
    } finally {
      cleanup();
    }
  });

  it('bản tóm tắt SỐNG SÓT qua các lần chạy — mở lại session là thấy', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubChat([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
      const { model: modelNen } = stubNen('TOM TAT');
      const session = openSession(state, dir);
      for (const m of lichSuDai()) session.append(m);

      await runRepl({
        model,
        modelNen,
        tools: undefined,
        session,
        windowTokens: 32_000,
        ask: reader('/compact', '/exit'),
        out: () => {},
      });
      session.close();

      const moi = openSession(state, dir);
      expect(moi.compaction?.summary).toContain('TOM TAT');
      moi.close();
    } finally {
      cleanup();
    }
  });

  it('provider từ chối vì tràn context thì nén lại và THỬ LẠI đúng một lần', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubChat([[{ type: 'text-delta', textDelta: 'ok' }, DONE]], 'prompt is too long');
      const { model: modelNen } = stubNen('TOM TAT');
      const session = openSession(state, dir);
      for (const m of lichSuDai()) session.append(m);

      await runRepl({
        model,
        modelNen,
        tools: undefined,
        session,
        windowTokens: 32_000,
        ask: reader('cau moi', '/exit'),
        out: () => {},
      });

      expect(calls.length, 'phai thu lai MOT LAN').toBe(2);
      expect(session.compaction?.summary).toContain('TOM TAT');
    } finally {
      cleanup();
    }
  });

  it('lỗi KHÔNG phải tràn context thì không thử lại', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubChat([[{ type: 'text-delta', textDelta: 'ok' }, DONE]], 'Unauthorized');
      const { model: modelNen } = stubNen('TOM TAT');
      const session = openSession(state, dir);
      // Lịch sử NGẮN để nén tự động không kích hoạt — test này chỉ về đường lỗi.
      session.append({ role: 'user', content: 'cau 1' });
      session.append({ role: 'assistant', content: 'tra loi 1' });

      await runRepl({
        model,
        modelNen,
        tools: undefined,
        session,
        windowTokens: 32_000,
        ask: reader('cau moi', '/exit'),
        out: () => {},
      });

      expect(calls.length, 'khong duoc thu lai khi loi khong phai tran context').toBe(1);
      expect(session.compaction, 'khong nen khi loi khong phai tran context').toBeUndefined();
    } finally {
      cleanup();
    }
  });
});


describe('REPL — /new và tràn ngầm', () => {
  it('/new BỎ bản tóm tắt của phiên cũ — phiên mới không được thừa hưởng nó', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubChat([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
      const { model: modelNen } = stubNen('TOM TAT');
      const session = openSession(state, dir);
      for (const m of lichSuDai()) session.append(m);

      await runRepl({
        model,
        modelNen,
        tools: undefined,
        session,
        windowTokens: 32_000,
        ask: reader('/compact', '/new', 'cau moi', '/exit'),
        out: () => {},
      });

      // Lượt CUỐI (sau `/new`) không được mang bản tóm tắt của phiên cũ.
      const guiLuotCuoi = JSON.stringify(calls[calls.length - 1]);
      expect(guiLuotCuoi, 'phien moi phai quen phien cu').not.toContain('TOM TAT');
    } finally {
      cleanup();
    }
  });

  it('tràn ngầm (usage vượt cửa sổ mà finishReason vẫn "stop") thì nén lại', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubChat([
        [
          { type: 'text-delta', textDelta: 'ok' },
          { ...DONE, usage: { promptTokens: 300_000, completionTokens: 10 } },
        ],
      ]);
      const { model: modelNen, seen } = stubNen('TOM TAT');
      const session = openSession(state, dir);
      /* Lịch sử NHỎ: ước lượng phải DƯỚI ngưỡng, nếu không nén tự động đã nén
       * trước rồi và test này không cô lập được nhánh tràn ngầm. Mà vẫn đủ dài
       * để có chỗ cắt (≥ 6 tin trước ranh giới). */
      for (const m of lichSuNho()) session.append(m);

      await runRepl({
        model,
        modelNen,
        tools: undefined,
        session,
        windowTokens: 32_000,
        ask: reader('cau moi', '/exit'),
        out: () => {},
      });

      expect(seen.length, 'phai nen khi tran ngam — provider KHONG bao loi gi').toBeGreaterThan(0);
      expect(session.compaction?.summary).toContain('TOM TAT');
    } finally {
      cleanup();
    }
  });

  it('sau khi thử lại lần nữa, lịch sử vẫn nguyên vẹn — không mất, không lặp', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, calls } = stubChat([[{ type: 'text-delta', textDelta: 'ok' }, DONE]], 'prompt is too long');
      const { model: modelNen } = stubNen('TOM TAT');
      const session = openSession(state, dir);
      for (const m of lichSuDai()) session.append(m);

      await runRepl({
        model,
        modelNen,
        tools: undefined,
        session,
        windowTokens: 32_000,
        ask: reader('cau moi', '/exit'),
        out: () => {},
      });

      expect(calls.length).toBe(2);
      // Câu hỏi của người dùng phải xuất hiện **đúng một lần** trong lịch sử.
      const soLan = session.messages.filter((m) => m.content === 'cau moi').length;
      expect(soLan, 'cau hoi bi ghi lap hoac mat').toBe(1);
      expect(session.messages[0].role, 'lich su phai bat dau bang user').toBe('user');
    } finally {
      cleanup();
    }
  });
});
