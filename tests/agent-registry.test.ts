import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadAgentRegistry,
  resolveAgentDefinition,
  describeAgents,
} from '@/lib/agents/agent-registry';

const dirs: string[] = [];

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vyen-agents-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'nested'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

const DEF = (d: string) => `---\ndescription: ${d}\n---\nbody\n`;

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('loadAgentRegistry', () => {
  it('thư mục không tồn tại → agents rỗng, warnings rỗng, KHÔNG ném lỗi', () => {
    const r = loadAgentRegistry(join(tmpdir(), 'vyen-khong-co-that'));
    expect(r.agents).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('nạp .md ở cấp đĩa, bỏ qua thư mục con', () => {
    const r = loadAgentRegistry(dirWith({ 'a.md': DEF('A'), 'nested/b.md': DEF('B') }));
    expect(r.agents.map((a) => a.name)).toEqual(['a']);
  });

  it('file hỏng bị bỏ qua và ghi 1 warning, file tốt vẫn nạp', () => {
    const r = loadAgentRegistry(dirWith({ 'good.md': DEF('G'), 'bad.md': 'không có frontmatter' }));
    expect(r.agents.map((a) => a.name)).toEqual(['good']);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('bad.md');
  });

  it('sắp xếp theo name', () => {
    const r = loadAgentRegistry(dirWith({ 'z.md': DEF('Z'), 'a.md': DEF('A') }));
    expect(r.agents.map((a) => a.name)).toEqual(['a', 'z']);
  });
});

describe('resolveAgentDefinition', () => {
  it('khớp chính xác tên file', () => {
    const r = loadAgentRegistry(dirWith({ 'code-reviewer.md': DEF('review') }));
    const hit = resolveAgentDefinition(r, 'code-reviewer');
    expect(hit.ok && hit.definition.description).toBe('review');
  });

  it('tên không có → lỗi nêu available', () => {
    const r = loadAgentRegistry(dirWith({ 'only.md': DEF('O') }));
    const miss = resolveAgentDefinition(r, 'nope');
    expect(miss.ok === false && miss.available).toEqual(['only']);
    expect(miss.ok === false && miss.error).toContain('only');
  });

  it('registry rỗng → available rỗng, error vẫn nói cho model biết chưa có agent', () => {
    const miss = resolveAgentDefinition(loadAgentRegistry(join(tmpdir(), 'vyen-rong-2')), 'x');
    expect(miss.ok === false && miss.available).toEqual([]);
    expect(miss.ok === false && miss.error).toContain('Chưa có agent nào');
  });
});

describe('describeAgents', () => {
  it('rỗng → chuỗi rỗng', () => {
    expect(describeAgents(loadAgentRegistry(join(tmpdir(), 'vyen-rong')))).toBe('');
  });

  it('mỗi agent một dòng "tên — mô tả", KHÔNG kèm phần tools', () => {
    const s = describeAgents(loadAgentRegistry(dirWith({ 'a.md': DEF('làm việc A') })));
    expect(s).toContain('a — làm việc A');
    expect(s).not.toContain('tools');
  });
});
