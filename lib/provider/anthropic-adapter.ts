/**
 * Adapter Anthropic-native — SDK chính thức, không phải endpoint OpenAI-compatible.
 *
 * **Bắt buộc: file này phải tách riêng, KHÔNG import vào `adapter.ts`.** Import
 * tĩnh kéo `@ai-sdk/anthropic` vào mọi bundle dùng `adapter.ts`, kể cả nhánh
 * OpenAI — tức người dùng BYAI sẽ tải cả SDK Anthropic dù không dùng tới. Xem
 * Review Focus #5 trong plan.
 *
 * Lý do tồn tại: spec §3 ghi repo chỉ có `@ai-sdk/openai`; Anthropic trước đó chỉ
 * xuất hiện qua `model-meta.ts` để dò tên model lấy trần context, chưa từng gọi
 * được. Đây là nhánh native đầu tiên.
 *
 * Plan: docs/superpowers/plans/2026-10-18-provider-layer.md
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { ProviderRuntimeConfig } from './adapter';

export function resolveAnthropicModel(cfg: ProviderRuntimeConfig): LanguageModel {
  const anthropic = createAnthropic({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
  return anthropic(cfg.model);
}
