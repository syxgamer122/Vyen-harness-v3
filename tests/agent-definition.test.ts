import { describe, expect, it } from 'vitest';
import {
  parseAgentDefinition,
  AGENT_STEPS_MAX,
  AGENT_STEPS_DEFAULT,
} from '@/lib/agents/agent-definition';

const OK = `---
description: Review code về correctness và security.
tools: [fs_read, fs_list]
steps: 12
---

Bạn đang review code.
`;

describe('parseAgentDefinition', () => {
  it('lấy name từ tên file, không đọc name trong frontmatter', () => {
    const r = parseAgentDefinition('code-reviewer.md', OK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definition.name).toBe('code-reviewer');
  });

  it('giữ body sau frontmatter, bỏ khoảng trắng thừa', () => {
    const r = parseAgentDefinition('x.md', OK);
    expect(r.ok && r.definition.body).toBe('Bạn đang review code.');
  });

  it('tools và steps đọc đúng', () => {
    const r = parseAgentDefinition('x.md', OK);
    expect(r.ok && r.definition.tools).toEqual(['fs_read', 'fs_list']);
    expect(r.ok && r.definition.steps).toBe(12);
  });

  it('thiếu description thì lỗi', () => {
    const r = parseAgentDefinition('x.md', '---\nsteps: 3\n---\nbody');
    expect(r.ok).toBe(false);
  });

  it('steps kẹp về [1,25], không phải lỗi', () => {
    const low = parseAgentDefinition('x.md', '---\ndescription: d\nsteps: 0\n---\nb');
    const high = parseAgentDefinition('x.md', '---\ndescription: d\nsteps: 999\n---\nb');
    expect(low.ok && low.definition.steps).toBe(1);
    expect(high.ok && high.definition.steps).toBe(AGENT_STEPS_MAX);
  });

  it('thiếu steps thì dùng mặc định', () => {
    const r = parseAgentDefinition('x.md', '---\ndescription: d\n---\nb');
    expect(r.ok && r.definition.steps).toBe(AGENT_STEPS_DEFAULT);
  });

  it('thiếu tools thì undefined (kế thừa bộ tool cha)', () => {
    const r = parseAgentDefinition('x.md', '---\ndescription: d\n---\nb');
    expect(r.ok && r.definition.tools).toBeUndefined();
  });

  it('không có frontmatter thì lỗi', () => {
    expect(parseAgentDefinition('x.md', 'chỉ có body').ok).toBe(false);
  });

  it('YAML hỏng thì lỗi, không throw', () => {
    expect(parseAgentDefinition('x.md', '---\ndescription: [unclosed\n---\nb').ok).toBe(false);
  });
});
