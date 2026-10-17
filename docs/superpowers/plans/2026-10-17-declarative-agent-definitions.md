# Agent Declarative Definitions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép khai báo agent bằng file trong `.vyen/agents/*.md` để model tự chọn theo mô tả, và để agent con không có trong tool schema các tool nó không được phép dùng.

**Architecture:** Ba module mới dưới `lib/agents/` — parse frontmatter, registry quét đĩa + phân giải tên, và hàm giao bộ tool. `delegate` đổi schema từ "soạn brief" sang "chọn tên + việc". Cơ chế chạy subagent giữ nguyên (vẫn blocking, vẫn relay), nên diff nằm ở chỗ lọc tool và tham số, không phải ở tầng thực thi.

**Tech Stack:** TypeScript, Next.js App Router, `yaml` (đã có sẵn, dùng ở `lib/skills/disk.ts`, `lib/recipes/parse.ts`), vitest, zod.

**Spec:** `docs/superpowers/specs/2026-10-17-declarative-agent-definitions-design.md`

## Global Constraints

- Test runner: `npm test` = `vitest run`. Chạy một file: `npx vitest run tests/<file>.test.ts`.
- Typecheck: `npm run typecheck` = `tsc --noEmit`. Phải xanh trước khi commit task cuối.
- Import path trong source: `@/lib/...`. Import path trong test: `@/lib/...` hoặc relative — theo file test sẵn có.
- Comment và thông báo lỗi viết tiếng Việt, không dấu nhấn bị lỗi font. Code và tên biến tiếng Anh.
- Comment giải thích **VÌ SAO**, không giải thích CÁI GÌ — theo `AGENTS.md`.
- Mọi file mới dưới `lib/agents/` phải có docblock tiếng Việt ở đầu nói rõ nó làm gì và phụ thuộc gì.
- Không thêm dependency mới.
- Đường dẫn `.vyen/agents/` là tương đối so với workspace root, do caller truyền vào — không hardcode `process.cwd()`.

## Review Focus

Năm chế độ lỗi mà spec ngụ ý nhưng không test nào của task nào bảo vệ. Mỗi dòng có test tương ứng nằm trong task sở hữu code đó.

1. **`.vyen/agents/` không tồn tại** — `delegate` phải vẫn chạy y hệt hôm nay với bộ tool đầy đủ. Người dùng không nào tạo file agent cũng phải dùng được app. → Task 4
2. **`tools:` khai báo tên không có trong catalog** — tên đó bị bỏ qua, các tool còn lại vẫn dùng được; không ném lỗi làm hỏng agent. → Task 3
3. **`steps: 0` hoặc `steps: 999`** — kẹp về `[1, 25]`, không phải lỗi, không phải mặc định. → Task 1
4. **Model truyền tên agent không tồn tại** — tool trả `{error, available:[...]}`, model tự sửa được trong cùng lượt. → Task 4
5. **Hai file agent khớp cùng một wildcard ở mức độ cụ thể bằng nhau** — báo lỗi nêu cả hai tên, không âm thầm chọn một. Người viết agent phải biết có xung đột. → Task 2

---

## File Structure

| File | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `lib/frontmatter.ts` | Tách frontmatter YAML khỏi body markdown | `yaml` |
| `lib/agents/agent-definition.ts` | Kiểu `AgentDefinition` + validate + parse | `lib/frontmatter.ts` |
| `lib/agents/agent-registry.ts` | Quét `.vyen/agents/`, phân giải tên, sinh danh sách cho prompt | `agent-definition.ts`, `node:fs` |
| `lib/agents/agent-tool-scope.ts` | Giao bộ tool cha với `tools` của agent | `lib/tool-catalog.ts` |
| `.vyen/agents/code-reviewer.md` | Agent chỉ-đọc, ví dụ | — |
| `.vyen/agents/explorer.md` | Agent chỉ-đọc, ví dụ | — |

Sửa: `lib/skills/disk.ts`, `lib/agent-tools.ts`, `lib/subagent.ts`, `lib/tool-catalog.ts`, `app/api/chat/route.ts`.

Xoá: xem Task 5.

---

### Task 1: Tách frontmatter + parse định nghĩa agent

**Files:**
- Create: `lib/frontmatter.ts`
- Create: `lib/agents/agent-definition.ts`
- Create: `tests/agent-definition.test.ts`
- Modify: `lib/skills/disk.ts:51-61` (dùng helper mới thay vì cắt chuỗi inline)

**Interfaces:**
- Consumes: không có.
- Produces:
  ```ts
  // lib/frontmatter.ts
  export function splitFrontmatter(text: string): { frontRaw: string; body: string } | null

  // lib/agents/agent-definition.ts
  export interface AgentDefinition {
    name: string;              // tên file bỏ đuôi
    description: string;       // 1..400 ký tự
    tools?: readonly string[]; // undefined = kế thừa bộ tool cha
    model?: string;            // undefined = model của cha
    steps: number;             // đã kẹp [1,25]
    body: string;              // markdown sau frontmatter
  }
  export type ParseAgentResult =
    | { ok: true; definition: AgentDefinition }
    | { ok: false; error: string };
  export const AGENT_DESCRIPTION_MAX = 400;
  export const AGENT_STEPS_MIN = 1;
  export const AGENT_STEPS_MAX = 25;
  export const AGENT_STEPS_DEFAULT = 10;

  export function parseAgentDefinition(fileName: string, raw: string): ParseAgentResult;
  ```

- [ ] **Step 1: Viết test đỏ**

`tests/agent-definition.test.ts`:

```ts
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
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/agent-definition.test.ts`
Expected: FAIL — `Cannot find module '@/lib/agents/agent-definition'`

- [ ] **Step 3: Viết `lib/frontmatter.ts`**

```ts
/**
 * Tách frontmatter YAML (giữa hai dòng `---` ở đầu file) khỏi body markdown.
 *
 * Tách khỏi `lib/skills/disk.ts` để SKILL.md và agent dùng chung một quy tắc:
 * frontmatter phải là block YAML ở DÐẦU file, không phải xuất hiện ở giữa.
 */

export function splitFrontmatter(text: string): { frontRaw: string; body: string } | null {
  const normalized = (text ?? '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return null;
  return {
    frontRaw: normalized.slice(3, end).replace(/^\n/, ''),
    body: normalized.slice(end + 4).replace(/^\n+/, ''),
  };
}
```

- [ ] **Step 4: Viết `lib/agents/agent-definition.ts`**

Docblock tiếng Việt ở đầu nêu: file này định nghĩa "một agent là gì" và chỉ làm phần parse+validate, không đụng đĩa.

```ts
import { parse as parseYaml } from 'yaml';
import { splitFrontmatter } from '@/lib/frontmatter';

export const AGENT_DESCRIPTION_MAX = 400;
export const AGENT_STEPS_MIN = 1;
export const AGENT_STEPS_MAX = 25;
export const AGENT_STEPS_DEFAULT = 10;

export interface AgentDefinition { /* như Interfaces */ }

export type ParseAgentResult = { ok: true; definition: AgentDefinition } | { ok: false; error: string };

export function parseAgentDefinition(fileName: string, raw: string): ParseAgentResult {
  const split = splitFrontmatter(raw);
  if (!split) return { ok: false, error: 'Thiếu frontmatter YAML (file phải bắt đầu bằng dòng ---).' };

  let front: unknown;
  try { front = parseYaml(split.frontRaw); }
  catch (err) { return { ok: false, error: `Frontmatter hỏng: ${err instanceof Error ? err.message : String(err)}` }; }

  const rec = (front ?? {}) as Record<string, unknown>;
  const description = typeof rec.description === 'string' ? rec.description.trim() : '';
  if (!description) return { ok: false, error: 'description: bắt buộc.' };
  if (description.length > AGENT_DESCRIPTION_MAX) {
    return { ok: false, error: `description: tối đa ${AGENT_DESCRIPTION_MAX} ký tự, đang ${description.length}.` };
  }

  const steps = clampSteps(rec.steps);

  return {
    ok: true,
    definition: {
      name: fileName.replace(/\.md$/, ''),
      description,
      ...(Array.isArray(rec.tools)
        ? { tools: rec.tools.filter((t): t is string => typeof t === 'string') }
        : {}),
      ...(typeof rec.model === 'string' && rec.model.trim() ? { model: rec.model.trim() } : {}),
      steps,
      body: split.body,
    },
  };
}
```

`clampSteps(value: unknown): number` là hàm cục bộ không export: nhận số nguyên trong khoảng `[AGENT_STEPS_MIN, AGENT_STEPS_MAX]` thì trả về nó; không phải số nguyên hợp lệ thì trả `AGENT_STEPS_DEFAULT`; là số nguyên ngoài khoảng thì kẹp về biên.

- [ ] **Step 5: Chạy để xác nhận xanh**

Run: `npx vitest run tests/agent-definition.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 6: Cho `lib/skills/disk.ts` dùng helper**

Thay 9 dòng cắt chuỗi trong `parseSkillFile` (dòng 52-61) bằng:

```ts
const split = splitFrontmatter(text);
if (!split) {
  return { ok: false, error: 'Thiếu front-matter YAML (file phải bắt đầu bằng dòng ---).' };
}
```

Thêm `import { splitFrontmatter } from '@/lib/frontmatter';`. Giữ nguyên phần `parseYaml` và phần validate còn lại.

Run: `npx vitest run tests/skills-disk.test.ts`
Expected: PASS — hành vi không đổi.

- [ ] **Step 7: Commit**

```bash
git add lib/frontmatter.ts lib/agents/agent-definition.ts lib/skills/disk.ts tests/agent-definition.test.ts
git commit -m "feat(agents): parse dinh nghia agent tu frontmatter .md"
```

---

### Task 2: Registry — quét đĩa, phân giải tên, ship agent mẫu

**Files:**
- Create: `lib/agents/agent-registry.ts`
- Create: `tests/agent-registry.test.ts`
- Create: `.vyen/agents/code-reviewer.md`
- Create: `.vyen/agents/explorer.md`

**Interfaces:**
- Consumes: `parseAgentDefinition(fileName, raw): ParseAgentResult`, `AgentDefinition` (Task 1).
- Produces:
  ```ts
  // lib/agents/agent-registry.ts
  export interface AgentRegistry {
    agents: readonly AgentDefinition[];   // sắp xếp theo name
    warnings: readonly string[];          // mỗi dòng là 1 lý do bỏ qua 1 file
  }
  export function loadAgentRegistry(agentsDir: string): AgentRegistry;

  export type AgentResolution =
    | { ok: true; definition: AgentDefinition }
    | { ok: false; error: string; available: string[] };

  export function resolveAgentDefinition(
    registry: AgentRegistry,
    name: string
  ): AgentResolution;

  export function describeAgents(registry: AgentRegistry): string;
  ```

- [ ] **Step 1: Viết test đỏ**

`tests/agent-registry.test.ts`. Dùng `mkdtempSync(join(tmpdir(), 'agents-'))` tạo thư mục tạm, ghi file bằng `writeFileSync`, dọn bằng `rmSync(dir, {recursive:true})` trong `afterEach`.

```ts
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadAgentRegistry, resolveAgentDefinition, describeAgents,
} from '@/lib/agents/agent-registry';

const dirs: string[] = [];
function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vyen-agents-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'nested'), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}
const DEF = (d: string) => `---\ndescription: ${d}\n---\nbody\n`;
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('loadAgentRegistry', () => {
  it('thư mục không tồn tại → agents rỗng, warnings rỗng, KHÔNG ném lỗi', () => {
    const r = loadAgentRegistry(join(tmpdir(), 'vyen-khong-co-that'));
    expect(r.agents).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('nạp .md ở cấp đĩa, bỏ qua thư mục con', () => {
    const r = loadAgentRegistry(dirWith({ 'a.md': DEF('A'), 'sub/nested/b.md': DEF('B') }));
    expect(r.agents.map(a => a.name)).toEqual(['a']);
  });

  it('file hỏng bị bỏ qua và ghi 1 warning, file tốt vẫn nạp', () => {
    const r = loadAgentRegistry(dirWith({ 'good.md': DEF('G'), 'bad.md': 'không có frontmatter' }));
    expect(r.agents.map(a => a.name)).toEqual(['good']);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('bad.md');
  });

  it('sắp xếp theo name', () => {
    const r = loadAgentRegistry(dirWith({ 'z.md': DEF('Z'), 'a.md': DEF('A') }));
    expect(r.agents.map(a => a.name)).toEqual(['a', 'z']);
  });
});

describe('resolveAgentDefinition', () => {
  it('khớp chính xác thắng wildcard', () => {
    const r = loadAgentRegistry(dirWith({ 'rev.md': DEF('cụ thể'), 'rev-x.md': DEF('wildcard') }));
    const hit = resolveAgentDefinition(r, 'rev');
    expect(hit.ok && hit.definition.description).toBe('cụ thể');
  });

  it('wildcard nhiều ký tự hơn thắng', () => {
    const r = loadAgentRegistry(dirWith({ 'a-x.md': DEF('dài'), 'a-x-y.md': DEF('dài hơn') }));
    const hit = resolveAgentDefinition(r, 'a-x-y');
    expect(hit.ok && hit.definition.description).toBe('dài hơn');
  });

  it('hai wildcard cùng độ dài → lỗi nêu cả hai tên, không tự chọn', () => {
    const r = loadAgentRegistry(dirWith({ 'p-a.md': DEF('1'), 'p-b.md': DEF('2') }));
    const miss = resolveAgentDefinition(r, 'p-z');
    expect(miss.ok).toBe(false);
    expect(miss.ok === false && miss.error).toContain('p-a');
    expect(miss.ok === false && miss.error).toContain('p-b');
  });

  it('tên không có → lỗi kèm available', () => {
    const r = loadAgentRegistry(dirWith({ 'only.md': DEF('O') }));
    const miss = resolveAgentDefinition(r, 'nope');
    expect(miss.ok === false && miss.available).toEqual(['only']);
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
```

- [ ] **Step 2: Chạy để xác nhận đỗi**

Run: `npx vitest run tests/agent-registry.test.ts`
Expected: FAIL — `Cannot find module '@/lib/agents/agent-registry'`

- [ ] **Step 3: Viết `lib/agents/agent-registry.ts`**

Docblock: registry là nguồn sự thật duy nhất cho danh sách agent; đọc lại từ đĩa mỗi lần gọi (`.vyen/agents/` là file người dùng tự sửa, không có bước build/cache nào).

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgentDefinition, type AgentDefinition } from './agent-definition';

export interface AgentRegistry { /* như Interfaces */ }

export function loadAgentRegistry(agentsDir: string): AgentRegistry {
  let names: string[];
  try { names = readdirSync(agentsDir); }
  catch { return { agents: [], warnings: [] }; }   // không có thư mục = chưa dùng tính năng, không phải lỗi

  const agents: AgentDefinition[] = [];
  const warnings: string[] = [];
  for (const entry of names.filter(n => n.endsWith('.md')).sort()) {
    const parsed = parseAgentDefinition(entry, readFileSync(join(agentsDir, entry), 'utf8'));
    if (parsed.ok) agents.push(parsed.definition);
    else warnings.push(`Bỏ qua .vyen/agents/${entry}: ${parsed.error}`);
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, warnings };
}
```

`resolveAgentDefinition`:
1. Khớp chính xác: `registry.agents.find(a => a.name === name)` → trả `ok:true`.
2. Nếu không có, gom ứng viên có tên khớp wildcard: tên có `*`, thay `*` bằng `.*`, khớp toàn bộ tên.
3. Loại theo độ dài phần chữ trước dấu `*`, giữ dài nhất.
4. Nếu còn nhiều hơn một ứng viên → `ok:false`, `error` liệt kê tên các ứng viên.
5. Nếu không có ứng viên nào → `ok:false`, `available` = toàn bộ tên agent.

`describeAgents(registry)`: `registry.agents.map(a => \`${a.name} — ${a.description}\`).join('\n')`, trả `''` khi danh sách rỗng.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/agent-registry.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Tạo hai agent mẫu**

`.vyen/agents/code-reviewer.md`:
```markdown
---
description: Review code về correctness, security và hiệu năng. Chỉ đọc, không sửa.
tools: [fs_read, fs_list, fs_search, web_fetch]
steps: 12
---

Bạn đang review code. Với mỗi phát hiện, nêu file:line và vấn đề cụ thể.
Tuyệt đối không sửa file — nếu cần sửa, chỉ ra chỗ và giải thích.
```

`.vyen/agents/explorer.md`:
```markdown
---
description: Tìm file theo pattern, grep từ khoá, đọc để trả lời câu hỏi về codebase. Chỉ đọc.
tools: [fs_read, fs_list, fs_search]
steps: 8
---

Bạn là người thám hiểm codebase. Trả lời bằng bằng chứng file:line.
Không đoán — không đọc được thì nói không đọc được.
```

- [ ] **Step 6: Commit**

```bash
git add lib/agents/agent-registry.ts tests/agent-registry.test.ts .vyen/agents/
git commit -m "feat(agents): registry quet .vyen/agents va phan giai ten co wildcard"
```

---

### Task 3: Giao bộ tool

**Files:**
- Create: `lib/agents/agent-tool-scope.ts`
- Create: `tests/agent-tool-scope.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition` (Task 1); `TOOL_CATALOG` từ `@/lib/tool-catalog`.
- Produces:
  ```ts
  // lib/agents/agent-tool-scope.ts
  export interface ToolScopeResult {
    names: Set<string>;
    /** Tên trong `tools:` không có trong catalog — đã bị bỏ. */
    dropped: readonly string[];
  }
  export function resolveAgentToolNames(
    parentNames: ReadonlySet<string>,
    definition: AgentDefinition | null
  ): ToolScopeResult;
  ```

- [ ] **Step 1: Viết test đỏ**

`tests/agent-tool-scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveAgentToolNames } from '@/lib/agents/agent-tool-scope';
import type { AgentDefinition } from '@/lib/agents/agent-definition';

const def = (tools?: string[]): AgentDefinition => ({
  name: 'x', description: 'd', steps: 10, body: '', ...(tools ? { tools } : {}),
});

describe('resolveAgentToolNames', () => {
  it('definition null → kế thừa nguyên bộ tool cha', () => {
    const parent = new Set(['fs_read', 'shell_run']);
    const r = resolveAgentToolNames(parent, null);
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

  it('tools: [] → agent không có tool nào', () => {
    const r = resolveAgentToolNames(new Set(['fs_read', 'shell_run']), def([]));
    expect([...r.names]).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỗi**

Run: `npx vitest run tests/agent-tool-scope.test.ts`
Expected: FAIL — `Cannot find module '@/lib/agents/agent-tool-scope'`

- [ ] **Step 3: Viết `lib/agents/agent-tool-scope.ts`**

Docblock: đây là nơi "agent không được phép" trở thành "agent không nhìn thấy" — công cụ vắng mặt khỏi schema thì model không thể gọi, không phụ thuộc vào việc có dạy nó hay không.

```ts
import type { AgentDefinition } from './agent-definition';

/** Tên tool hợp lệ, suy ra từ catalog — dùng để loại tên gõ sai trong `tools:`. */
export function isKnownToolName(name: string): boolean;

export interface ToolScopeResult { /* như Interfaces */ }

export function resolveAgentToolNames(
  parentNames: ReadonlySet<string>,
  definition: AgentDefinition | null
): ToolScopeResult {
  if (definition?.tools === undefined) return { names: new Set(parentNames), dropped: [] };
  const dropped: string[] = [];
  const names = new Set<string>();
  for (const t of definition.tools) {
    if (!isKnownToolName(t)) { dropped.push(t); continue; }
    if (parentNames.has(t)) names.add(t);
  }
  names.delete('delegate');   // chống đệ quy ở tầng schema, không phải ở prompt
  return { names, dropped };
}
```

`isKnownToolName` lấy key từ `TOOL_CATALOG` trong `@/lib/tool-catalog`. Phải đọc tên export thực tế của catalog ở thời điểm viết; nếu `TOOL_CATALOG` là mảng các entry có `.name`, dùng `TOOL_CATALOG.some(e => e.name === name)`.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/agent-tool-scope.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/agents/agent-tool-scope.ts tests/agent-tool-scope.test.ts
git commit -m "feat(agents): giao bo tool cha voi tools khai bao, delegate luon bi loai"
```

---

### Task 4: Đấu `delegate` mới vào cả hai đường chạy

**Files:**
- Modify: `lib/subagent.ts` (`DelegateCallArgs`, `SubagentOptions`, `executeDelegate`, bỏ CapBAC)
- Modify: `lib/agent-tools.ts:1227-1279` (schema `delegate` trong `CLIENT_TOOL_DEFS`)
- Modify: `lib/tool-catalog.ts:487-493` (mô tả `delegate` trong catalog)
- Modify: `app/api/chat/route.ts` (nơi dựng tool và nơi chạy `executeDelegate`)
- Modify: `tests/subagent.test.ts`
- Create: `tests/agent-delegate-wiring.test.ts`

**Interfaces:**
- Consumes: `loadAgentRegistry`, `resolveAgentDefinition`, `describeAgents` (Task 2); `resolveAgentToolNames` (Task 3); `AgentDefinition` (Task 1).
- Produces:
  ```ts
  // lib/subagent.ts — thay cho DelegateCallArgs cũ
  export interface DelegateCallArgs {
    /** Tên agent trong .vyen/agents/. Bỏ trống = bộ tool đầy đủ. */
    agent?: string;
    /** Việc cần làm, 10..5000 ký tự. */
    task: string;
    steps?: number;
    model?: string;
    context?: 'fresh' | 'brief';
  }
  // SubagentOptions: bỏ `mode`, thêm
  agentDefinition: AgentDefinition | null;

  // lib/agent-tools.ts — thay cho object delegate cũ
  export function buildDelegateTool(registry: AgentRegistry): { tool: Tool; description: string };
  ```

- [ ] **Step 1: Viết test đỗi**

`tests/agent-delegate-wiring.test.ts` — khẳng định ba điều ở tầng định nghĩa, không đụng LLM:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLIENT_TOOL_DEFS } from '@/lib/agent-tools';

describe('delegate schema mới', () => {
  it('có `agent` và `task`, KHÔNG còn `instructions`/`tasks`/`mode`/`max_turns`/`timeout_secs`', () => {
    const shape = CLIENT_TOOL_DEFS.delegate.parameters._def.shape() as Record<string, unknown>;
    expect(Object.keys(shape).sort()).toEqual(['agent', 'context', 'model', 'steps', 'task']);
  });

  it('`task` là bắt buộc', () => {
    const shape = CLIENT_TOOL_DEFS.delegate.parameters._def.shape() as Record<string, unknown>;
    expect(Object.keys(CLIENT_TOOL_DEFS.delegate.parameters._def.shape()).length).toBeGreaterThan(0);
    expect(shape.task).toBeDefined();
  });
});

describe('mô tả delegate đồng bộ với đĩa', () => {
  it('mô tả liệt kê đúng agent có trong .vyen/agents/', () => {
    const desc = CLIENT_TOOL_DEFS.delegate.description;
    expect(desc).toContain('code-reviewer');
    expect(desc).toContain('explorer');
  });
});

describe('delegate không còn là tool ghi', () => {
  it('delegate không nằm trong danh sách tool bị ghi (SEQUENTIAL_TOOLS vẫn giữ vì nó kéo theo side-effect)', () => {
    const src = readFileSync('lib/subagent.ts', 'utf8');
    expect(src).not.toContain('defaultSubagentScope');
    expect(src).not.toContain('withSubagentWriteScope');
    expect(src).not.toContain('SCOUT_DENIED_CLIENT_TOOLS');
  });
});
```

Nếu zod version trong repo không expose `_def.shape()`, viết lại hai case đầu bằng cách parse `CLIENT_TOOL_DEFS.delegate.parameters.safeParse({ task: 'x'.repeat(20) })` và kiểm tra nó **thành công** với `{ task }`, và **thất bại** với `{ instructions: '...' }`. Đây là kiểm chứng hành vi, không phụ thuộc hình dạng nội bộ.

- [ ] **Step 2: Chạy để xác nhận đỗi**

Run: `npx vitest run tests/agent-delegate-wiring.test.ts`
Expected: FAIL — schema còn `instructions`, `tasks`, `mode`.

- [ ] **Step 3: Đổi `DelegateCallArgs` và `SubagentOptions` trong `lib/subagent.ts`**

- Xoá `SubagentMode`, `SCOUT_DENIED_CLIENT_TOOLS`, `defaultSubagentScope`, `withSubagentWriteScope`.
- Xoá import `createCapabilityScope`, `validateSubagentPermission`, `AgentCapabilityScope` từ `@/core/agent-runtime/capability-context`.
- Xoá `DelegateTaskInput`.
- `DelegateCallArgs` và `SubagentOptions.mode` theo Interfaces ở trên.
- `SubagentResult` bỏ trường `mode`.
- `buildSubagentSystemPrompt(baseSystem, instructions, maxTurns, opts)`: đổi `opts.mode` thành `opts.tools?`. Khối "CHẾ ĐỘ SCOUT" hiện tại viết lại thành khối liệt kê tool thực tế mà agent có, ví dụ:

```
## Tools của bạn
Bạn chỉ có các tool sau: fs_read, fs_list, fs_search.
Tool khác KHÔNG tồn tại với bạn — đừng cố gọi.
```

Danh sách rỗng thì bỏ hẳn khối này.
- `runSubagent`: thay `const clientToolNames = mode === 'scout' ? ... : opts.clientToolNames` bằng dùng thẳng `opts.clientToolNames` (đã lọc sẵn ở `executeDelegate`).

- [ ] **Step 4: Sửa `executeDelegate`**

Trong `lib/subagent.ts`, `executeDelegate` nhận `agentDefinition` và `clientToolNames` đã lọc từ tầng trên. Bỏ phần `tasks[]` fan-out, `runPool`, `SUBAGENT_MAX_PARALLEL_TASKS`, `SUBAGENT_PARALLEL_CONCURRENCY` — Spec #2 sẽ làm lại phần này.

Thứ tự xử lý trong `executeDelegate` phải là:
1. `resolveAgentDefinition(registry, args.agent)` — không có `args.agent` thì `definition = null`.
2. Không resolve được → trả `JSON.stringify({ error, available })` ngay, **không** gọi `runSubagent`.
3. `resolveAgentToolNames(parentToolNames, definition)` → truyền `names` vào `runSubagent`.
4. `steps = args.steps ?? definition?.steps ?? SUBAGENT_DEFAULT_MAX_TURNS`, kẹp `[SUBAGENT_ABSOLUTE_MAX_TURNS]`.

- [ ] **Step 5: Sửa schema `delegate` trong `lib/agent-tools.ts`**

Thay khối `delegate: tool({...})` (dòng 1227-1279) bằng object có `agent`, `task`, `steps`, `model`, `context`. `task` là `z.string().min(10).max(5000)` và **bắt buộc**. Không có `execute` — như bản cũ; route cung cấp bản server.

Mô tả phải do `describeAgents(registry)` sinh ra, không hardcode tên agent. Nội dung mẫu:

```
GIAO VIỆC cho subagent chạy context RIÊNG (không thấy lịch sử chat này).

Agent có sẵn:
{catalog}

Chọn `agent` theo việc cần làm, rồi viết `task` cụ thể cho nó.
Agent chỉ có đúng các tool trong khai báo của nó — ví dụ agent chỉ-đọc không
có fs_write, nên đừng bảo nó sửa code.
```

Nếu danh sách agent rỗng, dùng biến thể mô tả không có mục "Agent có sẵn".

- [ ] **Step 6: Nối registry trong `app/api/chat/route.ts`**

- Nạp registry một lần mỗi request: `loadAgentRegistry(<workspaceRoot>/.vyen/agents)`. Workspace root lấy từ biến workspace mà route đã dùng cho `webContext`/cảnh báo workspace; nếu chưa có biến này, dùng `process.cwd()` và ghi chú việc đó trong code.
- `ghi log` mỗi phần tử `registry.warnings` ra console mỗi request — người dùng sửa file agent hỏng thì thấy ngay.
- Truyền `registry` xuống chỗ dựng `nativeDelegateTool` và chỗ `executeDelegate` của đường emulated.
- Ở cả hai đường: gọi `resolveAgentDefinition` + `resolveAgentToolNames` **trước** khi chạy, và dùng `describeAgents(registry)` cho `description`.
- `PLAN_MODE_WRITE_TOOLS` (dòng 81) giữ nguyên, vẫn gồm `delegate`.

- [ ] **Step 7: Sửa mô tả trong `lib/tool-catalog.ts`**

Cập nhật entry `delegate` (dòng 487-493) cho khớp ý nghĩa mới: giao việc cho agent có tên. Giữ `category: 'delegate'` và key trong `TOOL_CATEGORY_MAP` — đổi chúng sẽ phá cấu hình quyền đã lưu của người dùng.

- [ ] **Step 8: Sửa `tests/subagent.test.ts`**

Bỏ các case scout/worker và case CapBAC. Giữ case nào chỉ kiểm tra `buildSubagentSystemPrompt` thì đổi sang khối "Tools của bạn". Thêm case: `buildSubagentSystemPrompt(..., { tools: ['fs_read'] })` chứa đúng `fs_read` và không chứa `shell_run`.

- [ ] **Step 9: Chạy toàn bộ test liên quan**

Run:
```
npx vitest run tests/agent-delegate-wiring.test.ts tests/subagent.test.ts tests/agent-definition.test.ts tests/agent-registry.test.ts tests/agent-tool-scope.test.ts tests/tool-catalog.test.ts tests/tool-deny.test.ts tests/plan-mode.test.ts tests/recipes-subrecipe.test.ts
```
Expected: PASS. Sửa mọi test khác vỡ vì schema đổi, nhưng KHÔNG xoá test chỉ để nó xanh.

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi. Nếu còn tham chiếu `mode`/`tasks`/`SCOUT_DENIED_CLIENT_TOOLS` ở đâu đó, sửa chỗ đó.

- [ ] **Step 11: Commit**

```bash
git add lib/subagent.ts lib/agent-tools.ts lib/tool-catalog.ts app/api/chat/route.ts tests/
git commit -m "feat(agents): delegate chon agent theo ten, cat CapBAC, bo mode/tasks fan-out"
```

---

### Task 5: Dọn code chết

**Files:**
- Delete: `core/agent-runtime/state-machine.ts`, `tests/core-state-machine.test.ts`
- Delete: `core/agent-runtime/fencing.ts`, `tests/storage-fencing.test.ts`
- Delete: `core/agent-runtime/capability-context.ts`, `tests/subagent-write-scope.test.ts`, `tests/capability-projection.test.ts`
- Delete: `core/agent-runtime/tool-runner.ts`
- Create: `lib/shell-policy.ts`
- Modify: `react/use-chat-orchestration.ts:3` và chỗ gọi `validateShellAllowlist`
- Modify: `tests/core-state-machine.test.ts` → chuyển case còn lại sang `tests/shell-allowlist.test.ts` TRƯỚC khi xoá file test gốc

**Interfaces:**
- Consumes: không có.
- Produces: `validateShellAllowlist(command: string): { ok: true; compiled: string } | { ok: false; reason: string }` chuyển từ `@/core/agent-runtime/tool-runner` sang `@/lib/shell-policy`. Kiểu `ShellValidationResult` phải được export lại từ file mới.

- [ ] **Step 1: Tách `validateShellAllowlist` sang `lib/shell-policy.ts`**

Copy nguyên văn hàm + kiểu `ShellValidationResult` từ `core/agent-runtime/tool-runner.ts`. Giữ nguyên `import { compileShellCommand } from '@/lib/ipc.cjs'` (hoặc đường dẫn tương đương đang dùng) và docblock giải thích vì sao lớp này chạy song song với `lib/ipc.cjs`.

- [ ] **Step 2: Trỏ import lại**

Trong `react/use-chat-orchestration.ts` dòng 3, đổi `@/core/agent-runtime/tool-runner` thành `@/lib/shell-policy`.

Run: `npx vitest run tests/shell-tool.test.ts`
Expected: PASS

- [ ] **Step 3: Chuyển case `validateShellAllowlist` sang test mới**

Trong `tests/core-state-machine.test.ts`, lấy riêng các case kiểm tra `validateShellAllowlist` (import ở dòng 17) sang `tests/shell-allowlist.test.ts`, đổi import sang `@/lib/shell-policy`. Bỏ các case còn lại.

Run: `npx vitest run tests/shell-allowlist.test.ts`
Expected: PASS, số test bằng số case vừa chuyển.

- [ ] **Step 4: Chạy full suite trước khi xoá**

Run: `npm test`
Expected: PASS. Nếu đỏ, dừng lại — không xoá gì khi baseline đỏ.

- [ ] **Step 5: Xoá các file chết**

```bash
git rm core/agent-runtime/state-machine.ts tests/core-state-machine.test.ts
git rm core/agent-runtime/fencing.ts tests/storage-fencing.test.ts
git rm core/agent-runtime/capability-context.ts tests/subagent-write-scope.test.ts tests/capability-projection.test.ts
git rm core/agent-runtime/tool-runner.ts
```

- [ ] **Step 6: Xác nhận không còn import nào lơ lửng**

Run: `npx vitest run` và `npm run typecheck`
Expected: cả hai PASS/XANH. Grep `agent-runtime/(state-machine|fencing|tool-runner|capability-context)` phải trả về rỗng.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: xoa state-machine/fencing/capability-context/tool-runner

state-machine.ts va fencing.ts chi duoc chinh test cua no tham chieu.
capability-context.ts chet theo CapBAC o Task 4.
validateShellAllowlist chuyen sang lib/shell-policy.ts."
```

---

## Self-review

**Spec coverage:** mục 1 (vấn đề) → Task 4. Mục 3 (nguồn tham khảo) → không cần task. Mục 4 (định dạng + phân giải) → Task 1, 2. Mục 5 (lọc tool, CapBAC) → Task 3, 4. Mục 6 (schema mới) → Task 4. Mục 7 (mô tả mới) → Task 4 Step 5. Mục 8 (code chết) → Task 5. Mục 9 (thành phần mới) → cấu trúc File Structure. Mục 10 (luồng dữ liệu) → Task 4 Step 6. Mục 11 (lỗi) → Task 2 (file hỏng), Task 3 (tên lạ), Task 4 (tên không tồn tại). Mục 12 (kiểm thử) → Task 1-5. Mục 13 (rủi ro) → Global Constraints + Review Focus. Mục 14 (Spec #2) → ngoài phạm vi, đã ghi ở Task 4 Step 4.

**Review Focus → task sở hữu:** dòng 1 (thư mục thiếu) → Task 2 `loadAgentRegistry` test; Task 4 Step 6 giữ nguyên hành vi khi rỗng. Dòng 2 (tên lạ) → Task 3. Dòng 3 (steps ngoài khoảng) → Task 1. Dòng 4 (tên không tồn tại) → Task 2 `resolveAgentDefinition` + Task 4 Step 4. Dòng 5 (wildcard trùng) → Task 2.

**Type consistency:** `AgentDefinition` định nghĩa ở Task 1, dùng ở Task 2, 3, 4 — cùng tên. `AgentRegistry` định nghĩa ở Task 2, dùng ở Task 4 (`buildDelegateTool(registry)`). `resolveAgentToolNames` trả `ToolScopeResult` với `{ names, dropped }` — Task 3 khai, Task 4 dùng `.names`. `loadAgentRegistry(agentsDir: string)` nhận đường dẫn tuyệt đối ở cả test lẫn route.

**Proportion:** 5 task, 40 bước. Spec 230 dòng, plan ~330 dòng — cùng cấp độ chi tiết, không phải bản chép lại code.
