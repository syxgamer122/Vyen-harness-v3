/**
 * Task 1 — lớp provider: chọn nhánh adapter.
 *
 * Plan: docs/superpowers/plans/2026-10-18-provider-layer.md
 * Spec: docs/superpowers/specs/2026-10-18-cli-core-design.md §5
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { generateText } from 'ai';
import ts from 'typescript';
import { resolveAdapterKind } from '@/lib/provider/adapter';
import { resolveOpenAIModel } from '@/lib/provider/openai-adapter';
import { resolveAnthropicModel } from '@/lib/provider/anthropic-adapter';
import { runtimeImportSpecs } from '@/scripts/cli-migration/import-graph';

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
  /** Anthropic gửi key ở `x-api-key`, không phải `Authorization`. */
  xApiKey?: string;
}

/**
 * Server giả nói protocol Anthropic Messages API — KHÁC OpenAI: `type: 'message'`,
 * content là mảng block, key ở header `x-api-key`.
 */
async function startFakeAnthropic(): Promise<{ base: string; captured: Captured }> {
  const captured: Captured = { path: '', auth: undefined };
  const server = createServer((req, res) => {
    captured.path = req.url ?? '';
    captured.auth = req.headers.authorization;
    captured.xApiKey = req.headers['x-api-key'] as string | undefined;
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
  return { base: `http://127.0.0.1:${port}`, captured };
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

/**
 * Review Focus #5 — SDK Anthropic KHÔNG được nạp ở nhánh không dùng tới nó.
 *
 * `adapter.ts` là module mọi đường đều đi qua; `openai-adapter.ts` là nhánh mà
 * người dùng BYAI hay chạy nhất. Một `import` tĩnh ở đó kéo `@ai-sdk/anthropic`
 * vào bundle của họ — tức người không dùng Anthropic vẫn phải tải nó.
 *
 * Dùng `runtimeImportSpecs` của máy quét kiểm kê thay vì regex: nó đã loại
 * `import type`, nên `import type { X } from './anthropic-adapter'` vẫn hợp lệ
 * (bị xoá lúc build, không tốn băng thông). Regex tay sẽ bắt nhầm ca đó.
 */
describe('Review Focus #5 — Anthropic không lọt vào nhánh khác', () => {
  const anthropicImports = (file: string) =>
    runtimeImportSpecs(readFileSync(file, 'utf8'), file).filter((s) => /anthropic/i.test(s));

  it('adapter.ts không nạp adapter Anthropic', () => {
    expect(anthropicImports('lib/provider/adapter.ts')).toEqual([]);
  });

  it('openai-adapter.ts không nạp adapter Anthropic', () => {
    expect(anthropicImports('lib/provider/openai-adapter.ts')).toEqual([]);
  });

  it('`import type` thì được — không sinh mã chạy', () => {
    // Cùi bằng chứng trên: máy quét phải BỎ qua import type, nếu không guard
    // này sẽ đỏ và mọi người sẽ xoá luôn `import type` hợp lệ.
    expect(runtimeImportSpecs("import type { X } from './anthropic-adapter';\n", 'x.ts')).toEqual([]);
  });
});

/**
 * Review Focus #4 của plan (`toolChoice: 'none'`) mô tả cơ chế repo KHÔNG dùng.
 *
 * Đo: `route.ts` có 0 lần set `toolChoice`. Cơ chế thật là `lib/emulated-agent.ts` —
 * render schema tool thành TEXT trong system prompt rồi parse `<tool_call>`, đúng
 * như spec §7 nói.
 *
 * `toolChoice` là tham số của *mỗi lần gọi* `streamText`/`generateText`, không
 * phải thuộc tính của adapter. Thêm nó vào `ProviderRuntimeConfig` sẽ tạo ra một
 * lựa chọn giả — trông như đã xử lý, nhưng không ai dùng tới.
 *
 * Guard này để người đọc plan sau đừng "sửa cho đúng" bằng cách thêm nó vào đây.
 */
describe('bề mặt adapter — không có trường nào thuộc đường gọi', () => {
  const ADAPTER_FILES = [
    'lib/provider/adapter.ts',
    'lib/provider/openai-adapter.ts',
    'lib/provider/anthropic-adapter.ts',
  ];

  /** Tên trường khai báo, đọc từ AST — regex sẽ khớp cả comment. */
  const declaresToolChoice = (file: string) => {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let found = false;
    const walk = (n: ts.Node): void => {
      if (
        (ts.isPropertySignature(n) || ts.isPropertyDeclaration(n)) &&
        ts.isIdentifier(n.name) &&
        n.name.text === 'toolChoice'
      ) {
        found = true;
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    return found;
  };

  it('không adapter nào khai trường `toolChoice`', () => {
    const found = ADAPTER_FILES.filter(declaresToolChoice);
    expect(
      found,
      `toolChoice không thuộc adapter — nó là tham số mỗi lần gọi streamText/generateText. Cơ chế thật: lib/emulated-agent.ts. File: ${found.join(', ')}`,
    ).toEqual([]);
  });

  it('cơ chế fallback thật vẫn còn: lib/emulated-agent.ts', () => {
    expect(existsSync('lib/emulated-agent.ts')).toBe(true);
  });
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

  /* `route.ts:1334-1338` tạo instance RIÊNG kèm `fetch: nonStreamingFetch`
   * cho đường `generateText`. Không có đường truyền này thì đổi `route.ts` sang
   * adapter là mất instance đó, và `generateText` gặp gateway trả SSE sẽ ném
   * "Invalid JSON response" — đúng lỗi khiến /api/compact trước đây luôn fail.
   * Test canh: giá trị trong config PHẢI tới được tầng HTTP. */
  it('truyền fetch override xuống tầng HTTP', async () => {
    const { base, captured } = await startFakeOpenAI();
    let used = 0;
    const model = resolveOpenAIModel({
      kind: 'openai-compatible',
      baseUrl: `${base}/v1`,
      apiKey: 'sk-test-123',
      model: 'gpt-4o',
      fetch: (...args) => {
        used++;
        return fetch(...args);
      },
    });
    await generateText({ model, prompt: 'hi' });
    expect(used).toBe(1);
    expect(captured.path).toBe('/v1/chat/completions');
  });
});

describe('resolveAnthropicModel', () => {
  it('anthropic: trả model gọi đúng endpoint messages', async () => {
    /* Server giả trả payload của Anthropic Messages API, KHÁC hẳn OpenAI:
     * `type: 'message'`, content là mảng block, key gửi đi là `x-api-key`.
     * Test này chứng minh nhánh Anthropic KHÔNG đi qua endpoint
     * OpenAI-compatible — đó là điều Review Focus #5 canh. */
    const { base, captured } = await startFakeAnthropic();

    const model = resolveAnthropicModel({
      kind: 'anthropic',
      baseUrl: `${base}/v1`,
      apiKey: 'sk-ant-test',
      model: 'claude-test',
    });
    const out = await generateText({ model, prompt: 'hi' });
    expect(out.text).toBe('xin chào');
    expect(captured.path).toMatch(/\/v1\/messages$/);
    expect(captured.xApiKey).toBe('sk-ant-test');
  });

  /* Cùng lý do với nhánh OpenAI, và phải có ở CẢ HAI adapter: chỉ thêm ở một
   * bên tạo ra adapter không đối xứng — dạng "hai chỗ rồi sẽ lệch" mà AGENTS.md
   * §6 cảnh báo. Người đọc sẽ tưởng nhánh kia không cần. */
  it('truyền fetch override xuống tầng HTTP', async () => {
    const { base, captured } = await startFakeAnthropic();
    let used = 0;
    const model = resolveAnthropicModel({
      kind: 'anthropic',
      baseUrl: `${base}/v1`,
      apiKey: 'sk-ant-test',
      model: 'claude-test',
      fetch: (...args) => {
        used++;
        return fetch(...args);
      },
    });
    await generateText({ model, prompt: 'hi' });
    expect(used).toBe(1);
    expect(captured.path).toMatch(/\/v1\/messages$/);
  });
});
