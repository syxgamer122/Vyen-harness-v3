# SDD ledger — plan: docs/superpowers/plans/2026-10-18-provider-layer.md

Spec: docs/superpowers/specs/2026-10-18-cli-core-design.md §5

## Setup

- **Ruling: không tạo git worktree, chuyển nhánh trong cùng thư mục.** Lý do y hệt
  ledger của plan kiểm kê: repo đã cài `node_modules` (534 package); worktree mới
  phải cài lại, chậm, mà plan này chỉ thêm file. Cần cô lập thì nhánh riêng đủ.
  Chi phí nếu sai: không có gì để cô lập vì không sửa file đang chạy.
- Nhánh: `feat/provider-layer`, mọc từ `fe5a0c0`. **Không implement trên `main`** —
  `executing-plans` yêu cầu cô lập, và `main` đang ahead `origin/main` 5 commit
  nên càng không nên trộn.
- `sdd-workspace` là shell script, máy không có bash (đã ghi ở ledger plan trước).
  Tạo thủ công đúng đường dẫn skill quy định.
- Tiền đề đã kiểm chứng trước khi bắt đầu (không dựa vào lời plan):
  - Task 4 bóc 9 hằng/hàm theo **tên** — đã grep xác nhận cả 9 tồn tại trong
    `app/api/chat/route.ts`: `redact`:228, `rawMessageOf`:232,
    `sanitizeErrorMessage`:239, `getStatusCode`:244,
    `normalizeGatewayStreamError`:278, `NETWORK_FAILURE_RE`:364,
    `GATEWAY_WRAPPED_ERROR_RE`:368, `UpstreamDiagnosis`:370,
    `diagnoseUpstreamError`:383.
  - `UpstreamScope` ở `@/lib/api-keys:1`, và file đó **không có dòng `import`
    nào** (grep `^import` → 0 kết quả) nên thuần, chạy được trên Node.
  - `createOpenAI({` có **hai** chỗ ở `route.ts:1709` và `:1718` — khớp plan.
  - `@ai-sdk/anthropic` **không** xuất hiện trong `route.ts`, khớp spec §3.

## Pre-flight: xung đột giữa các task

| Task tiêu thụ | Task sản xuất | Cần dùng | Tìm thấy |
|---|---|---|---|
| 2 | 1 | `ProviderRuntimeConfig` | Khớp chữ ký |
| 3 | 1 | `ProviderRuntimeConfig` | Khớp chữ ký |
| 2 | 1 | `tests/provider-adapter.test.ts` | **Cùng file test.** Plan đã ghi "Modify" nên đúng, nhưng phải chạy lại test của Task 1 mỗi lần thêm, nếu không sẽ hỏng mà không ai thấy. |
| 3 | — | `CORE_ENTRIES` + `build-inventory.ts` | **MỚI so với lúc plan viết.** Plan 2026-10-18 có trước phần việc phụ thuộc xuyên (commit `0a5dc74`). Nay `CORE_ENTRIES` được canh bằng GUỐ: không file lõi nào được kéo trình duyệt vào. File provider mới không chạm API trình duyệt nên phải xanh; nếu đỏ thì đó là phát hiện thật, không phải nhiễu. |
| 3 | — | `tests/cli-migration-scan.test.ts` | **MỚI.** Hai test bảng-stale sẽ đỏ nếu quên chạy lại generator. Phải chạy `node scripts/cli-migration/build-inventory.ts` **trước** khi chạy lại test. |

## Nợ kéo vào từ trước (đã trả, không làm lại)

- `next build` với `allowImportingTsExtensions` → exit 0 (M3).
- Mutation `eval('require')` của spill → 2 test đỏ, mutation chứng minh hợp lệ.
- Bảng kiểm kê: 17 file kéo trình duyệt vào qua phụ thuộc xuyên; **0 file nào
  nằm trong đồ thị lõi**. Lõi CLI hiện sạch Dexie.

## Ruling chung

- **Ruling: bỏ qua `scripts/task-start`** — nó là shell script, máy không có bash
  (ledger của plan kiểm kê đã ghi đúng điều này). Đọc thẳng brief trong plan.
  Chi phí nếu sai: không có; brief nằm ngay trong file plan.
- **Ruling: không chạy `scripts/task-done`** — cùng lý do. Ghi dòng hoàn tất task
  bằng tay theo đúng định dạng skill quy định.

## Task 1: complete (tests: npx vitest run tests/provider-adapter.test.ts → 2 passed)

- **RED:** `Cannot find package '@/lib/provider/adapter'` — đúng như plan dự đoán.
- **GREEN:** 2/2. typecheck sạch.
- **Mutation:** `resolveAdapterKind` trả luôn `'openai-compatible'` → 1 test đỏ
  (`anthropic đi nhánh native`). Đúng như plan dự đoán.
- Commit `f5d6bf4`.

## Task 2: complete (tests: npx vitest run tests/provider-adapter.test.ts → 3 passed)

- **RED:** `Cannot find package '@/lib/provider/openai-adapter'`.
- **GREEN:** 3/3. Mutation bỏ `apiKey` khỏi `createOpenAI` → **1 test đỏ**, đúng
  test canh header `Authorization`. Đúng như plan dự đoán.
- Commit `df894ff`.

### Task 2: Ruling: test dùng `generateText` chứ không phải `streamText`

- **Plan viết** `streamText`, **tôi làm** `generateText`.
- **Lý do:** test chỉ cần chứng minh base URL + API key thật sự đi ra HTTP. Cả hai
  đều đi qua cùng tầng HTTP của AI SDK. `streamText` bắt server giả phải phát
  SSE — nhiều code hơn, và lỗi hỏng sẽ nằm ở tầng SSE chứ không phải ở adapter,
  tức khi đỏ thì không chỉ ra được nguyên nhân. `generateText` chỉ cần một JSON
  `{ id, object, created, model, choices, usage }`.
- **Chi phí nếu sai:** nếu `streamText` và `generateText` khác nhau ở chỗ nào đó
  về base URL/header thì test này bỏ sót. Hiện chưa có bằng chứng nào là khác —
  cả hai đều gọi `POST {baseURL}/chat/completions` với cùng header. Task sau khi
  bóc vòng `streamText` ra khỏi `route.ts` sẽ có cơ hội kiểm lại.

### Phát hiện ngoài phạm vi plan: flaky thứ 4 chưa được ghi

Full suite lộ `tests/redteam-picker.test.ts > perf … dưới 500ms` đỏ khi chạy song
song, **13/13 xanh khi chạy riêng**. Đây là test ngân sách thời gian, cùng loại với
`secret-registry`, nhưng AGENTS.md §1 chỉ liệt kê 3 test flaky. Tức danh sách đó
**thiếu một mục** — cần chủ repo bổ sung, tôi không tự sửa file quy ước.

## Task 3: complete (tests: npx vitest run tests/provider-adapter.test.ts → 4 passed)

- **Cài dependency:** `npm install @ai-sdk/anthropic@1.2.12` → exit 0, `added 1
  package`, **không có xung đột peer** (plan yêu cầu dừng nếu có — không xảy ra).
  `package.json` ghim `"@ai-sdk/anthropic": "1.2.12"`.
- **RED:** `Cannot find package '@/lib/provider/anthropic-adapter'`.
- **GREEN:** 4/4.
- **CORE_ENTRIES + sinh lại bảng:** đồ thị lõi **36 → 39**. 30/30 test kiểm kê
  xanh, gồm GUỐ (không file lõi nào kéo trình duyệt vào) và hai test chống bảng
  stale.
- **Mutation:** xoá `lib/provider/anthropic-adapter.ts` khỏi `CORE_ENTRIES` →
  đồ thị **39 → 38**. `CORE_ENTRIES` thật sự ảnh hưởng bảng.

### Task 3: Ruling — base URL của test Anthropic phải có `/v1` (PLAN SAI)

- **Plan viết** `baseUrl: http://<port>` và kỳ vọng path kết thúc `/v1/messages`.
- **Thực tế:** path là `/messages` → test đỏ **vì plan sai, không phải vì code sai**.
- **Kiểm chứng bằng mã nguồn SDK, không suy đoán:**
  `@ai-sdk/anthropic` mặc định `"https://api.anthropic.com/v1"`,
  `@ai-sdk/openai` mặc định `"https://api.openai.com/v1"`. Cả hai chỉ nối phần
  endpoint, nên `baseURL` phải **tự chứa `/v1`**.
- **Quyết định:** sửa test dùng `baseUrl: http://<port>/v1`.
- **Chi phí nếu sai:** nếu SDK nào đó tự thêm `/v1`, test sẽ đỏ khi lên production
  và bắt phải sửa — tức lỗi bị phát hiện, không lọt. Hướng này an toàn.

### Task 3: Ruling — suýt xoá nhầm test của Task 2

Khi thêm describe Anthropic, tôi thay cả khối `describe('resolveOpenAIModel')`
thay vì chèn cạnh. Phát hiện ngay bằng `grep '^describe\('` — file chỉ còn 2
describe thay vì 3. Đã trả lại trước khi chạy test.

- **Chi phí nếu sai nếu không phát hiện:** test OpenAI biến mất mà suite vẫn "xanh",
  và Task 3 xong với 3 test thay vì 4 — đúng loại tự chứng minh mà ledger cảnh báo.
- **Bài học:** sau mỗi sửa file test, đếm lại số `describe`/`it` — không tin rằng
  `edit` chỉ sửa đúng chỗ mình nghĩ.

## Task 4: complete (tests: npx vitest run tests/provider-diagnosis.test.ts → 7 passed)

Module `lib/provider/upstream-diagnosis.ts` chuyển từ `route.ts` các dòng 225-299 và
346-665. `UpstreamScope` **re-export** từ `@/lib/api-keys`, không định nghĩa lại.

### Kiểm chứng bản chuyển: SO KHỚP CƠ HỌC, không chỉ test

7 test hành vi xanh KHÔNG đủ — chúng không soi được lỗi gõ trong regex hay trong
comment. Nên tôi so từng dòng module với vùng tương ứng trong `route.ts`, chỉ bỏ
tiền tố `export ` và dòng trống.

**Phát hiện được: tôi đã làm hỏng ký tự `ướ`** trong một dòng comment
(`...stream 200 dưới dạng [401]...` → `d␦␦␦i dạng`). 7 test không thấy. Sửa bằng
`node` (không qua PowerShell, để không hỏng tiếp lần nữa), rồi so lại:
**376/376 dòng khớp, 0 khác biệt.**

- **Bài học:** với task dạng "chuyển nguyên văn", test hành vi chỉ chứng minh phần
  mình đã nghĩ tới. So khớp cơ học mới chứng minh phần mình **không** nghĩ tới.

### Task 4: Ruling — BỎ Step 4 (trỏ import trong `route.ts`)

- **Plan Step 4** nói đổi import trong `route.ts` sang module mới. **Plan Step 3**
  nói **không xoá code cũ** ở `route.ts`.
- **Hai đó mâu thuẫn:** route.ts đang khai báo `function diagnoseUpstreamError` ở
  cấp module. Import cùng tên từ module mới vào sẽ ra **duplicate identifier** —
  TypeScript không cho phép. Muốn trỏ import thì **bắt buộc phải xoá** khai báo cũ.
- **Quyết định:** làm Step 3 trọn vẹn; **bỏ Step 4**. Lý do: (a) xoá trên file
  153KB là thay đổi lớn nhất của plan này, (b) `hostOf`, `redact`, `DEBUG_ERRORS`
  còn được dùng ở nhiều chỗ khác trong `route.ts` nên phải export thêm ngoài
  `Produces` của plan, (c) plan tự ghi phần dọn dẹp thuộc plan sau.
- **Chi phí nếu sai:** tồn tại **hai bản** logic chẩn đoán trong repo cho tới khi
  plan sau dọn. Đây đúng là dạng "hai nguồn sự thật" mà AGENTS.md §6 cảnh báo —
  nhưng là trạng thái tạm **có chủ đích** mà plan đã định, và git là đường lui.
  Nếu quên dọn thì đó là nợ.

### Task 4: Ruling — 3 kỳ vọng trong plan SAI, test viết theo hành vi thật

Đọc code thật trước khi viết test, thay vì tin `Expected:` của plan:

1. **401 → `stopFailover` là FALSE**, plan viết true. `stopFailover` chỉ được đặt
   true khi `scope === 'request'` hoặc `status === 404`; 401 có scope `key-auth`.
   Semantics đúng: 401 là lỗi key *này* nên vẫn nên thử key khác — `blameKey: true`
   mới là tín hiệu bỏ qua key này.
2. **`[429]: {...}` KHÔNG cho status 429.** `diagnoseUpstreamError` gọi thẳng
   `getStatusCode`, KHÔNG qua `normalizeGatewayStreamError`; regex của hàm đó tìm
   `HTTP NNN`. Định dạng gateway thật là `Upstream returned HTTP 502`.
3. **Review Focus #2 cần test đúng hình dạng**: phải đi qua
   `normalizeGatewayStreamError` trước, mới chứng minh được bước gắn `statusCode`.

- **Chi phí nếu sai:** nếu hành vi thật khác tôi đoán, thì module đã chuyển sai
  logic mà test vẫn xanh. Nhưng so khớp cơ học 376/376 với `route.ts` đã chứng
  minh logic **không đổi** — test chỉ khoá lại điều đó ở tầng hành vi.

### Task 4: Ruling — `export type` KHÔNG tạo binding cục bộ (CHỈ `tsc` bắt được)

Lần chạy full gate đầu tiên của Task 4 cho `typecheck exit=2`:

```
lib/provider/upstream-diagnosis.ts(130,10): error TS2304: Cannot find name 'UpstreamScope'
```

Vì sao: `export type { UpstreamScope } from '@/lib/api-keys'` **re-export** nhưng
không đưa tên vào scope cục bộ, nên `interface UpstreamDiagnosis` không resolve
được. Sửa bằng cách thêm `import type { UpstreamScope }` cạnh bên.

- **Đáng chú ý nhất:** **7/7 test vẫn XANH** khi module không compile. Vitest
  không typecheck, nên "test xanh" hoàn toàn không bảo đảm code biên dịch được.
  Chỉ `npm run typecheck` mới bắt. Đây là bằng chứng cụ thể cho luật của AGENTS.md
  §1: ba gate là **cả ba**, không thể bỏ cái nào.
- **Chi phí nếu bỏ gate typecheck:** module vào repo không biên dịch, và sẽ chỉ lộ
  ra khi ai đó build — ở xa hơn nhiều so với lúc này.
