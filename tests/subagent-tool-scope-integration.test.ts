/**
 * Cổng tool của subagent phải là MỘT lần giao, không phải hai lần.
 *
 * Vyen có hai tầng tool: server tool (chạy trong route — web_fetch, memory_save…)
 * và client tool (relay về trình duyệt — fs_read, shell_run…). Trước đây
 * `resolveAgentToolNames` chỉ thấy tầng client, nên khai báo `tools:` trong file
 * agent ràng buộc được client tool mà KHÔNG ràng buộc được server tool.
 *
 * Hậu quả đo được: agent khai `tools: [fs_read]` (ý định chỉ đọc) vẫn gọi được
 * `memory_save`. CapBAC đã bị xoá khỏi `lib/subagent.ts`, nên không còn lớp nào
 * chặn phần tử rò này — nó là lỗ hổng, không phải khác biệt mỹ thuật.
 *
 * Lớp này lách đúng chỗ đó: mock `runEmulatedLoop` (điểm giao duy nhất giữa
 * executeDelegate và thế giới thật) rồi khẳng định bộ tool mà vòng lặp thật sự
 * nhận.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runEmulatedLoop } from '@/lib/emulated-agent';
import { executeDelegate, type DelegateExecuteDeps } from '@/lib/subagent';
import { loadAgentRegistryFromEntries } from '@/lib/agents/agent-registry';

// Điểm mock duy nhất: executeDelegate + runSubagent chạy thật, chỉ chặn vòng
// lặp LLM để test không gọi mạng.
vi.mock('@/lib/emulated-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/emulated-agent')>();
  return { ...actual, runEmulatedLoop: vi.fn() };
});

beforeEach(() => {
  vi.mocked(runEmulatedLoop).mockReset();
  vi.mocked(runEmulatedLoop).mockImplementation(async (opts) => {
    opts.onTextDelta?.('xong');
    return { status: 'done', roundsUsed: 1, totalCalls: 0 };
  });
});

type LoopOpts = Parameters<typeof runEmulatedLoop>[0];

/** Tool giả — runEmulatedLoop đã bị mock nên hình dạng không quan trọng. */
const fakeTool = { execute: async () => 'x' } as never;

function makeDeps(over: Partial<DelegateExecuteDeps> = {}): DelegateExecuteDeps {
  return {
    model: { id: 'parent-model' } as never,
    systemBase: 'base system',
    serverTools: {} as never,
    clientToolNames: new Set(['fs_read', 'fs_write']),
    registry: loadAgentRegistryFromEntries([
      { name: 'ro.md', content: '---\ndescription: Chỉ đọc.\ntools: [fs_read]\n---\nBạn review.\n' },
      {
        name: 'mixed.md',
        content: '---\ndescription: Cả hai tầng.\ntools: [fs_read, web_fetch]\n---\nBạn tra cứu.\n',
      },
      {
        name: 'fast.md',
        content: '---\ndescription: Chạy nhanh.\nmodel: fast-model\ntools: [fs_read]\n---\nBạn đọc.\n',
      },
      { name: 'open.md', content: '---\ndescription: Mọi tool.\n---\nBạn làm gì cũng được.\n' },
    ]),
    ...over,
  };
}

/** Chạy delegate và trả về opts mà vòng lặp thật sự nhận. */
async function captureLoop(deps: DelegateExecuteDeps, args: Record<string, unknown>) {
  await executeDelegate(args as never, deps);
  const call = vi.mocked(runEmulatedLoop).mock.calls[0];
  expect(call, 'runEmulatedLoop phải được gọi').toBeTruthy();
  return call![0] as LoopOpts;
}

/* ------------------------------------------------------------------ */
/* #3a — server tool phải chịu cùng phép giao với client tool         */
/* ------------------------------------------------------------------ */

describe('server tool chịu phép giao như client tool', () => {
  it('agent khai tools:[fs_read] thì KHÔNG còn memory_save trong bộ tool', async () => {
    const opts = await captureLoop(
      makeDeps({
        serverTools: { memory_save: fakeTool, web_fetch: fakeTool } as never,
        clientToolNames: new Set(['fs_read', 'fs_write']),
      }),
      { agent: 'ro', task: 'đọc file lib/subagent.ts rồi tóm tắt' },
    );

    expect(Object.keys(opts.tools)).toEqual([]);
  });

  it('agent khai web_fetch thì web_fetch VẪN dùng được (không bị loại im lặng)', async () => {
    const opts = await captureLoop(
      makeDeps({
        serverTools: { web_fetch: fakeTool, memory_save: fakeTool } as never,
        clientToolNames: new Set(['fs_read']),
      }),
      { agent: 'mixed', task: 'tra cứu tài liệu rồi đọc file này giúp tôi' },
    );

    // Không chỉ "còn trong schema" — phải thật sự chạy được, và memory_save
    // (không khai) vẫn phải bị loại.
    expect(Object.keys(opts.tools)).toEqual(['web_fetch']);
  });

  it('agent không khai tools: thì kế thừa TOÀN BỘ server tool của cha', async () => {
    const opts = await captureLoop(
      makeDeps({
        serverTools: { web_fetch: fakeTool, memory_save: fakeTool } as never,
        clientToolNames: new Set(['fs_read']),
      }),
      { agent: 'open', task: 'làm việc này bất cứ điều gì cần thiết' },
    );

    expect(Object.keys(opts.tools).sort()).toEqual(['memory_save', 'web_fetch']);
  });

  it('delegate không bao giờ lọt vào bộ tool con, kể cả khi cha có nó', async () => {
    const opts = await captureLoop(
      makeDeps({
        serverTools: { delegate: fakeTool } as never,
        clientToolNames: new Set(['fs_read', 'delegate']),
      }),
      { agent: 'open', task: 'làm việc này bất cứ điều gì cần thiết' },
    );

    expect(Object.keys(opts.tools)).not.toContain('delegate');
    expect([...(opts.clientTools as Set<string>)]).not.toContain('delegate');
  });
});

/* ------------------------------------------------------------------ */
/* #3b — prompt phải mô tả BỘ TOOL THẬT, không nói sai với model       */
/* ------------------------------------------------------------------ */

describe('system prompt không nói sai về bộ tool', () => {
  it('liệt kê server tool đã được cấp, không chỉ client tool', async () => {
    const opts = await captureLoop(
      makeDeps({
        serverTools: { web_fetch: fakeTool } as never,
        clientToolNames: new Set(['fs_read']),
      }),
      { agent: 'mixed', task: 'tra cứu tài liệu rồi đọc file này giúp tôi' },
    );

    expect(opts.system).toContain('fs_read');
    expect(opts.system).toContain('web_fetch');
  });

  it('tool cha có nhưng agent không khai thì KHÔNG xuất hiện trong danh sách', async () => {
    // Lỗi gốc không phải câu "tool khác không tồn tại" — câu đó đúng khi danh
    // sách là TOÀN BỘ bộ tool. Lỗi gốc là danh sách THIẾU: nó chỉ liệt kê client
    // tool, nên model không hề biết mình có server tool nào.
    const opts = await captureLoop(
      makeDeps({
        serverTools: { web_fetch: fakeTool } as never,
        clientToolNames: new Set(['fs_read', 'fs_write']),
      }),
      { agent: 'ro', task: 'đọc file lib/subagent.ts rồi tóm tắt' },
    );

    expect(opts.system).not.toContain('fs_write');
    // Danh sách phải khớp ĐÚNG bộ tool thật sự được cấp — không thừa, không thiếu.
    const listed = opts.system.match(/Bạn chỉ có các tool sau: ([^\n]+)\./)?.[1] ?? '';
    expect(listed.split(', ').sort()).toEqual(['fs_read']);
  });
});

/* ------------------------------------------------------------------ */
/* #7 — `model:` trong file agent phải thật sự đổi model              */
/* ------------------------------------------------------------------ */

describe('trường model: trong file agent', () => {
  it('được truyền vào deps.resolveModel và thay model cha', async () => {
    const fast = { id: 'fast-model' } as never;
    const resolveModel = vi.fn(() => fast);
    const opts = await captureLoop(
      makeDeps({ resolveModel }),
      { agent: 'fast', task: 'đọc file lib/subagent.ts rồi tóm tắt' },
    );

    expect(resolveModel).toHaveBeenCalledWith('fast-model');
    expect(opts.model).toBe(fast);
  });

  it('model không phân giải được thì rơi về model cha, không ném lỗi', async () => {
    const resolveModel = vi.fn(() => undefined);
    const parent = { id: 'parent-model' } as never;
    const opts = await captureLoop(
      makeDeps({ model: parent, resolveModel }),
      { agent: 'fast', task: 'đọc file lib/subagent.ts rồi tóm tắt' },
    );

    expect(resolveModel).toHaveBeenCalledWith('fast-model');
    expect(opts.model).toBe(parent);
  });

  it('không khai model: thì KHÔNG gọi resolveModel (giữ đúng model cha)', async () => {
    const resolveModel = vi.fn(() => ({ id: 'x' }) as never);
    await captureLoop(makeDeps({ resolveModel }), { agent: 'ro', task: 'đọc file này giúp tôi' });

    expect(resolveModel).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* #10 — annotation `done` phải mang tên agent                        */
/* ------------------------------------------------------------------ */

describe('annotation subagent mang tên agent', () => {
  it('cả start và done đều mang agentName — người dùng phải thấy tên agent đã chạy', async () => {
    const seen: Array<Record<string, unknown>> = [];
    await executeDelegate(
      { agent: 'ro', task: 'đọc file lib/subagent.ts rồi tóm tắt' } as never,
      makeDeps({
        onProgress: (phase, detail) => seen.push({ phase, ...(detail as object) }),
      }),
    );

    for (const phase of ['start', 'done']) {
      const payload = seen.find((s) => s.phase === phase);
      expect(payload, `thiếu annotation phase=${phase}`).toBeTruthy();
      expect(payload!.agentName, `phase=${phase} mất agentName`).toBe('ro');
    }
  });

  it('delegate không tên agent thì agentName là null, không phải undefined', async () => {
    const seen: Array<Record<string, unknown>> = [];
    await executeDelegate(
      { task: 'đọc file lib/subagent.ts rồi tóm tắt' } as never,
      makeDeps({
        onProgress: (phase, detail) => seen.push({ phase, ...(detail as object) }),
      }),
    );

    expect(seen.find((s) => s.phase === 'start')!.agentName).toBeNull();
  });
});