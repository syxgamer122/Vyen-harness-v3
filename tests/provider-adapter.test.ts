/**
 * Task 1 — lớp provider: chọn nhánh adapter.
 *
 * Plan: docs/superpowers/plans/2026-10-18-provider-layer.md
 * Spec: docs/superpowers/specs/2026-10-18-cli-core-design.md §5
 */
import { describe, expect, it } from 'vitest';
import { resolveAdapterKind } from '@/lib/provider/adapter';

describe('resolveAdapterKind', () => {
  it('anthropic đi nhánh native', () => {
    expect(resolveAdapterKind({ kind: 'anthropic' })).toBe('anthropic');
  });

  it('openai-compatible đi nhánh OpenAI', () => {
    expect(resolveAdapterKind({ kind: 'openai-compatible' })).toBe('openai-compatible');
  });
});
