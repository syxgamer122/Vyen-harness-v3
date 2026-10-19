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
import { runAgentTurn, messagesDaHoanThanh } from '@/cli/agent-turn';

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

/** Message người dùng — dùng trong các test đa lượt. */
const user = (text: string) => ({ role: 'user' as const, content: text });

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
    const r = await runAgentTurn({ model, tools: tools(ghiNhat), messages: [{ role: 'user', content: 'doc file a.txt' }] });
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
      messages: [user('p')],
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
    const r = await runAgentTurn({ model, tools: t, messages: [user('p')], onToolError: (n) => seen.push(n) });
    expect(r.text).toBe('khong doc duoc');
    expect(seen).toEqual(['fs_read']);
  });

  it('không có tool thì vẫn trả lời bình thường', async () => {
    const { model, calls } = stubModel([[{ type: 'text-delta', textDelta: 'chi chat' }, DONE]]);
    const r = await runAgentTurn({ model, tools: undefined, messages: [user('p')] });
    expect(r.text).toBe('chi chat');
    expect(calls.length).toBe(1);
  });

  /* ĐÂY LÀ THỨ QUAN TRỌNG NHẤT CỦA ĐA LƯỢT.
   *
   * Một lượt có tool sinh ra một CHUỖI message, không phải một: assistant gọi
   * tool → tool trả kết quả → assistant trả lời. Nếu chỉ giữ câu trả lời cuối
   * thì transcript lưu `tool_use` mà không có `tool_result`, và provider từ chối
   * **mọi lượt sau** của phiên đó — tức một chỗ thiếu làm hỏng cả cuộc hội thoại.
   *
   * Vì vậy phải trả về đủ, và người gọi ghi đủ. */
  it('trả về CẢ message gọi tool và message kết quả, không chỉ câu trả lời cuối', async () => {
    const { model } = stubModel([
      [
        { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
        { ...DONE, finishReason: 'tool-calls' },
      ],
      [{ type: 'text-delta', textDelta: 'da doc xong' }, DONE],
    ]);
    const r = await runAgentTurn({ model, tools: tools(), messages: [user('doc a.txt')] });

    const vaiTro = r.messages.map((m) => m.role);
    expect(vaiTro, 'phai co assistant (goi tool) roi moi co tool (ket qua)').toEqual([
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  it('mọi tool-use đều có tool-result khớp id trong cùng lượt', async () => {
    const { model } = stubModel([
      [
        { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
        { ...DONE, finishReason: 'tool-calls' },
      ],
      [{ type: 'text-delta', textDelta: 'xong' }, DONE],
    ]);
    const r = await runAgentTurn({ model, tools: tools(), messages: [user('doc')] });
    /* Gom mọi part của mọi message ra một danh sách phẳng. Kiểu `content` của AI
     * SDK là union rất rộng, nên gom xong ép một lần — test chỉ cần biết có part
     * `tool-call` và `tool-result` khớp id hay không, không cần kiểu chính xác. */
    const part = (m: { content: unknown }): { type?: string; toolCallId?: string }[] =>
      Array.isArray(m.content) ? (m.content as { type?: string; toolCallId?: string }[]) : [];
    const tatCa = r.messages.flatMap((m) => part(m as { content: unknown }));
    const goi = tatCa.filter((c) => c.type === 'tool-call');
    const coKetQua = tatCa.filter((c) => c.type === 'tool-result');
    expect(goi.length).toBeGreaterThan(0);
    for (const g of goi) {
      const id = g.toolCallId;
      expect(
        coKetQua.some((k) => k.toolCallId === id),
        `tool-call ${id} khong co tool-result tuong ung`,
      ).toBe(true);
    }
  });

  it('lịch sử đầu vào đi qua tới model (đa lượt thật sự đa lượt)', async () => {
    const { model, calls } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
    await runAgentTurn({
      model,
      tools: undefined,
      messages: [user('cau 1'), { role: 'assistant', content: 'tra loi 1' }, user('cau 2')],
    });
    // Định dạng `ai@4` chuyển messages thành `{role, content}` cho provider. Nếu
    // chỉ gửi lượt cuối thì provider mất bối cảnh — đúng lỗi "quên mất lượt trước".
    const guiDi = JSON.stringify(calls[0]);
    expect(guiDi, 'khong gui cau 1').toContain('cau 1');
    expect(guiDi, 'khong gui tra loi 1').toContain('tra loi 1');
    expect(guiDi, 'khong gui cau 2').toContain('cau 2');
  });

  it('system prompt tới được model', async () => {
    const { model, calls } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
    await runAgentTurn({
      model,
      tools: undefined,
      messages: [user('p')],
      system: 'ban la tro ly lap trinh',
    });
    expect(JSON.stringify(calls[0])).toContain('tro ly lap trinh');
  });

  it('trả về số token để in ra cuối lượt', async () => {
    const { model } = stubModel([[{ type: 'text-delta', textDelta: 'ok' }, DONE]]);
    const r = await runAgentTurn({ model, tools: undefined, messages: [user('p')] });
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
    await expect(runAgentTurn({ model: bad, tools: undefined, messages: [user('p')] })).rejects.toThrow(
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
    await expect(runAgentTurn({ model, tools: undefined, messages: [user('p')] })).rejects.toThrow(
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
      runAgentTurn({ model, tools: tools(), messages: [user('p')] }),
    ).rejects.toThrow(/500/);
  });
});


describe('runAgentTurn — finishReason', () => {
  it('trả finishReason của lượt', async () => {
    const { model } = stubModel([[{ type: 'text-delta', textDelta: 'xin chao' }, DONE]]);
    const r = await runAgentTurn({ model, messages: [{ role: 'user', content: 'hi' }] });
    expect(r.usage.finishReason).toBe('stop');
  });

  it('lượt có tool cũng trả finishReason', async () => {
    const { model } = stubModel([
      [
        { type: 'tool-call', toolCallId: 't1', toolName: 'fs_read', args: '{"path":"a.txt"}' },
        { ...DONE, finishReason: 'tool-calls' },
      ],
      [{ type: 'text-delta', textDelta: 'xong' }, DONE],
    ]);
    const r = await runAgentTurn({
      model,
      tools: tools([]),
      messages: [{ role: 'user', content: 'doc file a.txt' }],
    });
    expect(r.usage.finishReason).toBe('stop');
  });

  it('finishReason là "length" thì phải báo đúng — dùng để bắt tràn ngầm', async () => {
    const { model } = stubModel([
      [{ type: 'text-delta', textDelta: 'bi cat' }, { ...DONE, finishReason: 'length' }],
    ]);
    const r = await runAgentTurn({ model, messages: [{ role: 'user', content: 'hi' }] });
    expect(r.usage.finishReason).toBe('length');
  });
});


/* ============ LƯỢT HỎNG GIỮA CHỪNG: GIỮ LẠI PHẦN TOOL ĐÃ CHẠY XONG ============
 *
 * Đo 2026-10-20 (reviewer độc lập): lượt hỏng giữa chừng thì `runAgentTurn` ném lỗi
 * **trước** khi đọc `result.response` ⇒ mọi tool đã chạy xong biến mất khỏi
 * transcript.
 *
 * Hậu quả thật: `fs_write` ĐÃ ghi file, nhưng transcript chỉ còn câu hỏi của người
 * dùng ⇒ `/compact` không biết có file nào vừa bị sửa, và đường `overflow` thử lại
 * ⇒ model **làm lại** đúng các tool call đó ⇒ `fs_write`/`git_commit` chạy hai lần.
 *
 * Đo thêm (bằng script, đã xoá): `result.response.messages` resolve ra **undefined** khi
 * stream lỗi ⇒ không khôi phục được từ đó. Nhưng `fullStream` **có** phát part
 * `tool-call` lẫn `tool-result` (và `args` là object đã parse) ⇒ dựng lại được từ
 * chính stream.
 *
 * Ràng buộc an toàn: chỉ ghi phần **ĐẦY ĐỦN** (tool-call có tool-result tương ứng).
 * Tool call chưa có kết quả thì không ghi — ghi nó là tạo chuỗi hở, mà chuỗi hở làm
 * provider từ chối MỌI lượt sau của phiên.
 */
describe('runAgentTurn — lượt hỏng giữa chừng', () => {
  it('lỗi vẫn phải nổi ra', async () => {
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
      runAgentTurn({ model, tools: tools([]), messages: [user('p')] }),
    ).rejects.toThrow(/500/);
  });

  it('giữ lại phần tool ĐÃ chạy xong để không phải làm lại', async () => {
    const ghiNhat: string[] = [];
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
    let loi: unknown;
    try {
      await runAgentTurn({ model, tools: tools(ghiNhat), messages: [user('p')] });
    } catch (e) {
      loi = e;
    }
    expect(ghiNhat, 'tool phai da chay').toEqual(['a.txt']);

    const daHoanThanh = messagesDaHoanThanh(loi);
    expect(daHoanThanh).toHaveLength(2);
    expect(daHoanThanh[0].role).toBe('assistant');
    expect(daHoanThanh[1].role).toBe('tool');
    // Kết quả tool phải còn nguyên trong message.
    expect(JSON.stringify(daHoanThanh[1])).toContain('NOI DUNG');
  });

  it('mọi tool-call được ghi đều có tool-result tương ứng — không bao giờ ghi chuỗi hở', async () => {
    /* AI SDK luôn chạy tool rồi mới sang lượt sau, nên "tool-call không kết quả"
     * gần như không xảy ra. Điều đáng canh là **bất biến**: phần ghi ra không bao giờ
     * chứa một tool-call mà không có tool-result tương ứng — vì chuỗi hở làm provider
     * từ chối MỌI lượt sau của phiên. */
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
    let loi: unknown;
    try {
      await runAgentTurn({ model, tools: tools([]), messages: [user('p')] });
    } catch (e) {
      loi = e;
    }
    const daHoanThanh = messagesDaHoanThanh(loi);
    const coKetQua = new Set(
      daHoanThanh
        .filter((m) => m.role === 'tool')
        .flatMap((m) => (m.content as { type?: string; toolCallId?: string }[]).map((p) => p.toolCallId ?? '')),
    );
    for (const m of daHoanThanh) {
      if (m.role !== 'assistant') continue;
      for (const p of m.content as { type?: string; toolCallId?: string }[]) {
        if (p.type !== 'tool-call') continue;
        expect(coKetQua.has(p.toolCallId ?? ''), 'tool-call khong co tool-result').toBe(true);
      }
    }
  });
});
