import { describe, expect, it } from 'vitest';
import {
  loadAgentRegistryFromEntries,
  resolveAgentDefinition,
  describeAgents,
} from '@/lib/agents/agent-registry';

const DEF = (d: string) => `---\ndescription: ${d}\n---\nbody\n`;
const reg = (files: Record<string, string>) =>
  loadAgentRegistryFromEntries(
    Object.entries(files).map(([name, content]) => ({ name, content })),
  );

describe('loadAgentRegistryFromEntries', () => {
  it('danh sách rỗng → agents rỗng, warnings rỗng, KHÔNG ném lỗi', () => {
    const r = loadAgentRegistryFromEntries([]);
    expect(r.agents).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('nạp mọi entry', () => {
    const r = reg({ 'a.md': DEF('A'), 'b.md': DEF('B') });
    expect(r.agents.map((a) => a.name)).toEqual(['a', 'b']);
  });

  it('tên lặp → giữ bản đầu, ghi warning', () => {
    const r = loadAgentRegistryFromEntries([
      { name: 'a.md', content: DEF('đầu') },
      { name: 'a.md', content: DEF('sau') },
    ]);
    expect(r.agents.map((x) => x.description)).toEqual(['đầu']);
    expect(r.warnings.some((w) => w.includes('trùng tên'))).toBe(true);
  });

  it('file hỏng bị bỏ qua và ghi 1 warning, file tốt vẫn nạp', () => {
    const r = reg({ 'good.md': DEF('G'), 'bad.md': 'không có frontmatter' });
    expect(r.agents.map((a) => a.name)).toEqual(['good']);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('bad.md');
  });

  it('sắp xếp theo name', () => {
    const r = reg({ 'z.md': DEF('Z'), 'a.md': DEF('A') });
    expect(r.agents.map((a) => a.name)).toEqual(['a', 'z']);
  });
});

describe('resolveAgentDefinition', () => {
  it('khớp chính xác tên file', () => {
    const hit = resolveAgentDefinition(reg({ 'code-reviewer.md': DEF('review') }), 'code-reviewer');
    expect(hit.ok && hit.definition.description).toBe('review');
  });

  it('phân biệt hoa thường — tên sai hoa thường thì không khớp', () => {
    const r = reg({ 'Code-Reviewer.md': DEF('review') });
    expect(resolveAgentDefinition(r, 'code-reviewer').ok).toBe(false);
    expect(resolveAgentDefinition(r, 'Code-Reviewer').ok).toBe(true);
  });

  it('tên không có → lỗi nêu available trong chính chuỗi error', () => {
    const miss = resolveAgentDefinition(reg({ 'only.md': DEF('O') }), 'nope');
    expect(miss.ok === false && miss.available).toEqual(['only']);
    expect(miss.ok === false && miss.error).toContain('only');
  });

  it('registry rỗng → available rỗng, error vẫn nói cho model biết chưa có agent', () => {
    const miss = resolveAgentDefinition(loadAgentRegistryFromEntries([]), 'x');
    expect(miss.ok === false && miss.available).toEqual([]);
    expect(miss.ok === false && miss.error).toContain('Chưa có agent nào');
  });
});

describe('describeAgents', () => {
  it('rỗng → chuỗi rỗng', () => {
    expect(describeAgents(loadAgentRegistryFromEntries([]))).toBe('');
  });

  it('mỗi agent một dòng "tên — mô tả", KHÔNG kèm phần tools', () => {
    const s = describeAgents(reg({ 'a.md': DEF('làm việc A') }));
    expect(s).toContain('a — làm việc A');
    expect(s).not.toContain('tools');
  });
});
