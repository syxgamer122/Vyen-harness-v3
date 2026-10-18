import { describe, expect, it } from 'vitest';
import { resolveAgentToolNames } from '@/lib/agents/agent-tool-scope';
import type { AgentDefinition } from '@/lib/agents/agent-definition';

const def = (tools?: string[]): AgentDefinition => ({
  name: 'x',
  description: 'd',
  steps: 10,
  body: '',
  ...(tools ? { tools } : {}),
});

describe('resolveAgentToolNames', () => {
  it('definition null → kế thừa nguyên bộ tool cha', () => {
    const r = resolveAgentToolNames(new Set(['fs_read', 'shell_run']), null);
    expect([...r.names].sort()).toEqual(['fs_read', 'shell_run']);
  });

  it('tools khai báo → giao với bộ tool cha', () => {
    const parent = new Set(['fs_read', 'fs_list', 'fs_search', 'web_fetch']);
    const r = resolveAgentToolNames(parent, def(['fs_read', 'web_fetch']));
    expect([...r.names].sort()).toEqual(['fs_read', 'web_fetch']);
  });

  it('tool khai báo mà cha không có → không xuất hiện', () => {
    const r = resolveAgentToolNames(new Set(['fs_read']), def(['fs_read', 'run_code']));
    expect([...r.names]).toEqual(['fs_read']);
  });

  it('tên không có trong catalog → bỏ và báo, KHÔNG ném lỗi', () => {
    const r = resolveAgentToolNames(new Set(['fs_read']), def(['fs_read', 'khong-ton-tai']));
    expect([...r.names]).toEqual(['fs_read']);
    expect(r.dropped).toEqual(['khong-ton-tai']);
  });

  it('delegate LUÔN bị loại, kể cả khi agent khai báo muốn có', () => {
    const r = resolveAgentToolNames(new Set(['fs_read', 'delegate']), def(['fs_read', 'delegate']));
    expect([...r.names]).toEqual(['fs_read']);
  });

  it('delegate bị loại cả khi agent không khai tools (kế thừa)', () => {
    const r = resolveAgentToolNames(new Set(['fs_read', 'delegate']), def());
    expect([...r.names]).toEqual(['fs_read']);
  });

  it('tools: [] → agent không có tool nào', () => {
    const r = resolveAgentToolNames(new Set(['fs_read', 'shell_run']), def([]));
    expect([...r.names]).toEqual([]);
  });
});
