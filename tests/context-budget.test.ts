import { describe, expect, it } from 'vitest';
import {
  estimateContextTokens,
  estimatePromptTokens,
  evaluateUsageTrigger,
  isContextOverflowError,
  retainedTailBudget,
  shouldCompact,
  splitForCompaction,
  KEEP_RECENT_MESSAGES,
  KEEP_RECENT_TOKENS,
  MIN_KEEP_RECENT_TOKENS,
  MIN_MESSAGES_TO_COMPACT,
  FALLBACK_CONTEXT_WINDOW,
  IMAGE_TOKEN_ESTIMATE,
  RESERVE_TOKENS,
  clampReserveTokens,
  reserveTokensFor,
} from '@/lib/context-budget';
import { capabilityFor } from '@/lib/models';

const msg = (content: string, attachments?: Array<{ contentType?: string; url?: string }>) => ({
  role: 'user',
  content,
  ...(attachments ? { experimental_attachments: attachments } : {}),
});

describe('estimateContextTokens — chars/4 + ảnh hằng số', () => {
  it('chuỗi đơn giản', () => {
    expect(estimateContextTokens([msg('abcd'.repeat(100))])).toBe(100);
    expect(estimateContextTokens([msg('abc')])).toBe(1); // ceil(3/4)
  });

  it('content dạng mảng parts của AI SDK', () => {
    const m = { role: 'user', content: [{ type: 'text', text: 'x'.repeat(80) }] };
    expect(estimateContextTokens([m])).toBe(20);
  });

  it('ảnh đính kèm tính IMAGE_TOKEN_ESTIMATE, không cộng base64', () => {
    const img = { contentType: 'image/png', url: 'data:image/png;base64,' + 'A'.repeat(4000) };
    expect(estimateContextTokens([msg('hi', [img])])).toBe(1 + IMAGE_TOKEN_ESTIMATE);
  });

  it('attachment phi-ảnh trần theo độ dài URL', () => {
    const pdf = { contentType: 'application/pdf', url: 'data:application/pdf;base64,' + 'B'.repeat(400) };
    // 26 ký tự prefix + 400 = 426 -> ceil/4 = 107
    expect(estimateContextTokens([msg('hi', [pdf])])).toBe(1 + 107);
  });

  it('tính kết quả tool invocation theo JSON, có trần ký tự', () => {
    const m = {
      role: 'assistant',
      content: 'abcd',
      toolInvocations: [
        { state: 'call', args: { path: 'ab' } },
        { state: 'result', args: { path: 'cd' }, result: { content: 'x'.repeat(40) } },
      ],
    };
    // text 1 + args(12/4=3) + result JSON ~54/4=14
    expect(estimateContextTokens([m])).toBeGreaterThan(15);
  });

  it('bỏ qua partial-call và giá trị không serialize được', () => {
    const m = {
      role: 'assistant',
      content: '',
      toolInvocations: [
        { state: 'partial-call', args: { path: 'x'.repeat(100) } },
        { state: 'call', args: { circular: BigInt(1) } },
      ],
    };
    expect(estimateContextTokens([m])).toBe(0);
  });
});

describe('estimatePromptTokens', () => {
  it('cộng messages và các block system động', () => {
    expect(
      estimatePromptTokens([msg('abcd')], ['x'.repeat(8), undefined, null]),
    ).toBe(3);
  });
});

/**
 * Ngưỡng nén = window − reserve, nhưng reserve bị CLAMP ở nửa window
 * (`clampReserveTokens`) và mặc định nay dựng từ trần output thật của model
 * (`reserveTokensFor`, 16_384 + 1_000 = 17_384) thay vì hằng 6k cũ.
 *
 * Vì vậy các kỳ vọng dưới đây viết bằng `RESERVE` chứ không viết số: nếu
 * `capabilityFor().maxOutputTokens` đổi thì test vẫn đúng ý thay vì đỏ vì
 * con số cũ.
 */
const RESERVE = RESERVE_TOKENS;

describe('reserveTokensFor — lấy từ trần output thật của model', () => {
  it('bằng maxOutputTokens của capability cộng chỗ cho sai số ước lượng', () => {
    expect(reserveTokensFor('gpt-4o')).toBe(capabilityFor('gpt-4o').maxOutputTokens + 1_000);
  });

  it('model lạ vẫn có reserve hữu hạn, không âm, không 0', () => {
    for (const id of ['o1-mini', 'khong-co-model-nay', 'claude-opus-5', '']) {
      const r = reserveTokensFor(id);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThan(0);
    }
  });

  it('modelId rỗng/null vẫn cho reserve dùng được (demo chưa cấu hình)', () => {
    expect(reserveTokensFor('')).toBeGreaterThan(0);
    expect(reserveTokensFor(null)).toBe(reserveTokensFor(undefined));
  });
});

describe('clampReserveTokens — không để reserve nuốt hết cửa sổ', () => {
  it('reserve nhỏ giữ nguyên', () => {
    expect(clampReserveTokens(2_000, 32_000)).toBe(2_000);
  });

  it('reserve lớn bị kẹp ở nửa window', () => {
    // Đây là hậu quả của việc dựng reserve từ maxOutputTokens: gateway có
    // window 16k thì trần output 16_384 lớn hơn cửa sổ. Không clamp thì
    // `window - reserve` âm ⇒ mọi lượt đều 'threshold' ⇒ nén vô tận.
    expect(clampReserveTokens(17_384, 16_000)).toBe(8_000);
    // window 32k: 17_384 > nửa window (16k) ⇒ kẹp còn 16_000.
    expect(clampReserveTokens(17_384, 32_000)).toBe(16_000);
  });

  it('giá trị rác (NaN, âm, 0) → 0', () => {
    expect(clampReserveTokens(Number.NaN, 32_000)).toBe(0);
    expect(clampReserveTokens(-5, 32_000)).toBe(0);
    expect(clampReserveTokens(0, 32_000)).toBe(0);
  });

  it('window không hợp lệ → dùng FALLBACK_CONTEXT_WINDOW làm mốc nửa', () => {
    expect(clampReserveTokens(1_000_000, undefined)).toBe(
      Math.floor(FALLBACK_CONTEXT_WINDOW / 2),
    );
  });
});

describe('shouldCompact — tokens > window − reserve', () => {
  it('dưới ngưỡng: false; vượt ngưỡng: true', () => {
    const threshold = 32_000 - RESERVE;
    expect(shouldCompact(threshold - 5_000, 32_000)).toBe(false);
    expect(shouldCompact(threshold + 5_000, 32_000)).toBe(true);
  });

  it('window không hợp lệ -> dùng FALLBACK_CONTEXT_WINDOW', () => {
    const threshold = FALLBACK_CONTEXT_WINDOW - RESERVE;
    expect(shouldCompact(threshold - 5_000, undefined)).toBe(false);
    expect(shouldCompact(threshold + 5_000, 0)).toBe(true);
  });

  it('reserve tuỳ chỉnh', () => {
    expect(shouldCompact(9_500, 12_000, 2_000)).toBe(false);
    expect(shouldCompact(10_100, 12_000, 2_000)).toBe(true);
  });

  it('window nhỏ + reserve lớn: ngưỡng vẫn dương, không phải -∞', () => {
    // reserve 17k trên window 16k, không clamp thì 16k − 17k = âm ⇒ mọi lượt
    // đều true. Clamp phải giữ ngưỡng dương và mọi lượt đều false khi cửa
    // sổ còn trống.
    expect(shouldCompact(1_000, 16_000, 17_384)).toBe(false);
    expect(shouldCompact(9_000, 16_000, 17_384)).toBe(true);
  });
});

describe('retainedTailBudget — nửa ngưỡng, kẹp trong [MIN, KEEP_RECENT_TOKENS]', () => {
  it('window nhỏ: một nửa ngưỡng (window − reserve đã clamp)', () => {
    // 32k − clamp(17_384 → 16_000) = 16_000 -> 8_000
    const threshold = 32_000 - clampReserveTokens(RESERVE, 32_000);
    expect(retainedTailBudget(32_000)).toBe(Math.floor(threshold / 2));
  });

  it('window lớn: chạm trần tuyệt đối', () => {
    // 128k − reserve -> 61k, bị kẹp về KEEP_RECENT_TOKENS
    expect(retainedTailBudget(128_000)).toBe(KEEP_RECENT_TOKENS);
  });

  it('window tí hon vẫn giữ được sàn', () => {
    expect(retainedTailBudget(7_000)).toBe(MIN_KEEP_RECENT_TOKENS);
  });

  it('window không hợp lệ -> dùng FALLBACK', () => {
    expect(retainedTailBudget(undefined)).toBe(retainedTailBudget(FALLBACK_CONTEXT_WINDOW));
    expect(retainedTailBudget(0)).toBe(retainedTailBudget(FALLBACK_CONTEXT_WINDOW));
  });

  it('reserve lớn hơn window: kẹp theo sàn chứ không âm', () => {
    // Không clamp: 7k − 17k âm -> Math.max(MIN, floor(âm/2)) vẫn ra MIN
    // nhờ Math.max, nhưng clamp làm con số này CÓ NGHĨA thay vì trùng hợp.
    expect(retainedTailBudget(7_000, 17_384)).toBe(MIN_KEEP_RECENT_TOKENS);
  });
});

describe('splitForCompaction — cắt theo SỐ LƯỢNG và NGÂN SÁCH TOKEN', () => {
  it('hội thoại ngắn -> null (không đáng nén)', () => {
    const few = Array.from({ length: MIN_MESSAGES_TO_COMPACT }, (_, i) => msg(`m${i}`));
    expect(splitForCompaction(few)).toBeNull();
  });

  it('tin nhắn nhẹ -> vẫn cắt theo KEEP_RECENT_MESSAGES như trước', () => {
    const list = Array.from({ length: MIN_MESSAGES_TO_COMPACT + KEEP_RECENT_MESSAGES + 2 }, (_, i) =>
      msg(`m${i}`),
    );
    const out = splitForCompaction(list)!;
    expect(out.older).toHaveLength(list.length - KEEP_RECENT_MESSAGES);
    expect(out.keep).toHaveLength(KEEP_RECENT_MESSAGES);
    expect(out.firstKept).toBe(list.length - KEEP_RECENT_MESSAGES);
    expect((out.older[0] as ReturnType<typeof msg>).content).toBe('m0');
  });

  it('tool result khổng lồ: evict SÂU HƠN trần số lượng', () => {
    /* Kịch bản agent coding thật: 12 tin, mỗi tin một tool result 24k ký tự
       (~6k token). Trần số lượng giữ 8 tin => ~48k token, vẫn tràn window 32k.
       Ngân sách token (13k) chỉ cho giữ 2 tin. */
    const heavy = Array.from({ length: 12 }, (_, i) => ({
      role: 'assistant',
      content: '',
      toolInvocations: [
        { state: 'result', args: { path: `f${i}.ts` }, result: { content: 'x'.repeat(24_000) } },
      ],
    }));
    const out = splitForCompaction(heavy, 32_000)!;
    expect(out.firstKept).toBeGreaterThan(heavy.length - KEEP_RECENT_MESSAGES);
    expect(out.keptTokens).toBeLessThanOrEqual(retainedTailBudget(32_000));
  });

  it('luôn giữ lại ít nhất MỘT tin dù tin đó vượt ngân sách', () => {
    const giant = Array.from({ length: 10 }, () => msg('y'.repeat(400_000)));
    const out = splitForCompaction(giant, 32_000)!;
    expect(out.keep).toHaveLength(1);
    expect(out.firstKept).toBe(giant.length - 1);
  });

  it('điểm cắt giữa lượt -> splitTurnStart trỏ vào tin user mở lượt', () => {
    /* 15 tin, trần số lượng giữ 8 cuối => firstKept = 7 (một assistant giữa
       lượt). Phải truy ngược ra tin user mở lượt ở index 6. */
    const list = [
      ...Array.from({ length: 6 }, (_, i) => msg(`cũ ${i}`)),
      { role: 'user', content: 'sửa file cho tôi' },
      ...Array.from({ length: 8 }, (_, i) => ({ role: 'assistant', content: `bước ${i}` })),
    ];
    const out = splitForCompaction(list)!;
    expect(out.firstKept).toBe(7);
    expect(list[out.firstKept].role).toBe('assistant');
    expect(out.splitTurnStart).toBe(6);
    expect((list[out.splitTurnStart!] as { content: string }).content).toBe('sửa file cho tôi');
  });

  it('điểm cắt đúng ranh giới lượt user -> không có splitTurnStart', () => {
    const list = [
      ...Array.from({ length: 8 }, (_, i) => msg(`cũ ${i}`)),
      ...Array.from({ length: 8 }, () => ({ role: 'user', content: 'hỏi' })),
    ];
    const out = splitForCompaction(list)!;
    expect(list[out.firstKept].role).toBe('user');
    expect(out.splitTurnStart).toBeUndefined();
  });
});

describe('isContextOverflowError — regex theo provider', () => {
  it.each([
    ['Anthropic', 400, 'prompt is too long: 213462 tokens > 200000 maximum'],
    ['OpenAI', 400, 'Your input exceeds the context window of this model'],
    ['OpenRouter', 400, "This endpoint's maximum context length is 8192 tokens. However, you requested about 12000 tokens"],
    ['Groq', 400, 'Please reduce the length of the messages or completion'],
    ['Kimi', 400, 'Your request exceeded model token limit: 90000 (requested: 120000)'],
    ['Generic', 500, 'context_length_exceeded after 210000 tokens'],
  ])('%s: nhận diện qua body dù status %i', (_name, status, text) => {
    expect(isContextOverflowError(status, text)).toBe(true);
  });

  it('rate limit KHÔNG bị nhầm là tràn dù body nhắc "tokens"', () => {
    expect(
      isContextOverflowError(429, 'Too many tokens, please wait before trying again'),
    ).toBe(false);
    expect(isContextOverflowError(429, 'Rate limit exceeded for requests')).toBe(false);
  });

  it('body rỗng / lỗi thường -> false', () => {
    expect(isContextOverflowError(500, '')).toBe(false);
    expect(isContextOverflowError(undefined, 'Internal Server Error')).toBe(false);
    expect(isContextOverflowError(401, 'Unauthorized')).toBe(false);
  });
});

describe('evaluateUsageTrigger — trigger theo usage thật từ upstream', () => {
  const base = (overrides: Record<string, unknown> = {}) => ({
    promptTokens: 20_000,
    completionTokens: 500,
    finishReason: 'stop',
    windowTokens: 32_000,
    ...overrides,
  });

  it('dưới ngưỡng → skip', () => {
    expect(evaluateUsageTrigger(base({ promptTokens: 10_000 })).kind).toBe('skip');
  });

  /**
   * Hồi quy: lượt agent nhiều vòng tool cộng dồn usage ra một con số lớn hơn
   * window, nhưng request CUỐI thật ra vẫn vừa khung. Nếu caller đưa TỔNG vào
   * đây thì mọi lượt dài đều thành nén oan — nên caller phải đưa step cuối.
   * Test khoá đúng hợp đồng đó.
   */
  it('step cuối vừa khung thì skip, kể cả khi TỔNG cộng dồn vượt window', () => {
    // Ngưỡng viết bằng công thức vì reserve bị clamp theo window (xem
    // `clampReserveTokens`): "vừa khung" = ngay dưới ngưỡng đó.
    const threshold = FALLBACK_CONTEXT_WINDOW - clampReserveTokens(RESERVE, FALLBACK_CONTEXT_WINDOW);
    // Tổng cộng dồn 54,288 (nhiều vòng tool) — nhưng request cuối vẫn vừa khung.
    const totalCumulative = 54_288;
    const lastStep = threshold - 1_000;
    expect(lastStep).toBeLessThan(32_000);

    // Đưa step cuối vào → không nén.
    expect(evaluateUsageTrigger(base({ promptTokens: lastStep })).kind).toBe('skip');

    // Đưa nhầm tổng vào → nén oan. Đây chính là lỗi đã gặp.
    expect(evaluateUsageTrigger(base({ promptTokens: totalCumulative })).kind).not.toBe('skip');
  });

  it('threshold: promptTokens > window − reserve → trigger', () => {
    // Ngưỡng viết bằng công thức chứ không viết cứng: reserve nay dựng từ
    // trần output thật của model (RESERVE), không phải hằng 6k cũ.
    const threshold = FALLBACK_CONTEXT_WINDOW - clampReserveTokens(RESERVE, FALLBACK_CONTEXT_WINDOW);
    expect(evaluateUsageTrigger(base({ promptTokens: threshold - 1_000 })).kind).not.toBe('threshold');
    expect(evaluateUsageTrigger(base({ promptTokens: threshold + 1_000 })).kind).toBe('threshold');
  });

  it('silent overflow: stop + promptTokens > window → trigger', () => {
    // promptTokens 35k > window 32k nhưng finishReason vẫn 'stop'
    const d = evaluateUsageTrigger(base({ promptTokens: 35_000, finishReason: 'stop' }));
    expect(d.kind).toBe('silent_overflow');
  });

  it('length-stop zero-output: input ≥ 99% window → trigger', () => {
    const d = evaluateUsageTrigger(base({
      promptTokens: 31_800, // ≥ 32k * 0.99 = 31_680
      completionTokens: 0,
      finishReason: 'length',
    }));
    expect(d.kind).toBe('length_stop_zero_output');
  });

  it('length-stop có output + dưới ngưỡng threshold → skip', () => {
    // Dưới ngưỡng threshold (window − reserve) và có output ⇒ không phải overflow.
    const threshold = FALLBACK_CONTEXT_WINDOW - clampReserveTokens(RESERVE, FALLBACK_CONTEXT_WINDOW);
    const d = evaluateUsageTrigger(base({
      promptTokens: threshold - 2_000,
      completionTokens: 100,
      finishReason: 'length',
    }));
    expect(d.kind).toBe('skip');
  });

  it('length-stop dưới 99% window + dưới ngưỡng threshold → skip', () => {
    const d = evaluateUsageTrigger(base({
      promptTokens: 10_000, // < 31_680 và < ngưỡng threshold
      completionTokens: 0,
      finishReason: 'length',
    }));
    expect(d.kind).toBe('skip');
  });

  it('window = 0 hoặc undefined → skip (gate an toàn)', () => {
    expect(evaluateUsageTrigger(base({ windowTokens: 0 })).kind).toBe('skip');
    expect(evaluateUsageTrigger(base({ windowTokens: undefined })).kind).toBe('skip');
    expect(evaluateUsageTrigger(base({ windowTokens: null })).kind).toBe('skip');
  });

  it('promptTokens = 0 → skip (usage không tin cậy)', () => {
    expect(evaluateUsageTrigger(base({ promptTokens: 0 })).kind).toBe('skip');
  });

  it('reserve tuỳ chỉnh', () => {
    // window 32k, reserve 2k → ngưỡng 30k; 29k < 30k → skip
    expect(evaluateUsageTrigger(base({ promptTokens: 29_000, reserveTokens: 2_000 })).kind).toBe('skip');
    // 31k > 30k → threshold
    expect(evaluateUsageTrigger(base({ promptTokens: 31_000, reserveTokens: 2_000 })).kind).toBe('threshold');
  });
});
