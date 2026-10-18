/**
 * Task 1 — lớp provider: chọn nhánh adapter.
 *
 * Plan: docs/superpowers/plans/2026-10-18-provider-layer.md
 * Spec: docs/superpowers/specs/2026-10-18-cli-core-design.md §5
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateText } from 'ai';
import { resolveAdapterKind } from '@/lib/provider/adapter';
import { resolveOpenAIModel } from '@/lib/provider/openai-adapter';
import { resolveAnthropicModel } from '@/lib/provider/anthropic-adapter';

/**
 * Server giả nói đúng protocol OpenAI-compatible, ghi lại request để assert.
 *
 * Vì sao cần server thật thay vì so cấu trúc object: test chỉ có giá trị nếu
 * chứng minh **base URL và API key thật sự đi ra HTTP**. Adapter trả về model
 * object của AI SDK, mọi thứ bên trong nó là thư viện — không gọi mạng thì
 * không có gì để canh, và test sẽ xanh vì lý do sai.
 */
interface Captured {
  path: string;
  auth: string | undefined;
}

const servers: Server[] = [];

async function startFakeOpenAI(): Promise<{ base: string; captured: Captured }> {
  const captured: Captured = { path: '', auth: undefined };
  const server = createServer((req, res) => {
    captured.path = req.url ?? '';
    captured.auth = req.headers.authorization;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 1700000000,
          model: 'gpt-4o',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'xin chào' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, captured };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
});

describe('resolveAdapterKind', () => {
  it('anthropic đi nhánh native', () => {
    expect(resolveAdapterKind({ kind: 'anthropic' })).toBe('anthropic');
  });

  it('openai-compatible đi nhánh OpenAI', () => {
    expect(resolveAdapterKind({ kind: 'openai-compatible' })).toBe('openai-compatible');
  });
});

describe('resolveOpenAIModel', () => {
  it('trả model gọi được base URL và key của config', async () => {
    const { base, captured } = await startFakeOpenAI();
    const model = resolveOpenAIModel({
      kind: 'openai-compatible',
      baseUrl: `${base}/v1`,
      apiKey: 'sk-test-123',
      model: 'gpt-4o',
    });
    const out = await generateText({ model, prompt: 'hi' });
    expect(out.text).toBe('xin chào');
    expect(captured.auth).toBe('Bearer sk-test-123');
    expect(captured.path).toBe('/v1/chat/completions');
  });
});

describe('resolveAnthropicModel', () => {
  it('anthropic: trả model gọi đúng endpoint messages', async () => {
    /* Server giả trả payload của Anthropic Messages API, KHÁC hẳn OpenAI:
     * `type: 'message'`, content là mảng block, key gửi đi là `x-api-key`.
     * Test này chứng minh nhánh Anthropic KHÔNG đi qua endpoint
     * OpenAI-compatible — đó là điều Review Focus #5 canh. */
    const captured: Captured = { path: '', auth: undefined };
    let apiKeyHeader: string | undefined;
    const server = createServer((req, res) => {
      captured.path = req.url ?? '';
      captured.auth = req.headers.authorization;
      apiKeyHeader = req.headers['x-api-key'] as string | undefined;
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-test',
            content: [{ type: 'text', text: 'xin chào' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    const { port } = server.address() as AddressInfo;

    const model = resolveAnthropicModel({
      kind: 'anthropic',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-ant-test',
      model: 'claude-test',
    });
    const out = await generateText({ model, prompt: 'hi' });
    expect(out.text).toBe('xin chào');
    expect(captured.path).toMatch(/\/v1\/messages$/);
    expect(apiKeyHeader).toBe('sk-ant-test');
  });
});
