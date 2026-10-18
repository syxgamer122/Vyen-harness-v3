# Kiểm kê di cư sang CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sinh ra bảng phân loại cho 46 file `lib/` đang phụ thuộc API trình duyệt, để biết chính xác cái gì giữ, cái gì viết lại, cái gì xoá — trước khi viết dòng lõi nào.

**Architecture:** Một script Node đọc `lib/**` và phát ra bằng chứng (file, dòng, tên API). Một script thứ hai vẽ đồ thị import để trả lời "file này còn dùng bởi lõi không". Hai script đó cùng sinh ra `docs/cli-migration-inventory.md`. Việc **phân loại** là phán đoán, không phải máy — bảng đó ghi rõ tiêu chí và ai quyết định.

**Tech Stack:** Node ESM (`node:fs`, `node:path`), vitest, TypeScript cho các file repo.

**Spec:** `docs/superpowers/specs/2026-10-18-cli-core-design.md` §4 (Giai đoạn 0)

## Global Constraints

- Không dùng PowerShell để **ghi** file có tiếng Việt. PowerShell 5.1 đọc file không BOM theo ANSI rồi ghi lại thành UTF-8 của chuỗi đã hỏng → mojibake trong comment mà `tsc`/`lint`/test đều không thấy. Dùng `node` (`readFileSync`/`writeFileSync` UTF-8 mặc định) hoặc `edit`. Đã xảy ra 1 lần trong phiên 2026-10-18.
- Comment và tài liệu viết bằng tiếng Việt có dấu. Tin nhắn commit **không** dấu, theo `type(scope): mô tả`.
- File mới phải `git add` trước khi `npm run docs:check` chạy — checker dùng `git ls-files`.
- Comment trong code tiếng Việt **có dấu**. Không dùng ASCII-ize trong `.ts`.
- Mọi test mới phải qua mutation discipline: làm hỏng đúng thứ test khoá → phải thấy đỏ → trả lại.

## Review Focus

Những cách bảng này có thể **nói dối người đọc nó** — tức bảng sai vẫn trông đúng:

1. **Regex quét hỏng âm thầm.** Đổi pattern → không file nào khớp → bảng ra "0 file cần viết lại" → kế hoạch phía sau xây trên con số 0. Đây đúng là lỗi đã xảy ra trong phiên 2026-10-18 (`describe.skipIf` làm 9 test "xanh"; grep thô trả 8 dòng toàn comment).
2. **Báo động giả làm bảng vô dụng.** `typeof window !== 'undefined'` xuất hiện ở hầu hết mọi file và vô hại. Nếu quét nó, bảng ghi nhận cả repo là browser-only và mất hết giá trị định hướng.
3. **Đồ thị import quét hỏng âm thầm.** Nếu regex `from '@/...'` sai, script báo "không file nào nằm trong đồ thị lõi" → kết luận "xoá hết" → xoá nhầm code đang chạy. `AGENTS.md` §6 đã cảnh báo đúng lỗi này.
4. **File không có trong bảng.** Một file `lib/` mới thêm vào mà không chạy lại quét sẽ vô hình. Cần canh **tổng số file `lib/`** khớp số dòng trong bảng.
5. **Phân loại không nhất quán.** Hai người (hoặc hai lần) gắn nhãn khác nhau cho cùng một file → kế hoạch phía sau vỡ. Cần tiêu chí viết ra, không để tuỳ.

---

### Task 1: Script quét API trình duyệt

**Files:**
- Create: `scripts/cli-migration/scan-browser-apis.mjs`
- Test: `tests/cli-migration-scan.test.ts`
- Create: `tests/fixtures/cli-migration/browser-api/` (fixture: file sạch + file dính)

**Interfaces:**
- Consumes: không có
- Produces: `scanBrowserApis(root: string): ScanHit[]` và `scanFile(src: string, file: string): ScanHit[]`, trong đó

```ts
interface ScanHit {
  file: string;   // đường dẫn tương đối so với repo, dùng dấu '/' kể cả trên Windows
  line: number;   // số dòng 1-based
  api: string;    // một trong BROWSER_APIS
}
```

và `export const BROWSER_APIS: Record<string, RegExp>` — bảng định nghĩa, phải export để Task 2 dùng lại và để test kiểm.

Danh sách API phải khớp **chính xác** với cái đã dùng để tìm ra con số 46:

```
Dexie, indexedDB, localStorage, showDirectoryPicker, showOpenFilePicker,
FileSystemHandle, getAsFileSystemHandle, navigator.storage,
navigator.clipboard, navigator.share
```

Cố ý **không** đưa `window`/`document` vào danh sách: chúng xuất hiện trong guard `typeof window !== 'undefined'` ở hầu hết mọi file và làm bảng mất khả năng chỉ đường.

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest';
import { scanBrowserApis, BROWSER_APIS } from '../scripts/cli-migration/scan-browser-apis.mjs';
```

Ba test:

```ts
it('dò đúng API trình duyệt và trả về số dòng', () => {
  const src = [
    "import Dexie from 'dexie';",        // dòng 1
    'export const db = new Dexie("vyen");',
    "async function mo() {",             // dòng 3
    '  const h = await showDirectoryPicker();',
    '  localStorage.setItem("k", "v");', // dòng 5
    '}',
  ].join('\n');
  const hits = scanFile(src, 'lib/demo.ts');
  expect(hits.map((h) => [h.line, h.api])).toEqual([
    [1, 'Dexie'],
    [2, 'Dexie'],
    [4, 'showDirectoryPicker'],
    [5, 'localStorage'],
  ]);
});

it('bỏ qua guard typeof window — không phải API trình duyệt chỉ-server', () => {
  const src = [
    "if (typeof window !== 'undefined') {",
    '  return null;',
    '}',
  ].join('\n');
  expect(scanFile(src, 'lib/demo.ts')).toEqual([]);
});

it('cơ chế quét tự được kiểm: phải tìm thấy Dexie trong lib/db.ts thật', () => {
  // Nếu regex hỏng, hai test trên vẫn xanh (chúng dùng fixture do chính ta viết).
  // Chỉ test này bắt được. Đây là bài học lặp lại nhiều lần trong phiên 2026-10-18.
  const hits = scanBrowserApis('lib');
  const db = hits.filter((h) => h.file === 'lib/db.ts' && h.api === 'Dexie');
  expect(db.length, 'lib/db.ts chắc chắn có Dexie — quét mà không thấy là regex hỏng').toBeGreaterThan(0);
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/cli-migration-scan.test.ts`
Expected: FAIL — `Cannot find module '../scripts/cli-migration/scan-browser-apis.mjs'`

- [ ] **Step 3: Viết `scripts/cli-migration/scan-browser-apis.mjs`**

```js
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const BROWSER_APIS = {
  Dexie: /\bDexie\b/,
  indexedDB: /\bindexedDB\b/,
  localStorage: /\blocalStorage\b/,
  showDirectoryPicker: /\bshowDirectoryPicker\b/,
  showOpenFilePicker: /\bshowOpenFilePicker\b/,
  FileSystemHandle: /\bFileSystemHandle\b/,
  getAsFileSystemHandle: /\bgetAsFileSystemHandle\b/,
  'navigator.storage': /\bnavigator\.storage\b/,
  'navigator.clipboard': /\bnavigator\.clipboard\b/,
  'navigator.share': /\bnavigator\.share\b/,
};

export function scanFile(src, file) {
  const hits = [];
  src.split(/\r?\n/).forEach((line, i) => {
    for (const [api, re] of Object.entries(BROWSER_APIS)) {
      if (re.test(line)) hits.push({ file, line: i + 1, api });
    }
  });
  return hits;
}

export function scanBrowserApis(root) { /* duyệt đệ quy .ts dưới root, nối kết quả */ }
```

Chuẩn hoá đường dẫn bằng `split(path.sep).join('/')` — Windows trả `\`, test so với `'lib/db.ts'`.

Bỏ qua `node_modules`, `.next`, `dist`.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/cli-migration-scan.test.ts`
Expected: PASS — 3 test

- [ ] **Step 5: Mutation — đảo regex thành thứ không bao giờ khớp**

Sửa `Dexie: /\bDexie\b/` thày `Dexie: /\bZZZNOKHOP\b/`, chạy lại test.
Expected: test thứ ba **ĐỎ** với thông báo "lib/db.ts chắc chắn có Dexie".
Nếu vẫn xanh, test tự kiểm không hoạt động — dừng và sửa nó trước khi đi tiếp.

Trả lại regex gốc, chạy lại, phải xanh.

- [ ] **Step 6: Commit**

```bash
git add scripts/cli-migration/scan-browser-apis.mjs tests/cli-migration-scan.test.ts
git commit -m "test(cli): quet API trinh duyet, co test tu kiem co that quet khong"
```

---

### Task 2: Đồ thị import — file nào còn dùng bởi lõi

**Files:**
- Create: `scripts/cli-migration/import-graph.mjs`
- Modify: `tests/cli-migration-scan.test.ts`

**Interfaces:**
- Consumes: `BROWSER_APIS` không dùng. Thay vào đó dùng đường dẫn repo làm tham số.
- Produces:

```ts
/** Tập file trong đồ thị import bắt đầu từ `entries`, quy về đường dẫn repo dùng '/'. */
function reachableFrom(entries: string[]): Set<string>;

/** File nào trong `files` KHÔNG nằm trong đồ thị lõi. */
function unreached(files: string[], entries: string[]): string[];
```

Điểm vào của lõi (giữ đúng tên này, Task 3 dùng lại):
`lib/agent-tools-server.ts`, `lib/tool-result-server.ts`, `lib/emulated-agent.ts`, `lib/tool-limits.ts`, `lib/context-budget.ts`, `lib/secret-registry.ts`, `lib/mcp/tool-mapper.ts`.

- [ ] **Step 1: Viết test đỏ**

```ts
import { reachableFrom, unreached } from '../scripts/cli-migration/import-graph.mjs';

it('đi từ entry tới được qua chuỗi import nhiều tầng', () => {
  const s = reachableFrom(['lib/agent-tools-server.ts']);
  // agent-tools-server -> tool-limits -> secret-registry: 3 tầng.
  expect(s.has('lib/secret-registry.ts')).toBe(true);
});

it('đồ thị phải lớn hơn 5 file — quét hỏng sẽ báo "không thấy gì" và trả về rỗng', () => {
  expect(reachableFrom(['lib/agent-tools-server.ts']).size).toBeGreaterThan(5);
});

it('file treo lơ lửng không nằm trong đồ thị lõi', () => {
  expect(unreached(['lib/db.ts'], ['lib/agent-tools-server.ts'])).toContain('lib/db.ts');
});
```

Test thứ hai là **test kiểm cơ chế kiểm** — cùng dạng với test thứ ba của Task 1.

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/cli-migration-scan.test.ts`
Expected: FAIL — `Cannot find module '../scripts/cli-migration/import-graph.mjs'`

- [ ] **Step 3: Viết `scripts/cli-migration/import-graph.mjs`**

Parse `from '@/x'` → `lib/x.ts`. Bỏ qua import không nội bộ (`ai`, `zod`, `node:*`, `react`).

Định nghĩa và **export** điểm vào của lõi ở đây — một chỗ duy nhất, Task 3 import lại:

```js
export const CORE_ENTRIES = [
  'lib/agent-tools-server.ts',
  'lib/tool-result-server.ts',
  'lib/emulated-agent.ts',
  'lib/tool-limits.ts',
  'lib/context-budget.ts',
  'lib/secret-registry.ts',
  'lib/mcp/tool-mapper.ts',
];
```

`reachableFrom()` mặc định lấy `CORE_ENTRIES`. Không được viết lại danh sách này ở task khác — hai bộ hằng trùng tên là cách hỏng nguồn sự thật (`AGENTS.md` §6).

**Quan trọng:** nếu file không tồn tại thì **phải ném**, không phải bỏ qua âm thầm. `AGENTS.md` §6 ghi rõ: tìm-hụt dễ dẫn tới xoá nhầm code đang chạy. Đường dẫn sai là lỗi dữ liệu, không phải lý do bỏ qua.

- [ ] **Step 4: Chạy để xác nhận xanh**

Run: `npx vitest run tests/cli-migration-scan.test.ts`
Expected: PASS — 6 test

- [ ] **Step 5: Mutation — phá regex import**

Sửa `from '@/x'` thành `from "@/x"`, chạy lại.
Expected: test "đồ thị phải lớn hơn 5 file" **ĐỎ**.
Trả lại, chạy lại, phải xanh.

- [ ] **Step 6: Commit**

```bash
git add scripts/cli-migration/import-graph.mjs tests/cli-migration-scan.test.ts
git commit -m "test(cli): ve do thi import de biet file nao con dung boi loi"
```

---

### Task 3: Sinh bảng kiểm kê

**Files:**
- Create: `scripts/cli-migration/build-inventory.mjs`
- Create: `docs/cli-migration-inventory.md` (sinh ra, commit)
- Modify: `tests/cli-migration-scan.test.ts`

**Interfaces:**
- Consumes: `scanBrowserApis(root)` từ Task 1; `CORE_ENTRIES` và `reachableFrom(entries)` từ Task 2.
- Produces: `renderInventory(scan: ScanHit[], core: Set<string>): string` — trả về markdown; và `countTsFiles(root: string): number` — đếm file `.ts` đệ quy, dùng cho test "bảng phải phủ hết file".

**Tiêu chí phân loại** — ghi thẳng vào file sinh ra để người đọc sau không phải đoán:

| Nhãn | Điều kiện |
|---|---|
| `GHIU` | Không chạm API trình duyệt, **hoặc** chỉ chạm trong guard tùy chọn và không thuộc đường lõi |
| `VIET-LAI` | Chạm API trình duyệt **và** nằm trong đồ thị lõi → lõi cần nó, phải có bản Node |
| `XOA` | Chạm API trình duyệt và **không** nằm trong đồ thị lõi → thuộc tính năng web, bỏ theo |

Cột `LÝ DO` ghi tên tính năng mà file phục vụ, để người đọc đoán được hậu quả khi xoá (ví dụ `auto-backup.ts` → sao lưu tự động, mất khi bỏ web).

- [ ] **Step 1: Viết test đỏ**

```ts
import { readFileSync } from 'node:fs';
import { countTsFiles, renderInventory } from '../scripts/cli-migration/build-inventory.mjs';

it('bảng phải phủ hết file .ts trong lib — không có file nào vô hình', () => {
  // Cơ chế kiểm thứ hai: thêm một file lib mới mà không chạy lại quét thì
  // bảng sẽ im lặng bỏ sót nó. Canh tổng số dòng bằng số file thật.
  const md = readFileSync('docs/cli-migration-inventory.md', 'utf8');
  const rows = md.split('\n').filter((l) => l.startsWith('| `lib/'));
  expect(rows.length).toBe(countTsFiles('lib'));
});

it('mọi file trong bảng đều có nhãn hợp lệ', () => {
  const md = readFileSync('docs/cli-migration-inventory.md', 'utf8');
  for (const row of md.split('\n').filter((l) => l.startsWith('| `lib/'))) {
    expect(row, 'nhãn phải là GHIU | VIET-LAI | XOA').toMatch(/\| (GHIU|VIET-LAI|XOA) \|/);
  }
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Run: `npx vitest run tests/cli-migration-scan.test.ts`
Expected: FAIL — `docs/cli-migration-inventory.md` chưa tồn tại

- [ ] **Step 3: Viết `scripts/cli-migration/build-inventory.mjs`**

Ghép `scanBrowserApis` + `reachableFrom`, gán nhãn theo tiêu chí trên, xuất markdown có cột: `file | dòng API | nằm trong đồ thị lõi | nhãn | lý do`.

Script **chỉ ghi bằng chứng**, nhãn `GHIU`/`VIET-LAI`/`XOA` gán tự động theo tiêu chí máy kiểm được. Cột `LÝ DO` để trống — đó là chỗ phán đoán của người, **không** đoán bằng máy.

- [ ] **Step 4: Chạy script rồi test**

```bash
node scripts/cli-migration/build-inventory.mjs
npx vitest run tests/cli-migration-scan.test.ts
```
Expected: PASS — 8 test

- [ ] **Step 5: Điền cột LÝ DO**

Đọc từng dòng có `XOA`, điền tính năng nó phục vụ. Tối đa 46 dòng, làm thẳng không cần công cụ.

- [ ] **Step 6: Chạy gate đầy đủ**

```bash
npm run typecheck
npm run test
npm run lint
npm run docs:check
```
Expected: typecheck 0 lỗi · test không đỏ (trừ 3 flaky ở AGENTS.md §1) · lint không có lỗi mới · docs OK.

- [ ] **Step 7: Commit**

```bash
git add -A scripts/cli-migration docs/cli-migration-inventory.md tests/cli-migration-scan.test.ts
git commit -m "docs(cli): bang ke ke 46 file lib phu thuoc API trinh duyet"
```

---

## Sau khi kế hoạch này xong

Bảng kiểm kê là **cổng** cho mọi kế hoạch sau. Không viết lõi trước khi có nó.

Các kế hoạch tiếp theo, mỗi cái một plan riêng, lập sau khi đọc bảng:

1. `lib/session/` — thay Dexie bằng JSONL
2. `lib/provider/` — adapter Anthropic-native + bóc streaming từ `route.ts`
3. `lib/tools/fs-node.ts` — thay File System Access API
4. `cli/` — entry, REPL, duyệt tool nguy hiểm
5. Xoá web — **chỉ khi CLI đạt chuẩn**