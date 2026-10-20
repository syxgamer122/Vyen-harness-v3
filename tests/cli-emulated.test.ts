/**
 * Lượt giả lập của CLI — model không hỗ trợ function calling.
 *
 * ============ VÌ SAO TEST BẰNG MODEL GIẢ ============
 *
 * Đường giả lập dùng `generateText` (buffered) ⇒ stub `doGenerate` là đủ, không cần
 * network. Như vậy test phụ thuộc code chứ không phụ thuộc hạ tầng.
 */
import { describe, expect, it } from 'vitest';
import type { LanguageModelV1, ToolSet } from 'ai';
import { z } from 'zod';
import {
  isToolsUnsupportedError,
  markEmulated,
  runEmulatedTurn,
  shouldUseEmulated,
} from '@/cli/emulated';
import { resetToolSupportCache } from '@/lib/tool-support-cache';
import { messagesDaHoanThanh } from '@/cli/agent-turn';
import { runRepl } from '@/cli/repl';
import { openSession, sessionFileFor } from '@/cli/session';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Model giả: mỗi lần gọi trả lần lượt một đoạn text. */
function stubModel(texts: string[]) {
  let i = 0;
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub-1',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async () => {
      const text = texts[Math.min(i, texts.length - 1)];
      i += 1;
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
  return model;
}


function mk() {
  const state = mkdtempSync(path.join(tmpdir(), 'vyen-emu-'));
  return {
    state,
    dir: 'C:\\du-an',
    cleanup: () => rmSync(state, { recursive: true, force: true }),
  };
}

/** Đọc từng dòng trong `dong`; hết thì trả `null` (EOF). */
function reader(...dong: (string | null)[]) {
  let i = 0;
  return async () => (i < dong.length ? dong[i++] : null);
}
const KHOI_TOOL_CALL =
  '<tool_call>\n{"name":"fs_read","arguments":{"path":"a.txt"}}\n</tool_call>';

describe('runEmulatedTurn — lượt giả lập của CLI', () => {
  it('tool của CLI chạy THẬT và kết quả quay lại trong transcript', async () => {
    const daGoi: (string | undefined)[] = [];
    const tools = {
      fs_read: {
        description: 'doc file',
        parameters: z.object({ path: z.string().optional() }),
        execute: async (args: { path?: string }) => {
          daGoi.push(args.path);
          return { content: 'NOI DUNG' };
        },
      },
    } as unknown as ToolSet;

    const r = await runEmulatedTurn({
      model: stubModel([KHOI_TOOL_CALL, 'Đã đọc xong a.txt.']),
      tools,
      messages: [{ role: 'user', content: 'doc file a.txt' }],
      system: 'SYSTEM',
    });

    expect(daGoi, 'tool phai chay that').toEqual(['a.txt']);
    expect(r.text).toContain('Đã đọc xong');
    expect(r.totalCalls).toBe(1);
    // Transcript phải có lượt assistant + lượt chứa TOOL_RESULT.
    // assistant gọi tool + user chứa TOOL_RESULT + assistant trả lời cuối.
    expect(r.messages.length).toBe(3);
    expect(r.messages[0].role).toBe('assistant');
    expect(r.messages[1].role).toBe('user');
    expect(r.messages[2].role).toBe('assistant');
    expect(JSON.stringify(r.messages[2].content)).toContain('Đã đọc xong');
    expect(JSON.stringify(r.messages)).toContain('TOOL_RESULT');
    expect(JSON.stringify(r.messages)).toContain('NOI DUNG');
  });

  it('model không gọi tool thì trả lời prose, và câu trả lời vẫn vào transcript', async () => {
    const r = await runEmulatedTurn({
      model: stubModel(['Chào bạn, tôi không cần tool.']),
      tools: {} as unknown as ToolSet,
      messages: [{ role: 'user', content: 'xin chào' }],
      system: 'SYSTEM',
    });
    expect(r.text).toContain('Chào bạn');
    expect(r.totalCalls).toBe(0);
  });
});

describe('isToolsUnsupportedError — nhận diện model chê tools', () => {
  it('nhận lỗi có câu "không hỗ trợ tools"', () => {
    expect(isToolsUnsupportedError(new Error('This model does not support tools'))).toBe(true);
    expect(
      isToolsUnsupportedError(Object.assign(new Error('Bad request'), { data: { error: 'tools are not supported' } })),
    ).toBe(true);
  });

  it('KHÔNG nhận lỗi thường', () => {
    expect(isToolsUnsupportedError(new Error('401 Unauthorized'))).toBe(false);
    expect(isToolsUnsupportedError(new Error('prompt is too long'))).toBe(false);
    expect(isToolsUnsupportedError(undefined)).toBe(false);
  });
});

describe('shouldUseEmulated / markEmulated — cache model chê tools', () => {
  it('sau khi ghi nhớ thì đi thẳng đường giả lập, khỏi tốn một lượt native chết', () => {
    resetToolSupportCache();
    const env = { providerBase: 'https://gw.test/v1', modelId: 'model-x' };
    expect(shouldUseEmulated(env)).toBe(false);
    markEmulated(env);
    expect(shouldUseEmulated(env)).toBe(true);
    resetToolSupportCache();
  });

  it('ép thì luôn đi đường giả lập', () => {
    resetToolSupportCache();
    expect(shouldUseEmulated({ force: true, modelId: 'model-y' })).toBe(true);
  });
});


/* ============ REPL TỰ CHUYỂN SANG ĐƯỜNG GIẢ LẬP ============
 *
 * Spec `docs/superpowers/specs/2026-10-18-cli-core-design.md` §7:
 * *"Model không hỗ trợ tool calling → rơi về `emulated-agent`"*. Trước đây CLI
 * không có đường đó: provider từ chối ⇒ lỗi ⇒ **phiên dừng**. Với BYOK +
 * model local (đúng thứ CLI nhắm tới) thì đó là chết cả session.
 */
describe('REPL — model không hỗ trợ tools', () => {
  it('tự chuyển sang đường giả lập và VẪN trả lời được', async () => {
    const { state, dir, cleanup } = mk();
    try {
      /* Native path (doStream) trả lỗi "không hỗ trợ tools" — đúng cách provider
       * báo lỗi API trong chế độ stream: một part `error` rồi đóng stream. */
      const model = {
        specificationVersion: 'v1',
        provider: 'stub',
        modelId: 'stub-1',
        defaultObjectGenerationMode: 'tool',
        doGenerate: async () => ({
          text: 'Tôi trả lời bằng văn bản thôi.',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(ctrl) {
                ctrl.enqueue({
                  type: 'error',
                  error: new Error('This model does not support tools'),
                } as never);
                ctrl.close();
              },
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          }),
      } as unknown as LanguageModelV1;

      const session = openSession(state, dir);
      const out: string[] = [];
      await runRepl({
        model,
        modelNen: model,
        tools: {
          fs_read: {
            description: 'doc file',
            parameters: z.object({ path: z.string().optional() }),
            execute: async () => ({ content: 'x' }),
          },
        } as unknown as ToolSet,
        session,
        ask: reader('xin chào', '/exit'),
        out: (s) => out.push(s),
      });

      expect(out.join(''), 'phai tra loi duoc qua duong gia lap').toContain('trả lời bằng văn bản');
    } finally {
      cleanup();
    }
  });

  it('lượt tiếp theo đi thẳng đường giả lập, không thử native chết lần nữa', async () => {
    const { state, dir, cleanup } = mk();
    try {
      let soLanNative = 0;
      const model = {
        specificationVersion: 'v1',
        provider: 'stub',
        modelId: 'stub-1',
        defaultObjectGenerationMode: 'tool',
        doGenerate: async () => ({
          text: 'ok',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
        doStream: () => {
          soLanNative += 1;
          return Promise.resolve({
            stream: new ReadableStream({
              start(ctrl) {
                ctrl.enqueue({
                  type: 'error',
                  error: new Error('This model does not support tools'),
                } as never);
                ctrl.close();
              },
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          });
        },
      } as unknown as LanguageModelV1;

      const session = openSession(state, dir);
      await runRepl({
        model,
        modelNen: model,
        tools: {
          fs_read: {
            description: 'doc file',
            parameters: z.object({ path: z.string().optional() }),
            execute: async () => ({ content: 'x' }),
          },
        } as unknown as ToolSet,
        session,
        providerBase: 'https://gw.test/v1',
        modelId: 'model-x',
        ask: reader('cau 1', 'cau 2', '/exit'),
        out: () => {},
      });

      /* Lượt 1 native chết (phát hiện) → ghi cache; lượt 2 phải đi thẳng giả lập. */
      expect(soLanNative, 'native chi duoc thu MOT lan').toBe(1);
    } finally {
      cleanup();
    }
  });
});


/* ============ C1: CÂU TRẢ LỜI CỦA LƯỢT GIẢ LẬP PHẢI ĐƯỢC GHI ============
 *
 * Root cause (đo, không suy đoán): `runEmulatedLoop` gọi `onTextDelta(answer)` rồi
 * `return` — KHÔNG push `{role:'assistant', content: answer}` vào `messages`.
 * Hệ quả: transcript CLI chỉ có message `user`, câu trả lời mà người dùng ĐÃ THẤY
 * trên màn hình không có ở bất kỳ đâu; lượt sau model không biết mình đã trả lời gì.
 */
describe('C1 — câu trả lời của lượt giả lập phải được GHI', () => {
  it('runEmulatedTurn trả về message chứa câu trả lời cuối', async () => {
    const r = await runEmulatedTurn({
      model: stubModel(['Chào bạn, tôi không cần tool.']),
      tools: {} as unknown as ToolSet,
      messages: [{ role: 'user', content: 'xin chào' }],
      system: 'SYSTEM',
    });
    expect(r.text).toContain('Chào bạn');
    expect(
      r.messages.some(
        (m) => m.role === 'assistant' && JSON.stringify(m.content).includes('Chào bạn'),
      ),
      'cau tra loi cuoi phai co trong messages',
    ).toBe(true);
  });

  it('lượt giả lập trong REPL: file JSONL trên đĩa phải chứa câu trả lời', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const model = {
        specificationVersion: 'v1',
        provider: 'stub',
        modelId: 'stub-1',
        defaultObjectGenerationMode: 'tool',
        doGenerate: async () => ({
          text: 'Tôi trả lời bằng văn bản thôi.',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(ctrl) {
                ctrl.enqueue({
                  type: 'error',
                  error: new Error('This model does not support tools'),
                } as never);
                ctrl.close();
              },
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          }),
      } as unknown as LanguageModelV1;

      const session = openSession(state, dir);
      await runRepl({
        model,
        modelNen: model,
        tools: {
          fs_read: {
            description: 'doc file',
            parameters: z.object({ path: z.string().optional() }),
            execute: async () => ({ content: 'x' }),
          },
        } as unknown as ToolSet,
        session,
        ask: reader('xin chào', '/exit'),
        out: () => {},
      });

      const jsonl = readFileSync(sessionFileFor(state, dir), 'utf8');
      expect(jsonl, 'cau tra loi cuoi phai duoc ghi vao dia').toContain(
        'Tôi trả lời bằng văn bản thôi.',
      );
    } finally {
      cleanup();
    }
  });
});


/* ============ B: LƯỢT GIẢ LẬP HỎNG GIỮA CHỪNG ============
 *
 * Root cause: `runEmulatedLoop` ném lỗi (upstream/abort) ⇒ mảng `messages` CỤC BỘ
 * của vòng lặp bị mất ⇒ CLI không biết tool nào ĐÃ chạy xong.
 *
 * Hậu quả (đúng lý do file `cli/repl.ts` đã cảnh báo): `fs_write` đã ghi file mà
 * transcript không có dấu vết ⇒ đường `overflow` thử lại ⇒ model LÀM LẠI đúng các
 * tool call đó ⇒ ghi file hai lần.
 */
describe('B — lượt giả lập hỏng giữa chừng', () => {
  /** Model: vòng 1 trả tool_call, vòng 2 ném lỗi upstream. */
  function modelHongGiuaChung() {
    let i = 0;
    return {
      specificationVersion: 'v1' as const,
      provider: 'stub',
      modelId: 'stub-1',
      defaultObjectGenerationMode: 'tool' as const,
      doGenerate: async () => {
        i += 1;
        if (i === 1) {
          return {
            text: KHOI_TOOL_CALL,
            finishReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 5 },
            rawCall: { rawPrompt: null, rawSettings: {} },
          };
        }
        throw new Error('upstream 500');
      },
      doStream: () => {
        throw new Error('stub khong ho tro doStream');
      },
    } as unknown as LanguageModelV1;
  }

  const toolThatChay = () => ({
    fs_read: {
      description: 'doc file',
      parameters: z.object({ path: z.string().optional() }),
      execute: async () => ({ content: 'NOI DUNG' }),
    },
  }) as unknown as ToolSet;

  it('lỗi mang theo phần tool ĐÃ chạy xong (lấy lại được qua messagesDaHoanThanh)', async () => {
    let loi: unknown = null;
    try {
      await runEmulatedTurn({
        model: modelHongGiuaChung(),
        tools: toolThatChay(),
        messages: [{ role: 'user', content: 'doc file a.txt' }],
        system: 'SYSTEM',
      });
    } catch (e) {
      loi = e;
    }
    expect(loi, 'luot phai that bai').not.toBeNull();
    const daHoanThanh = messagesDaHoanThanh(loi);
    expect(daHoanThanh.length, 'phai lay lai duoc phan da chay xong').toBeGreaterThan(0);
    expect(JSON.stringify(daHoanThanh)).toContain('TOOL_RESULT');
  });

  it('REPL: lượt giả lập hỏng giữa chừng vẫn ghi được phần đã chạy xong xuống đĩa', async () => {
    const { state, dir, cleanup } = mk();
    try {
      const session = openSession(state, dir);
      const model = {
        ...modelHongGiuaChung(),
        /* Native path phải chết ngay với lỗi "không hỗ trợ tools" để lượt đi
         * sang đường giả lập; vong giả lập 1 thì gọi tool, vong 2 thì lỗi. */
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(ctrl) {
                ctrl.enqueue({
                  type: 'error',
                  error: new Error('This model does not support tools'),
                } as never);
                ctrl.close();
              },
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          }),
      } as unknown as LanguageModelV1;

      await runRepl({
        model,
        modelNen: model,
        tools: toolThatChay(),
        session,
        ask: reader('doc file a.txt', '/exit'),
        out: () => {},
      });

      const jsonl = readFileSync(sessionFileFor(state, dir), 'utf8');
      expect(jsonl, 'phan da chay xong phai duoc ghi vao dia').toContain('TOOL_RESULT');
    } finally {
      cleanup();
    }
  });
});

describe('B — usage + finishReason của đường giả lập', () => {
  it('trả về usage và finishReason của round cuối', async () => {
    const r = await runEmulatedTurn({
      model: stubModel(['Chào bạn.']),
      tools: {} as unknown as ToolSet,
      messages: [{ role: 'user', content: 'xin chào' }],
      system: 'SYSTEM',
    });
    expect(r.usage.promptTokens, 'phai co promptTokens de bat tran ngam').toBe(1);
    expect(r.usage.completionTokens).toBe(1);
    expect(r.finishReason, 'finishReason la thu lưới tran ngam can').toBe('stop');
  });
});
