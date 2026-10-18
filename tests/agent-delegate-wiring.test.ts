/**
 * Test LÁCH giữa `runEmulatedLoop` và `executeDelegate`.
 *
 * Đây là khe hở đã từng nuốt bug nghiêm trọng: loop emulated dựng lại args của
 * `delegate` từ schema CŨ, còn `executeDelegate` đã đổi sang schema mới — mọi
 * lượt delegate trên đường emulated trả về "Thiếu `task`". `tsc` không bắt vì
 * `DelegateCallArgs` toàn field optional và object được truyền qua biến, nên cả
 * excess-property check lẫn missing-required đều không chạy.
 *
 * Test này lách đúng chỗ đó: model giả phát ra tool-call, và ta khẳng định
 * `onDelegateCall` nhận đúng field.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runEmulatedLoop } from '@/lib/emulated-agent';
import type { AgentToolSet } from '@/lib/agent-tools';
import { loadAgentRegistryFromEntries } from '@/lib/agents/agent-registry';
import { executeDelegate, type DelegateCallArgs } from '@/lib/subagent';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function completion(content: string): Response {
  return jsonResponse({
    id: 'test',
    object: 'chat.completion',
    created: 0,
    model: 'sub-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

/** Mỗi request trả completion tiếp theo trong `scripts`; hết thì lặp lại cái cuối. */
function scriptFetch(scripts: string[]) {
  let i = 0;
  return vi.fn(async () => {
    const content = scripts[Math.min(i, scripts.length - 1)];
    i += 1;
    return completion(content);
  });
}

function makeModel() {
  const provider = createOpenAI({ apiKey: 'test-key', baseURL: 'https://gw.test/v1' });
  return provider('sub-model');
}

/** Khối tool-call của protocol emulated — parser nhận `{name, arguments}`. */
function toolCall(name: string, args: unknown): string {
  return `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`;
}

afterEach(() => vi.unstubAllGlobals());

describe('runEmulatedLoop → executeDelegate', () => {
  it('chuyển nguyên vẹn agent/task/steps/model/context sang callback', async () => {
    vi.stubGlobal(
      'fetch',
      scriptFetch([
        toolCall('delegate', {
          agent: 'code-reviewer',
          task: 'review file lib/subagent.ts giúp tôi',
          steps: 7,
          model: 'fast',
          context: 'brief',
        }),
        'xong',
      ]),
    );

    const seen: unknown[] = [];
    await runEmulatedLoop({
      model: makeModel(),
      messages: [{ role: 'user', content: 'review đi' }],
      system: 'base',
      tools: {} as AgentToolSet,
      clientTools: new Set(['delegate']),
      onTextDelta: () => {},
      onAnnotation: () => {},
      onDelegateCall: async (args: DelegateCallArgs) => {
        seen.push(args);
        return JSON.stringify({ status: 'done' });
      },
    } as never);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      agent: 'code-reviewer',
      task: 'review file lib/subagent.ts giúp tôi',
      steps: 7,
      model: 'fast',
      context: 'brief',
    });
  });

  it('delegate gọi từ đường emulated thực sự chạy được, không dính lỗi thiếu task', async () => {
    vi.stubGlobal(
      'fetch',
      scriptFetch([
        toolCall('delegate', { agent: 'ro', task: 'đọc file này và tóm tắt' }),
        'xong',
      ]),
    );

    const out = await runEmulatedLoop({
      model: makeModel(),
      messages: [{ role: 'user', content: 'đọc đi' }],
      system: 'base',
      tools: {} as AgentToolSet,
      clientTools: new Set(['fs_read']),
      onTextDelta: () => {},
      onDelegateCall: (args: DelegateCallArgs) =>
        executeDelegate(args, {
          model: makeModel(),
          systemBase: 'base',
          serverTools: {} as AgentToolSet,
          clientToolNames: new Set(['fs_read', 'fs_write']),
          registry: loadAgentRegistryFromEntries([
            {
              name: 'ro.md',
              content: '---\ndescription: chỉ đọc\ntools: [fs_read]\n---\nbạn là người đọc.\n',
            },
          ]),
          // Trả ngay, không cần model thật — mục tiêu là chứng minh args
          // đi qua khe một cách đúng hình dạng, không phải chứng minh LLM chạy được.
          resolveClientTool: async () => 'ok',
        }),
    } as never);

    expect(out.status).toBe('done');
  });
});
