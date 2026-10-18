# Lớp provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách tầng gọi model ra khỏi `app/api/chat/route.ts` thành module Node thuần, có cả adapter OpenAI-compatible và adapter Anthropic-native.

**Architecture:** Một `ProviderAdapter` trả về model object của AI SDK, đã cấu hình theo provider. Lõi agent chỉ cần `resolveModel(config)` — không cần biết Anthropic khác OpenAI ở chỗ nào. Tầng chẩn đoán lỗi upstream được bóc ra thành hàm thuần, không phụ thuộc Next.

**Tech Stack:** TypeScript, `@ai-sdk/openai` (đã có), `@ai-sdk/anthropic` (thêm mới), vitest, `node:http` cho server giả trong test.

**Spec:** `docs/superpowers/specs/2026-10-18-cli-core-design.md` §5

Spec §5 mới chỉ có **một dòng** về `lib/provider/`, nên các quyết định dưới đây do plan này chốt và nằm ở Global Constraints, không phải trích từ spec. Nếu có xung đột, Global Constraints của plan thắng.

## Global Constraints

- **Không** ghi file có tiếng Việt bằng PowerShell — PowerShell 5.1 đọc file không BOM theo ANSI rồi ghi lại thành UTF-8 của chuỗi đã hỏng, sinh mojibake trong comment mà `tsc`/`lint`/test đều không thấy. Dùng `node` hoặc công cụ `edit`.
- Comment và tài liệu: tiếng Việt có dấu. Tin nhắn commit: **không** dấu, `type(scope): mô tả`.
- File mới phải `git add` trước khi `npm run docs:check`.
- **Sau Task 3 phải cập nhật `CORE_ENTRIES` trong `scripts/cli-migration/import-graph.ts`** và chạy lại `node scripts/cli-migration/build-inventory.ts`. Bảng kiểm kê phân loại file theo việc lõi có dùng hay không; không khai báo entry mới thì file lõi mới rơi ra ngoài đồ thị và bị gán `XOA` — tức kế hoạch sau đọc rồi xoá. Kiểm bằng `unreached([...], CORE_ENTRIES)` rồi chắc chắn không file nào chạm API trình duyệt nằm trong nhóm đó.
- Mọi test mới phải qua mutation discipline: làm hỏng đúng thứ test khoá → phải thấy đỏ → trả lại.
- **Phạm vi:** plan này KHÔNG đụng `lib/providers.ts` (cấu hình provider đọc từ Dexie), KHÔNG đụng vòng `streamText` trong `route.ts`, KHÔNG di dời `route.ts`. Lõi sẽ tự truyền `ProviderRuntimeConfig` đã giải sẵn; chuyện đó là plan sau.

## Review Focus

1. **API key lọt vào log hay vào `devLog`.** `diagnoseUpstreamError` trả `devLog` và `userMessage` là hai chuỗi khác nhau; người dùng phải thấy thông báo sạch, logfile mới được phép có chi tiết. Một bản vá gộp hai trường là rò thông tin.
2. **Gateway bọc lỗi trong chính stream 200.** Nhiều gateway trả `data: [401]: {"error":...}` với HTTP 200 — không phải `!res.ok`. Chỉ kiểm status sẽ báo "thành công" rồi đổ text rác vào ngữ cảnh model.
3. **Provider OpenAI-compatible trả `403` vì sai key.** `blameKey` phải là `true` để chuyển model, `false` khi gateway chỉ chặn riêng một model — quyết định này quyết định failover có đúng không.
4. **Model không hỗ trợ tool calling.** Adapter phải trả `toolChoice: 'none'` khi không có tool, thay vì để provider tự lỗi bằng thông báo tiếng Anh dài dòng.
5. **`@ai-sdk/anthropic` được nạp ở cả nhánh không dùng tới.** Import tĩnh kéo nó vào mọi bundle; nếu ai đó viết `import` tĩnh ở module dùng chung thì adapter OpenAI cũng mang theo nó. Kiểm import của cả hai nhánh.

---

### Task 1: Kiểu adapter và chọn nhánh

**Files:**
- Create: `lib/provider/adapter.ts`
- Test: `tests/provider-adapter.test.ts`

**Interfaces:**
- Consumes: không có
- Produces:

```ts
export type AdapterKind = 'openai-compatible' | 'anthropic';

export interface ProviderRuntimeConfig {
  /** 'anthropic' dùng SDK native; mọi thứ khác dùng endpoint OpenAI-compatible. */
  kind: AdapterKind;
  /** base URL. Bỏ trống thì adapter dùng base URL mặc định của hãng. */
  baseUrl?: string;
  apiKey: string;
  /** id model theo quy ước của provider, ví dụ 'gpt-4o' hoặc 'claude-opus-5'. */
  model: string;
}

export function resolveAdapterKind(cfg: Pick<ProviderRuntimeConfig, 'kind'>): AdapterKind;
```

`resolveAdapterKind` là hàm thuần, không I/O — để test được không cần mạng.

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest';
import { resolveAdapterKind } from '@/lib/provider/adapter';

describe('resolveAdapterKind', () => {
  it('anthropic đi nhánh native', () => {
    expect(resolveAdapterKind({ kind: 'anthropic' })).toBe('anthropic');
  });

  it('openai-compatible đi nhánh OpenAI', () => {
    expect(resolveAdapterKind({ kind: 'openai-compatible' })).toBe('openai-compatible');
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/provider-adapter.test.ts`
Expected: FAIL — `Cannot find package '@/lib/provider/adapter'`

- [ ] **Step 3: Viết `lib/provider/adapter.ts`**

Khai kiểu như trên. `resolveAdapterKind` trả về `cfg.kind` — viết thẳng, **không** thêm bảng ánh xạ tên khác, vì mọi giá trị hợp lệ đã được kiểu chặn lúc biên dịch.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/provider-adapter.test.ts`
Expected: PASS — 2 test

- [ ] **Step 5: Mutation**

Sửa `resolveAdapterKind` thành luôn trả `'openai-compatible'`, chạy lại.
Expected: test "anthropic đi nhánh native" **ĐỎ**. Trả lại, xanh.

- [ ] **Step 6: Commit**

```bash
git add lib/provider/adapter.ts tests/provider-adapter.test.ts
git commit -m "feat(provider): khai ProviderRuntimeConfig va resolveAdapterKind"
```

---

### Task 2: Adapter OpenAI-compatible

**Files:**
- Create: `lib/provider/openai-adapter.ts`
- Modify: `tests/provider-adapter.test.ts`

**Interfaces:**
- Consumes: `ProviderRuntimeConfig` từ Task 1
- Produces: `resolveOpenAIModel(cfg: ProviderRuntimeConfig): LanguageModel`

`LanguageModel` là kiểu export từ gói `ai`.

- [ ] **Step 1: Viết test đỏ**

Bật HTTP server giả nói đúng protocol OpenAI-compatible, rồi assert:

```ts
it('trả model gọi được base URL và key của config', async () => {
  // server giả: nhận POST, trả JSON { id, object, created, model, choices: [...] }
  // assert: request nhận được Authorization: Bearer <apiKey> và path /chat/completions
  const model = resolveOpenAIModel({
    kind: 'openai-compatible',
    baseUrl: `${base}/v1`,
    apiKey: 'sk-test-123',
    model: 'gpt-4o',
  });
  // gọi streamText({ model, prompt: 'hi' }) và await kết quả; server giả ghi lại
  // request để assert header và path.
  expect(capturedAuth).toBe('Bearer sk-test-123');
  expect(capturedPath).toBe('/v1/chat/completions');
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/provider-adapter.test.ts`
Expected: FAIL — `resolveOpenAIModel is not a function`

- [ ] **Step 3: Viết `lib/provider/openai-adapter.ts`**

Dùng `createOpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey })` rồi trả `openai(cfg.model)`.

**Bóc từ `route.ts`:** dòng 1709 và 1718 có sẵn hai instance `createOpenAI`, một cho stream một cho non-stream. Trong plan này chỉ dựng một instance và trả model; vòng `streamText` thuộc plan sau. **Không** sao chép comment dài của `route.ts` sang — tham chiếu tới `route.ts:1709` là đủ.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/provider-adapter.test.ts`
Expected: PASS — 3 test

- [ ] **Step 5: Mutation**

Bỏ `apiKey` khỏi tham số truyền vào `createOpenAI`, chạy lại.
Expected: test **ĐỎ** (header `Authorization` không còn khớp). Trả lại, xanh.

- [ ] **Step 6: Commit**

```bash
git add lib/provider/openai-adapter.ts tests/provider-adapter.test.ts
git commit -m "feat(provider): adapter openai-compatible"
```

---

### Task 3: Adapter Anthropic-native

**Files:**
- Modify: `package.json` (thêm dependency)
- Create: `lib/provider/anthropic-adapter.ts`
- Modify: `tests/provider-adapter.test.ts`
- Modify: `scripts/cli-migration/import-graph.ts` (`CORE_ENTRIES`)
- Regenerate: `docs/cli-migration-inventory.md`

**Interfaces:**
- Consumes: `ProviderRuntimeConfig` từ Task 1
- Produces: `resolveAnthropicModel(cfg: ProviderRuntimeConfig): LanguageModel`

- [ ] **Step 1: Cài dependency**

Run: `npm install @ai-sdk/anthropic@^2`
Expected: exit 0, xuất hiện trong `dependencies`. **Ghim bản major 2** để khớp `@ai-sdk/openai@1`… nếu npm báo xung đột peer, dừng lại và báo lại, đừng ép `--force`.

- [ ] **Step 2: Viết test đỏ**

Giống Task 2 nhưng server giả trả payload của Anthropic Messages API (`{ id, type: 'message', role, content: [...] }`) và assert:

```ts
it('anthropic: trả model gọi đúng endpoint messages', async () => {
  // assert path kết thúc bằng /v1/messages và header x-api-key đúng key
  expect(capturedPath).toMatch(/\/v1\/messages$/);
  expect(capturedApiKeyHeader).toBe('sk-ant-test');
});
```

Đây là test chứng minh nhánh Anthropic **không** đi qua endpoint OpenAI-compatible.

- [ ] **Step 3: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/provider-adapter.test.ts`
Expected: FAIL — `resolveAnthropicModel is not a function`

- [ ] **Step 4: Viết `lib/provider/anthropic-adapter.ts`**

Dùng `createAnthropic({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey })` rồi trả `anthropic(cfg.model)`.

**Bắt buộc:** export riêng, **không** import vào `adapter.ts`. Xem Review Focus #5 — import tĩnh ở module dùng chung sẽ kéo Anthropic vào cả nhánh OpenAI.

- [ ] **Step 5: Chạy để xác nhận xanh**

Run: `npx vitest run tests/provider-adapter.test.ts`
Expected: PASS — 4 test

- [ ] **Step 6: Cập nhật CORE_ENTRIES và sinh lại bảng**

Thêm `lib/provider/adapter.ts` và `lib/provider/openai-adapter.ts` và `lib/provider/anthropic-adapter.ts` vào `CORE_ENTRIES`, rồi chạy:

```bash
node scripts/cli-migration/build-inventory.ts
```

Expected: dòng tóm tắt in ra số file trong đồ thị lõi **lớn hơn trước**. Nếu không tăng, `CORE_ENTRIES` chưa ăn — dừng và kiểm.

- [ ] **Step 7: Mutation**

Xoá một entry vừa thêm khỏi `CORE_ENTRIES`, chạy lại generator.
Expected: số file trong đồ thị **giảm**. Đó là bằng chứng `CORE_ENTRIES` thật sự ảnh hưởng đến bảng chứ không phải trang trí. Trả lại.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/provider/anthropic-adapter.ts \
  tests/provider-adapter.test.ts scripts/cli-migration/import-graph.ts \
  docs/cli-migration-inventory.md
git commit -m "feat(provider): adapter anthropic native + cap nhat CORE_ENTRIES"
```

---

### Task 4: Chẩn đoán lỗi upstream

**Files:**
- Create: `lib/provider/upstream-diagnosis.ts`
- Test: `tests/provider-diagnosis.test.ts`

**Interfaces:**
- Consumes: không có (hàm thuần, không I/O, không import Next)
- Produces — di chuyển nguyên vẹn từ `app/api/chat/route.ts`:

```ts
export interface UpstreamDiagnosis {
  status?: number;
  scope: UpstreamScope;
  code: string;
  userMessage: string;
  devLog: string;
  stopFailover: boolean;
  blameKey: boolean;
  modelUnsupported: boolean;
}

export function diagnoseUpstreamError(
  e: unknown,
  ctx: { requestId: string; model: string; keyLabel: string; providerBase?: string },
): UpstreamDiagnosis;

export function normalizeGatewayStreamError(e: unknown): unknown;
export function sanitizeErrorMessage(e: unknown): string;
export function getStatusCode(e: unknown): number | undefined;
```

`UpstreamScope` **không nằm trong `route.ts`** — nó đã ở `@/lib/api-keys`, và file đó
**không có import nào** (đã kiểm), nên thuần và chạy được trên Node. Vì vậy:

```ts
export type { UpstreamScope } from '@/lib/api-keys';
// 'key-auth' | 'key-rate' | 'request' | 'transient' | 'unknown'
```

**Re-export, không định nghĩa lại** — định nghĩa thứ hai là hai nguồn sự thật, và
`AGENTS.md` §6 cấm đúng thứ đó.

- [ ] **Step 1: Viết test đỏ**

Năm test, mỗi test một tình huống. Test đầu dùng hết năm giá trị scope nên canh
luôn việc bảng phân loại có đủ:

```ts
it('lỗi mạng không kèm status → blameKey false, stopFailover false, scope transient', () => {
  const d = diagnoseUpstreamError(new Error('fetch failed'), ctx);
  expect(d.status).toBeUndefined();
  expect(d.blameKey).toBe(false);
  expect(d.stopFailover).toBe(false);
  expect(d.scope).toBe('transient');
});

it('401 từ key sai → blameKey true, stopFailover true, scope key-auth', () => {
  const d = diagnoseUpstreamError(statusError(401), ctx);
  expect(d.blameKey).toBe(true);
  expect(d.stopFailover).toBe(true);
  expect(d.scope).toBe('key-auth');
});

it('gateway bọc lỗi trong chuỗi stream — HTTP 200 vẫn phải ra lỗi', () => {
  const d = diagnoseUpstreamError(new Error('[429]: {"error":{"message":"rate limit"}}'), ctx);
  expect(d.status).toBe(429);
});

it('userMessage không chứa API key, devLog thì có', () => {
  const d = diagnoseUpstreamError(statusError(500), { ...ctx, keyLabel: 'sk-secret-abc' });
  expect(d.userMessage).not.toContain('sk-secret-abc');
  expect(d.devLog).toContain('sk-secret-abc');
});
```

Test thứ tư là Review Focus #1 — khẳng định `userMessage` và `devLog` là hai chuỗi
khác nhau, không được gộp làm một.

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/provider-diagnosis.test.ts`
Expected: FAIL — `Cannot find package '@/lib/provider/upstream-diagnosis'`

- [ ] **Step 3: Viết `lib/provider/upstream-diagnosis.ts`**

Chuyển nguyên văn code và hằng từ `route.ts` khoảng dòng 292–660: `UpstreamDiagnosis`, `NETWORK_FAILURE_RE`, `GATEWAY_WRAPPED_ERROR_RE`, `normalizeGatewayStreamError`, `sanitizeErrorMessage`, `getStatusCode`, `diagnoseUpstreamError`, cùng mọi hằng trần nó dùng. **Không** định nghĩa lại `UpstreamScope` — re-export từ `@/lib/api-keys` như Interfaces ghi.

Sửa **duy nhất**: đường dẫn import nội bộ phải trỏ sang `@/lib/...`; không sửa logic, không rút gọn regex, không bỏ comment giải thích. Regex đã được chỉnh cho gateway thật, sửa lại là hồi quy.

- [ ] **Step 4: Trỏ `route.ts` sang module mới**

Đổi import trong `app/api/chat/route.ts` sang `@/lib/provider/upstream-diagnosis`. **Không xoá code cũ ở `route.ts` trong task này** — nếu xoá mà chưa xác nhận thì mất đường lui; dọn ở plan sau.

- [ ] **Step 5: Chạy để xác nhận xanh**

```bash
npx vitest run tests/provider-diagnosis.test.ts
npx tsc --noEmit
```
Expected: PASS 4 test, typecheck 0 lỗi

- [ ] **Step 6: Mutation**

Đảo `blameKey` trong nhánh lỗi mạng từ `false` thành `true`, chạy lại.
Expected: test "lỗi mạng không kèm status" **ĐỎ**. Trả lại, xanh.

- [ ] **Step 7: Commit**

```bash
git add lib/provider/upstream-diagnosis.ts tests/provider-diagnosis.test.ts \
  app/api/chat/route.ts
git commit -m "refactor(provider): tach chan doan loi upstream ra module chay server"
```

---

## Sau plan này

`route.ts` vẫn nguyên vẹn, chỉ đổi import. Nốt tồn đọng của nó thuộc plan sau:

1. `lib/session/` — thay Dexie bằng JSONL
2. Bóc vòng `streamText` + `fullStream` ra khỏi `route.ts`, dùng adapter của plan này
3. `lib/tools/fs-node.ts` — thay File System Access API
4. `cli/` — entry, REPL, duyệt tool nguy hiểm
5. Xoá web — chỉ khi CLI đạt chuẩn

Bảng kiểm kê hiện có 5 dòng; các plan trên chạm đúng `db.ts` và `fs-access.ts` — hai dòng `THAY-THE`.