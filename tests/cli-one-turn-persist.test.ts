/**
 * Đường `-p` (một lượt rồi thoát) phải ghi được phần ĐÃ HOÀN THÀNH khi lượt hỏng,
 * và mọi dòng chẩn đoán phải đi qua `note` (không phải `console.error`).
 *
 * ============ LỖI ĐÃ KIỂM CHỨNG ============
 *
 * `cli/repl.ts` xử lý lỗi đúng: lấy `messagesDaHoanThanh(e)` rồi
 * `session.appendAll(...)` — phần tool đã chạy xong vẫn nằm trong transcript,
 * nên `/compact` biết file nào vừa bị sửa và lượt thử lại không làm lại tool.
 *
 * `chayMotLuot` (đường `-p`) thì **không**: nó chỉ ghi `turn.messages` khi lượt
 * THÀNH CÔNG (`cli/index.ts:258`). Lượt hỏng ⇒ transcript chỉ còn câu hỏi của
 * người dùng, không có dấu vết tool đã chạy.
 *
 * Thêm nữa: `chayMotLuot` in chẩn đoán bằng `console.error` trực tiếp, bỏ qua
 * `opts.note` ⇒ người gọi (và test) không bắt được dòng nào cả.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { LanguageModelV1, LanguageModelV1StreamPart } from 'ai';
import type { ToolSet } from 'ai';
import { chayMotLuot } from '@/cli/index';
import { openSession } from '@/cli/session';

type StubPart = LanguageModelV1StreamPart | Record<string, unknown>;

const DONE = {
  type: 'finish' as const,
  finishReason: 'stop' as const,
  usage: { promptTokens: 1, completionTokens: 1 },
};

/** Model giả trả về đúng kịch bản stream đã định sẵn (mỗi lần gọi một lượt). */
function stubModel(script: StubPart[][]) {
  let i = 0;
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub-1',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async () => {
      throw new Error('stub khong ho tro doGenerate');
    },
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
  return model;
}

/** Model giả cho lượt TÓM TẮT — `doGenerate` (dùng khi nén context). */
function stubNen(text = 'TOM TAT'): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub-nen',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async () => ({
      text,
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1 },
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
    doStream: () => {
      throw new Error('stub khong ho tro doStream');
    },
  } as unknown as LanguageModelV1;
}

function mk() {
  const state = mkdtempSync(path.join(tmpdir(), 'vyen-onep-'));
  const dir = mkdtempSync(path.join(tmpdir(), 'vyen-du-an-'));
  return {
    state,
    dir,
    cleanup: () => {
      rmSync(state, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const TOOLS = {
  fs_read: {
    description: 'doc file',
    parameters: z.object({ path: z.string().optional() }),
    execute: async () => ({ content: 'NOI DUNG' }),
  },
} as unknown as ToolSet;

describe('đường -p — lượt hỏng vẫn ghi được phần đã hoàn thành', () => {
  it('lượt hỏng vì TRÀN CONTEXT cũng phải gữ phần tool đã hoàn thành', async () => {
    /* Đây là ca mà đường `-p` khác REPL: REPL ghi phần đã hoàn thành TRƯỚC khi
     * xử lý nhánh tràn context (`cli/repl.ts`), còn `-p` xử lý tràn context
     * TRƯỚC rồi mới ghi ⇒ `continue` bỏ qua lệnh ghi ⇒ phần tool đã chạy xong
     * biến mất khỏi transcript ⇒ lượt thử lại chạy lại đúng tool call đó ⇒
     * **ghi file hai lần** (đúng cái hậu quả mà comment của đường REPL nêu). */
    const { state, dir, cleanup } = mk();
    const exitCodeTruoc = process.exitCode;
    try {
      /* Lịch sử phải ĐỦ DÀI và NẶNG để nén được (cùng cách dựng của
       * `tests/cli-repl-compaction.test.ts`): nếu lịch sử nhẹ thì
       * `splitForCompaction` trả null ⇒ nén không thành ⇒ nhánh `overflow`
       * không `continue` ⇒ test không phân biệt được thứ tự ghi. */
      const session = openSession(state, dir);
      for (let i = 0; i < 5; i += 1) {
        session.append({ role: 'user', content: `cau ${i}` });
        session.append({ role: 'assistant', content: `tra loi ${i}` });
        session.append({
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: `t${i}`, toolName: 'fs_read', args: { path: `a${i}.txt` } },
          ] as never,
        });
        session.append({
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

      const model = stubModel([
        [
          { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
          { ...DONE, finishReason: 'tool-calls' },
        ],
        [
          /* Lượt 2: provider TỪ CHỐI vì tràn context (lỗi nằm TRONG stream —
           * đúng dạng lỗi mà `runAgentTurn` gắn phần tool đã chạy xong vào). */
          { type: 'error', error: new Error('prompt is too long') },
          DONE,
        ],
        [
          /* Lượt 3: lượt THỬ LẠI sau khi nén — thành công. */
          { type: 'text-delta', textDelta: 'xong roi' },
          DONE,
        ],
      ]);

      const modelNen = stubNen('TOM TAT');
      await chayMotLuot({
        lm: model,
        lmNen: modelNen,
        session,
        question: 'doc file a.txt',
        tools: TOOLS,
        maxTokens: 100,
        apiKey: 'sk-test',
        model: 'stub-1',
        system: 'SYSTEM',
        windowTokens: 32_000,
        out: () => {},
        note: () => {},
      });

      expect(
        JSON.stringify(session.messages),
        'kết quả tool đã chạy xong phải còn trong transcript (không được mất)',
      ).toContain('NOI DUNG');
    } finally {
      process.exitCode = exitCodeTruoc;
      cleanup();
    }
  });

  it('transcript phải chứa phần tool ĐÃ chạy xong trước khi lượt hỏng', async () => {
    const { state, dir, cleanup } = mk();
    const exitCodeTruoc = process.exitCode;
    try {
      const model = stubModel([
        [
          { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
          { ...DONE, finishReason: 'tool-calls' },
        ],
        [
          { type: 'text-delta', textDelta: 'da doc' },
          { type: 'error', error: new Error('500 upstream exploded') },
          DONE,
        ],
      ]);

      const session = openSession(state, dir);
      await chayMotLuot({
        lm: model,
        lmNen: model,
        session,
        question: 'doc file a.txt',
        tools: TOOLS,
        maxTokens: 100,
        apiKey: 'sk-test',
        model: 'stub-1',
        system: 'SYSTEM',
        out: () => {},
        note: () => {},
      });

      const roles = session.messages.map((m) => m.role);
      expect(roles, 'phải có câu hỏi + phần tool đã hoàn thành').toContain('tool');
      expect(JSON.stringify(session.messages)).toContain('NOI DUNG');
    } finally {
      process.exitCode = exitCodeTruoc;
      cleanup();
    }
  });

  it('chẩn đoán phải đi qua note, KHÔNG in thẳng ra console.error', async () => {
    const { state, dir, cleanup } = mk();
    const exitCodeTruoc = process.exitCode;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const model = stubModel([
        [{ type: 'error', error: new Error('500 upstream exploded') }, DONE],
      ]);

      const session = openSession(state, dir);
      const noteLines: string[] = [];
      await chayMotLuot({
        lm: model,
        lmNen: model,
        session,
        question: 'hỏi cho lỗi',
        tools: TOOLS,
        maxTokens: 100,
        apiKey: 'sk-test',
        model: 'stub-1',
        system: 'SYSTEM',
        out: () => {},
        note: (s) => noteLines.push(s),
      });

      expect(noteLines.join('\n').trim(), 'phải có chẩn đoán qua note').not.toBe('');
      expect(
        noteLines.join('\n'),
        'chẩn đoán phải nói rõ cần đổi key hay không',
      ).toContain('phai doi key');
      expect(
        spy.mock.calls.flat().join('\n'),
        'không được in chẩn đoán thẳng ra console.error',
      ).not.toContain('phai doi key');
    } finally {
      spy.mockRestore();
      process.exitCode = exitCodeTruoc;
      cleanup();
    }
  });

  it('dòng token/usage của lượt thành công cũng phải qua note', async () => {
    const { state, dir, cleanup } = mk();
    const exitCodeTruoc = process.exitCode;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const model = stubModel([[{ type: 'text-delta', textDelta: 'xong' }, DONE]]);

      const session = openSession(state, dir);
      const noteLines: string[] = [];
      await chayMotLuot({
        lm: model,
        lmNen: model,
        session,
        question: 'hỏi cho xong',
        tools: TOOLS,
        maxTokens: 100,
        apiKey: 'sk-test',
        model: 'stub-1',
        system: 'SYSTEM',
        out: () => {},
        note: (s) => noteLines.push(s),
      });

      expect(noteLines.join('\n')).toContain('token:');
      expect(spy.mock.calls.flat().join('\n')).not.toContain('token:');
    } finally {
      spy.mockRestore();
      process.exitCode = exitCodeTruoc;
      cleanup();
    }
  });
});
