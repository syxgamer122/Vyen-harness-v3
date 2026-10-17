import { describe, it, expect } from 'vitest';
import {
  stripProviderPrefix,
  resolveContract,
  calculateModelCost,
  MODEL_CONTRACTS,
} from '@/lib/model-contracts';

describe('Model Contracts & Pricing Protocol', () => {
  describe('stripProviderPrefix', () => {
    it('strips slash prefixes', () => {
      expect(stripProviderPrefix('openai/gpt-5-6-sol')).toBe('gpt-5-6-sol');
      expect(stripProviderPrefix('anthropic/claude-opus-5')).toBe('claude-opus-5');
    });

    it('strips colon prefixes', () => {
      expect(stripProviderPrefix('ollama:gpt-5-6-sol')).toBe('gpt-5-6-sol');
      expect(stripProviderPrefix('openrouter:deepseek-reasoner')).toBe('deepseek-reasoner');
    });

    it('returns raw ID if no prefix', () => {
      expect(stripProviderPrefix('o1')).toBe('o1');
      expect(stripProviderPrefix('gpt-5-6-sol')).toBe('gpt-5-6-sol');
    });
  });

  describe('resolveContract', () => {
    it('resolves known models directly', () => {
      const sol = resolveContract('gpt-5-6-sol');
      expect(sol).toBeDefined();
      expect(sol?.id).toBe('gpt-5-6-sol');
    });

    it('resolves prefixed models properly', () => {
      const opus = resolveContract('anthropic/claude-opus-5');
      expect(opus).toBeDefined();
      expect(opus?.id).toBe('claude-opus-5');
    });

    it('returns undefined for unregistered models', () => {
      expect(resolveContract('non-existent-super-model')).toBeUndefined();
      expect(resolveContract('')).toBeUndefined();
    });
  });

  describe('calculateModelCost', () => {
    it('calculates cost accurately for models with listed pricing', () => {
      // gpt-5-6-sol: in: 3.5/M, out: 14.0/M, cachedIn: 1.75/M
      const cost = calculateModelCost('gpt-5-6-sol', {
        promptTokens: 100_000,
        completionTokens: 20_000,
        cachedPromptTokens: 40_000,
      });

      // regular prompt: 60k -> 60_000 * 3.5 / 1M = 0.21
      // cached prompt: 40k -> 40_000 * 1.75 / 1M = 0.07
      // completion: 20k -> 20_000 * 14.0 / 1M = 0.28
      // total = 0.21 + 0.07 + 0.28 = 0.56
      expect(cost).toBe(0.56);
    });

    it('returns "unknown" if model is not priced or unregistered (NEVER $0)', () => {
      const unpricedCost = calculateModelCost('unknown-or-unpriced-model', {
        promptTokens: 50_000,
        completionTokens: 10_000,
      });
      expect(unpricedCost).toBe('unknown');
      expect(unpricedCost).not.toBe(0);
    });

    it('returns "unknown" if contract has no price field', () => {
      const mockContractId = 'mock-no-price';
      (MODEL_CONTRACTS as any)[mockContractId] = {
        id: mockContractId,
        sources: [{ url: 'test', readAt: '2026-01-01' }],
      };

      try {
        const cost = calculateModelCost(mockContractId, {
          promptTokens: 1000,
          completionTokens: 1000,
        });
        expect(cost).toBe('unknown');
      } finally {
        delete (MODEL_CONTRACTS as any)[mockContractId];
      }
    });
  });

  describe('Model Contract Citations and Integrity', () => {
    it('ensures every contract has cited sources with valid URLs and readAt timestamps', () => {
      for (const [id, contract] of Object.entries(MODEL_CONTRACTS)) {
        expect(contract.id, `Contract ${id} must match id`).toBe(id);
        expect(contract.sources.length, `Contract ${id} must have at least 1 source`).toBeGreaterThan(0);
        for (const source of contract.sources) {
          expect(source.url, `Contract ${id} source must have url`).toMatch(/^https?:\/\//);
          expect(source.readAt, `Contract ${id} source must have readAt date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    });
  });
});
