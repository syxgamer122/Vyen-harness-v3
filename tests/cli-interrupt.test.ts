/**
 * Cắt lượt đang chạy (Esc) — và cái nguy hiểm nhất khi cắt: **history hỏng**.
 *
 * ============ VÌ SAO PHẢI CẤM GHI DỞ ============
 *
 * Một lượt có tool sinh ra một CHUỖI message: assistant gọi tool → tool trả kết
 * quả → assistant trả lời. Cắt giữa chừng thì chuỗi đó **hở dở**. Gửi chuỗi hở dở
 * cho provider ở lượt sau là provider trả 400 — "tool_use không có tool_result".
 *
 * Nghĩa là cắt lượt sẽ giết **cả cuộc hội thoại**, chứ không phải chỉ lượt đó.
 * Đây là lý do phải có test này trước khi có nút bấm.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CoreMessage, LanguageModelV1, LanguageModelV1StreamPart } from 'ai';
import { z } from 'zod';
import { runAgentTurn } from '@/cli/agent-turn';
import { runRepl } from '@/cli/repl';
import { openSession } from '@/cli/session';

type StubPart = LanguageModelV1StreamPart | Record<string, unknown>;

const DONE = {
  type: 'finish' as const,
  finishReason: 'stop' as const,
  usage: { promptTokens: 1, completionTokens: 1 },
};

/** Model giả phát chữ CHẬM — đủ để có cửa sổ bấm Esc giữa chừng. */
function stubModelCham(parts: StubPart[], waitMs = 40) {
  let calls = 0;
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async () => ({}) as never,
    doStream: (options) => {
      calls++;
      return Promise.resolve({
        /* PHẢI nghe `abortSignal` — bản đầu stub bỏ qua nó, nên test đỏ vì lý do
         * hoàn toàn ngược: `runAgentTurn` trả về nửa vời chứ không phải vì nó hỏng.
         * Provider THẬT thì nghe tín hiệu dừng, nên stub mà không nghe là test sai. */
        stream: new ReadableStream<LanguageModelV1StreamPart>({
          async start(ctrl) {
            const signal = (options as { abortSignal?: AbortSignal }).abortSignal;
            for (const p of parts) {
              // Chờ một nhịp để lượt thật sự còn đang chạy khi ta bấm Esc.
              await new Promise((r) => setTimeout(r, waitMs));
              if (signal?.aborted) {
                ctrl.error(new DOMException('The operation was aborted.', 'AbortError'));
                return;
              }
              ctrl.enqueue(p as LanguageModelV1StreamPart);
            }
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      });
    },
  };
  return { model, soLanGoi: () => calls };
}

function stubModelNhanh(script: StubPart[][]) {
  let i = 0;
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async () => ({}) as never,
    doStream: () => {
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
  return { model };
}

function tools() {
  return {
    fs_read: {
      description: 'doc file',
      parameters: z.object({ path: z.string().optional() }),
      execute: async () => ({ content: 'NOI DUNG' }),
    },
  } as unknown as Parameters<typeof runAgentTurn>[0]['tools'];
}

/**
 * Model giả **BỎ QUA** `abortSignal` — mô phỏng provider/gateway hỏng.
 *
 * ============ VÌ SAO CẦN HÒN HAI LOẠI STUB ============
 *
 * Bản `stubModelCham` nghe tín hiệu dừng, nên `streamText` ném và mọi thứ dễ.
 * Nhưng thực tế có provider không nghe — đo 2026-10-19: khi đó `streamText` **hoàn
 * tất bình thường** và trả về một bộ message nửa vời.
 *
 * Nếu chỉ test stub ngoan thì lưới an toàn "kiểm tra `signal.aborted` sau khi
 * stream xong" chưa từng được chứng minh là cần. Stub hỏng mới là thứ chứng minh
 * nó — bỏ nó thì transcript ghi chuỗi hở và chết cả phiên.
 */
function stubModelBoQuaDung(parts: StubPart[], waitMs = 40) {
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub-khong-nghe',
    modelId: 'stub',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async () => ({}) as never,
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream<LanguageModelV1StreamPart>({
          async start(ctrl) {
            for (const p of parts) {
              await new Promise((r) => setTimeout(r, waitMs));
              ctrl.enqueue(p as LanguageModelV1StreamPart); // CỐ TÌNH không nghe signal
            }
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
  };
  return { model };
}

/* `abortSignal` không dừng sớm, thì phải chờ model sinh HẾT rồi mới bỏ kết quả.
   Đó là lượt này còn tốn tiền token cho phần bị vứt. Test này đo TRỰC TIẾP số part
   đã sinh, vì nếu chỉ kiểm tra "kết quả có bị ghi không" thì lưới an toàn bên dưới
   che mất, và việc truyền `abortSignal` trở thành không thể chứng minh. */
it('dừng SỚM — không sinh nốt phần bị vứt', async () => {
  const nhieu: StubPart[] = Array.from({ length: 12 }, (_, i) => ({
    type: 'text-delta' as const,
    textDelta: `phan-${i} `,
  }));
  const { model, soPartDaSinh } = stubModelChamDoDem(nhieu, 25);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  await runAgentTurn({ model, tools: undefined, messages: [user('p')], signal: ac.signal }).catch(
    () => {},
  );
  // Chạy hết 12 part cần ~300ms; cắt sau ~30ms thì chỉ được vài part.
  expect(
    soPartDaSinh(),
    'van sinh het du da cat — ton tien token cho phan bi vu',
  ).toBeLessThan(12);
});

/** Stub như trên NHƯNG đếm số part đã sinh — để đo "dừng sớm". */
function stubModelChamDoDem(parts: StubPart[], waitMs = 40) {
  let daSinh = 0;
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async () => ({}) as never,
    doStream: (options) =>
      Promise.resolve({
        stream: new ReadableStream<LanguageModelV1StreamPart>({
          async start(ctrl) {
            const signal = (options as { abortSignal?: AbortSignal }).abortSignal;
            for (const p of parts) {
              await new Promise((r) => setTimeout(r, waitMs));
              if (signal?.aborted) {
                ctrl.error(new DOMException('The operation was aborted.', 'AbortError'));
                return;
              }
              daSinh++;
              ctrl.enqueue(p as LanguageModelV1StreamPart);
            }
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
  };
  return { model, soPartDaSinh: () => daSinh };
}

function mk() {
  const state = mkdtempSync(path.join(tmpdir(), 'vyen-abort-'));
  return { state, dir: 'C:\\du-an', cleanup: () => rmSync(state, { recursive: true, force: true }) };
}

const user = (t: string): CoreMessage => ({ role: 'user', content: t });

describe('runAgentTurn — tín hiệu dừng', () => {
  it('signal đã dừng sẵn thì không sinh ra message nào', async () => {
    const { model } = stubModelNhanh([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      runAgentTurn({ model, tools: undefined, messages: [user('p')], signal: ac.signal }),
    ).rejects.toThrow();
  });

  it('bị dừng giữa chừng thì KHÔNG trả về message dở', async () => {
    const { model } = stubModelCham([{ type: 'text-delta', textDelta: 'a' }, DONE], 50);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    await expect(
      runAgentTurn({ model, tools: undefined, messages: [user('p')], signal: ac.signal }),
    ).rejects.toThrow();
  });
});

describe('runRepl — Esc cắt lượt', () => {
  it('cắt xong vẫn quay lại nhận lượt tiếp theo', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model, soLanGoi } = stubModelCham([{ type: 'text-delta', textDelta: 'dai' }, DONE], 40);
      const session = openSession(state, dir);
      let huy: (() => void) | null = null;
      let lan = 0;
      const dong = ['cau 1', 'cau 2', '/exit'];
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: async () => dong[lan++] ?? null,
        out: () => {},
        note: () => {},
        watchInterrupt: (cancel) => {
          huy = cancel;
          // Lượt đầu bị cắt ngay khi bắt đầu.
          if (lan === 1) setTimeout(cancel, 5);
          return () => {
            huy = null;
          };
        },
      });
      expect(soLanGoi(), 'vong lap dung chua chay tiep').toBeGreaterThanOrEqual(2);
    } finally {
      cleanup();
    }
  });

  /* ĐÂY LÀ THỨ PHẢI CANH. Cắt lượt rồi ghi dở vào transcript thì mọi lượt sau của
   * phiên đó đều bị provider từ chối — cắt một lượt, chết cả phiên. */
  it('lượt bị cắt KHÔNG được ghi dở vào transcript', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModelCham([{ type: 'text-delta', textDelta: 'dai' }, DONE], 40);
      const session = openSession(state, dir);
      let lan = 0;
      const dong = ['cau bi cat', '/exit'];
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: async () => dong[lan++] ?? null,
        out: () => {},
        note: () => {},
        watchInterrupt: (cancel) => {
          if (lan === 1) setTimeout(cancel, 5);
          return () => {};
        },
      });
      session.close();
      const moi = openSession(state, dir);
      const vaiTro = moi.messages.map((m) => m.role);
      // Message của người dùng thì giữ — nó là ý thật. Message của model sau khi
      // bị cắt thì KHÔNG được ghi.
      expect(vaiTro).toEqual(['user']);
      moi.close();
    } finally {
      cleanup();
    }
  });

  it('lượt bình thường (không cắt) thì vẫn ghi đủ như cũ', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModelNhanh([[{ type: 'text-delta', textDelta: 'xong' }, DONE]]);
      const session = openSession(state, dir);
      const dong = ['cau 1', '/exit'];
      let lan = 0;
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: async () => dong[lan++] ?? null,
        out: () => {},
        note: () => {},
        watchInterrupt: () => () => {},
      });
      session.close();
      const moi = openSession(state, dir);
      expect(moi.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      moi.close();
    } finally {
      cleanup();
    }
  });

  /* Dọn listener sau mỗi lượt, nếu không thì phím Esc của lượt sau sẽ kích hoạt
   * `cancel` của lượt đã xong — và cắt nhầm. */
  it('ngừng lắng nghe sau mỗi lượt', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModelNhanh([[{ type: 'text-delta', textDelta: 'a' }, DONE]]);
      const session = openSession(state, dir);
      let soLanDon = 0;
      const dong = ['cau 1', 'cau 2', '/exit'];
      let lan = 0;
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: async () => dong[lan++] ?? null,
        out: () => {},
        note: () => {},
        watchInterrupt: () => {
          return () => {
            soLanDon++;
          };
        },
      });
      expect(soLanDon, 'moi lan chay deu phai don listener').toBe(2);
    } finally {
      cleanup();
    }
  });

  it('báo cho người dùng biết lượt đã bị cắt', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModelCham([{ type: 'text-delta', textDelta: 'dai' }, DONE], 40);
      const session = openSession(state, dir);
      const noiDung: string[] = [];
      const dong = ['cau bi cat', '/exit'];
      let lan = 0;
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: async () => dong[lan++] ?? null,
        out: () => {},
        note: (s) => noiDung.push(s),
        watchInterrupt: (cancel) => {
          if (lan === 1) setTimeout(cancel, 5);
          return () => {};
        },
      });
      /* Regex phải **cụ thể**. Bản đầu dùng `/cat/i` và vẫn xanh khi nhánh "bị cắt" bị
   vô hiệu — vì nhánh lỗi thường in ra `LENH DA BI CAT`, chứa chữ `CAT`. Test xanh
   vì một chữ vô tình, tức test rỗng. */
    expect(noiDung.join('\n')).toContain('da cat lenh');
    } finally {
      cleanup();
    }
  });

  /* Trường hợp KHÔNG CÓ lưới an toàn thì hỏng: provider bỏ qua tín hiệu dừng,
   * `streamText` trả về message nửa vời, REPL ghi xuống đĩa — và từ đó mọi lượt
   * sau của phiên đều bị provider từ chối vì tool_use không có tool_result. */
  it('provider KHÔNG nghe tín hiệu dừng thì vẫn KHÔNG ghi chuỗi hở vào đĩa', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModelBoQuaDung([{ type: 'text-delta', textDelta: 'nua doi' }, DONE], 40);
      const session = openSession(state, dir);
      const dong = ['cau bi cat', '/exit'];
      let lan = 0;
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: async () => dong[lan++] ?? null,
        out: () => {},
        note: () => {},
        watchInterrupt: (cancel) => {
          if (lan === 1) setTimeout(cancel, 5);
          return () => {};
        },
      });
      session.close();
      const moi = openSession(state, dir);
      expect(moi.messages.map((m) => m.role)).toEqual(['user']);
      moi.close();
    } finally {
      cleanup();
    }
  });

  it('không có watchInterrupt thì vẫn chạy bình thường', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const { model } = stubModelNhanh([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
      const session = openSession(state, dir);
      const dong = ['cau 1', '/exit'];
      let lan = 0;
      await runRepl({
        model,
        tools: undefined,
        session,
        ask: async () => dong[lan++] ?? null,
        out: () => {},
      });
      expect(true).toBe(true);
    } finally {
      cleanup();
    }
  });
});