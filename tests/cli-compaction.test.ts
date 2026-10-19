/**
 * Cơ chế nén context của CLI — chọn ranh giới và tạo bản tóm tắt.
 *
 * ============ VÌ SAO TEST BẰNG MODEL GIẢ ============
 *
 * Gọi model thật cần API key và mạng ⇒ test phụ thuộc thứ ngoài repo và đỏ theo
 * hạ tầng chứ không theo code. Ở đây dựng một `LanguageModelV1` giả — cùng khuôn với
 * `tests/cli-agent-turn.test.ts`.
 *
 * ============ RANH GIỚI NÉN LÀ CHỖ DỄ HỎNG NHẤT ============
 *
 * `CoreMessage` tách tool-call (assistant) và tool-result (message `tool`) thành
 * hai message. Nếu điểm cắt rơi giữa chúng, phần giữ lại bắt đầu bằng một
 * `tool-result` **mồ côi** ⇒ provider trả 400 ở **mọi** lượt sau của phiên, tức
 * một sự cố hiếm biến thành phiên chết vĩnh viễn. Ngoài ra Anthropic yêu cầu
 * message đầu tiên phải là `user`.
 *
 * ⇒ Ranh giới LUÔN nằm ngay trước một message `role:'user'`.
 */
import { describe, expect, it } from 'vitest';
import type { CoreMessage, LanguageModelV1 } from 'ai';
import {
  chooseCut,
  compactConversation,
  withSummary,
  buildModelConfigs,
  createCompactionRunner,
} from '@/cli/compaction';
import { createNonStreamingFetch, nonStreamingFetch } from '@/lib/non-streaming-fetch';

/** Model giả cho `generateText` — gọi `doGenerate`, ghi lại prompt đã nhận. */
function stubModel(opts: { text?: string; fail?: boolean } = {}) {
  const seen: unknown[] = [];
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub-1',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async (o: unknown) => {
      seen.push(o);
      if (opts.fail) throw new Error('model hong');
      return {
        text: opts.text ?? 'TOM TAT',
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

const toolCall = (id: string, name: string, args: unknown): CoreMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, toolName: name, args } as never],
});
const toolResult = (id: string, name: string, result: unknown): CoreMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: id, toolName: name, result } as never],
});

describe('chooseCut — ranh giới nén', () => {
  it('phần giữ lại LUÔN bắt đầu bằng role user', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'cau 1' },
      toolCall('c1', 'fs_read', { path: 'a' }),
      toolResult('c1', 'fs_read', { content: 'x'.repeat(30_000) }),
      { role: 'assistant', content: 'xong' },
      { role: 'user', content: 'cau 2' },
      { role: 'assistant', content: 'tra loi 2' },
    ];
    const cut = chooseCut(msgs, { windowTokens: 200_000 }, { force: true });
    expect(cut).not.toBeNull();
    expect(cut!.keep[0].role).toBe('user');
  });

  it('cắt TIẾN tới message user kế tiếp — bỏ nhiều hơn chứ không giữ thêm', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'cau 1' },
      toolCall('c1', 'fs_read', { path: 'a' }),
      toolResult('c1', 'fs_read', { content: 'x'.repeat(30_000) }),
      { role: 'assistant', content: 'xong' },
      { role: 'user', content: 'cau 2' },
      { role: 'assistant', content: 'tra loi 2' },
    ];
    const cut = chooseCut(msgs, { windowTokens: 200_000 }, { force: true });
    expect(cut!.keep[0].content).toBe('cau 2');
  });

  it('lịch sử chỉ có MỘT lượt thì không nén được — trả null chứ không cắt mồ côi', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'cau 1' },
      toolCall('c1', 'fs_read', { path: 'a' }),
      toolResult('c1', 'fs_read', { content: 'x'.repeat(400_000) }),
    ];
    expect(chooseCut(msgs, { windowTokens: 200_000 }, { force: true })).toBeNull();
  });

  it('khi điểm cắt rơi GIỮA lượt thì vẫn cắt tới message user', () => {
    /* Cửa sổ nhỏ ⇒ điểm cắt theo token rơi vào giữa lượt (message assistant),
     * không phải message user. Nếu không có luật "cắt tới user", phần giữ lại sẽ
     * bắt đầu bằng `assistant` (Anthropic 400) hoặc bằng `tool` mồ côi (provider
     * 400 mọi lượt sau). */
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'cau 1' },
      toolCall('c1', 'fs_read', { path: 'a' }),
      toolResult('c1', 'fs_read', { content: 'x'.repeat(30_000) }),
      { role: 'assistant', content: 'xong' },
      { role: 'user', content: 'cau 2' },
      { role: 'assistant', content: 'tra loi 2' },
    ];
    const cut = chooseCut(msgs, { windowTokens: 32_000 }, { force: true });
    expect(cut).not.toBeNull();
    expect(cut!.keep[0].role).toBe('user');
    expect(cut!.keep[0].content).toBe('cau 2');
  });

  it('không cắt được thì trả null (chưa đủ lịch sử)', () => {
    const msgs: CoreMessage[] = [{ role: 'user', content: 'cau 1' }];
    expect(chooseCut(msgs, { windowTokens: 200_000 })).toBeNull();
  });

  it('lịch sử NGẮN mà nặng: không ép thì không nén được, ép thì nén được', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'cau 1' },
      toolCall('c1', 'fs_read', { path: 'a' }),
      toolResult('c1', 'fs_read', { content: 'x'.repeat(400_000) }),
      { role: 'assistant', content: 'xong' },
      { role: 'user', content: 'cau 2' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'cau 3' },
      { role: 'assistant', content: 'ok' },
    ];
    // Không ép: `splitForCompaction` trả null vì sàn 6 tin.
    expect(chooseCut(msgs, { windowTokens: 200_000 })).toBeNull();
    expect(chooseCut(msgs, { windowTokens: 200_000 }, { force: true })).not.toBeNull();
  });
});

describe('withSummary', () => {
  it('không có summary thì system prompt giữ nguyên', () => {
    expect(withSummary('SYSTEM', undefined)).toBe('SYSTEM');
    expect(withSummary('SYSTEM', '   ')).toBe('SYSTEM');
  });
  it('có summary thì ghép vào sau system', () => {
    const p = withSummary('SYSTEM', 'TOM TAT');
    expect(p).toContain('SYSTEM');
    expect(p).toContain('TOM TAT');
  });
});

describe('compactConversation', () => {
  /* Fixture NẶNG — đúng ca thật: nén chỉ xảy ra khi payload lớn, nên phần bị bỏ
   * phải lớn hơn bản tóm tắt. Dùng fixture nhỏ thì bản tóm tắt LỚN HƠN phần bị
   * bỏ ⇒ payload không giảm ⇒ 'failed' — đúng hành vi, nhưng không phải ca ta
   * đang kiểm ở đây. */
  const msgsNang: CoreMessage[] = [
    { role: 'user', content: 'them file test' },
    toolCall('c1', 'fs_write', { path: 'a.txt' }),
    toolResult('c1', 'fs_write', { content: 'x'.repeat(30_000) }),
    { role: 'assistant', content: 'da them file test' },
    { role: 'user', content: 'them them file nua' },
    { role: 'assistant', content: 'ok' },
  ];

  /* Fixture NHẸ — dùng cho ca "nén không làm payload giảm" và ca "chưa vượt ngưỡng". */
  const msgsNhe: CoreMessage[] = [
    { role: 'user', content: 'them file test' },
    toolCall('c1', 'fs_write', { path: 'a.txt' }),
    toolResult('c1', 'fs_write', { ok: true }),
    { role: 'assistant', content: 'da them file test' },
    { role: 'user', content: 'them them file nua' },
    { role: 'assistant', content: 'ok' },
  ];

  it('trả summary và state tích luỹ', async () => {
    const { model } = stubModel({ text: 'TOM TAT' });
    const r = await compactConversation({ messages: msgsNang, model, system: 'SYSTEM', force: true });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.summary).toContain('TOM TAT');
    expect(r.state.filesWritten).toContain('a.txt');
    expect(r.state.completedRequests).toContain('them file test');
    expect(r.olderCount).toBeGreaterThan(0);
    expect(r.keptCount).toBeGreaterThan(0);
  });

  it('model hỏng thì dùng emergency summary, KHÔNG ném', async () => {
    const { model } = stubModel({ fail: true });
    const r = await compactConversation({ messages: msgsNang, model, system: 'SYSTEM', force: true });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    // Emergency summary trích được yêu cầu người dùng ⇒ không rỗng.
    expect(r.summary.length).toBeGreaterThan(0);
    expect(r.summary).toContain('them file test');
  });

  it('nén xong mà payload KHÔNG giảm thì báo failed — không báo thành công sai', async () => {
    // Fixture nhẹ: phần bị bỏ rất nhỏ, nên bản tóm tắt (bị chặn ở 16.000 ký tự)
    // LỚN HƠN phần bị bỏ ⇒ payload không giảm.
    const { model } = stubModel({ text: 'x'.repeat(30_000) });
    const r = await compactConversation({ messages: msgsNhe, model, system: 'SYSTEM', force: true });
    expect(r.kind).toBe('failed');
  });

  it('bản tóm tắt TRƯỚC được truyền vào prompt của lượt nén sau', async () => {
    const { model, seen } = stubModel({ text: 'TOM TAT' });
    await compactConversation({
      messages: msgsNang,
      model,
      system: 'SYSTEM',
      force: true,
      previousSummary: 'BUA TRUOC',
    });
    const prompt = JSON.stringify(seen);
    expect(prompt).toContain('BUA TRUOC');
  });

  it('chưa vượt ngưỡng thì bỏ qua, không gọi model', async () => {
    const { model, seen } = stubModel({ text: 'TOM TAT' });
    const r = await compactConversation({ messages: msgsNhe, model, system: 'SYSTEM' });
    expect(r.kind).toBe('skipped');
    expect(seen).toHaveLength(0);
  });
});


describe('buildModelConfigs — HAI instance model', () => {
  const cfg = { kind: 'openai-compatible' as const, apiKey: 'k', model: 'm' };

  it('model CHAT không dùng fetch ép stream:false', () => {
    const { chat, nen } = buildModelConfigs(cfg);
    expect(chat.fetch).toBeUndefined();
    expect(nen.fetch).toBe(nonStreamingFetch);
  });

  it('model CHAT GIỮ fetch của người dùng — chỉ lượt tóm tắt mới bị ép', () => {
    const fetchNguoiDung = (async () => new Response('{}')) as unknown as typeof fetch;
    const { chat, nen } = buildModelConfigs({ ...cfg, fetch: fetchNguoiDung });
    expect(chat.fetch).toBe(fetchNguoiDung);
    expect(nen.fetch).toBe(nonStreamingFetch);
  });

  it('fetch ép stream:false THẬT SỰ làm stream:false — nên tuyệt đối không dùng cho chat', async () => {
    const bodies: string[] = [];
    const spy = createNonStreamingFetch(async (_input, init) => {
      bodies.push(String(init?.body));
      return new Response('{}', { status: 200 });
    });
    await spy('http://x', { method: 'POST', body: JSON.stringify({ model: 'm', stream: true }) });
    expect(bodies[0]).toContain('"stream":false');
  });
});


describe('createCompactionRunner — debounce khi nén THẤT BẠI', () => {
  it('ghi marker lỗi thì không gọi lại model ở lượt sau', async () => {
    /* Tình huống thật: đĩa đầy / rút USB ⇒ `session.compact()` ném. Nếu mỗi lượt
     * lại gọi model tóm tắt thì mỗi lượt đều tốn tiền mà không nén được gì. */
    const { model, seen } = stubModel({ text: 'TOM TAT' });
    /* Lịch sử phải VƯỢT ngưỡng (32.000 token cửa sổ ⇒ ngưỡng nén 16.000 token) và
     * đủ dài để `splitForCompaction` không trả null (sàn 6 tin). 16 message, mỗi
     * tool result 30.000 ký tự = 7.500 token ⇒ tổng 30.000 token. */
    const lon: CoreMessage[] = [];
    for (let i = 0; i < 4; i++) {
      lon.push({ role: 'user', content: `cau ${i}` });
      lon.push({
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: `t${i}`, toolName: 'fs_read', args: { path: `a${i}` } } as never],
      });
      lon.push({
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
      lon.push({ role: 'assistant', content: 'xong' });
    }
    const fakeSession = {
      header: { kind: 'header', sessionId: 's', directory: 'd', createdAt: '' },
      messages: lon,
      compaction: undefined,
      append: () => {},
      appendAll: () => {},
      reset: () => {},
      compact: () => {
        throw new Error('het cho ghi marker');
      },
      close: () => {},
    } as unknown as Parameters<typeof createCompactionRunner>[0]['session'];

    const runner = createCompactionRunner({
      session: fakeSession,
      model,
      system: 'SYSTEM',
      windowTokens: 32_000,
    });

    const r1 = await runner.nen('auto');
    const r2 = await runner.nen('auto');
    expect(r1, 'ghi marker that bai ⇒ bao loi, khong ap dung').toBe(false);
    expect(r2, 'luot sau phai bi debounce').toBe(false);
    expect(seen.length, 'model khong duoc goi lai oan').toBe(1);
  });
});
