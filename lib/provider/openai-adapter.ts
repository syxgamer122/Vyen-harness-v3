/**
 * Adapter OpenAI-compatible.
 *
 * Bóc từ `app/api/chat/route.ts` (hai chỗ `createOpenAI({` ở dòng 1709 và 1718 —
 * một cho stream, một cho non-stream). Ở đây chỉ dựng MỘT instance và trả model;
 * vòng `streamText` thuộc plan sau.
 *
 * KHÔNG sao chép comment dài của `route.ts` sang — tham chiếu tới nó là đủ.
 *
 * Plan: docs/superpowers/plans/2026-10-18-provider-layer.md
 */
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { ProviderRuntimeConfig } from './adapter';

/**
 * Dựng model theo cấu hình runtime.
 *
 * `baseUrl` bỏ trống thì SDK dùng base URL mặc định của OpenAI — nhánh BYOK cho
 * gateway tự khai báo.
 */
export function resolveOpenAIModel(cfg: ProviderRuntimeConfig): LanguageModel {
  const openai = createOpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
  return openai(cfg.model);
}
