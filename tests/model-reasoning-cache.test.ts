/**
 * Cache capability suy luận — chống hồi quy "thiếu Authorization".
 *
 * Lỗi gốc (2026-10-17): `fetchCapabilities` gọi `${base}/models` mà KHÔNG gửi
 * `Authorization`. Mọi provider đều BYOK (`providerNeedsApiKey` luôn true) ⇒ 401
 * ⇒ `cap` null ⇒ `route.ts` không gắn `providerOptions.openai.reasoningEffort` ⇒
 * mức người dùng chọn trong menu Thinking bị bỏ âm thầm, không lỗi nào hiện.
 *
 * Hai test dưới canh đúng hai mặt của lỗi:
 *  1. Header `Authorization` phải có mặt (và đúng key được truyền vào).
 *  2. Lỗi fetch KHÔNG được ghi thành entry cache rỗng — bản cũ khoá sạch cache
 *     5 phút, khiến mọi lượt sau rơi vào im lặng dù gateway vốn trả tốt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getReasoningCapability,
  resetModelReasoningCache,
} from '@/lib/model-reasoning-cache';

const BASE = 'https://api.example.com/v1';

/**
 * /models trả metadata kiểu OpenRouter: `supported_efforts: null` là cờ
 * "hỗ trợ mọi mức chuẩn" → parser chỉ map bốn mức LÕI, không bịa `none`/
 * `minimal`/`xhigh` (gateway không khai thì không có bằng chứng model nhận —
 * xem `CORE_LEVELS` trong `reasoning-capability.ts`).
 */
function modelsResponseOk() {
  return {
    ok: true,
    json: async () => ({
      data: [
        {
          id: 'gpt-x',
          supported_parameters: ['reasoning'],
          reasoning: { max_tokens: 100, supported_efforts: null },
        },
      ],
    }),
  } as unknown as Response;
}

describe('model-reasoning-cache — phải xác thực khi fetch /models', () => {
  beforeEach(() => {
    resetModelReasoningCache();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetModelReasoningCache();
  });

  it('gửi Authorization khi có apiKey — thiếu nó thì gateway BYOK trả 401', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(modelsResponseOk());
    vi.stubGlobal('fetch', fetchSpy);

    await getReasoningCapability(BASE, 'gpt-x', 'sk-secret');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
  });

  it('vẫn dùng được khi không có apiKey (gateway không yêu cầu xác thực)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(modelsResponseOk());
    vi.stubGlobal('fetch', fetchSpy);

    const cap = await getReasoningCapability(BASE, 'gpt-x');

    expect(cap).not.toBeNull();
    expect(cap?.efforts).toEqual(['low', 'medium', 'high', 'max']);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('trả capability từ metadata thật', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelsResponseOk()));

    const cap = await getReasoningCapability(BASE, 'gpt-x', 'sk-secret');

    expect(cap?.efforts).toContain('high');
    expect(cap?.mandatory).toBe(false);
  });

  it('model không khai reasoning → null, KHÔNG phải mảng rỗng', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'plain-model' }] }),
      } as unknown as Response),
    );

    const cap = await getReasoningCapability(BASE, 'plain-model', 'sk-secret');

    expect(cap).toBeNull();
  });

  it('lỗi fetch KHÔNG ghi entry rỗng vào cache — lượt sau phải thử lại', async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('401'))
      .mockResolvedValue(modelsResponseOk());
    vi.stubGlobal('fetch', fetchSpy);

    // Lần 1: gateway lỗi → cap null (không có gì để dùng).
    expect(await getReasoningCapability(BASE, 'gpt-x', 'sk-secret')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Lần 2: gateway đã hồi phục. Bản cũ trả null vì cache rỗng còn sống 5
    // phút ⇒ mức suy luận rơi im lặng trên mọi lượt tiếp theo.
    const cap = await getReasoningCapability(BASE, 'gpt-x', 'sk-secret');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(cap?.efforts).toContain('high');
  });

  it('cache thành công thì dùng lại được, không fetch lại', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(modelsResponseOk());
    vi.stubGlobal('fetch', fetchSpy);

    await getReasoningCapability(BASE, 'gpt-x', 'sk-secret');
    await getReasoningCapability(BASE, 'other-model', 'sk-secret');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('baseUrl rỗng hoặc modelId rỗng → null, không fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await getReasoningCapability('', 'gpt-x')).toBeNull();
    expect(await getReasoningCapability(BASE, '')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});