# Compaction — không, đường GIẢ LẬP (emulated) cho CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi model của người dùng **không hỗ trợ function calling**, CLI phải vẫn làm agent được (gọi tool qua văn bản) thay vì chết lượt.

**Architecture:** Tái dùng nguyên xi `lib/emulated-agent.ts` (đã có, đã chạy ở server) — chỉ bọc lại cho bộ tool của CLI (`buildIpcTools`) và thêm đường nhận diện "model chê tools" mà web đã có (`TOOLS_UNSUPPORTED_RE` trong `app/api/chat/route.ts`, chuyển vào `lib/tool-support-cache.ts` để hai bên dùng chung).

**Tech Stack:** TypeScript, AI SDK v4 (`generateText` buffered), vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-cli-core-design.md` §7 (hàng: *"Model không hỗ trợ tool calling → rơi về `emulated-agent`"*) + `docs/superpowers/specs/2026-10-19-cli-compaction-design.md`.

## Global Constraints

- Comment tiếng Việt **có dấu**; commit message **không dấu**, `type(scope): mô tả`.
- Mọi test mới: RED → GREEN → **mutation** (làm hỏng đúng thứ test khoá → phải thấy đỏ → trả lại).
- Không tạo cơ chế thứ hai cho thứ đã có (`AGENTS.md` §6): dùng `lib/emulated-agent.ts`,
  `lib/tool-support-cache.ts`, `lib/agent-tools-server.ts` — **không** chép lại.
- Đường emulated dùng `generateText` ⇒ **bắt buộc** instance model có `fetch: nonStreamingFetch`
  (gateway trả SSE nếu thiếu `stream:false` ⇒ AI SDK ném "Invalid JSON response").
- Ba gate mỗi task: typecheck 0 lỗi · test không đỏ (trừ 3 flaky `AGENTS.md` §1) · lint 0 lỗi mới.

## Review Focus

1. **Model không hỗ trợ tools ⇒ CLI phải vẫn làm được việc** — không phải báo lỗi rồi dừng.
2. **Không ghim "không hỗ trợ tools" oan.** Mẫu phải khớp **câu trả lời** "không hỗ trợ tools",
   KHÔNG khớp chữ "tool" rơi vãi (lỗi tool của chính app sẽ tước agent của model đó 10 phút).
3. **Transcript của lượt giả lập phải ghi được** — không ghi thì lượt sau mất ngữ cảnh.
4. **Tool của CLI phải chạy thật** (fs_*, shell, git) chứ không phải tool của server.

---

### Task 1: `TOOLS_UNSUPPORTED_RE` dùng chung + `lib/emulated-agent.ts` trả message mới

**Files:**
- Modify: `lib/tool-support-cache.ts`
- Modify: `app/api/chat/route.ts:133-157`
- Modify: `lib/emulated-agent.ts:325-334,341-573`
- Test: `tests/tool-support-cache.test.ts` (nếu chưa có) hoặc file test hiện có

**Interfaces:**
- Produces (trong `lib/tool-support-cache.ts`):
  ```ts
  /** Mẫu thật đo được: gateway/model nói "tôi không nhận tools / function calling". */
  export const TOOLS_UNSUPPORTED_RE: RegExp;
  /** true nếu thông điệp lỗi nói đúng ý "không hỗ trợ tools". */
  export function isToolsUnsupportedMessage(msg: string): boolean;
  ```
- Produces (trong `lib/emulated-agent.ts`):
  ```ts
  export interface EmulatedLoopResult {
    status: 'done' | 'pending-client';
    roundsUsed: number;
    totalCalls: number;
    /** Message MỚI sinh ra trong vòng lặp (KHÔNG gồm transcript đầu vào). */
    messages: CoreMessage[];
  }
  ```

- [ ] **Step 1: Viết test đỏ**

```ts
describe('isToolsUnsupportedMessage', () => {
  it('khớp câu trả lời "không hỗ trợ tools"', () => {
    expect(isToolsUnsupportedMessage('This model does not support tools')).toBe(true);
    expect(isToolsUnsupportedMessage('tools are not supported')).toBe(true);
    expect(isToolsUnsupportedMessage('tool use is not supported')).toBe(true);
  });
  it('KHÔNG khớp lỗi tool của chính app', () => {
    expect(isToolsUnsupportedMessage('Error executing tool web_search: fetch failed')).toBe(false);
    expect(isToolsUnsupportedMessage('rate limit exceeded')).toBe(false);
  });
});
```

và ở `tests/emulated-agent.test.ts`:

```ts
it('trả message MỚI sinh ra, không kèm transcript đầu vào', async () => {
  // … stub fetch trả 1 round tool_call rồi 1 round prose
  const r = await runEmulatedLoop(opts);
  expect(r.messages.length).toBeGreaterThan(0);
  expect(r.messages[0].role).toBe('assistant');
});
```

- [ ] **Step 2: Chạy → RED**
- [ ] **Step 3: Implement** — chuyển regex nguyên văn từ route.ts sang `lib/tool-support-cache.ts`;
  route.ts import lại (xoá bản riêng). `runEmulatedLoop` nhớ `soDauVao = messages.length` ngay sau
  khi filter và trả `messages.slice(soDauVao)`.
- [ ] **Step 4: GREEN**
- [ ] **Step 5: Mutation** — đổi `isToolsUnsupportedMessage` thành `/tool/i` ⇒ test "KHÔNG khớp lỗi tool
  của chính app" ĐỎ.
- [ ] **Step 6: Gate + commit** — `refactor(lib): chua mau loi "khong ho tro tools" de web va CLI dung chung`

---

### Task 2: `cli/emulated.ts` — lượt giả lập cho bộ tool của CLI

**Files:**
- Create: `cli/emulated.ts`
- Test: `tests/cli-emulated.test.ts`

**Interfaces:**
- Consumes: `runEmulatedLoop` từ `@/lib/emulated-agent`; `isToolsUnsupportedMessage`,
  `isToolUnsupported`, `markToolsUnsupported` từ `@/lib/tool-support-cache`.
- Produces:
  ```ts
  export interface EmulatedEnv {
    providerBase?: string;
    modelId?: string;
    /** Ép dùng đường giả lập (`VYEN_EMULATED=1`). */
    force?: boolean;
  }
  /** true nếu lượt này nên đi đường giả lập. */
  export function shouldUseEmulated(env: EmulatedEnv): boolean;
  /** Ghi nhớ model vừa chê tools (cache 10 phút). */
  export function markEmulated(env: EmulatedEnv): void;
  /** true nếu lỗi này là do model/gateway KHÔNG hỗ trợ function calling. */
  export function isToolsUnsupportedError(e: unknown): boolean;

  export interface EmulatedTurnOptions {
    /** Instance model CÓ `fetch: nonStreamingFetch` — đường giả lập dùng generateText. */
    model: LanguageModelV1;
    tools: ToolSet;
    messages: readonly CoreMessage[];
    system: string;
    maxTokens?: number;
    signal?: AbortSignal;
    onText?: (text: string) => void;
    onToolCall?: (name: string) => void;
  }
  export interface EmulatedTurnResult {
    text: string;
    /** Message MỚI — caller ghi vào transcript. */
    messages: CoreMessage[];
    totalCalls: number;
    roundsUsed: number;
  }
  export async function runEmulatedTurn(opts: EmulatedTurnOptions): Promise<EmulatedTurnResult>;
  ```

- [ ] **Step 1: Viết test đỏ** — model giả (`doGenerate`) trả về lần 1: khối `<tool_call>` gọi
  `fs_read`; lần 2: prose. Khẳng định tool CLI **chạy thật** (execute được gọi với args đúng),
  và `messages` trả về chứa lượt assistant + user(TOOL_RESULT).
- [ ] **Step 2: RED**
- [ ] **Step 3: Implement** — `runEmulatedTurn` gọi `runEmulatedLoop` với `tools` của CLI
  ( ép kiểu `Partial<AgentToolSet>`), `clientTools: undefined` (mọi tool của CLI chạy cục bộ),
  `onTextDelta` gom text + forward, `onAnnotation` forward sang `onToolCall`.
- [ ] **Step 4: GREEN**
- [ ] **Step 5: Mutation** — bỏ `tools` khỏi lời gọi `runEmulatedLoop` ⇒ test đỏ.
- [ ] **Step 6: Gate + commit** — `feat(cli): luot gia lap cho model khong ho tro function calling`

---

### Task 3: Nối vào REPL + `VYEN_EMULATED`

**Files:**
- Modify: `cli/repl.ts`
- Modify: `cli/index.ts` (đọc `VYEN_EMULATED`, truyền `providerBase`/`modelId` xuống REPL)
- Test: `tests/cli-emulated.test.ts` (bổ sung), `tests/cli-repl-wiring.test.ts` (bổ sung)

**Interfaces:**
- Consumes: `runEmulatedTurn`, `shouldUseEmulated`, `markEmulated`, `isToolsUnsupportedError` từ `@/cli/emulated`.
- Produces: `ReplOptions` += `providerBase?: string; modelId?: string; forceEmulated?: boolean`.

- [ ] **Step 1: Viết test đỏ** — REPL với model giả **không** hỗ trợ tools: lần native trả lỗi
  "This model does not support tools" ⇒ REPL phải tự chuyển sang đường giả lập và **trả lời
  được** (không ném ra ngoài).
- [ ] **Step 2: RED**
- [ ] **Step 3: Implement** — trong vòng lượt: nếu `shouldUseEmulated` thì đi thẳng đường giả
  lập; ngược lại thử native, và khi lỗi là "không hỗ trợ tools" thì `markEmulated` + chạy lại
  bằng đường giả lập.
- [ ] **Step 4: GREEN**
- [ ] **Step 5: Mutation** — bỏ nhánh chuyển sang giả lập ⇒ test đỏ.
- [ ] **Step 6: Gate + commit** — `feat(cli): tu chuyen sang duong gia lap khi model che tools`

---

### Task 4: `CORE_ENTRIES` + sinh lại bảng kiểm kê + gate cuối

- [ ] Thêm `cli/emulated.ts` vào `CORE_ENTRIES`; chạy lại `node scripts/cli-migration/build-inventory.ts`.
- [ ] `npm run typecheck` · `npm run test` · `npm run lint` · `npm run build` · `npm run docs:check`.
- [ ] Commit: `docs(cli): khai cli/emulated.ts trong CORE_ENTRIES va sinh lai bang ke ke`
