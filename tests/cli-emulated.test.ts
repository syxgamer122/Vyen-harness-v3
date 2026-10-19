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
    expect(r.messages.length).toBe(2);
    expect(r.messages[0].role).toBe('assistant');
    expect(r.messages[1].role).toBe('user');
    expect(JSON.stringify(r.messages)).toContain('TOOL_RESULT');
    expect(JSON.stringify(r.messages)).toContain('NOI DUNG');
  });

  it('model không gọi tool thì trả lời prose, không sinh message rác', async () => {
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
