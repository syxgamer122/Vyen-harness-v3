# Tool Result Spill — sửa gốc C1 + C3 (spec v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm cho phần kết quả tool bị cắt vẫn đọc lại được bằng `fs_read`, trên cả native lẫn emulated path, trong bản build thật.

**Architecture:** Tách hai module đang trộn client và server theo ranh giới runtime, để phần server import được `lib/ipc.cjs` bằng **import tĩnh** (cùng instance mà `server-bridge.ts:75` nạp). Spill nằm đúng một chỗ: tầng kết quả tool phía server. Xoá hẳn `eval('require')` của bản 1.

**Tech Stack:** Next.js 16 (Turbopack), React 19, TypeScript, Vitest 4.1.11

**Spec:** `docs/superpowers/specs/2026-10-18-tool-result-spill-design.md` (bản 2)

**Bối cảnh bắt buộc:** bản 1 đã implement đủ 5 task, mọi gate xanh (`tsc`, `lint`, `build`, 143 test, full suite 3.346) — và tính năng **không chạy**. Đừng tin `build exit 0`.

## Global Constraints

- `TOOL_RESULT_MAX_CHARS = 24_000` và tỷ lệ `0.7` / `0.25` **không đổi** — hình dạng preview phải y hệt bản 1.
- Redact phải chạy **trước** khi ghi xuống đĩa. Đây là ranh giới thứ hai, sau "redact trước khi cắt" (`tests/secret-registry.test.ts:260`).
- Lỗi ghi file → fallback cắt trần cũ, **không** ném. Lỗi lưu không được biến tool call thành công thành thất bại.
- Registry đẩy `shell` trước `spill` — giữ nguyên `lib/ipc.cjs` Task 2 của bản 1, **không sửa**.
- Comment tiếng Việt. Tin nhắn commit **không** dấu.
- Test mới phải chứng minh ĐỎ trước khi sửa (AGENTS.md §2).
- `mode: 0o600` không có tác dụng trên Windows — đừng mô tả nó là bảo vệ quyền ghi.

## Review Focus

1. **Bản build phải thật sự nối `saveSpillText`.** `build exit 0` không chứng minh điều này — bản 1 đã chứng minh điều đó bằng cách thất bại. Test phải đọc `.next/server/`.
2. **Bất kỳ code server nào quay lại nằm trong module dùng chung.** Đó chính là lỗi sinh ra C1. Test duyệt đồ thị import từ entry trình duyệt phải bắt được.
3. **Khoá bí mật nằm ở phần giữa** — phần bị lược bỏ khỏi ngữ cảnh. File spill không được chứa nó.
4. **`capToolResult` giữ hình dạng object.** Nhiều test và `toolResultBody` phụ thuộc shape `results[]` / `content` / `note`. Đổi shape là hồi quy.
5. **Lỗi ghi đĩa.** Agent không có đĩa, hoặc hết chỗ. Tool call phải vẫn thành công.

---

### Task 1: Chứng minh C1 bằng artifact thật

**Files:**
- Create: `tests/spill-wiring.test.ts`
- Modify: không

**Interfaces:**
- Consumes: không có
- Produces: không có — task này chỉ chứng minh, không sửa gì

**Đây là task chặn.** Nó phải ĐỎ ngay với code hiện tại. Nếu xanh thì test vô nghĩa — dừng lại và làm rõ.

- [ ] **Step 1: Viết test ĐỎ — artifact build phải nối spill**

`tests/spill-wiring.test.ts`:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();
const SERVER_DIR = path.join(REPO, '.next', 'server');

function jsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) jsFiles(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

describe.skipIf(!existsSync(SERVER_DIR))('spill — artifact đã build', () => {
  it('bản build có mang saveSpillText, không chỉ mang lời gọi', () => {
    const files = jsFiles(SERVER_DIR);
    expect(files.length).toBeGreaterThan(0);
    const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    // `vyen-spill-` là hằng duy nhất trong saveSpillText — dùng để chứng minh
    // ipc.cjs thật sự được đóng gói vào sản phẩm server, không phải require
    // theo đường dẫn (đường dẫn đó không tồn tại sau khi bundle).
    expect(all).toContain('vyen-spill-');
  });

  it('không còn require theo đường dẫn tới ipc.cjs', () => {
    const all = jsFiles(SERVER_DIR).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(all).not.toContain('./ipc.cjs');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận ĐỎ**

Run: `npm run build && npx vitest run tests/spill-wiring.test.ts`
Expected: FAIL ở test thứ nhất — bản build hiện tại **không** chứa `vyen-spill-` vì `ipc.cjs` không được bundle.
Test thứ hai phải ĐỎ (vẫn còn `req("./ipc.cjs")`).

Nếu test thứ nhất XANH → **dừng**. Nghĩa là `.next` cũ hoặc build không chạy; xoá `.next` rồi chạy lại.

- [ ] **Step 3: Viết test ĐỎ — ranh giới runtime**

Thêm vào cùng file:

```ts
describe('ranh giới runtime — trình duyệt không được chạm ipc.cjs', () => {
  const CLIENT_ENTRIES = [
    'react/use-chat-orchestration.ts',
    'components/chat/tool-trace.tsx',
    'app/page.tsx',
  ];

  function importsOf(file: string): string[] {
    const src = readFileSync(path.join(REPO, file), 'utf8');
    const out: string[] = [];
    const re = /from\s+'@\/([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.push(`lib/${m[1]}.ts`);
    return out;
  }

  it('không module nào tới được từ trình duyệt import ipc.cjs', () => {
    const seen = new Set<string>();
    const queue = CLIENT_ENTRIES.filter((f) => existsSync(path.join(REPO, f)));
    const offenders: string[] = [];
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const abs = path.join(REPO, f);
      if (!existsSync(abs)) continue;
      const src = readFileSync(abs, 'utf8');
      if (/from\s+'[^']*ipc\.cjs'|require\([^)]*ipc\.cjs/.test(src)) offenders.push(f);
      for (const dep of importsOf(f)) queue.push(dep);
    }
    expect(offenders, `module chạm ipc.cjs nhưng nằm trong đồ thị trình duyệt: ${offenders.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 4: Chạy xác nhận ĐỎ**

Run: `npx vitest run tests/spill-wiring.test.ts`
Expected: PASS ở test ranh giới (code hiện tại chưa import ipc.cjs từ module dùng chung — `tool-limits.ts` dùng `eval`, regex này không bắt). Ghi nhận: test này chống **tương lai**, không chứng minh lỗi hiện tại.

Nếu ĐỎ → có module chạm ipc.cjs thật; dừng và báo cáo trước khi sửa.

- [ ] **Step 5: Chạy toàn bộ để xác nhận trạng thái**

Run: `npx vitest run tests/spill-wiring.test.ts`
Expected: 2 pass, 1 fail (test artifact — sẽ xanh sau Task 2).

- [ ] **Step 6: Commit**

```bash
git add tests/spill-wiring.test.ts
git commit -m "test(spill): chung minh C1 bang artifact da build + canh ranh gioi runtime"
```

---

### Task 2: Tách `agent-tools.ts`, spill trong `capToolResult`

**Files:**
- Create: `lib/agent-tools-server.ts`
- Modify: `lib/agent-tools.ts` (bỏ phần server)
- Modify: `app/api/chat/route.ts:44-54`, `lib/emulated-agent.ts:35` (đổi import)
- Test: `tests/agent-tools-spill.test.ts` (mới)

**Interfaces:**
- Consumes: `saveSpillText(content: string, suggestedName: string) => { savedTo: string; bytes: number; notice: string } | null` từ `@/lib/ipc.cjs`
- Produces: `lib/agent-tools-server.ts` export `buildAgentTools`, `buildDelegateTool`, `searchMemories`, `validateMemoryProposal`, và các kiểu `AgentToolSet`, `AgentToolsOptions`, `MemoryItem`, `MemoryVerdict`

**Chia đúng theo ranh giới runtime:**

| Giữ ở `agent-tools.ts` (dùng chung) | Chuyển sang `agent-tools-server.ts` (chỉ server) |
|---|---|
| `summarizeToolArgs` `:104` | `buildAgentTools` `:662` |
| `summarizeToolResult` `:178` | `capToolResult` `:623` (private) |
| `toolResultBody` `:241` | `guarded()` `:686` (private) |
| `ToolLikeForDocs` `:964` | `buildDelegateTool` `:1513` |
| `ALL_TOOL_PROTOCOL_NAMES` `:991` | `validateMemoryProposal` `:1479` |
| `formatToolProtocolManual` `:1007` | `MemoryVerdict` `:1469` |
| `TOOL_SHORT_LABELS` `:1035` | `searchMemories` `:78` |
| `formatToolNameList` `:1039` | `AgentToolSet` `:50` |
| `DELEGATE_PARAMETERS` `:1054` | `AgentToolsOptions` `:57` |
| `CLIENT_TOOL_DEFS` `:1085` | `MemoryItem` `:52` |
| `ClientToolSet` `:1447` | |
| `CLIENT_TOOL_NAMES` `:1450` | |
| `NATIVE_EXCLUDED_CLIENT_TOOLS` `:1463` | |

`agent-tools-server.ts` import từ `@/lib/agent-tools` (dùng chung) và `@/lib/ipc.cjs`. Chiều ngược lại là cấm.

**Không đổi hình dạng `capToolResult` trả về** — nhiều test và `toolResultBody` phụ thuộc `results[]` / `content` / `note`. Chỉ thêm một trường `spillNotice` khi spill.

- [ ] **Step 1: Viết test ĐỎ**

`tests/agent-tools-spill.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAgentTools } from '@/lib/agent-tools-server';
import { redactSecretText } from '@/lib/secret-registry';
import { TOOL_RESULT_MAX_CHARS } from '@/lib/tool-limits';

describe('capToolResult — spill qua buildAgentTools', () => {
  it('kết quả nhỏ: không có spillNotice', async () => {
    const t = buildAgentTools();
    const out = await t.memory_search!.execute!({ query: 'abc' }, {} as never);
    expect(out).toBeTruthy();
    expect(JSON.stringify(out)).not.toContain('spillNotice');
  });

  it('kết quả lớn: có spillNotice trỏ tới file tạm đọc được', async () => {
    const t = buildAgentTools();
    const out = await t.memory_search!.execute!({ query: 'x '.repeat(20_000) }, {} as never);
    const notice = (out as Record<string, unknown>).spillNotice;
    expect(typeof notice).toBe('string');
    const m = String(notice).match(/đã lưu:\s*(\S+)/);
    expect(m).not.toBeNull();
    // File tồn tại thật trên đĩa và fs_read đọc được (đã trong registry).
    expect(existsSync(m![1])).toBe(true);
  });

  it('bí mật ở phần giữa không nằm trong file spill', async () => {
    const SECRET = 'sk-proj-abcdefghijklmnopqrstuvwx';
    const t = buildAgentTools();
    const out = await t.memory_search!.execute!(
      { query: 'x '.repeat(20_000) + SECRET + 'y '.repeat(20_000) }, {} as never,
    );
    const notice = String((out as Record<string, unknown>).spillNotice);
    const p = notice.match(/đã lưu:\s*(\S+)/)![1];
    expect(readFileSync(p, 'utf8')).not.toContain(SECRET);
    expect(redactSecretText(SECRET)).not.toBe(SECRET); // chứng minh rule bắt được khoá này
  });

  it('tổng nội dung gửi model vẫn ≤ TOOL_RESULT_MAX_CHARS', async () => {
    const t = buildAgentTools();
    const out = await t.memory_search!.execute!({ query: 'x '.repeat(20_000) }, {} as never);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS + 1_000);
  });
});
```

- [ ] **Step 2: Chạy xác nhận ĐỎ**

Run: `npx vitest run tests/agent-tools-spill.test.ts`
Expected: FAIL — `@/lib/agent-tools-server` không tồn tại.

- [ ] **Step 3: Tạo `lib/agent-tools-server.ts`**

Di chuyển nguyên văn các mục cột phải ở bảng trên. Thêm import:

```ts
import { saveSpillText } from '@/lib/ipc.cjs';
```

`ipc.cjs` là CommonJS; nếu TypeScript cần `esModuleInterop` cho named import từ `.cjs`, dùng namespace và destructure trong hàm:

```ts
import * as ipc from '@/lib/ipc.cjs';
const saveSpillText = (ipc as unknown as {
  saveSpillText: (c: string, n: string) => { savedTo: string; bytes: number; notice: string } | null;
}).saveSpillText;
```

- [ ] **Step 4: Cài spill trong `capToolResult`**

Trong `lib/agent-tools-server.ts`, giữ nguyên hành vi cắt theo từng trường, thêm: khi `raw.length > TOOL_RESULT_MAX_CHARS`, **trước** khi cắt —

```ts
const spilled = saveSpillText(redactSecretText(raw), 'tool-result.txt');
if (spilled) out.spillNotice = spilled.notice;
```

`redactSecretText` **bắt buộc** chạy trước. `redactSecretsDeep` ở `:719` chạy sau `capToolResult`, nên phải redact thêm ở đây cho đường ghi đĩa.

- [ ] **Step 5: Chạy xác nhận XANH**

Run: `npx vitest run tests/agent-tools-spill.test.ts`
Expected: PASS.

- [ ] **Step 6: Đổi import ở nơi gọi**

`app/api/chat/route.ts:44-54` và `lib/emulated-agent.ts:35`: tách import — phần `buildAgentTools` / `buildDelegateTool` sang `@/lib/agent-tools-server`, phần còn lại giữ `@/lib/agent-tools`.

Cũng sửa các test import trực tiếp `buildAgentTools`: `tests/agent-tools.test.ts:5`, `tests/secret-registry.test.ts:31`, `tests/emulated-agent.test.ts:11`. **Danh sách phải đếm bằng grep, không đoán:**

Run: `grep -rn "buildAgentTools" tests/ lib/ app/ components/ react/`
Expected: mọi nơi đều trỏ đúng module sau khi sửa.

- [ ] **Step 7: Xoá phần server khỏi `lib/agent-tools.ts`**

Cắt các mục cột phải. `lib/agent-tools.ts` phải **không** còn tham chiếu `ipc.cjs`.

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit` → exit 0. `npm run lint` → 0 lỗi mới, 8 warning baseline.

- [ ] **Step 9: Commit**

```bash
git add lib/agent-tools.ts lib/agent-tools-server.ts app/api/chat/route.ts lib/emulated-agent.ts tests/
git commit -m "refactor(tools): tach phan chay server khoi agent-tools.ts de import duoc ipc.cjs"
```

---

### Task 3: Tách `tool-mapper.ts`, spill trong `formatMcpResultForModel`

**Files:**
- Create: `lib/mcp/tool-mapper-server.ts`
- Modify: `lib/mcp/tool-mapper.ts`
- Modify: `app/api/chat/route.ts` (import `mapMcpTools` + `formatMcpResultForModel`)
- Test: bổ sung vào `tests/agent-tools-spill.test.ts`

**Interfaces:**
- Consumes: `saveSpillText` từ `@/lib/ipc.cjs`; `truncateToolResult` từ `@/lib/tool-limits`; `McpCallResult`, `McpContentBlock`, `mcpContentToText` từ `@/lib/mcp/tool-mapper`
- Produces: `lib/mcp/tool-mapper-server.ts` export `formatMcpResultForModel(text: string) => string`

- [ ] **Step 1: Viết test ĐỎ**

Thêm vào `tests/agent-tools-spill.test.ts`:

```ts
import { formatMcpResultForModel } from '@/lib/mcp/tool-mapper-server';

describe('formatMcpResultForModel — spill', () => {
  it('kết quả lớn: có đường dẫn đọc lại', () => {
    const out = formatMcpResultForModel('x'.repeat(40_000));
    expect(out.length).toBeLessThanOrEqual(24_000);
    expect(out).toContain('fs_read');
  });

  it('kết quả nhỏ: giữ nguyên', () => {
    expect(formatMcpResultForModel('ngắn')).toBe('ngắn');
  });
});
```

- [ ] **Step 2: Chạy xác nhận ĐỎ**

Run: `npx vitest run tests/agent-tools-spill.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Tạo `lib/mcp/tool-mapper-server.ts`**

Chuyển `formatMcpResultForModel` (`:375-401`) sang đây. Import `truncateToolResult` và `saveSpillText`.

Thay vì gọi `truncateToolResult`, dùng `serializeToolResult` **với saver truyền vào** — hoặc gọi `truncateToolResult` rồi spill. Chọn một và ghi rõ trong comment:

> Nếu spill được: `head(70%) + marker + tail(25%) + notice`, tổng ≤ 24.000. Nếu không: `truncateToolResult(text, 24_000)` — hành vi cũ.

- [ ] **Step 4: Xoá khỏi `tool-mapper.ts`, sửa import ở `route.ts`**

- [ ] **Step 5: Chạy xác nhận XANH + typecheck**

Run: `npx vitest run tests/agent-tools-spill.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/tool-mapper.ts lib/mcp/tool-mapper-server.ts app/api/chat/route.ts tests/
git commit -m "refactor(mcp): tach formatMcpResultForModel ra module chay server"
```

---

### Task 4: Xoá đường nối sai của bản 1

**Files:**
- Modify: `lib/tool-limits.ts` (xoá `loadSpillSaver`, `SpillSaver`, nhánh spill trong `serializeToolResult`)
- Modify: `tests/tool-limits-budget.test.ts` (xoá 7 test)
- Test: `tests/spill-wiring.test.ts` (Task 1) phải chuyển từ đỏ sang xanh

**Interfaces:**
- Consumes: không có
- Produces: `serializeToolResult(result: unknown, maxChars?: number): string` trở về đúng vai cũ — redact rồi cắt trần

- [ ] **Step 1: Xoá test**

Trong `tests/tool-limits-budget.test.ts`, xoá describe `loadSpillSaver — không được làm hỏng bundle trình duyệt` (3 test) và describe `serializeToolResult — spill phần bị cắt` (4 test), cùng các import không còn dùng.

- [ ] **Step 2: Xoá code**

Xoá `SpillSaver`, `loadSpillSaver`, `spillSaverCache`, và nhánh spill trong `serializeToolResult`, đưa nó về đúng dạng cũ:

```ts
return truncateToolResult(redactSecretText(raw), maxChars);
```

- [ ] **Step 3: Chạy xác nhận**

Run: `npx vitest run tests/tool-limits-budget.test.ts tests/spill-wiring.test.ts`
Expected: cả hai xanh. `spill-wiring` chuyển từ đỏ sang xanh **vì `ipc.cjs` giờ được Turbopack bundle vào sản phẩm server**.

Nếu `spill-wiring` vẫn đỏ → Task 2/3 chưa thực sự nối. **Dừng**, không làm tiếp.

- [ ] **Step 4: Grep chắc không còn sót**

Run: `grep -rn "loadSpillSaver\|SpillSaver\|eval('require')" lib/ app/ react/ components/ tests/`
Expected: không có kết quả nào.

- [ ] **Step 5: Commit**

```bash
git add lib/tool-limits.ts tests/tool-limits-budget.test.ts
git commit -m "refactor(spill): xoa duong noi require sai - spill nam o tang server"
```

---

### Task 5: Tài liệu + gate đầy đủ

**Files:**
- Modify: `README.md:47`, `README.md:165`
- Test: `tests/spill-wiring.test.ts` chạy sau `npm run build`

**Interfaces:**
- Consumes: hành vi thật của Task 2–4
- Produces: không có code

- [ ] **Step 1: Sửa README — nói đúng những gì thật sự chạy**

`README.md:165`: nói phần bị cắt của **tool server và MCP** vẫn đọc lại được. Nói rõ `fs_read` của client tool không có spill.

`README.md:47`: bỏ câu *"bất kỳ kết quả nào vượt 24.000 ký tự"*. Thay bằng phạm vi đúng.

Thêm một câu thẳng về bảo mật: phần lưu xuống đĩa là nội dung **đã redact**; bảo đảm là "không phải bí mật mà rule nhận ra", không phải bảo vệ quyền ghi.

- [ ] **Step 2: Chạy gate đầy đủ — có test artifact**

```bash
npm run build
npx vitest run tests/spill-wiring.test.ts
npx tsc --noEmit
npm run lint
npx vitest run --maxWorkers=1 --no-file-parallelism
npm run docs:check
```

Expected: build 0; `spill-wiring` xanh; tsc 0; lint 0 lỗi; test không đỏ (trừ 3 flaky AGENTS.md §1); docs OK.

**`spill-wiring` phải xanh.** Nếu đỏ thì dừng — nghĩa là tính năng vẫn không chạy và mọi thứ khác chỉ là hình thức.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): noi dung pham vi thuc te cua spill - server va MCP, khong phai moi tool"
```