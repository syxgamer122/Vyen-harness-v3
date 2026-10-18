# Tool Result Spill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi một tool trả kết quả vượt 24.000 ký tự, phần bị cắt được lưu ra file app tự ghi và model đọc lại được bằng `fs_read` sẵn có, thay vì bị vứt vĩnh viễn.

**Architecture:** Mở rộng `lib/ipc.cjs` — nơi đã làm đúng việc này cho `shell_run` — thay vì dựng `lib/spill/` mới. Registry hiện tại đổi value thành `{ path, kind }` để tách chính sách sống: đẩy `shell` cũ trước, `spill` chỉ bị đẩy khi hết shell. `lib/tool-limits.ts` gọi `saveSpillText` **lazy** (runtime `require`, không import top-level) vì file đó nằm trong bundle trình duyệt qua `react/use-chat-orchestration.ts:57`.

**Tech Stack:** Node CommonJS (`lib/ipc.cjs`), TypeScript (`lib/tool-limits.ts`), Vitest 4.1.11

**Spec:** `docs/superpowers/specs/2026-10-18-tool-result-spill-design.md`

## Global Constraints

- Ngưỡng `TOOL_RESULT_MAX_CHARS = 24_000` **không đổi**. Tỷ lệ `TOOL_RESULT_HEAD_RATIO = 0.7` / `TOOL_RESULT_TAIL_RATIO = 0.25` **không đổi**. Hình dạng preview phải y hệt hiện tại.
- `redactSecretText` phải chạy **trước** khi spill. Nội dung ghi xuống đĩa phải là bản **đã redact**. Lý do: `lib/tool-limits.ts:62-65` — khoá bí mật vắt qua ranh giới cắt không khớp regex nào nào, lọt vào ngữ cảnh.
- Spill là **best-effort**. Lỗi ghi → fallback `truncateToolResult` cũ. Không bao giờ biến một tool call thành công thành `isError` (`docs/subsystems/spill.md:92` của dsh).
- Không thêm file mới ngoài `tests/`. Mọi thay đổi nằm trong `lib/ipc.cjs` và `lib/tool-limits.ts`.
- Comment và thông báo cho model viết **tiếng Việt**. Tin nhắn commit **không** dấu, theo `type(scope): mô tả`.
- Mọi test mới phải được chứng minh **ĐỎ** trước khi sửa (AGENTS.md §2).

## Review Focus

Những đầu vào mà spec nói tới nhưng không test nào phủ, xếp theo khả năng gây hại thật:

1. **`suggestedName` chứa ký tự đường dẫn** (`../../evil.txt`, `C:\x`, `a/b.txt`) — kẻ xấu hoặc model bị tấn công prompt-injection có thể ép ghi file ngoài tmpdir. Kỳ vọng: file luôn nằm trong `os.tmpdir()`.
2. **Registry đầy khi đang có nhiều spill** — model vừa được báo "đã lưu ở <path>" thì file bị xoá. Kỳ vọng: spill bị đẩy **sau** shell, và notice nói rõ file có thể bị dọn.
3. **Nội dung tool chứa bí mật (API key) dài hơn 24.000 ký tự** — redact xảy ra trước cắt nên phần đầu/đuôi đã sạch, nhưng **phần giữa bị lược** và đó là phần hay chứa key. Kỳ vọng: file spill không chứa key ở bất kỳ vị trí nào.
4. **Chạy ở trình duyệt** (`window` tồn tại) — không có Node, `require` phải hỏng **mềm**, không làm sập bundle. Kỳ vọng: hành vi y hệt hiện tại (truncate, không spill).
5. **`fs_read` đọc đường dẫn spill khi registry đã đầy** — path không còn trong registry phải bị chặn, không đọc được file tùy ý ngoài workspace. *(Đã có test sẵn: `tests/shell-tool.test.ts:165` khẳng định `isSavedShellOutput` trả `false` cho một path ngẫu nhiên trong `tmpdir` — nên phần "bị chặn" đã được canh, không cần viết mới.)*

---

### Task 1: Chứng minh cơ chế require trước khi viết gì

Đây là task chặn. `lib/tool-limits.ts` được import bởi `react/use-chat-orchestration.ts:57` (bundle trình duyệt) — `require('../ipc.cjs')` ở top-level sẽ làm hỏng build client. Task này giải bằng thực nghiệm, không suy đoán.

**Files:**
- Modify: `tests/tool-limits-budget.test.ts` (thêm describe block)
- Modify: `lib/tool-limits.ts` (thêm loader, chưa nối vào `serializeToolResult`)

**Interfaces:**
- Consumes: không có
- Produces: `loadSpillSaver(): SpillSaver | null` trong `lib/tool-limits.ts`, với kiểu `type SpillSaver = (content: string, suggestedName: string) => { savedTo: string; bytes: number; notice: string } | null`

- [ ] **Step 1: Viết test đỏ — loader phải an toàn ở cả hai nơi**

Trong `tests/tool-limits-budget.test.ts`, thêm:

```ts
describe('loadSpillSaver — không được làm hỏng bundle trình duyệt', () => {
  it('trả null thay vì ném khi không có Node', () => {
    expect(() => loadSpillSaver()).not.toThrow();
  });

  it('trả null nếu môi trường giả lập window (trình duyệt)', () => {
    (globalThis as any).window = {};
    try {
      expect(loadSpillSaver()).toBeNull();
    } finally {
      delete (globalThis as any).window;
    }
  });
});
```

Import `loadSpillSaver` từ `@/lib/tool-limits`.

- [ ] **Step 2: Chạy test để xác nhận ĐỎ**

Run: `npx vitest run tests/tool-limits-budget.test.ts`
Expected: FAIL — `loadSpillSaver` chưa được export.

- [ ] **Step 3: Cài loader tối thiểu trong `lib/tool-limits.ts`**

Đặt ngay trên `export function truncateToolResult`. **Không** import `ipc.cjs` ở top-level.

```ts
export type SpillSaver = (content: string, suggestedName: string) =>
  | { savedTo: string; bytes: number; notice: string }
  | null;

let spillSaverCache: SpillSaver | null | undefined;

export function loadSpillSaver(): SpillSaver | null {
  if (spillSaverCache !== undefined) return spillSaverCache;
  // Trình duyệt không có Node. Chặn trước để không chạm require.
  if (typeof window !== 'undefined') { spillSaverCache = null; return null; }
  try {
    const nodeRequire = eval('require') as NodeRequire;
    const ipc = nodeRequire('../ipc.cjs') as { saveSpillText?: SpillSaver };
    spillSaverCache = typeof ipc.saveSpillText === 'function' ? ipc.saveSpillText : null;
  } catch {
    spillSaverCache = null;
  }
  return spillSaverCache;
}
```

Dùng `eval('require')` để bundler không phân tích tĩnh — import tĩnh sẽ kéo `ipc.cjs` vào bundle trình duyệt và làm hỏng `next build`.

- [ ] **Step 4: Chạy test xác nhận XANH**

Run: `npx vitest run tests/tool-limits-budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Chứng minh test có tác dụng (mutation)**

Xoá khối `if (typeof window !== 'undefined')` rồi chạy lại.
Expected: FAIL ở test thứ hai.
Trả lại khối đó, chạy lại → PASS.

- [ ] **Step 6: Kiểm chứng build client không vỡ**

Run: `npm run build`
Expected: exit 0. Nếu đỏ vì `ipc.cjs` lọt vào client bundle, thay `eval('require')` bằng cách đọc module qua biến động để bundler không phân tích.

- [ ] **Step 7: Chạy typecheck + lint**

Run: `npx tsc --noEmit` → exit 0. `npm run lint` → 0 lỗi mới.
Nếu lint chặn `eval`, thêm dòng `// eslint-disable-next-line no-eval` ngay trên `eval`.

- [ ] **Step 8: Commit**

```bash
git add lib/tool-limits.ts tests/tool-limits-budget.test.ts
git commit -m "feat(spill): loader lazy cho saveSpillText, an toan o ca server va trinh duyet"
```

---

### Task 2: `saveSpillText` + registry biết loại

**Files:**
- Modify: `lib/ipc.cjs:599-620` (registry), `lib/ipc.cjs:1490-1504` (exports)
- Test: `tests/shell-tool.test.ts`

**Interfaces:**
- Consumes: `SpillSaver` (Task 1) — tên hàm gọi vào từ ipc.cjs là `saveSpillText`
- Produces: `saveSpillText(content: string, suggestedName: string) -> { savedTo, bytes, notice } | null` trong `module.exports` của `lib/ipc.cjs`

- [ ] **Step 1: Viết test đỏ — sanitize tên và ghi exclusive**

Trong `tests/shell-tool.test.ts`, dùng `require('../lib/ipc.cjs')` sẵn có (file test đã require ở `:28`):

```ts
describe('saveSpillText', () => {
  it('ghi file tạm và trả savedTo + bytes', () => {
    const r = ipc.saveSpillText('hello spill', 'web_fetch.txt');
    expect(r).not.toBeNull();
    expect(fs.readFileSync(r!.savedTo, 'utf8')).toBe('hello spill');
    expect(r!.bytes).toBe(Buffer.byteLength('hello spill', 'utf8'));
    expect(r!.notice).toContain(r!.savedTo);
  });

  it('suggestedName chứa đường dẫn vẫn nằm trong tmpdir', () => {
    const r = ipc.saveSpillText('x', '../../evil.txt');
    expect(path.dirname(path.resolve(r!.savedTo))).toBe(path.resolve(os.tmpdir()));
  });

  it('suggestedName rỗng thì dùng tên mặc định, không ném', () => {
    expect(() => ipc.saveSpillText('x', '')).not.toThrow();
  });
});
```

- [ ] **Step 2: Chạy test xác nhận ĐỎ**

Run: `npx vitest run tests/shell-tool.test.ts`
Expected: FAIL — `saveSpillText is not a function`.

- [ ] **Step 3: Đổi registry sang biết loại**

Trong `lib/ipc.cjs:599-620`, đổi `savedShellOutputs` thành `Map<key, { path, kind }>`:

```js
const SAVED_OUTPUT_REGISTRY_MAX = 50;
const savedShellOutputs = new Map(); // key đã normalize -> { path, kind }

function registerSavedShellOutput(savePath, kind = 'shell') {
  const key = savedOutputKey(savePath);
  if (savedShellOutputs.has(key)) return;
  savedShellOutputs.set(key, { path: savePath, kind });
  evictSavedOutputs();
}

// Đẩy `shell` cũ trước (đọc xong ngay trong lượt đó), `spill` chỉ bị đẩy khi
// đã hết shell và vẫn vượt trần — spill thiết kế để đọc LÂU HƠN nên phải sống lâu hơn.
function evictSavedOutputs() {
  const overflow = savedShellOutputs.size - SAVED_OUTPUT_REGISTRY_MAX;
  if (overflow <= 0) return;
  const order = [];
  for (const [key, entry] of savedShellOutputs) order.push({ key, kind: entry.kind });
  order.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'shell' ? -1 : 1));
  let removed = 0;
  for (const { key } of order) {
    if (removed >= overflow) break;
    const path = savedShellOutputs.get(key).path;
    savedShellOutputs.delete(key);
    try { fs.unlinkSync(path); } catch { /* OS đã dọn — chỉ cần quên đường dẫn */ }
    removed++;
  }
}
```

Giữ `savedOutputKey` và `isSavedShellOutput` nguyên vẹn.

- [ ] **Step 4: Viết `saveSpillText`**

Đặt ngay dưới `truncateShellOutput`. Dùng `LIMITS.SPILL_FILE_PREFIX` xoá sau khi thêm ở Step 5.

```js
function sanitizeSpillName(suggestedName) {
  const base = String(suggestedName || '').replace(/[\\/]/g, '_').replace(/[^A-Za-z0-9._-]/g, '_');
  const cleaned = base.replace(/^\.+/, '').slice(0, 60);
  return cleaned || 'spill.txt';
}

function saveSpillText(content, suggestedName) {
  if (!content) return null;
  const id = crypto.randomBytes(4).toString('hex');
  const fileName = `vyen-spill-${id}-${sanitizeSpillName(suggestedName)}`;
  const savePath = path.join(os.tmpdir(), fileName);
  try {
    // flag 'wx': ghi exclusive, symlink có sẵn không thể chuyển hướng (spill-local/store.ts:115)
    fs.writeFileSync(savePath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch {
    return null; // best-effort — caller fallback, KHÔNG ném
  }
  registerSavedShellOutput(savePath, 'spill');
  const bytes = Buffer.byteLength(content, 'utf8');
  const notice = `[Phần giữa (${bytes.toLocaleString('vi-VN')} ký tự) đã lưu: ${savePath}\n` +
    ` Đọc bằng fs_read(path, start_line, line_count) hoặc fs_search(path). ` +
    `File có thể bị dọn khi phiên tích tụ nhiều kết quả lớn.]`;
  return { savedTo: savePath, bytes, notice };
}
```

- [ ] **Step 5: Thêm hằng vào `LIMITS`**

Trong khối `LIMITS` (`lib/ipc.cjs:86-91`), thêm `SPILL_FILE_PREFIX: 'vyen-spill'` và dùng nó trong `saveSpillText`.

- [ ] **Step 6: Export**

Thêm `saveSpillText` vào `module.exports` (`lib/ipc.cjs:1490-1504`).

- [ ] **Step 7: Chạy test xác nhận XANH**

Run: `npx vitest run tests/shell-tool.test.ts`
Expected: PASS.

- [ ] **Step 8: Mutation — chứng minh test canh đúng**

Bỏ `flag: 'wx'` khỏi `writeFileSync`, chạy lại.
Expected: phải ĐỎ ở test ghi exclusive nếu có; nếu không có test nào đỏ, viết thêm test ghi đè không được.
Trả lại, chạy lại → PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/ipc.cjs tests/shell-tool.test.ts
git commit -m "feat(spill): saveSpillText ghi file tam exclusive + registry phan biet shell voi spill"
```

---

### Task 3: `fs_read` đọc được file spill + đẩy shell trước

**Files:**
- Modify: `lib/ipc.cjs:313-324` (`readTargetOf`)
- Test: `tests/shell-tool.test.ts`

**Interfaces:**
- Consumes: registry `{ path, kind }` (Task 2)
- Produces: `readTargetOf` nhận path spill; hàm export `isSavedShellOutput` giữ nguyên hành vi

- [ ] **Step 1: Viết test đỏ — whitelist chấp nhận cả hai loại**

Trong `tests/shell-tool.test.ts`:

```ts
describe('fs_read whitelist — nhận cả shell lẫn spill', () => {
  it('path spill đọc được qua isSavedShellOutput', () => {
    const r = ipc.saveSpillText('nội dung', 'a.txt');
    expect(ipc.isSavedShellOutput(r!.savedTo)).toBe(true);
  });

  it('đầy registry thì shell bị đẩy trước, spill còn lại', () => {
    const spill = ipc.saveSpillText('giữ lại', 'keep.txt');
    for (let i = 0; i < ipc.SAVED_OUTPUT_REGISTRY_MAX + 5; i++) {
      const o = ipc.truncateShellOutput('x\n'.repeat(2100), 'stdout'); // vượt trần dòng
      expect(o.savedTo).toBeTruthy();
    }
    expect(ipc.isSavedShellOutput(spill!.savedTo)).toBe(true);
    expect(fs.existsSync(spill!.savedTo)).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy test xác nhận ĐỎ**

Run: `npx vitest run tests/shell-tool.test.ts`
Expected: FAIL ở test "đầy registry" — vì `evictSavedOutputs` hiện xoá theo thứ tự chèn, sẽ đẩy spill đi trước.

- [ ] **Step 3: Sửa `readTargetOf` cho value mới**

`lib/ipc.cjs:318-324`:

```js
function readTargetOf(payload) {
  if (typeof payload?.relPath === 'string') {
    const entry = savedShellOutputs.get(savedOutputKey(payload.relPath));
    // Luôn trả path GỐC đã ghi (value của registry) — canonical với đĩa.
    if (entry) return entry.path;
  }
  return targetOf(payload);
}
```

- [ ] **Step 4: Chạy test xác nhận XANH**

Run: `npx vitest run tests/shell-tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation — chứng minh ưu tiên đẩy shell có tác dụng**

Trong `evictSavedOutputs`, đổi comparator thành `a.kind === b.kind ? 0 : 1` (luôn đẩy spill trước).
Run lại.
Expected: FAIL ở test "đầy registry".
Trả lại comparator đúng → PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit` → 0. `npm run lint` → 0 lỗi mới.

- [ ] **Step 7: Commit**

```bash
git add lib/ipc.cjs tests/shell-tool.test.ts
git commit -m "feat(spill): fs_read doc duoc file spill, day shell output truoc khi tran registry"
```

---

### Task 4: `serializeToolResult` — spill hoặc truncate

**Files:**
- Modify: `lib/tool-limits.ts:52-67`
- Test: `tests/tool-result-body.test.ts`

**Interfaces:**
- Consumes: `loadSpillSaver()` (Task 1), `saveSpillText` (Task 2), `truncateToolResult` (đã có)
- Produces: hành vi mới của `serializeToolResult(result, maxChars?)` — trả preview + notice khi spill được, trả y hệt cũ khi không

- [ ] **Step 1: Viết test đỏ — không spill khi dưới ngưỡng**

Trong `tests/tool-result-body.test.ts`:

```ts
describe('serializeToolResult — spill', () => {
  it('dưới ngưỡng: không gọi saveSpillText, trả nguyên văn', () => {
    const spy = vi.spyOn(fs, 'writeFileSync');
    const out = serializeToolResult({ a: 'x'.repeat(1000) });
    expect(out).toContain('x'.repeat(100));
    expect(spy).not.toHaveBeenCalled();
  });

  it('vượt ngưỡng: có đường dẫn đọc lại, tổng ký tự vẫn ≤ maxChars', () => {
    const out = serializeToolResult({ a: 'x'.repeat(40_000) }, 24_000);
    expect(out).toMatch(/fs_read/);
    expect(out.length).toBeLessThanOrEqual(24_000);
  });

  it('vượt ngưỡng nhưng ghi lỗi: trả y hệt truncateToolResult cũ', () => {
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('ENOSPC'); });
    const raw = { a: 'x'.repeat(40_000) };
    expect(serializeToolResult(raw, 24_000))
      .toBe(truncateToolResult(redactSecretText(JSON.stringify(raw)), 24_000));
    spy.mockRestore();
  });

  it('bí mật ở phần giữa không nằm trong file spill', () => {
    const secret = 'sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const body = 'x'.repeat(12_000) + secret + 'y'.repeat(12_000);
    const out = serializeToolResult({ body }, 24_000);
    const m = out.match(/([A-Za-z]:\\[^\s\]]+\.txt)/);
    expect(m).not.toBeNull();
    expect(fs.readFileSync(m![1], 'utf8')).not.toContain(secret);
  });
});
```

Import thêm `truncateToolResult` từ `@/lib/tool-limits` và `redactSecretText` từ `@/lib/secret-registry`, `vi`, `fs` nếu chưa có.

- [ ] **Step 2: Chạy test xác nhận ĐỎ**

Run: `npx vitest run tests/tool-result-body.test.ts`
Expected: FAIL — test "vượt ngưỡng" chưa thấy `fs_read`.

- [ ] **Step 3: Cài logic spill-or-truncate**

Thay thân `lib/tool-limits.ts:52-67`:

```ts
export function serializeToolResult(result: unknown, maxChars: number = TOOL_RESULT_MAX_CHARS): string {
  let raw: string;
  try {
    raw = JSON.stringify(result) ?? 'null';
  } catch {
    raw = '"[kết quả không serialize được]"';
  }
  /* Redact TRƯỚC mọi thứ — kể cả trước khi spill. Nếu spill bản thô thì bí
     mật nằm trên đĩa; nếu cắt trước rồi redact thì khoá vắt qua ranh giới cắt
     không khớp regex nào. Xem lib/secret-registry.ts. */
  const redacted = redactSecretText(raw);
  if (redacted.length <= maxChars) return redacted;

  const saveSpillText = loadSpillSaver();
  if (saveSpillText) {
    const spilled = saveSpillText(redacted, 'tool-result.txt');
    if (spilled) {
      // Chừa sẵn chỗ cho marker và notice rồi mới chia phần còn lại cho đầu/đuôi,
      // để TỔNG không bao giờ vượt maxChars — đây là hợp đồng của tool-limits.ts:28.
      const markerLen = 64;
      const room = Math.max(0, maxChars - markerLen - spilled.notice.length - 2);
      const split = TOOL_RESULT_HEAD_RATIO / (TOOL_RESULT_HEAD_RATIO + TOOL_RESULT_TAIL_RATIO);
      const headLen = Math.floor(room * split);
      const tailLen = room - headLen;
      const head = redacted.slice(0, headLen);
      const tail = tailLen > 0 ? redacted.slice(-tailLen) : '';
      const marker = `\n...[đã cắt bớt ${Math.max(0, redacted.length - headLen - tailLen)} ký tự ở giữa]...\n`;
      return `${head}${marker}${tail}\n\n${spilled.notice}`;
    }
  }
  return truncateToolResult(redacted, maxChars);
}
```

`markerLen` là trần đặt trên — marker thực tế ngắn hơn, nên tổng luôn **dưới** `maxChars`. Dùng tròn số an toàn thay vì đo chính xác độ dài marker.

- [ ] **Step 4: Chạy test xác nhận XANH**

Run: `npx vitest run tests/tool-result-body.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation bắt buộc — chứng minh redact chạy trước spill**

Xoá `redactSecretText` (thay bằng `raw` thẳng), chạy lại.
Expected: FAIL ở test "bí mật ở phần giữa".
Trả lại → PASS.

Đây là mutation quan trọng nhất của cả plan (AGENTS.md §2).

- [ ] **Step 6: Chạy toàn bộ suite liên quan**

Run: `npx vitest run tests/tool-result-body.test.ts tests/tool-limits-budget.test.ts tests/shell-tool.test.ts tests/secret-registry.test.ts tests/emulated-agent.test.ts`
Expected: PASS. Nếu `tests/secret-registry.test.ts` đỏ về thời gian, chạy riêng nó — AGENTS.md §1 ghi là flaky khi chạy song song.

- [ ] **Step 7: Commit**

```bash
git add lib/tool-limits.ts tests/tool-result-body.test.ts
git commit -m "feat(spill): serializeToolResult luu phan bi cat de fs_read doc lai duoc"
```

---

### Task 5: Tài liệu

**Files:**
- Modify: `README.md:47`, `README.md:165`

**Interfaces:**
- Consumes: hành vi thật của Task 4
- Produces: không có code

- [ ] **Step 1: Sửa `README.md:165`**

Cụm hiện tại nói kết quả tool bị cắt ở 24.000 ký tự. Thêm rằng phần bị cắt **vẫn đọc lại được** bằng `fs_read` và nằm ở file app tự ghi.

- [ ] **Step 2: Sửa `README.md:47`**

Nói rõ temp file giờ dùng chung một cơ chế cho **mọi** tool, không chỉ `shell_run`.

- [ ] **Step 3: Chạy docs:check**

Run: `npm run docs:check`
Expected: `docs:check OK`. Nếu đỏ vì đường dẫn, sửa cho khớp.

- [ ] **Step 4: Chạy toàn bộ gate trước khi báo xong**

```bash
npx tsc --noEmit
npm run lint
npx vitest run --maxWorkers=1 --no-file-parallelism
npm run docs:check
```

Expected: typecheck 0, lint 0 lỗi mới, test không đỏ (trừ 3 flaky ở AGENTS.md §1), docs OK.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): ghi ro ket qua tool bi cat van doc lai duoc bang fs_read"
```