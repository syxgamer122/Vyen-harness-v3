/**
 * Vòng lặp tool của CLI — thứ biến nó từ "trả lời" thành "làm việc".
 *
 * ============ VÌ SAO TEST BẰNG MODEL GIẢ ============
 *
 * Chạy thật cần API key và mạng, tức test phụ thuộc thứ ngoài repo và đỏ theo
 * hạ tầng chứ không theo code. Ở đây ta dựng một `LanguageModelV1` giả trả về
 * đúng chuỗi stream đã định sẵn — nên "model gọi tool rồi trả lời chữ" trở
 * thành dữ liệu đầu vào, kiểm được không cần ai gọi ai.
 *
 * Và đây đúng là chỗ dễ hỏng mà không ai thấy: nếu quên `maxSteps`, `streamText`
 * trả về sau MỘT lượt và **tool call bị bỏ qua âm thầm** — không lỗi, không cảnh
 * báo, chỉ là model "không bao giờ làm được gì". Test này canh đúng điều đó.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LanguageModelV1, LanguageModelV1StreamPart } from 'ai';
import { z } from 'zod';
import { runAgentTurn } from '@/cli/agent-turn';

/**
 * Part của stub — khai báo lỏng cho dễ đọc, ép kiể **một lần** trong
 * `stubModel`.
 *
 * Vì sao phải ép: `LanguageModelV1StreamPart` là union hẹp (`args: unknown` nhưng
 * còn `providerMetadata?`, `rawCall` bắt buộc trong `doStream`…). Ghi đủ thì test
 * dành nửa chỗ cho khai báo kiểu, và mỗi lần thêm part mới lại phải sửa kiểu
 * trước khi test chạy. Một ép có chú thú ở đây rẻ hơn nhiều.
 */
type StubPart = LanguageModelV1StreamPart | Record<string, unknown>;

/**
 * Model giả: mỗi lần được gọi sẽ trả về kịch bản stream tương ứng.
 * `calls` đếm số lượt để test khẳng định vòng lặp có chạy lượt hai hay không.
 */
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
        // `rawCall` là bắt buộc trong hợp đồng của `LanguageModelV1`, dù stub
        // không dùng tới.
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

function mk() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vyen-turn-'));
  writeFileSync(path.join(dir, 'a.txt'), 'dong 1\n', 'utf8');
  const userData = mkdtempSync(path.join(tmpdir(), 'vyen-ud-'));
  return { dir, userData };
}

/**
 * Tool tối giản: không cần cả IPC, chỉ cần biết `execute` có được gọi không.
 *
 * `parameters` phải là **Zod**, không phải JSON Schema thô. Đo thật 2026-10-18:
 * truyền `{ type: 'object' }` thì AI SDK ném `Cannot read properties of undefined
 * (reading 'typeName')`. Hóa ra `CLIENT_TOOL_DEFS` đã dùng đúng `z.object(...)`
 * nên đường sản phẩm không dính — nhưng test stub phải theo đúng, nếu không nó
 * canh nhầm thứ.
 */
function tools(ghiNhat: string[] = []) {
  return {
    fs_read: {
      description: 'doc file',
      parameters: z.object({ path: z.string().optional() }),
      execute: async (args: { path?: string }) => {
        ghiNhat.push(args.path ?? '');
        return { content: 'NOI DUNG' };
      },
    },
  } as unknown as Parameters<typeof runAgentTurn>[0]['tools'];
}

describe('runAgentTurn — vòng lặp tool', () => {
  it('model gọi tool xong rồi mới trả lời chữ', async () => {
    const ghiNhat: string[] = [];
    const { model, calls } = stubModel([
      [
        { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
        { ...DONE, finishReason: 'tool-calls' },
      ],
      [
        { type: 'text-delta', textDelta: 'da doc xong' },
        DONE,
      ],
    ]);
    const r = await runAgentTurn({ model, tools: tools(ghiNhat), prompt: 'doc file a.txt' });
    expect(ghiNhat).toEqual(['a.txt']);
    expect(r.text).toBe('da doc xong');
    // 2 lượt: tool-call rồi mới có chữ. 1 lượt = quên maxSteps.
    expect(calls.length).toBe(2);
  });

  it('báo cho người dùng biết đang gọi tool nào', async () => {
    const seen: string[] = [];
    const { model } = stubModel([
      [
        { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
        { ...DONE, finishReason: 'tool-calls' },
      ],
      [{ type: 'text-delta', textDelta: 'xong' }, DONE],
    ]);
    await runAgentTurn({
      model,
      tools: tools(),
      prompt: 'p',
      onToolCall: (name) => seen.push(name),
    });
    expect(seen).toEqual(['fs_read']);
  });

  /* Tool ném lỗi là chuyện THƯỜNG (file không tồn tại, duyệt bị từ chối). Nếu
   * làm sập cả lượt thì agent chết giữa chừng thay vì thử cách khác. */
  it('tool hỏng thì KHÔNG làm sập lượt — lỗi đi tiếp cho model', async () => {
    const seen: string[] = [];
    const { model } = stubModel([
      [
        { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
        { ...DONE, finishReason: 'tool-calls' },
      ],
      [{ type: 'text-delta', textDelta: 'khong doc duoc' }, DONE],
    ]);
    const t = {
      fs_read: {
        description: 'doc file',
        parameters: z.object({ path: z.string().optional() }),
        execute: async () => {
          throw new Error('file khong ton tai');
        },
      },
    } as unknown as Parameters<typeof runAgentTurn>[0]['tools'];
    const r = await runAgentTurn({ model, tools: t, prompt: 'p', onToolError: (n) => seen.push(n) });
    expect(r.text).toBe('khong doc duoc');
    expect(seen).toEqual(['fs_read']);
  });

  it('không có tool thì vẫn trả lời bình thường', async () => {
    const { model, calls } = stubModel([[{ type: 'text-delta', textDelta: 'chi chat' }, DONE]]);
    const r = await runAgentTurn({ model, tools: undefined, prompt: 'p' });
    expect(r.text).toBe('chi chat');
    expect(calls.length).toBe(1);
  });

  it('trả về số token để in ra cuối lượt', async () => {
    const { model } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
    const r = await runAgentTurn({ model, tools: undefined, prompt: 'p' });
    expect(r.usage.promptTokens).toBe(1);
    expect(r.usage.completionTokens).toBe(1);
  });

  /* Stream lỗi (401, 429) KHÔNG ném ra `for await` — đã đo 2026-10-18. Nếu
   * `runAgentTurn` nuốt mất thì CLI in ra câu rỗng rồi exit 0, tức báo thành
   * công cho một lần gọi thất bại. */
  it('lỗi từ provider thì phải ném ra, không trả về rỗng', async () => {
    const bad: LanguageModelV1 = {
      specificationVersion: 'v1',
      provider: 'stub',
      modelId: 'bad',
      defaultObjectGenerationMode: 'json',
      doGenerate: async () => ({}) as never,
      doStream: () =>
        Promise.resolve({
          stream: new ReadableStream<LanguageModelV1StreamPart>({
            start(ctrl) {
              ctrl.error(new Error('401 Unauthorized'));
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
    };
    await expect(runAgentTurn({ model: bad, tools: undefined, prompt: 'p' })).rejects.toThrow(
      /401/,
    );
  });

  /* Đây là chỗ HAY HỎNG NHẤT và dễ bỏ sót nhất.
   *
   * Đo mã `ai@4` 2026-10-18 (`node_modules/ai/dist/index.mjs` L5381-5390):
   * `onError` được gọi khi stream chạm qua một part `{type:'error'}`, và part đó
   * **vẫn được enqueue** vào `fullStream` ngay dòng trên — tức stream **KẾT THÚC
   * BÌNH THƯỜNG**, không reject.
   *
   * Nghĩa là provider báo lỗi giữa chừng (SSE error) thì vòng lặp chạy trót,
   * không ném, `text` rỗng, và CLI in ra MỘT CÂU RỖNG rồi exit 0. Đó là báo
   * thành công cho một lần gọi thất bại — tệ hơn cả crash.
   *
   * Vì vậy `runAgentTurn` phải tự ném lỗi mà `onError` đã bắt, chứ không chờ
   * `for await`. Nếu xoá dòng `if (streamError) throw streamError;` thì test này
   * đỏ. */
  it('part lỗi giữa stream (không reject) vẫn phải ném ra', async () => {
    const { model } = stubModel([
      [
        { type: 'text-delta', textDelta: 'bat dau' },
        {
          type: 'error',
          error: Object.assign(new Error('429 Too Many Requests'), {
            data: { code: 'rate_limit' },
          }),
        },
        DONE,
      ],
    ]);
    await expect(runAgentTurn({ model, tools: undefined, prompt: 'p' })).rejects.toThrow(
      /429/,
    );
  });

  /* Cùng lý do, nhưng có tool: lỗi ở lượt hai vẫn phải nổi ra chứ không bị bỏ
   * qua vì "lượt đầu có kết quả rồi". */
  it('lỗi ở lượt sau (sau khi đã gọi tool) vẫn phải ném ra', async () => {
    const { model } = stubModel([
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
    await expect(
      runAgentTurn({ model, tools: tools(), prompt: 'p' }),
    ).rejects.toThrow(/500/);
  });
});