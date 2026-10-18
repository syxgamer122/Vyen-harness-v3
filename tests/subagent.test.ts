/**
 * Tests for Subagent Delegation system.
 *
 * Covers:
 * - System prompt generation (buildSubagentSystemPrompt)
 * - Constants validation
 * - Result type structure
 * - No recursive delegation (delegate excluded from subagent tools)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildSubagentSystemPrompt,
  executeDelegate,
  SUBAGENT_RESULT_PREVIEW_CHARS,
  SUBAGENT_DEFAULT_MAX_TURNS,
  SUBAGENT_ABSOLUTE_MAX_TURNS,
  SUBAGENT_DEFAULT_TIMEOUT_SECS,
  type SubagentResult,
  type DelegateExecuteDeps,
} from '@/lib/subagent';
import { runEmulatedLoop } from '@/lib/emulated-agent';
import { buildSubagentParentBrief } from '@/lib/context-compaction';
import { loadAgentRegistryFromEntries } from '@/lib/agents/agent-registry';
import type { BudgetMessageLike } from '@/lib/context-budget';

// runEmulatedLoop là điểm mock duy nhất: executeDelegate/runSubagent chạy thật,
// chỉ chặn vòng lặp LLM để test fan-out/filter/brief không gọi mạng.
vi.mock('@/lib/emulated-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/emulated-agent')>();
  return { ...actual, runEmulatedLoop: vi.fn() };
});

beforeEach(() => {
  vi.mocked(runEmulatedLoop).mockReset();
});

type LoopOpts = Parameters<typeof runEmulatedLoop>[0];

/** Mock loop trả text ngay — đủ cho đường 'done' của runSubagent. */
function mockLoopText(text: string) {
  vi.mocked(runEmulatedLoop).mockImplementation(async (opts) => {
    opts.onTextDelta(text);
    return { status: 'done', roundsUsed: 1, totalCalls: 0 };
  });
}

function makeDeps(over: Partial<DelegateExecuteDeps> = {}): DelegateExecuteDeps {
  return {
    model: {} as never,
    systemBase: 'base system',
    serverTools: {} as never,
    clientToolNames: new Set(['fs_read', 'fs_write', 'fs_edit', 'shell_run']),
    registry: loadAgentRegistryFromEntries([
      {
        name: 'ro.md',
        content: '---\ndescription: Chỉ đọc.\ntools: [fs_read]\n---\nBạn review code.\n',
      },
    ]),
    ...over,
  };
}

/** Chờ điều kiện bằng polling ngắn — tránh sleep cứng dễ flaky. */
async function waitFor(cond: () => boolean, ms = 1000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

describe('subagent constants', () => {
  it('default max turns is reasonable', () => {
    expect(SUBAGENT_DEFAULT_MAX_TURNS).toBe(10);
  });

  it('absolute max turns caps at 25 (mặc định)', () => {
    expect(SUBAGENT_ABSOLUTE_MAX_TURNS).toBe(25);
  });

  it('default timeout is 5 minutes', () => {
    expect(SUBAGENT_DEFAULT_TIMEOUT_SECS).toBe(300);
  });

  it('default <= absolute max', () => {
    expect(SUBAGENT_DEFAULT_MAX_TURNS).toBeLessThanOrEqual(SUBAGENT_ABSOLUTE_MAX_TURNS);
  });
});

/* ------------------------------------------------------------------ */
/* System prompt builder                                               */
/* ------------------------------------------------------------------ */

describe('buildSubagentSystemPrompt', () => {
  const baseSystem = 'You are Vyen, an AI coding assistant.';
  const instructions = 'Refactor the auth module to use JWT tokens.';

  it('includes base system prompt', () => {
    const result = buildSubagentSystemPrompt(baseSystem, instructions, 10);
    expect(result).toContain(baseSystem);
  });

  it('includes task instructions', () => {
    const result = buildSubagentSystemPrompt(baseSystem, instructions, 10);
    expect(result).toContain(instructions);
  });

  it('includes max turns limit', () => {
    const result = buildSubagentSystemPrompt(baseSystem, instructions, 15);
    expect(result).toContain('15');
    expect(result).toContain('MAXIMUM');
  });

  it('explicitly forbids delegate tool (no recursion)', () => {
    const result = buildSubagentSystemPrompt(baseSystem, instructions, 10);
    expect(result).toContain('CANNOT call `delegate`');
    expect(result).toContain('NO Delegation');
  });

  it('includes subagent role definition', () => {
    const result = buildSubagentSystemPrompt(baseSystem, instructions, 10);
    expect(result).toContain('SPECIALIZED SUBAGENT');
    expect(result).toContain('Independence');
    expect(result).toContain('Bounded Operation');
  });

  it('includes tool efficiency rules', () => {
    const result = buildSubagentSystemPrompt(baseSystem, instructions, 10);
    expect(result).toContain('Tool Efficiency');
    expect(result).toContain('minimum tools');
  });

  it('includes completion guidance', () => {
    const result = buildSubagentSystemPrompt(baseSystem, instructions, 10);
    expect(result).toContain('Clear Completion');
    expect(result).toContain('summarize');
  });

  it('handles empty instructions gracefully', () => {
    const result = buildSubagentSystemPrompt(baseSystem, '', 10);
    expect(result).toContain(baseSystem);
    expect(result).toContain('SPECIALIZED SUBAGENT');
  });

  it('handles long instructions without truncation', () => {
    const longInstructions = 'A'.repeat(5000);
    const result = buildSubagentSystemPrompt(baseSystem, longInstructions, 10);
    expect(result).toContain(longInstructions);
  });
});

/* ------------------------------------------------------------------ */
/* Result type structure                                                 */
/* ------------------------------------------------------------------ */

describe('SubagentResult type', () => {
  it('done result has required fields', () => {
    const result: SubagentResult = {
      result: 'Task completed successfully.',
      turnsUsed: 3,
      toolCalls: 5,
      status: 'done',
      runId: 'run-1',
      agentName: null,
      startedAt: 0,
      durationMs: 100,
    };
    expect(result.status).toBe('done');
    expect(result.result).toBeTruthy();
    expect(result.turnsUsed).toBeGreaterThan(0);
  });

  it('error result includes error message', () => {
    const result: SubagentResult = {
      result: '',
      turnsUsed: 0,
      toolCalls: 0,
      status: 'error',
      runId: 'run-2',
      agentName: null,
      startedAt: 0,
      durationMs: 0,
      error: 'Model API timeout',
    };
    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('max-turns result indicates truncation', () => {
    const result: SubagentResult = {
      result: 'Partial results...',
      turnsUsed: 25,
      toolCalls: 40,
      status: 'max-turns',
      runId: 'run-3',
      agentName: null,
      startedAt: 0,
      durationMs: 0,
    };
    expect(result.status).toBe('max-turns');
    expect(result.turnsUsed).toBe(SUBAGENT_ABSOLUTE_MAX_TURNS);
  });

  it('aborted result for cancellation', () => {
    const result: SubagentResult = {
      result: '(subagent aborted)',
      turnsUsed: 2,
      toolCalls: 3,
      status: 'aborted',
      runId: 'run-4',
      agentName: null,
      startedAt: 0,
      durationMs: 0,
    };
    expect(result.status).toBe('aborted');
  });
});


/* ------------------------------------------------------------------ */
/* executeDelegate — đường đơn + brief + phân giải agent + tool scope     */
/* ------------------------------------------------------------------ */

describe('executeDelegate — đường đơn (backward compatible)', () => {
  it('trả SubagentResult JSON như cũ, kèm metadata mới', async () => {
    mockLoopText('kết quả đơn');
    const out = JSON.parse(
      await executeDelegate({ task: 'một task duy nhất đủ dài để chạy' }, makeDeps()),
    ) as SubagentResult;
    expect(out.status).toBe('done');
    expect(out.result).toBe('kết quả đơn');
    expect(out.runId).toBeTruthy();
    expect(out.agentName).toBe(null);
    expect(typeof out.startedAt).toBe('number');
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('tên agent không có → lỗi kèm danh sách, KHÔNG spawn loop', async () => {
    const out = JSON.parse(
      await executeDelegate({ agent: 'khong-ton-tai', task: 'một task duy nhất đủ dài' }, makeDeps()),
    ) as { status: string; error?: string; available?: string[] };
    expect(out.status).toBe('error');
    expect(out.available).toEqual(['ro']);
    expect(runEmulatedLoop).not.toHaveBeenCalled();
  });

  it('agent chỉ-đọc không nhận tool ghi trong bộ tool thật', async () => {
    mockLoopText('ok');
    await executeDelegate({ agent: 'ro', task: 'review file này giúp tôi' }, makeDeps());
    const clientTools = vi.mocked(runEmulatedLoop).mock.calls[0][0].clientTools as Set<string>;
    expect([...clientTools].sort()).toEqual(['fs_read']);
  });

  it('thân file agent được ghép vào system prompt của con', async () => {
    mockLoopText('ok');
    await executeDelegate({ agent: 'ro', task: 'review file này giúp tôi' }, makeDeps());
    expect(vi.mocked(runEmulatedLoop).mock.calls[0][0].system).toContain('Bạn review code.');
  });

  it('từ chối khi thiếu cả hai', async () => {
    const out = JSON.parse(await executeDelegate({}, makeDeps())) as { status: string };
    expect(out.status).toBe('error');
    expect(runEmulatedLoop).not.toHaveBeenCalled();
  });

  it('context brief gắn khối ngữ cảnh cha vào system; fresh không gọi builder', async () => {
    mockLoopText('ok');
    const getParentBrief = vi.fn(() => 'Người dùng đang làm tính năng đăng nhập.');
    await executeDelegate(
      { task: 'task cần hiểu bối cảnh phiên cha', context: 'brief' },
      makeDeps({ getParentBrief }),
    );
    expect(getParentBrief).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runEmulatedLoop).mock.calls[0][0].system).toContain('tính năng đăng nhập');

    const getParentBrief2 = vi.fn(() => 'không bao giờ được gọi');
    await executeDelegate(
      { task: 'task đường thường fresh context' },
      makeDeps({ getParentBrief: getParentBrief2 }),
    );
    expect(getParentBrief2).not.toHaveBeenCalled();
  });
});


describe('buildSubagentParentBrief', () => {
  it('trích yêu cầu user, file ops và kết luận gần nhất', () => {
    const messages = [
      { role: 'user', content: 'Hãy làm trang login cho app' },
      {
        role: 'assistant',
        content: 'Đang làm...',
        toolInvocations: [
          { state: 'result', toolName: 'fs_edit', args: { path: 'app/login/page.tsx' } },
          { state: 'result', toolName: 'fs_read', args: { path: 'lib/auth.ts' } },
        ],
      },
      { role: 'assistant', content: 'Đã hoàn thành phần backend xác thực.' },
    ] as unknown as BudgetMessageLike[];

    const brief = buildSubagentParentBrief(messages);
    expect(brief).toContain('trang login');
    expect(brief).toContain('app/login/page.tsx');
    expect(brief).toContain('lib/auth.ts');
    expect(brief).toContain('backend xác thực');
  });

  it('trả rỗng khi không trích được gì — caller bỏ qua việc gắn', () => {
    expect(buildSubagentParentBrief([])).toBe('');
    expect(buildSubagentParentBrief([{ role: 'system', content: 'chỉ hệ thống' }])).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* result preview annotation                                            */
/* ------------------------------------------------------------------ */

describe('done annotation — result preview', () => {
  it('gắn preview đúng trần SUBAGENT_RESULT_PREVIEW_CHARS', async () => {
    mockLoopText('k'.repeat(600));
    const events: Array<Record<string, unknown>> = [];
    await executeDelegate(
      { task: 'task đơn đủ dài để hợp lệ nhé' },
      makeDeps({ onProgress: (phase, detail) => events.push({ phase, ...detail }) }),
    );
    const done = events.find((e) => e.phase === 'done');
    expect(typeof done?.result).toBe('string');
    expect((done?.result as string).length).toBe(SUBAGENT_RESULT_PREVIEW_CHARS);
  });
});
