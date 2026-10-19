# Compaction cho CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI nén ngữ cảnh khi hội thoại dài — tự động theo ngưỡng, thủ công bằng `/compact`, và tự cứu khi provider từ chối vì tràn context — với bản tóm tắt sống sót qua các lần chạy.

**Architecture:** Dùng lại nguyên xi `lib/context-budget.ts` (ước lượng + cắt) và `lib/context-compaction.ts` (marker, state tích lũy, tóm tắt tất định) — đường web đã dùng đúng những thứ này. Phần CLI phải tự viết: adapter `CoreMessage → BudgetMessageLike` (vì `estimateContextTokens` đếm theo hình dạng UI message nên thiếu 1.200× trên `CoreMessage`), chọn ranh giới nén luôn rơi trước message `role:'user'`, ghi marker nén thành dòng JSONL mới, và nối 3 điểm kích hoạt vào REPL.

**Tech Stack:** TypeScript, AI SDK v4 (`ai@4.3.19`), vitest, `node:fs` (JSONL append-only), `tsx` (chạy CLI).

**Spec:** `docs/superpowers/specs/2026-10-19-cli-compaction-design.md` — bản 2, đã chốt 4 quyết định ở §8.

## Global Constraints

- Comment trong code và tài liệu: **tiếng Việt CÓ dấu**. Tin nhắn commit: **KHÔNG dấu**, theo `type(scope): mô tả`.
- **Không dùng PowerShell để ghi file có tiếng Việt** (PowerShell 5.1 đọc file không BOM theo ANSI rồi ghi lại thành UTF-8 của chuỗi đã hỏng → mojibake trong comment mà `tsc`/`lint`/test đều không thấy). Dùng `edit` hoặc `node` (`readFileSync`/`writeFileSync` UTF-8).
- **Mọi test mới phải qua mutation discipline**: viết test RED → xanh → **làm hỏng đúng thứ test khoá, phải thấy ĐỎ** → trả lại → xanh. Test xanh lúc viết không chứng minh gì. Nếu mutation không làm đỏ thì phải phân biệt: "mutation không áp dụng" hay "test rỗng" (`AGENTS.md` §2.2).
- **Ba gate mỗi task**: `npm run typecheck` exit 0 · `npm run test` không đỏ (trừ 3 flaky đã ghi ở `AGENTS.md` §1) · `npm run lint` không có lỗi mới. Cuối plan thêm `npm run docs:check`.
- File nguồn **không được có BOM** (`tests/repo-hygiene.test.ts` canh).
- File mới phải `git add` **trước** khi chạy `npm run docs:check` (checker dùng `git ls-files`).
- **Không tạo cơ chế thứ hai cho thứ đã có** (`AGENTS.md` §6). Mọi hàm dùng lại phải lấy từ `lib/context-budget.ts` / `lib/context-compaction.ts` / `lib/tool-limits.ts` / `lib/ipc.cjs`.
- **Thêm file lõi mới vào `CORE_ENTRIES`** (`scripts/cli-migration/import-graph.ts`) rồi chạy lại `node scripts/cli-migration/build-inventory.ts` — nếu không, file đó không nằm trong guard nào.
- Đơn vị của tham số schema phải khớp backend (`AGENTS.md` §7.1). Khoá theo dạng **đã chuẩn hoá**, không theo chuỗi người dùng gõ (`AGENTS.md` §7.2).
- Nhánh: `feat/provider-layer` (đang có 34 commit trên `origin/main`, chưa merge). **Không commit thẳng lên `main`.**

## Review Focus

Những ca mà spec nói rõ nhưng test nào cũng dễ bỏ sót. Mỗi dòng dưới đây có test ở task sở hữu nó.

1. **Ranh giới nén rơi giữa `assistant(tool-call)` và `tool(tool-result)`** → phần giữ lại bắt đầu bằng `role:'tool'` không có tool-call đi trước ⇒ provider trả 400 ở **mọi** lượt sau ⇒ phiên chết vĩnh viễn. Mong đợi: phần giữ lại **luôn** bắt đầu bằng `role:'user'`.
2. **Phần giữ lại bắt đầu bằng `assistant`** ⇒ Anthropic Messages API trả 400 (message đầu tiên phải là `user`) — `@ai-sdk/anthropic` không tự chèn message `user` đầu.
3. **Tool result dài không bị cắt** — `git_diff` trả tới 400.000 ký tự (`lib/ipc.cjs:1041`, `:1509-1516`), tức ~100.000 token trong **một** lần gọi tool, trong khi ước lượng chỉ thấy 6.000 (cap 24.000) ⇒ thiếu 17× ⇒ compaction không kích hoạt đúng lúc.
4. **Transcript nạp lại sau khi nén phải cho ra đúng phần lịch sử còn dùng** — không mất, không lặp, không mồ côi. Marker ghi sai ⇒ lần sau mở là mất hoặc lặp lịch sử.
5. **Bản tóm tắt phải sống sót**: qua các lần chạy (đóng/mở terminal) VÀ qua các lần nén liên tiếp — lần nén thứ hai không được xoá thông tin của lần nén thứ nhất.
6. **Nén phải THẬT SỰ giảm payload** — nếu ước lượng lại sau khi cắt mà không giảm thì phải báo thất bại, không báo thành công.

---

### Task 1: Adapter `CoreMessage → BudgetMessageLike`

**Files:**
- Create: `cli/context-adapter.ts`
- Test: `tests/cli-context-adapter.test.ts`

**Interfaces:**
- Consumes: `type { CoreMessage }` từ `ai`; `type { BudgetMessageLike }` từ `@/lib/context-budget`.
- Produces:
  ```ts
  /** Chuyển CoreMessage[] sang BudgetMessageLike[] — 1:1, giữ nguyên chỉ số. */
  export function toBudgetMessages(messages: readonly CoreMessage[]): BudgetMessageLike[];
  ```
  Bất biến bắt buộc: `toBudgetMessages(xs).length === xs.length` và `toBudgetMessages(xs)[i]` ứng với `xs[i]`, **kể cả** message `role:'tool'`.

- [ ] **Step 1: Viết test đỏ**

`tests/cli-context-adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CoreMessage } from 'ai';
import { toBudgetMessages } from '@/cli/context-adapter';

describe('toBudgetMessages — 1:1 với CoreMessage[]', () => {
  it('giữ nguyên số phần tử và thứ tự, kể cả message tool', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'xin chao' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'a.txt' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'fs_read', result: { content: 'x'.repeat(100) } }] },
    ];
    const out = toBudgetMessages(msgs);
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('tool-call và tool-result gộp thàNH MỘT invocation, state "result"', () => {
    const msgs: CoreMessage[] = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'a.txt' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'fs_read', result: { content: 'noi dung' } }] },
    ];
    const out = toBudgetMessages(msgs);
    const invs = out.flatMap((m) => m.toolInvocations ?? []);
    expect(invs).toHaveLength(1);
    expect(invs[0]).toMatchObject({ toolName: 'fs_read', state: 'result' });
    expect(invs[0].args).toEqual({ path: 'a.txt' });
  });

  it('ước lượng phải thấy tool result — đây là lý do adapter tồn tại', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'doc README.md' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'README.md' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'fs_read', result: { content: 'x'.repeat(24_000) } }] },
    ];
    // 24.000 ký tự tool result ⇒ ít nhất 6.000 token. Không có adapter thì ra ~0.
    expect(estimateContextTokens(toBudgetMessages(msgs))).toBeGreaterThan(5_000);
  });

  it('tool-call CHƯA có tool-result vẫn ra một invocation, state "call"', () => {
    const msgs: CoreMessage[] = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'a.txt' } }] },
    ];
    const invs = toBudgetMessages(msgs).flatMap((m) => m.toolInvocations ?? []);
    expect(invs).toHaveLength(1);
    expect(invs[0].state).toBe('call');
    expect(invs[0].args).toEqual({ path: 'a.txt' });
  });

  it('nội dung dạng mảng parts lấy phần text', () => {
    const msgs: CoreMessage[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'xin chao ban' }] },
    ];
    expect(toBudgetMessages(msgs)[0].content).toBe('xin chao ban');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/cli-context-adapter.test.ts`
Expected: FAIL — `Cannot find package '@/cli/context-adapter'`.

- [ ] **Step 3: Viết `cli/context-adapter.ts`**

- `textLengthOf` của `lib/context-budget.ts` chỉ đếm `part.text` ⇒ phần tool phải đưa vào `toolInvocations` mới được đếm.
- Duyệt `messages` một lần, gom `tool-call` theo `toolCallId` vào một map; khi gặp `tool-result` cùng id thì gắn `result` vào invocation đó và đánh dấu `state: 'result'`.
- Mỗi `CoreMessage` sinh **đúng một** entry `BudgetMessageLike`: `role` giữ nguyên; `content` = chuỗi nếu content là string, nếu là mảng thì nối các part `type:'text'` bằng `''`; `toolInvocations` = các invocation thuộc message đó.
- Invocation của `tool-call` (chưa có result) có `state: 'call'`; của `tool-result` (đã có args từ tool-call) có `state: 'result'` và `args` lấy từ tool-call đã gom.
- Tool-call và tool-result **phải gộp thành một invocation** (không phải hai): `lib/context-compaction.ts` đọc `inv.args.path` (cho `extractFileOps`) và `inv.result` (cho `describeToolInvocation`); tách ra hai entry thì `serializeForCompaction` sinh hai dòng mô tả cho một tool call.
- Import `BudgetMessageLike` bằng `import type` từ `@/lib/context-budget`.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/cli-context-adapter.test.ts`
Expected: PASS — 5 test.

- [ ] **Step 5: Mutation — bỏ `toolInvocations` khỏi kết quả**

Xoá dòng gán `toolInvocations` trong `toBudgetMessages`.
Expected: test "ước lượng phải thấy tool result" **ĐỎ** (`expected > 5000, got ~5`).
Trả lại, chạy lại, phải xanh.

- [ ] **Step 6: Gate**

Run: `npm run typecheck` → exit 0. `npm run lint` → không có lỗi mới.

- [ ] **Step 7: Commit**

```bash
git add cli/context-adapter.ts tests/cli-context-adapter.test.ts
git commit -m "feat(cli): adapter CoreMessage sang BudgetMessageLike cho uoc luong token"
```

---

### Task 2: Cắt trần kết quả tool cho CLI

**Files:**
- Modify: `lib/tool-result-server.ts` (thêm `capToolResult`, dùng chung)
- Modify: `lib/agent-tools-server.ts:29-49,127-154` (xoá bản riêng, import bản dùng chung)
- Modify: `lib/tools/ipc-node.ts` (áp `capToolResult` cho mọi tool của CLI)
- Test: `tests/cli-tool-result-cap.test.ts`

**Interfaces:**
- Consumes: `TOOL_RESULT_MAX_CHARS`, `truncateToolResult` từ `@/lib/tool-limits`.
- Produces (trong `lib/tool-result-server.ts`):
  ```ts
  /** Hàm ghi phần bị cắt ra file. `null` = ghi không được. */
  export type SpillSaver = (
    content: string,
    name: string,
  ) => { savedTo: string; bytes: number; notice: string } | null;

  /**
   * Cắt trần kết quả tool dạng object. Dùng chung cho đường server
   * (agent-tools) và đường CLI (ipc-node).
   */
  export function capToolResult(
    result: Record<string, unknown>,
    saveSpillText?: SpillSaver,
  ): Record<string, unknown>;

  /**
   * Bọc giá trị tool bất kỳ (chuỗi hoặc object) để đưa vào ngữ cảnh.
   * `git_diff` trả CHUỖI thô tới 400.000 ký tự — không bọc thì không cắt được.
   */
  export function capToolValue(value: unknown, saveSpillText?: SpillSaver): unknown;
  ```
  Hợp đồng: `JSON.stringify(value)` ≤ `TOOL_RESULT_MAX_CHARS` ⇒ trả **nguyên** value. Lớn hơn
  ⇒ spill trước, cắt trần, thêm `truncated: true` + `spillNotice` (object) hoặc chèn notice
  (chuỗi).

  **Vì sao `saveSpillText` là tham số chứ không phải import bên trong:** `lib/ipc.cjs` phải
  là **MỘT instance**. `lib/tools/ipc-node.ts` nạp nó bằng `'../ipc.cjs'`, còn
  `lib/tool-result-server.ts` nạp bằng `'@/lib/ipc.cjs'` — hai specifier khác nhau. Nếu
  mỗi bên tự import, một bên có thể giữ instance khác ⇒ spill ghi vào registry của
  instance này còn `fs_read` đọc registry của instance kia ⇒ **file spill không đọc được**.
  Truyền tay hàm của chính instance đang dùng ⇒ không thể lệch.

- [ ] **Step 1: Viết test đỏ**

`tests/cli-tool-result-cap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeHost, buildIpcTools } from '@/lib/tools/ipc-node';
import { capToolResult, capToolValue } from '@/lib/tool-result-server';
import { TOOL_RESULT_MAX_CHARS } from '@/lib/tool-limits';

describe('capToolValue — cắt trần kết quả tool', () => {
  it('chuỗi dài bị cắt và có notice', () => {
    const out = capToolValue('x'.repeat(100_000)) as string;
    expect(out.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS + 2_000);
  });

  it('object dài bị cắt, có truncated và spillNotice', () => {
    const out = capToolResult({ content: 'x'.repeat(100_000) });
    expect(out.truncated).toBe(true);
    expect(typeof out.spillNotice).toBe('string');
  });

  it('giá trị ngắn đi qua nguyên vẹn', () => {
    const o = { a: 1 };
    expect(capToolResult(o)).toBe(o);
  });
});

describe('CLI — mọi tool đều đi qua cắt trần', () => {
  it('fs_list trên thư mục nhiều file bị cắt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vyen-cap-'));
    const ud = mkdtempSync(path.join(tmpdir(), 'vyen-ud-'));
    const host = createNodeHost({ workspaceRoot: dir, userDataDir: ud });
    try {
      for (let i = 0; i < 600; i++) {
        writeFileSync(path.join(dir, `file-${String(i).padStart(5, '0')}.txt'), 'x');
      }
      const tools = buildIpcTools(host, { approve: async () => true }) as Record<
        string,
        { execute: (a: unknown) => Promise<unknown> }
      >;
      const out = await tools.fs_list.execute({ path: '.' });
      const raw = JSON.stringify(out);
      // Điều kiện tiên quyết: kết quả thô vượt trần — nếu không, test là rỗng.
      expect(raw.length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS);
      expect(raw.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS + 2_000);
    } finally {
      host.dispose();
      rmSync(dir, { recursive: true, force: true });
      rmSync(ud, { recursive: true, force: true });
    }
  });
});
```

> `fs_list` trả mảng `{name, kind, size, mtimeMs}` (`lib/ipc.cjs:296-314`) — mỗi entry
> ~60 ký tự JSON, nên 600 file là vượt trần 24.000. Tăng số file nếu điều kiện tiên quyết
> chưa đạt. **Không** dùng `shell_run` cho test này: `ipc.cjs` đã spill sẵn output shell
> ở mốc 50.000 byte (`lib/ipc.cjs:654-699`) nên kết quả vốn đã nhỏ ⇒ test sẽ xanh ngay
> từ đầu ⇒ **test rỗng**.

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/cli-tool-result-cap.test.ts`
Expected: FAIL — `capToolValue` / `capToolResult` chưa tồn tại (hoặc test `fs_list` đỏ vì
kết quả chưa bị cắt).

- [ ] **Step 3: Chuyển `capToolResult` vào `lib/tool-result-server.ts`**

- Chuyển nguyên văn thân hàm `capToolResult` từ `lib/agent-tools-server.ts:127-154` sang
  `lib/tool-result-server.ts` (file này **đã** có `saveSpillText` từ `ipc.cjs`).
- Thêm tham số `saveSpillText?: SpillSaver`; **mặc định** = hàm spill của module (đường
  server giữ nguyên hành vi). Thêm `capToolValue`:
  - `typeof value === 'string'`: quá trần ⇒ spill + `truncateToolResult` + notice.
  - là object ⇒ `capToolResult(value, saveSpillText)`.
  - còn lại ⇒ trả nguyên.
- `lib/agent-tools-server.ts`: xoá hàm riêng + xoá `import * as ipc from '@/lib/ipc.cjs'` +
  xoá biến `saveSpillText` cục bộ + import `capToolResult` từ `@/lib/tool-result-server`.
- Cập nhật docstring đầu `lib/tool-result-server.ts`: nói rõ file này phục vụ **cả hai**
  đường (server emulated + CLI), không chỉ emulated.

- [ ] **Step 4: Áp `capToolValue` trong `lib/tools/ipc-node.ts`**

Trong `buildIpcTools`, ở `execute` của mỗi tool: sau khi có `r` (kết quả từ channel) và
sau nhánh `fs_read` riêng, trả `capToolValue(r, ipc.saveSpillText)` — truyền **hàm spill
của chính instance `ipc` mà file này đang dùng** (`import ipc from '../ipc.cjs'`), không
để mặc định bên trong module (xem lý do ở Interfaces).

- [ ] **Step 5: Chạy để xác nhận xanh**

Run: `npx vitest run tests/cli-tool-result-cap.test.ts tests/tool-persistence-compaction.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation — bỏ `capToolResult` khỏi `ipc-node.ts`**

Xoá lời gọi `capToolResult` trong `execute`.
Expected: test đầu **ĐỎ**.
Trả lại, chạy lại, phải xanh.

- [ ] **Step 7: Gate**

Run: `npm run typecheck` → exit 0. `npm run test` → không đỏ (trừ flaky đã biết). `npm run lint` → không có lỗi mới.

- [ ] **Step 8: Commit**

```bash
git add lib/tool-result-server.ts lib/agent-tools-server.ts lib/tools/ipc-node.ts tests/cli-tool-result-cap.test.ts
git commit -m "fix(tools): cat tran ket qua tool cho CLI, dung chung capToolResult voi server"
```

---

### Task 3: Prompt tóm tắt dùng chung

**Files:**
- Modify: `lib/context-compaction.ts` (thêm `COMPACT_SUMMARY_SYSTEM` + `buildCompactPrompt`)
- Modify: `app/api/compact/route.ts:120-127` (xoá hằng riêng, import từ `lib/context-compaction`)
- Test: `tests/tool-persistence-compaction.test.ts` (bổ sung)

**Interfaces:**
- Consumes: không có.
- Produces (trong `lib/context-compaction.ts`):
  ```ts
  /** System prompt cho bộ nén ngữ cảnh. Di chuyển từ app/api/compact/route.ts. */
  export const COMPACT_SUMMARY_SYSTEM: string;

  /** Dựng user prompt cho lượt tóm tắt. */
  export function buildCompactPrompt(input: {
    transcript: string;
    context?: string;
    previousSummary?: string;
  }): string;
  ```
  `buildCompactPrompt` ghép: (nếu có) `previousSummary` với nhãn "Tóm tắt các lượt nén TRƯỚC đó" → (nếu có) `context` → dòng dẫn "Sau đây là phần CŨ của hội thoại…" → `transcript`.

- [ ] **Step 1: Viết test đỏ**

Bổ sung vào `tests/tool-persistence-compaction.test.ts`:

```ts
describe('prompt tóm tắt dùng chung', () => {
  it('SUMMARY_SYSTEM nằm trong lib/context-compaction, không nằm trong route', async () => {
    const fs = await import('node:fs');
    const route = fs.readFileSync('app/api/compact/route.ts', 'utf8');
    expect(route).not.toMatch(/const SUMMARY_SYSTEM\s*=/);
    expect(route).toMatch(/COMPACT_SUMMARY_SYSTEM/);
  });

  it('buildCompactPrompt chứa transcript và bản tóm tắt trước', () => {
    const p = buildCompactPrompt({
      transcript: 'Người dùng: them file test',
      previousSummary: 'Đã sửa lib/a.ts',
    });
    expect(p).toContain('Đã sửa lib/a.ts');
    expect(p).toContain('them file test');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/tool-persistence-compaction.test.ts`
Expected: FAIL — `COMPACT_SUMMARY_SYSTEM` / `buildCompactPrompt` chưa tồn tại.

- [ ] **Step 3: Chuyển `SUMMARY_SYSTEM` vào `lib/context-compaction.ts`**

- Chuyển **nguyên văn** 6 câu của `app/api/compact/route.ts:120-127` thành `COMPACT_SUMMARY_SYSTEM`.
- **Thêm một câu** về hợp nhất: nếu prompt có bản tóm tắt trước, hãy viết **một** bản tóm tắt hợp nhất bao gồm cả phần cũ. (Web cũng gửi bản tóm tắt trước vào payload nên câu này giúp cả hai đường.)
- `app/api/compact/route.ts`: xoá hằng `SUMMARY_SYSTEM`, dùng `COMPACT_SUMMARY_SYSTEM` import từ `@/lib/context-compaction`.
- `buildCompactPrompt` ghép 3 khối như mô tả ở Interfaces.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/tool-persistence-compaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation — xoá câu "hợp nhất" khỏi `COMPACT_SUMMARY_SYSTEM`**

Expected: test "SUMMARY_SYSTEM nằm trong lib/context-compaction…" **ĐỎ** (test này phải khẳng định câu hợp nhất CÓ mặt — bổ sung assert `expect(COMPACT_SUMMARY_SYSTEM).toMatch(/hợp nhất/i)` trước khi chạy mutation).
Trả lại, chạy lại, phải xanh.

- [ ] **Step 6: Gate + commit**

```bash
npm run typecheck && npm run lint
git add lib/context-compaction.ts app/api/compact/route.ts tests/tool-persistence-compaction.test.ts
git commit -m "refactor(cli): chuyen prompt tom tat ve lib/context-compaction de dung chung"
```

---

### Task 4: Marker compaction trong JSONL

**Files:**
- Modify: `cli/session.ts`
- Test: `tests/cli-session.test.ts` (bổ sung)

**Interfaces:**
- Consumes: `type { CompactionState }` từ `@/lib/context-compaction`.
- Produces:
  ```ts
  /** Marker nén đang có hiệu lực. */
  export interface CompactionMarker {
    /** Số dòng message ĐẦU TIÊN của file bị thay bằng `summary`. */
    throughCount: number;
    summary: string;
    state?: CompactionState;
    createdAt: string;
  }

  export interface SessionStore {
    header: SessionHeader;
    /** Lịch sử ĐANG DÙNG (hậu tố của các dòng message trong file). */
    messages: CoreMessage[];
    /** Marker nén cuối cùng đọc được từ file. */
    compaction?: CompactionMarker;
    /** Ghi dòng compaction + cắt lịch sử đang dùng. */
    compact(input: {
      /** Số message ĐẦU (cũ nhất) trong `messages` bị nén bỏ. */
      firstKept: number;
      summary: string;
      state?: CompactionState;
    }): { kept: CoreMessage[]; throughCount: number };
    /** Xoá lịch sử đang dùng trong RAM, file giữ nguyên (lệnh `/new`). */
    reset(): void;
    append(message: CoreMessage): void;
    appendAll(messages: CoreMessage[]): void;
    close(): void;
  }
  ```

  Quy tắc nạp: đọc hết file, **đếm** số dòng message; lấy dòng `compaction` CUỐI CÙNG; bỏ `throughCount` message đầu tiên; phần còn lại là `messages`.

- [ ] **Step 1: Viết test đỏ**

Bổ sung vào `tests/cli-session.test.ts`:

```ts
describe('marker compaction trong JSONL', () => {
  it('mở lại sau khi nén thì lịch sử chỉ còn phần sau ranh giới', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vyen-ses-'));
    try {
      const s = openSession(dir, dir);
      s.append({ role: 'user', content: 'cau 1' });
      s.append({ role: 'assistant', content: 'tra loi 1' });
      s.append({ role: 'user', content: 'cau 2' });
      const r = s.compact({ firstKept: 2, summary: 'TOM TAT' });
      expect(r.kept).toHaveLength(1);
      expect(r.throughCount).toBe(2);
      s.append({ role: 'assistant', content: 'tra loi 2' });
      const s2 = openSession(dir, dir);
      expect(s2.messages.map((m) => m.content)).toEqual(['TOM TAT', 'cau 2', 'tra loi 2']);
      expect(s2.compaction?.summary).toBe('TOM TAT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bản tóm tắt phải sống sót qua lần chạy sau, và file vẫn append-only', () => {
    // … mở session, nén, đóng; đọc file thô: phải còn ĐỦ dòng message cũ + dòng marker
    // ⇒ không được xoá dòng nào.
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/cli-session.test.ts`
Expected: FAIL — `s.compact is not a function`.

- [ ] **Step 3: Sửa `cli/session.ts`**

- `readMessages` trả về thêm `totalCount` (số dòng message trong file) và `compaction` (marker cuối cùng). Dòng `compaction` nhận dạng bằng `kind === 'compaction'`; dòng message nhận dạng bằng có field `message`.
- `openSession`: `seq` khởi tạo bằng **max seq đọc được** trong file, KHÔNG phải `messages.length` (sau khi cắt, `messages.length` ≠ số dòng đã ghi ⇒ seq đụng nhau).
- `messages` = các message **sau** `throughCount` message đầu.
- `compact({firstKept, summary, state})`: `throughCount = (totalCount - messages.length) + firstKept`; ghi **một dòng** `{"kind":"compaction","throughCount":…,"summary":…,"state":…,"createdAt":…}` xuống file (dùng `appendLine` sẵn có); `messages = messages.slice(firstKept)`; trả `{ kept: messages, throughCount }`.
- `reset()`: `messages = []` trong RAM, file **không** đụng.
- Bổ sung guard lúc nạp: nếu message đầu tiên còn lại có `role === 'tool'` ⇒ **ném** kèm lý do rõ ràng (chuỗi tool-result mồ côi ⇒ provider sẽ từ chối mọi lượt sau). Ném chứ không tự sửa — tự sửa là âm thầm xoá lịch sử.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/cli-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation — bỏ phép tính `throughCount` (dùng `firstKept` thẳng)**

Expected: test "mở lại sau khi nén…" **ĐỎ**.
Trả lại, chạy lại, phải xanh.

- [ ] **Step 6: Gate + commit**

```bash
npm run typecheck && npm run lint
git add cli/session.ts tests/cli-session.test.ts
git commit -m "feat(cli): luu marker nen trong transcript JSONL, seq theo maxSeq"
```

---

### Task 5: Ranh giới nén + hàm nén

**Files:**
- Create: `cli/compaction.ts`
- Modify: `lib/context-budget.ts:360-410` (thêm tham số `minMessagesToCompact`)
- Test: `tests/cli-compaction.test.ts`

**Interfaces:**
- Consumes: `splitForCompaction`, `shouldCompact`, `estimatePromptTokens`, `reserveTokensFor` từ `@/lib/context-budget`; `serializeForCompaction`, `buildEmergencySummary`, `buildReadFilesReminder`, `readReminderBudget`, `mergeCompactionState`, `extractFileOps`, `extractUserRequests`, `formatCompactContextBlock`, `COMPACT_SUMMARY_MAX_CHARS` từ `@/lib/context-compaction`; `COMPACT_SUMMARY_SYSTEM`, `buildCompactPrompt` từ `@/lib/context-compaction`; `toBudgetMessages` từ `@/cli/context-adapter`.
- Produces (trong `cli/compaction.ts`):
  ```ts
  export interface CutChoice {
    /** Chỉ số trong `messages` của message ĐẦU TIÊN được giữ. */
    firstKept: number;
    older: CoreMessage[];
    keep: CoreMessage[];
  }

  /** Chọn ranh giới nén. Ranh giới LUÔN nằm trước một message `role:'user'`. */
  export function chooseCut(
    messages: readonly CoreMessage[],
    budget: { windowTokens?: number | null; reserveTokens?: number },
    options?: { force?: boolean },
  ): CutChoice | null;

  export interface CompactInput {
    messages: readonly CoreMessage[];
    /** Instance model DỰNG RIÊNG cho generateText (có `fetch: nonStreamingFetch`). */
    model: LanguageModelV1;
    system: string;
    windowTokens?: number | null;
    reserveTokens?: number;
    previousSummary?: string;
    previousState?: CompactionState;
    signal?: AbortSignal;
  }

  export type CompactOutcome =
    | { kind: 'skipped'; reason: 'chua-du-lich-su' | 'chua-vuot-nguong' }
    | {
        kind: 'ok';
        summary: string;
        state: CompactionState;
        firstKept: number;
        olderCount: number;
        keptCount: number;
        keptTokens: number;
      }
    | { kind: 'failed'; error: string };

  export async function compactConversation(input: CompactInput): Promise<CompactOutcome>;

  /** Ghép bản tóm tắt vào system prompt. */
  export function withSummary(system: string, summary: string | undefined): string;
  ```

- [ ] **Step 1: Viết test đỏ**

`tests/cli-compaction.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CoreMessage } from 'ai';
import { chooseCut, withSummary } from '@/cli/compaction';

describe('chooseCut — ranh giới nén', () => {
  it('phần giữ lại LUÔN bắt đầu bằng role user', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'cau 1' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'a' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'fs_read', result: { content: 'x'.repeat(30_000) } }] },
      { role: 'assistant', content: 'xong' },
      { role: 'user', content: 'cau 2' },
      { role: 'assistant', content: 'tra loi 2' },
    ];
    const cut = chooseCut(msgs, { windowTokens: 200_000 }, { force: true });
    expect(cut).not.toBeNull();
    expect(cut!.keep[0].role).toBe('user');
  });

  it('cắt TIẾN tới message user kế tiếp — bỏ nhiều hơn chứ không giữ thêm', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'cau 1' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'a' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'fs_read', result: { content: 'x'.repeat(30_000) } }] },
      { role: 'assistant', content: 'xong' },
      { role: 'user', content: 'cau 2' },
      { role: 'assistant', content: 'tra loi 2' },
    ];
    const cut = chooseCut(msgs, { windowTokens: 200_000 }, { force: true });
    // kept phải bắt đầu ở 'cau 2' (message user kế tiếp), không phải ở 'xong'.
    expect(cut!.keep[0].content).toBe('cau 2');
  });

  it('lịch sử chỉ có MỘT lượt thì không nén được — trả null chứ không cắt mồ côi', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'cau 1' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'a' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'fs_read', result: { content: 'x'.repeat(400_000) } }] },
    ];
    expect(chooseCut(msgs, { windowTokens: 200_000 }, { force: true })).toBeNull();
  });

  it('không cắt được thì trả null (chưa đủ lịch sử)', () => {
    const msgs: CoreMessage[] = [{ role: 'user', content: 'cau 1' }];
    expect(chooseCut(msgs, { windowTokens: 200_000 })).toBeNull();
  });
});

describe('withSummary', () => {
  it('không có summary thì system prompt giữ nguyên', () => {
    expect(withSummary('SYSTEM', undefined)).toBe('SYSTEM');
  });
  it('có summary thì ghép vào sau system', () => {
    expect(withSummary('SYSTEM', 'TOM TAT')).toContain('TOM TAT');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/cli-compaction.test.ts`
Expected: FAIL — `Cannot find package '@/cli/compaction'`.

- [ ] **Step 3: Thêm tham số `minMessagesToCompact` cho `splitForCompaction`**

Trong `lib/context-budget.ts`, đổi chữ ký thành:

```ts
export function splitForCompaction(
  messages: readonly BudgetMessageLike[],
  windowTokens?: number | null,
  reserveTokens: number = RESERVE_TOKENS,
  /** Sàn số tin tối thiểu để đáng gọi LLM. Đường `overflow` truyền 0. */
  minMessagesToCompact: number = MIN_MESSAGES_TO_COMPACT,
): CompactionSplit | null;
```

và dùng `minMessagesToCompact` thay cho `MIN_MESSAGES_TO_COMPACT` ở chỗ kiểm tra. **Mặc định giữ nguyên** ⇒ đường web không đổi hành vi.

- [ ] **Step 4: Viết `cli/compaction.ts` — phần chọn ranh giới`

- Hằng mặc định của CLI:
  ```ts
  /** Context window mặc định khi model BYOK không khai. Cùng giá trị opencode dùng
   *  (`packages/schema/src/model.ts:142`). KHÁC 32.000 của đường web: CLI là agent
   *  coding, mỗi kết quả tool tới 24.000 ký tự = 6.000 token ⇒ 32.000 token chỉ
   *  chứa nổi ~5 kết quả tool, và một lượt đọc 10 file là đã tràn. */
  export const CLI_DEFAULT_CONTEXT_WINDOW = 200_000;
  ```
- `chooseCut` gọi `splitForCompaction(toBudgetMessages(messages), windowTokens, reserveTokens, force ? 0 : undefined)`.
  Với `force = true` phải truyền `0` (bỏ sàn 6 tin) — nếu không, hội thoại ≤13 tin không cứu được.
- **Sửa ranh giới về message `user`** — theo thứ tự:
  1. `u` = chỉ số message `role:'user'` **đầu tiên ≥ `firstKept`** ⇒ cắt tại `u` (bỏ nhiều hơn).
  2. Nếu không có ⇒ `u` = chỉ số message `role:'user'` **cuối cùng < `firstKept`** ⇒ cắt tại `u`
     (giữ nhiều hơn, có thể vượt ngân sách — kiểm chứng sau khi nén sẽ bắt).
  3. Nếu cả lịch sử không có message `user` nào ⇒ trả `null`.
  - Vì sao phải ở `user`: (a) provider trả 400 nếu phần giữ lại bắt đầu bằng `role:'tool'`
    không có tool-call đi trước; (b) Anthropic yêu cầu message đầu là `user`.
- `older = messages.slice(0, u)`, `keep = messages.slice(u)`.

- [ ] **Step 5: Chạy để xác nhận xanh (một phần)**

Run: `npx vitest run tests/cli-compaction.test.ts`
Expected: PASS cho 3 test của `chooseCut`; test `withSummary` còn đỏ (chưa viết hàm) — viết `withSummary` ngay sau đó:

```ts
export function withSummary(system: string, summary: string | undefined): string {
  if (!summary || !summary.trim()) return system;
  return `${system}\n\n[Tóm tắt phần hội thoại đã nén trước đó]\n${summary}`;
}
```

- [ ] **Step 6: Viết phần `compactConversation`**

- Cắt: `chooseCut(messages, budget, { force })`.
- Đóng gói phần cũ: `serializeForCompaction(toBudgetMessages(older))` → ghép thành transcript phẳng (`"Người dùng: …"` / `"Trợ lý: …"`).
- Ngữ cảnh có cấu trúc: `formatCompactContextBlock(extractFileOps(budgetOlder), extractUserRequests(budgetOlder), undefined, previousState)`.
- Prompt: `buildCompactPrompt({ transcript, context, previousSummary })` + system `COMPACT_SUMMARY_SYSTEM`.
- Gọi model: `generateText({ model, system: COMPACT_SUMMARY_SYSTEM, prompt, maxTokens: 1024 })`.
  - **KHÔNG gửi `temperature`** — model reasoning từ chối (`lib/models.ts:34` `NO_TEMPERATURE`).
  - Model phải là instance dựng riêng với `fetch: nonStreamingFetch` — nếu không, gateway trả SSE và AI SDK ném "Invalid JSON response" (`lib/non-streaming-fetch.ts:8-12`).
- Lỗi gọi model ⇒ **không ném**: dùng `buildEmergencySummary({ messages: budgetOlder, previousSummary })` (tất định, không cần LLM). Nếu emergency cũng rỗng ⇒ trả `{ kind: 'failed', error }`.
- Ghép `buildReadFilesReminder(budgetOlder, { maxTotalChars: readReminderBudget(summary.length) })` vào **cuối** summary (giống web `use-chat-orchestration.ts:3809-3813`).
- Chặn trần: `summary.slice(0, COMPACT_SUMMARY_MAX_CHARS)`.
- State: `mergeCompactionState(previousState, extractFileOps(budgetOlder), extractUserRequests(budgetOlder))`.
- **Kiểm chứng sau khi nén** (Review Focus #6): ước lượng lại `estimatePromptTokens(toBudgetMessages(keep), [system, summary])`; nếu **không** nhỏ hơn ước lượng trước ⇒ trả `{ kind: 'failed', error: 'nén xong mà payload không giảm' }`.

- [ ] **Step 7: Test cho `compactConversation` (model giả)**

Bổ sung vào `tests/cli-compaction.test.ts`, dùng **model giả** kiểu `LanguageModelV1` (xem
`tests/cli-agent-turn.test.ts` để lấy khuôn stub) trả về text cố định:

```ts
it('compactConversation trả summary và state', async () => { /* … */ });
it('model hỏng thì dùng emergency summary, KHÔNG ném', async () => { /* … */ });
it('nén xong mà payload không giảm thì báo failed', async () => { /* … */ });
it('bản tóm tắt TRƯỚC được truyền vào prompt của lượt nén sau', async () => {
  // bắt được prompt mà model giả nhận, khẳng định có chứa bản tóm tắt cũ
});
```

Test cuối là test cho **Review Focus #5**: lần nén thứ hai không được xoá thông tin của lần
nén thứ nhất.

- [ ] **Step 8: Mutation — bỏ `minMessagesToCompact` khỏi lời gọi khi `force`**

Expected: test "lịch sử chỉ có MỘT lượt thì không nén được" **không** đổi, nhưng phải có
một test khác đỏ. Nếu không có test nào đỏ ⇒ **viết thêm một test**: lịch sử **nhiều
lượt** nhưng ngắn (ví dụ 8 message) mà `force = true` vẫn cắt được — không có `force` thì
`splitForCompaction` trả `null` do sàn 6 tin.
Trả lại, chạy lại, phải xanh.

- [ ] **Step 9: Gate + commit**

```bash
npm run typecheck && npm run lint
git add cli/compaction.ts lib/context-budget.ts tests/cli-compaction.test.ts
git commit -m "feat(cli): chon ranh gioi nen luon nam truoc message user, co tom tat du phong"
```

---

### Task 6: `runAgentTurn` trả `finishReason`

**Files:**
- Modify: `cli/agent-turn.ts:148-181,198-210`
- Test: `tests/cli-agent-turn.test.ts` (bổ sung)

**Interfaces:**
- Consumes: không có.
- Produces: `AgentTurnResult.usage` thêm field `finishReason?: string` (giá trị của `ai@4` `FinishReason`: `'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown'`).

- [ ] **Step 1: Viết test đỏ**

Bổ sung vào `tests/cli-agent-turn.test.ts`:

```ts
it('trả finishReason của lượt', async () => {
  const r = await runAgentTurn({ model: modelStub('done'), messages: [{ role: 'user', content: 'hi' }] });
  expect(r.usage.finishReason).toBe('stop');
});
```

(dùng lại stub model sẵn có trong file; nếu stub chưa phát `finish` thì thêm phát part `{ type: 'finish', finishReason: 'stop' }` trong `fullStream`.)

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/cli-agent-turn.test.ts`
Expected: FAIL — `expected undefined to be 'stop'`.

- [ ] **Step 3: Sửa `cli/agent-turn.ts`**

- Bắt `finishReason` từ **part `finish` trong `fullStream`** — KHÔNG await `result.finishReason` (comment ở `cli/agent-turn.ts:128` ghi rõ: khi provider lỗi, `finishReason` **không bao giờ settle** ⇒ await nó là treo CLI).
- Vì vậy: dùng `fullStream` ở **cả hai** nhánh (có tool và không tool) và thêm `case 'finish':` bắt `p.finishReason`.
- Trả `finishReason` trong `usage`.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/cli-agent-turn.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation — bỏ `case 'finish'`**

Expected: test đỏ.
Trả lại, chạy lại, phải xanh.

- [ ] **Step 6: Gate + commit**

```bash
npm run typecheck && npm run lint
git add cli/agent-turn.ts tests/cli-agent-turn.test.ts
git commit -m "feat(cli): tra finishReason de bat duoc tran ngam"
```

---

### Task 7: Nối vào REPL + `/compact` + đường `-p`

**Files:**
- Modify: `cli/repl.ts`
- Modify: `cli/index.ts`
- Test: `tests/cli-repl.test.ts` (bổ sung)

**Interfaces:**
- Consumes: `compactConversation`, `withSummary`, `chooseCut`, `CLI_DEFAULT_CONTEXT_WINDOW` từ `@/cli/compaction`; `openSession`/`SessionStore` từ `@/cli/session`; `isContextOverflowError`, `evaluateUsageTrigger`, `shouldCompact`, `estimatePromptTokens`, `reserveTokensFor` từ `@/lib/context-budget`; `resolveOpenAIModel`/`resolveAnthropicModel` từ `@/lib/provider/*`; `nonStreamingFetch` từ `@/lib/non-streaming-fetch`.
- Produces: `parseCommand` trả thêm `{ kind: 'compact' }` cho lệnh `/compact` (khớp **trọn từ**, giống `/exit`).

- [ ] **Step 1: Viết test đỏ**

Bổ sung vào `tests/cli-repl.test.ts`:

```ts
it('parseCommand nhận /compact', () => {
  expect(parseCommand('/compact')).toEqual({ kind: 'compact' });
  expect(parseCommand('/compact them')).toBeNull(); // có khoảng trắng ⇒ không phải lệnh
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/cli-repl.test.ts`
Expected: FAIL.

- [ ] **Step 3: `cli/repl.ts` — REPL dùng `session.messages` làm nguồn duy nhất**

- Bỏ bản sao `let messages = [...opts.session.messages]`; dùng thẳng `opts.session.messages` (mảng trong RAM của store). Lý do: hai mảng lệch nhau sau `/new` ⇒ marker nén ghi sai ⇒ lần mở sau mất/lặp lịch sử.
- `/new` ⇒ gọi `opts.session.reset()`.
- Thêm lệnh `/compact`: nén thủ công, in kết quả (`> da nen: N message -> M message`), **không** đổi câu hỏi đang chờ.

- [ ] **Step 4: `cli/repl.ts` — 3 điểm kích hoạt**

Trước mỗi lượt:
1. **auto**: `shouldCompact(estimatePromptTokens(budgetMessages, [system, summary]), windowTokens, reserveTokens)` ⇒ nén trước khi gửi.
2. **overflow**: bắt lỗi provider trong `catch`; nếu `isContextOverflowError(status, message)` ⇒ nén rồi **thử lại đúng 1 lần** (biến `thuLaiDaDung` chặn lần thứ hai).
   - `status` lấy từ lỗi: `APICallError.isInstance(e) ? e.statusCode : undefined` — `ai@4` có `APICallError` (đã dùng ở `app/api/compact/route.ts:3`).
   - **Miễn debounce 60s cho đường overflow** (spec F5).
3. **silent overflow**: dùng `evaluateUsageTrigger` với `usage.promptTokens`, `usage.completionTokens`, `usage.finishReason` (Task 6) và `windowTokens`; nếu `kind !== 'skip'` ⇒ nén ở lượt kế tiếp.

Sau khi nén thành công: cập nhật `session.compact({ firstKept, summary, state })`, cắt mảng `messages`, và ghép summary vào system **mọi lượt sau** bằng `withSummary(system, summary)`.

- [ ] **Step 5: `cli/index.ts` — dựng HAI instance model**

```ts
const lm = kind === 'anthropic' ? resolveAnthropicModel(cfg) : resolveOpenAIModel(cfg);
// Instance RIÊNG cho lượt tóm tắt: `generateText` không gửi `stream`, mà nhiều
// gateway trả SSE ⇒ AI SDK ném "Invalid JSON response" (lib/non-streaming-fetch.ts:8).
const cfgNen = { ...cfg, fetch: nonStreamingFetch };
const lmNen = kind === 'anthropic' ? resolveAnthropicModel(cfgNen) : resolveOpenAIModel(cfgNen);
```

**TUYỆT ĐỐI KHÔNG** truyền `nonStreamingFetch` vào `lm` — hàm đó ghi đè `stream:false` **vô điều kiện** (`lib/non-streaming-fetch.ts:40`) ⇒ mọi lượt chat sẽ hỏng.

Đọc `VYEN_CONTEXT_WINDOW` (số nguyên > 0) ⇒ `windowTokens`; bỏ trống ⇒
`CLI_DEFAULT_CONTEXT_WINDOW` (200.000 — xem Task 5 Step 4). **KHÔNG** dùng
`FALLBACK_CONTEXT_WINDOW` (32.000) của đường web: CLI là agent coding, 32.000 token chỉ
chứa ~5 kết quả tool.

Truyền `lmNen` + `windowTokens` xuống `runRepl` và xuống `chayMotLuot` (đường `-p` cũng phải nén — spec F11).

- [ ] **Step 6: Chạy để xác nhận xanh**

Run: `npx vitest run tests/cli-repl.test.ts tests/cli-compaction.test.ts tests/cli-session.test.ts`
Expected: PASS.

- [ ] **Step 7: Mutation — truyền `nonStreamingFetch` vào `lm` (model chat)**

Expected: test nào đó phải ĐỎ — nếu không có test nào đỏ, **viết thêm một test** khẳng định model chat **không** dùng `fetch` ép `stream:false` (vd: stub `fetch` quan sát body gửi đi, khẳng định `stream` vẫn là `true`).
Trả lại, chạy lại, phải xanh.

- [ ] **Step 8: Gate + commit**

```bash
npm run typecheck && npm run lint
git add cli/repl.ts cli/index.ts tests/cli-repl.test.ts
git commit -m "feat(cli): nen ngu canh tu dong, thu cong bang /compact, tu cuu khi tran context"
```

---

### Task 8: Đưa file lõi mới vào `CORE_ENTRIES` + sinh lại bảng kiểm kê

**Files:**
- Modify: `scripts/cli-migration/import-graph.ts:44-88`
- Modify: `docs/cli-migration-inventory.md` (**sinh lại**, không sửa tay)
- Test: `tests/cli-migration-scan.test.ts` (đã có, chạy lại)

**Interfaces:**
- Consumes: không có.
- Produces: `CORE_ENTRIES` phải chứa `cli/context-adapter.ts`, `cli/compaction.ts`, `lib/context-compaction.ts`.

- [ ] **Step 1: Thêm entry mới vào `CORE_ENTRIES`**

Thêm vào mảng trong `scripts/cli-migration/import-graph.ts`:
`'lib/context-compaction.ts'`, `'cli/context-adapter.ts'`, `'cli/compaction.ts'`.

- [ ] **Step 2: Sinh lại bảng kiểm kê**

Run: `node scripts/cli-migration/build-inventory.ts`
Expected: in ra số file trong đồ thị lõi đã tăng.

- [ ] **Step 3: Chạy test kiểm kê**

Run: `npx vitest run tests/cli-migration-scan.test.ts tests/repo-hygiene.test.ts`
Expected: PASS — trong đó có test "GUỐ — lõi CLI không được kéo trình duyệt vào" và test bảng-stale (so tập file quét sống với bảng trên đĩa).

- [ ] **Step 4: Mutation — bỏ `'cli/compaction.ts'` khỏi `CORE_ENTRIES`**

Expected: test bảng-stale hoặc GUỐ **ĐỎ**.
Trả lại, chạy lại, phải xanh.

- [ ] **Step 5: Gate đầy đủ + commit**

```bash
npm run typecheck
npm run test
npm run lint
npm run docs:check
git add scripts/cli-migration/import-graph.ts docs/cli-migration-inventory.md
git commit -m "docs(cli): khai file lõi moi trong CORE_ENTRIES va sinh lai bang ke ke"
```

---

## Sau khi kế hoạch này xong

- `/compact` có trong REPL, nén tự động theo ngưỡng, tự cứu khi provider từ chối vì tràn context, và bản tóm tắt sống sót qua các lần chạy.
- Đường web **không đổi hành vi** (mọi tham số mới đều có mặc định giữ nguyên).
- Việc kế tiếp trong danh sách đã nêu: `question` tool · nâng cổng duyệt (allow/ask/deny + "luôn cho phép") · registry tool chung để làm MCP cho CLI.
