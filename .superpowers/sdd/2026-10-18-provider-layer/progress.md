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

> **⚠ RULING NÀY ĐÃ BỊ ĐẢO NGƯỢC Ở FIX PASS — xem "Final: fixed — route.ts và
> module là MỘT nguồn".** Lý do (b) ở trên **sai về mặt sự kiện**: reviewer độc lập
> tra lại rồi tôi tự kiểm, và chỉ `hostOf` dùng chỗ khác — `redact` và
> `DEBUG_ERRORS` không dùng ở đâu ngoài khối chẩn đoán. Nên Step 4 **làm được**,
> và giữ nguyên hai bản là tự tạo ra nợ không cần thiết.

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

# Final review — reviewer độc lập: 5 Important, 2 Minor

### Final: Ruling — so khớp của tôi ĐÃ GIẤU MỘT LỖI, reviewer tìm ra

Tôi ghi "376/376 dòng khớp". Reviewer đo lại: **375/376** — module thừa 1 khoảng
trắng trong comment `BAD_PROMPT_HISTORY` (`route.ts:428` có 4 space, module có 5).
Tôi **gọi đó là thẩm mỹ và bỏ qua**. Hoá ra nó là thứ làm phép so chính xác thất
bại, và tôi mất hai vòng debug vì điều đó.

Nguyên nhân gốc: phép so của tôi có `replace(/\s+/g, ' ')` — **tự chuẩn hoá
khoảng trắng**, tức **có thể giấu đúng loại lỗi mà tôi đi tìm**. Đây là task chuyển
văn bản, nên khoảng trắng chính là thứ phải so.

- **Sửa:** bỏ một khoảng trắng trong module; so lại → 376/376 thật.
- **Chi phí nếu sai:** trước khi sửa, `upstream-diagnosis.ts` lệch `route.ts` ở một
  ký tự — vô hại về hành vi nhưng **phá đúng cái bảo đảm mà tôi dựa vào để xoá bản
  gốc**. Đã sửa trước khi xoá nên không có hồi quy.

> **Bài học: cơ chế kiểm mà chuẩn hoá đầu vào thì không kiểm được chính thứ nó
> nên bắt.** Đây là lần thứ ba trong phiên tôi tự làm nhoè bằng chứng của chính
> mình (hai lần trước: `Select-String` với tiếng Việt, `Select-Object -Last` cắt
> mất đúng khối cần đọc).

Phép so đó giờ **hết ý nghĩa** — bản gốc đã bị xoá khỏi `route.ts` nên không còn
gì để so. Bảo đảm thay thế là: so khớp chạy xanh **trước** khi xoá, cộng 2 test
guard chặn tái tạo, cộng full suite.

# Final: Ruling — Finding 4 (`toolChoice: 'none'`) và Finding 5 (`fetch`) là NỢ THIẾT KẾ, không sửa

Reviewer tự dựng script kiểm, không tin ledger. Nó **bác bỏ một ruling của tôi** và
đúng. Fix pass dưới đây là một lượt, theo yêu cầu của skill.

### Final: fixed — route.ts và module là MỘT nguồn (Finding 1)

Tác giả đã bảo Step 3 và Step 4 của plan mâu thuẫn, nên bỏ Step 4. Reviewer nói
lý do của tôi sai, và **tôi tự kiểm thì reviewer đúng**: chỉ `hostOf` dùng chỗ
khác; `redact` và `DEBUG_ERRORS` không dùng ở đâu ngoài khối chẩn đoán. Lý do tôi
viết trong ledger ("cần export thêm ngoài Produces của plan") **sai về mặt sự
kiện**.

- `hostOf` **giữ lại** trong `route.ts` (dùng ở 3 chỗ ngoài khối chẩn đoán).
- Xoá khối trùng + banner, thêm một lệnh import. `route.ts` **2888 → 2367 dòng**.
- Thêm 2 test guard chặn tái tạo bản sao.
- **Chi phí nếu sai:** review toàn nhánh sẽ phải chạy lại.

### Final: fixed — Focus #3 `blameKey` ở 403 (Finding 2)

Reviewer mutation thật, cả hai chiều đều **hở** trước đây. Nay có test cho ba ca:
403 body rỗng (model bị chặn, không phạt key) · 403 body thường (lỗi key, phải
phạt) · 403 có dấu Cloudflare (WAF, đổi key vô ích).

### Final: fixed — Focus #2 phần còn lại (Finding 3)

Thêm test cho ranh giới NETWORK vs MODEL_REJECTED (dạng `[401]: {...}`, model từ
chối vì lý do logic, lỗi mạng thật) và test bí mật thật được che.

### Final: fixed — guard 429 chết theo vị trí file (phát hiện của tôi trong lúc fix)

`tests/chat-rate-limit-buckets.test.ts` grep văn bản `route.ts` để canh "còn xử lý
429 từ provider"; tầng chẩn đoán chuyển đi nên chuỗi không còn trong `route.ts` →
ĐỎ. **Không xoá assert** (xoá là mất đúng cái guard đó sinh ra để bảo vệ) — đổi
sang đọc module mới, giữ nguyên ý nghĩa. Mutation đổi tên mã lỗi 429 → đỏ.

### Bốn mutation của fix pass — tất cả đều bị bắt

| Mutation | Kết quả |
|---|---|
| 403 body rỗng: `blameKey false→true` | đỏ |
| 403 có body: `blameKey = !cloudflare → false` | đỏ |
| `NETWORK_FAILURE_RE.test(...) → if (true)` | đỏ (2 test) |
| `UPSTREAM_RATE_LIMIT_429` bị đổi tên | đỏ (2 test) |

Ba cái đầu **là đúng những mutation reviewer chứng minh test cũ hở**.

### Final: Ruling — Finding 4 (`toolChoice: 'none'`) và Finding 5 (`fetch`) là NỢ THIẾT KẾ, không sửa

Reviewer nói đúng cả hai: **interface hiện tại không biểu đạt được** chúng.
`toolChoice` là tham số mỗi lần gọi `streamText`/`generateText`, không phải của
adapter; `fetch: nonStreamingFetch` thì `resolveOpenAIModel` chưa có đường truyền.
Không có hồi quy người dùng hôm nay (`route.ts` chưa từng set `toolChoice`).

- **Chi phí nếu sai:** plan sau đổi `route.ts` sang adapter sẽ mất override
  `nonStreamingFetch` ở đường emulated → hỏng đúng lỗi comment `route.ts:1713-1717`
  đã cảnh báo. Plan sau **phải** mở rộng `ProviderRuntimeConfig` trước.
- Cũng lưu ý: Review Focus #4 của plan và spec §7 là **hai cơ chế khác nhau**
  (`toolChoice: 'none'` vs `emulated-agent`); spec §7 mới là thứ repo có.

### Deferred minors

- **Focus #5 hiện đúng nhưng chỉ có comment giữ.** Không gì đỏ nếu ai đó thêm
  `import { resolveAnthropicModel }` vào `adapter.ts`. Repo đã có sẵn
  `runtimeImportSpecs()` quét AST — guard ~10 dòng là đủ. Theo luật của skill,
  minor không vào fix pass.
- **Test Focus #1 chứng minh ít hơn tên gọi**: nó canh "một nhánh không lặp lại
  nhãn", không phải "bí mật được che" (phần này nay đã có test riêng ở trên).

# Lượt 2 (2026-10-18) — trả các nợ còn lại. Commit `b677f66`.

Cả 4 nợ đều làm theo TDD: viết test đỏ trước, xanh, rồi mutation để chứng minh
test không rỗng.

## Nợ 1 — `fetch` không truyền được qua adapter (NỢ THẬT)

- **Bằng chứng nợ có thật:** `app/api/chat/route.ts:1334-1338` tạo instance OpenAI
  **thứ hai** kèm `fetch: nonStreamingFetch` cho đường `generateText`. Không có
  đường truyền này thì đổi `route.ts` sang adapter là mất instance đó →
  `generateText` gặp gateway trả SSE sẽ ném *"Invalid JSON response"*, đúng lỗi
  khiến `/api/compact` trước đây luôn fail (ghi rõ trong
  `lib/non-streaming-fetch.ts`).
- **RED:** cả hai test đỏ với `expected +0 to be 1`.
- **GREEN:** thêm `fetch?: typeof globalThis.fetch` vào `ProviderRuntimeConfig`,
  truyền vào **cả hai** adapter — chỉ thêm ở một bên sẽ tạo adapter không đối
  xứng, đúng dạng "hai chỗ rồi sẽ lệch" AGENTS.md §6 cảnh báo.
- **Mutation:** bỏ `fetch: cfg.fetch` khỏi từng adapter → **mỗi lần đúng 1 test đỏ
  ứng với adapter đó**.

## Nợ 2 — Focus #5 trước đây chỉ có comment giữ (bây giờ có test)

- Dùng `runtimeImportSpecs()` của máy quét kiểm kê thay vì regex: nó đã loại
  `import type`, nên `import type { X } from './anthropic-adapter'` vẫn hợp lệ
  (không sinh mã chạy). Có test riêng khoá đúng điều đó — không có nó thì guard
  sẽ đỏ và người sau sẽ xoá luôn `import type` hợp lệ.
- **Mutation:** thêm `import { resolveAnthropicModel } from './anthropic-adapter'`
  vào `adapter.ts` → đỏ.

## Nợ 3 — test tên nói quá hơn điều nó chứng minh

- Test cũ tên *"userMessage không chứa API key"* nhưng truyền `statusError(500)`,
  mà nhánh 500 **không nội suy `keyLabel`** vào `userMessage` → `not.toContain`
  xanh vì **không có đường để rò**. Thay bằng hai test đúng nghĩa:
  (a) bí mật trong body upstream bị che ở **cả hai** chuỗi, (b) `devLog` mang dấu
  vết vận hành mà `userMessage` không mang.
- **Mutation:** `redact` → `return text` → **2 test đỏ**; bỏ `requestId` khỏi
  `devLog` → **1 test đỏ**.

## Nợ 4 — `toolChoice` không phải nợ build; đóng bằng test chứ không bằng comment

- **Đo:** `route.ts` có **0** lần set `toolChoice`. Cơ chế thật là
  `lib/emulated-agent.ts` (render schema tool thành TEXT trong system prompt rồi
  parse), đúng như spec §7. Nên Review Focus #4 của plan mô tả cơ chế repo
  **không dùng và chưa từng dùng**.
- `toolChoice` là tham số của *mỗi lần gọi* `streamText`/`generateText`, không
  phải thuộc tính adapter. Thêm vào `ProviderRuntimeConfig` sẽ tạo một lựa chọn
  giả — trông như đã xử lý, nhưng không ai dùng tới.
- **Guard:** đọc AST (`PropertySignature` tên `toolChoice`) chứ không regex —
  regex sẽ khớp cả comment. **Mutation:** khai `toolChoice?: 'auto' | 'none'` vào
  interface → đỏ.

### Bài học: regex khớp rộng hơn ý nghĩa — lần thứ 2 trong phiên

Bản regex đầu tiên của guard trên (`/\btoolChoice\b/`) khớp **chính comment của
tôi** trong `adapter.ts` và đỏ với `found` rỗng. Đúng loại lỗi AGENTS.md §2 mô tả.
Sửa bằng cách đọc AST.

## Nợ 5 — `next-env.d.ts` bị `next build` tự ghi lại

- **Đo trước khi làm:** bỏ file đi rồi chạy `tsc --noEmit` → **exit 0**, dù file
  nằm trong `include` của `tsconfig.json`. Nó không mang gánh gì cho typecheck;
  chỉ gây bẩn cây sau mỗi lần build (Next đổi giữa `.next/types/` và
  `.next/dev/types/` theo lệnh vừa chạy).
- **Cách trả:** thêm vào `.gitignore` + `git rm --cached`. Next.js khuyến nghị
  không track file này.
- **Chi phí nếu sai:** clone mới sẽ không có file tới lúc `next dev`/`next build`
  tự sinh — mà `next build` tự sinh, nên không ảnh hưởng. Hoàn tác bằng
  `git rm --cached` ngược lại + bỏ dòng trong `.gitignore`.

## Nợ 6 — flaky test chưa ghi đủ trong AGENTS.md §1, và tôi viết sai

- Thêm `tests/redteam-picker.test.ts` vào bảng (đo trước: có **hai** ngân sách
  thời gian — 200ms ở dòng 121, 500ms ở dòng 154).
- **Rồi phát hiện dòng `secret-registry` đang ghi sai:** "Chạy riêng thì xanh".
  Đo lại: **3/5 lần chạy đơn lẻ vẫn đỏ** (1, 1, 2 test đỏ). Nguyên nhân gốc là
  tôi **tin lời tôi đã nói trước đó** thay vì đo. Đã sửa, kèm ghi chú rằng "chạy
  riêng" **không** phải tiêu chuẩn phân biệt ở file này.
- Đo cả hai file cùng chuẩn: `redteam-picker` 5/5 xanh khi chạy riêng;
  `secret-registry` 3/5 đỏ. Không để một dòng theo chuẩn này, dòng kia theo
  chuẩn khác.

# SỬA LỖI SỐ LIỆU CỦA CHÍNH TÔI: "17 file chưa gán FORCE_LABEL" — SAI

Tôi báo nợ này suốt phiên. Kiểm lại thì:

- `FORCE_LABEL` là bản **ghi đè nhãn máy**, chỉ có **3** mục, đều `THAY-THE`
  (`lib/db.ts`, `lib/fs-access.ts`, `lib/tool-permissions.ts`). 106/109 file `.ts`
  trong `lib/` không có mục — đó là **bình thường**, máy tự gán nhãn cho chúng.
- Con số **17** là nhóm file **kéo trình duyệt vào qua phụ thuộc xuyên** (mục
  "Kéo trình duyệt vào qua phụ thuộc xuyên" trong `docs/cli-migration-inventory.md`).
- Trong 17 đó, 1 file (`lib/tool-permissions.ts`) **đã có** nhãn → **còn 16 chưa
  phân loại**, không phải 17.

- **Chi phí của việc tôi sai này:** nếu ai đó mở `ly-do.ts` tìm "17 mục thiếu"
  sẽ không thấy, và tưởng tôi đã bỏ sót. Tệ hơn, có thể tô thêm mục bừa cho 17
  file để "cho khớp con số" — đúng cách làm hỏng bảng kiểm kê.
- **Nguyên nhân:** tôi lấy con số "17 file kéo trình duyệt vào" từ ghi chú phiên
  trước rồi **gán nghĩa khác** cho nó, không kiểm lại. Đây là lần thứ tư trong
  phiên tôi "tin bằng chứng cũ thay vì đo" (ba lần trước: `Select-String` với
  tiếng Việt, `Select-Object -Last` cắt mất khối, và so khớp chuẩn hoá whitespace).

## 16 file còn nợ phán đoán của người

Đây là nợ **duy nhất** còn lại mà tôi không tự quyết được — mỗi file đều cần câu
hỏi "lõi CLI còn cần chức năng này không", mà câu trả lời nằm ở ý định sản
phẩm chứ không nằm trong mã.

# Lượt 3 (2026-10-18) — task A. SPEC §5 SAI, và đo trước khi viết đã cứu nó.

## Phát hiện lớn nhất: KHÔNG viết `lib/tools/fs-node.ts`

Spec §5 ghi `lib/tools/fs-node.ts` **MỚI — đọc/ghi file qua node:fs**. Đo trước
khi viết cho thấy điều đó **sai**: `lib/ipc.cjs` đã có sẵn toàn bộ backend, và
đã qua sử dụng thật trên desktop.

Có sẵn: đọc/ghi/liệt kê/tìm kiếm/xoá/thống kê file (có trần byte) · `path-guard.cjs`
chặn đường dẫn ra ngoài workspace + đường dẫn hệ thống · **chống TOCTOU** bằng
sha256 nội dung · `shell-policy.cjs` · `bg-jobs.cjs` · `approval-binding.cjs` ·
git (5 channel) · skills (2) · memory (2) · secure-store (4) · audit log.

**31 channel, phủ hết các nhóm tool.** Viết `fs-node.ts` là tạo **bản thứ hai**
không có path-guard và không có chống TOCTOU — tức **kém an toàn hơn**. Đúng cái
AGENTS.md §6 gọi là chắt vá.

- **Cách làm thay thế:** `register(ipcMain, opts)` của `ipc.cjs` chỉ cần một object
  có `handle(channel, fn)`. Truyền `ipcMain` giả gom handler vào Map rồi gọi
  thẳng. JSDoc ngay trên `register()` đã ghi kỹ thuật này dành cho test.
- **Kết quả:** `lib/tools/ipc-node.ts` — lớp cầu, **không viết backend nào mới**.
- **Chi phí nếu tôi bỏ qua việc đo và viết theo spec:** một bản fs mới không có
  path-guard, không có chống TOCTOU, và không ai hỏi vì "spec bảo vậy".

## Ba chỗ tôi sai khi kiểm chứng phạm vi

1. **"15 tool" — thật là 19.** Tôi đếm từ `TOOL_CATEGORY_MAP` nhưng bỏ sót nhóm
   Sarsed (`code_skeleton`, `code_symbols`, `code_verify`, `code_patch`).
2. **"Có test chặn thiếu mục" — tôi khẳng định từ *comment*, không mở test ra.**
   Mở ra thì đúng: `tests/tool-catalog.test.ts:131`.
3. **Script đo đầu tiên lấy `Object.keys()` trên `TOOL_CATALOG` — đó là MẢNG**, ra
   36 chỉ số thay vì 36 tên. Đo lại: phủ 36/36, 0 thiếu, 0 thừa.

Và lúc chạy thử, `register()` trả `{}` suốt ba lần — nguyên nhân là tôi gọi
handler với **một** tham số trong khi Electron truyền **hai** `(event, payload)`.
Không phép đo nào bắt được; chỉ đọc mã `handler()` mới thấy.

## Cổng duyệt tool

spec §7: tool nguy hiểm phải hỏi trước — "thứ người dùng tin CLI nhất". Ở web việc
này do UI đảm nhiệm; CLI không có UI nên cổng phải ở tầng tool.

- `NEEDS_APPROVAL` = `fs_write`, `shell_run`, `bg_run`, `bg_stop`.
- **Cố ý KHÔNG suy ra danh sách này từ nhóm quyền.** Lấy từ `TOOL_CATEGORY_MAP` sẽ
  kéo `git_add`/`git_commit` vào — tức hỏi cả thao tác git vốn đã được cho phép, và
  làm biến "duyệt" thành thói quen bấm `có` mà không đọc.
- Cổng là **tham số truyền vào**, không import Dexie → module không phụ thuộc
  `db.ts`, tức xây được trước cả khi thay `db.ts`.
- Từ chối thì **ném**, không trả giá trị rỗng — trả rỗng thì model coi tool chạy
  xong và đi tiếp, tức lệnh bị từ chối mà vẫn tiếp tục.

## Test bắt được lỗi của chính tác giả

`fs_stat` có channel thật (`vyen:fs-stat`) nên tôi đưa vào bảng ánh xạ. Test đỏ:
`tool ngoài catalog: fs_stat`. `fs_stat` không có trong `TOOL_CATALOG`, tức tôi đã
**phát minh một tool ngoài catalog** — đúng lối thoát khỏi chính sách quyền mà
test sinh ra để chặn. Kênh đó vẫn dùng được nội bộ qua `host.call()`.

## NỢ CHƯA TRẢ — `fs_edit` chưa có

`NEEDS_APPROVAL` **không** gồm `fs_edit`, và đó là thiếu sót có chủ đích chứ không
phải quên: `ipc.cjs` **không có** channel `vyen:fs-edit`. `fs_edit` nhận khối
`<<<<<<< SEARCH … ======= … >>>>>>> REPLACE` rồi phải áp vào nội dung file trước
khi gọi `fs-write`. Việc đó chưa làm. **Không ai được tưởng là `fs_edit` đã xong.**

- **Chi phí nếu bỏ sót:** model thấy mô tả `fs_edit` trong prompt nhưng gọi lên thì
  không có channel → lỗi khó hiểu. Hoặc tệ hơn: ai đó thêm nó vào map sau này mà
  không nghĩ tới chuyện duyệt.

# Lượt 4 (2026-10-18) — review độc lập. Reviewer bác 5 phát hiện của tôi.

## Bốn lỗi nghiêm trọng, tôi tự tái lập trước khi sửa

| | Reviewer nói | Tôi đo được |
|---|---|---|
| **C2** | workspaceRoot sai → lùi im lặng về phiên trước | ✅ **xác nhận** — `/typo/...` lùi về `C:\Users\Admin` |
| **C3** `start_line` | zod strip → model đọc lại chunk cũ, lặp tới hết token | ✅ **xác nhận** — dòng 10, nhận `d1` |
| **C3** `git_add` | `paths` ≠ `relPaths` | ✅ **xác nhận** |
| **C3** `shell_run` | luôn `approval_required` | ✅ **xác nhận** |
| **C1** | "path-guard biến thành vô hiệu" | ⚠ **CHƯA ĐÚNG NHƯ MÔ TẢ** — với root = home thì `C:\Windows\win.ini` **vẫn bị chặn**. Lỗi thật chỉ là `workspaceBlockReason` **không chạy** trên đường `workspaceOverride`, nên root gốc ổ đĩa lọt vào |

- **Sửa C1**: export `workspaceBlockReason` từ `ipc.cjs` rồi dùng lại — **không** viết
  lại blocklist (hai nguồn sự thật).
- **Sửa C3**: bảng `ARG_RENAMES` đầy đủ + `applyReadWindow` cắt cửa sổ dòng và
  trần 24.000 ký tự, vì `FsReadPayload` của `ipc.cjs` chỉ có `relPath` — phần phân
  trang thuộc tầng client ở bản web.

## Lỗi tinh vi nhất: HAI INSTANCE CỦA CÙNG MỘT MODULE

`shell_run` sửa xong vẫn chết với `approval_unknown`. Nguyên nhân: token nằm trong
`Map` cấp module, mà `import` đi qua tầng chuyển đổi của bundler còn `require` của
`ipc.cjs` đi qua loader CJS của Node — **hai instance, hai Map tách rời**.

Đo thật: mint bằng `import` → consume bằng `require` = `approval_unknown`; mint bằng
`require` → consume bằng `require` = `ok`.

- **Sửa**: `createRequire` neo tại chính `ipc.cjs`.
- **Nếu không sửa**: cổng duyệt báo *"đã duyệt"* trong khi lệnh vẫn không chạy —
  kiểu lỗi khó đoán nhất có thể.

## I2 — cổng mặc định từ chối, và đường thô KHÔNG lộ ra ngoài

`host.call` chặn mặc định mọi channel nguy hiểm. `buildIpcTools` cần gọi thẳng sau
khi duyệt, nên nó lấy đường thô qua `WeakMap` **trong cùng module** — không expose
lên object, vì nếu để thành method thì mọi tầng sau cầm `host` đều lách được và
cổng chỉ còn là hình thức.

## Ba test rỗng — phần tệ hơn lỗi chức năng

- `expect(Array.isArray(lines))` — luôn đúng vì `lines` là `[]`. Nay đòi **có dòng
  audit thật**.
- Test tên *"thiếu hash thì ipc.cjs phải chặn"* nhưng thân lại khẳng định **không**
  chặn. Tên ngược thân là bẫy cho người sau; đã đổi tên và đổi thân.
- Test cũ gọi thẳng `host.call('vyen:fs-write')` — sau I2 thì đúng là phải mở
  `allowChannel`. Không phải test sai, mà **hợp đồng đã đổi**.

## 5 mutation, 5 lần bị bắt

C1 bỏ blocklist → 2 đỏ · C2 bỏ kiểm tra tồn tại → 1 đỏ · C3 bỏ cửa sổ dòng → 2 đỏ
· I3 bỏ git khỏi cổng duyệt → 1 đỏ · I2 vô hiệu cổng mặc định → 1 đỏ.

# Lượt 5 (2026-10-18) — CLI thành agent: vòng lặp tool + trả hết 3 nợ

## Tôi tự ghi nợ sai một lần, và phải sửa bằng đo chứ không bằng lời

Lượt 4 tôi ghi: *"chống TOCTOU không thể tự bật khi chưa có `lib/session/`"*. **Sai.**
Làm được ngay bằng hash trong RAM theo host. Nguyên nhân: tôi lười tìm cách nên biến
thành "cần sau" — đúng cách biến nợ thành lý do.

Giới hạn thật của cách làm này (đã ghi trong mã, không giấu): hết phiên là mất hash,
nên chỉ bắt được việc file đổi **giữa hai lệnh cùng phiên**.

## Ba nợ đã trả

| Nợ | Cách trả | Mutation |
|---|---|---|
| `fs_edit` chưa làm | nối `parseEditBlocks` + `replaceMostSimilarChunk` có sẵn ở `lib/edit-blocks.ts` | bỏ khỏi cổng duyệt → đỏ · bỏ lỗi khi khối không khớp → 2 đỏ |
| TOCTOU không tự bật | `fs_read` nhớ sha256 toàn file; ghi đè file đã đọc thì tự gửi `hasDiff` + `expectedBaseHash` | bỏ `hasDiff` → đỏ |
| `audit` là hàm rỗng | mặc định ghi **append** vào `<userDataDir>/vyen-audit.log` | về hàm rỗng → đỏ |

### Hai thứ đọc mã web mới biết — ghi vào comment để không ai "tối ưu" hỏng

1. **`fs_edit` ghi đè TOÀN BỘ file**, nên phải đọc **full file** chứ không cắt 24.000
   ký tự như `fs_read`. Đọc bản cắt sẽ **mất đuôi file**. Bản web ghi chú đúng việc này
   ở `use-chat-orchestration.ts:1859+`.
2. **`parseEditBlocks` BẮT BUỘC dòng tên file** trên `<<<<<<< SEARCH`, nhưng mô tả tool
   `fs_edit` trong `agent-tools.ts` **không hề nhắc**. Tôi xử ở lớp cầu (thử parse thẳng;
   chỉ khi parser báo thiếu tên file mới thử lại với `path` đứng đầu). **Không** đụng
   parser, vì bản web đang dùng đúng như nó là.

## Vòng lặp tool — chỗ dễ hỏng nhất, và tôi đã đo thay vì tin

`maxSteps` là chỗ biến CLI từ "trả lời" thành "làm việc". Không có nó thì `streamText`
trả về sau **một** lượt và tool call bị bỏ qua **âm thầm**: không lỗi, không cảnh báo.

Test bằng **model giả** (`LanguageModelV1` trả kịch bản stream định sẵn), không cần key
và không cần mạng — nên test phụ thuộc code chứ không phụ thuộc hạ tầng.

### Ba lỗi tôi chỉ phát hiện vì test, không phải vì đọc code

1. **`text-delta` dùng tên `textDelta`, không phải `text`.** Dùng `text` thì text-delta
   rơi vào im lặng và kết quả là **CÂU RỐNG dù model đã trả lời** — tức báo thành công
   sai. Mutation: đổi tên → 2 đỏ.
2. **`ai@4` KHÔNG có part `tool-error`.** Để `execute` ném thì lỗi nổi lên và cả lượt
   chết. Sửa: bọc mọi tool trong `wrapTools` để lỗi thành **kết quả** `{ok:false,error}`
   — model đọc được lỗi và tự thử cách khác. Mutation: bỏ bắt → 1 đỏ.
3. **`onError` bắt lỗi KHÔNG đồng nghĩa stream reject.** Đo mã `ai@4`
   (`index.mjs` L5381-5390): `onError` chạy khi stream chạm qua part `{type:'error'}`,
   và part đó **vẫn được enqueue** ngay dòng trên → stream **kết thúc bình thường**.
   Nghĩa là provider báo lỗi giữa chừng thì vòng lặp chạy trót, `text` rỗng, CLI in
   câu rỗng rồi exit 0. **Đây là chỗ dòng `if (streamError) throw streamError;` bảo
   vệ.** Mutation đầu tiên của tôi **KHÔNG bị bắt** — vì stub của tôi dùng `ctrl.error()`
   (làm stream reject) chứ không phát part `error`. Phải viết thêm 2 test đúng cái
   chỗ đó, rồi mutation mới đỏ 2 test.

### 5 mutation của vòng lặp — 5 lần bị bắt

`maxSteps = 1` → 2 đỏ · `textDelta` → `text` → 2 đỏ · bỏ bắt lỗi tool → 1 đỏ ·
bỏ `throw streamError` → 2 đỏ · bỏ `onToolCall` → 1 đỏ.

### Cổng duyệt console — một mutation phải làm lại

Cổng duyệt nằm giữa "model muốn ghi file" và "file bị ghi", nên test rỗng ở đây tệ
hơn chỗ khác. Bỏ `fs_edit` khỏi cổng, không hiện nội dung, hỏi vô hạn, mọi câu trả
lời thành "có" → đều bị bắt. **Một mutation không bị bắt lần đầu**: bỏ
`redactSecretText` trong `brief()` vẫn xanh — vì còn **hai** lớp redact. Bỏ **cả
hai** thì đỏ. Test không rỗng, nhưng có lớp dư.

## Đo bằng CLI thật (key sai, không cần mạng)

| Tình huống | Kết quả |
|---|---|
| workspace hợp lệ | `> cong cu: 14` dựng lên, rồi 401 → `UPSTREAM_AUTH_401 (key-auth)`, exit 1 |
| workspace không tồn tại | `KHONG bat cong cu`, in lý do, **vẫn chat được** |
| workspace = home | bị chặn, in lý do rõ (root quá rộng làm vô hiệu path-guard) |
| workspace = thư mục con của home | **cho qua** — đúng, đó là thư mục dự án cụ thể |

## Còn lại

- **Lịch sử hội thoại / REPL** — xem lượt 6, đã xong.

# Lượt 6 (2026-10-19) — REPL + nhớ hội thoại qua các lần chạy

Chủ repo nói rõ: *"chạy CLI lên là chạy một tiến trình như claude code, xong mình cứ
làm việc trong cái conversation đó"*, và *"như opencode thì đóng terminal rồi mở lại
vẫn lưu cái cuộc hội thoại cũ"*.

## Đo trước: 15/17 file "kéo trình duyệt vào" đi qua ĐÚNG một cửa

Tôi báo "16 file cần phán đoán" như thể đó 16 câu hỏi. Đo đường đi bằng BFS trên
đồ thị import: **15/17 đi qua `lib/db.ts`** (Dexie), 2 file đi qua chỗ khác
(`fs-access.ts`, `chat-broadcast.ts`). Mà `db.ts` đã có nhãn `THAY-THE` sẵn trong
bảng kiểm kê. Nên đây là **một** nợ, không phải mười sáu.

Lỗi lặp lại của tôi: đo đầu truyền sai tham số `browserBoundIn`, ra **0** file.
Số 0 trông hợp lý nên dễ tin — và tin là bảng kiểm kê sai hoàn toàn.

## Ba thứ lấy từ mã người khác, kèm bằng chứng

1. **opencode** (`packages/core/src/session/sql.ts`): message lưu là **JSON mù**
   (`data: text({mode:'json'})` + `seq`), KHÔNG dựng cột cho từng trường → thêm kiểu
   message mới không phải migration. Session gắn với **thư mục** (cột `directory`).
2. **Claude Code CHANGELOG 2.1.300**: *"the first transcript entry written after
   resuming a session being lost when a crash had cut the transcript's last line
   short"*. Đây không phải lo ngại giả định.
3. **Tôi tái hiện đúng lỗi đó.** Bỏ dòng hỏng trong RAM nhưng **không cắt file** →
   lần `append` sau nối liền vào dòng hỏng → mất luôn bản ghi vừa ghi. Test bắt
   được (mutation "bỏ `catFile`" → 1 đỏ).

**Không lấy SQLite** của opencode: sẽ kéo `better-sqlite3` (native dep) hoặc
`node:sqlite` (Node ≥ 24). Với transcript tuyến tính của một người, SQL không mua
được gì — và đổi lại bạn `Get-Content` ra đọc bằng mắt được.

## Không làm compaction — và đây là bằng chứng, không phải tự hạn chế

CHANGELOG Claude Code bốn bản gần nhất: **ít nhất 9 mục** là lỗi resume ×
compaction (mất message sau compaction, mang về lịch sử trước compaction,
compaction lặp vô hạn...). Vùng đó họ mất nhiều phiên bản mới chịu được.

## Hai bug CHỈ chạy thậy mới ra — không test nào thấy

1. **Tôi khoá ngay chính cách dùng vừa làm.** Guard "phải có câu hỏi" làm
   `npm run cli` không đối số (tức REPL) in hướng dẫn rồi `exit 2`. Test gọi hàm
   chứ không chạy CLI nên không thấy.
2. **`rl.question` không trả `null` khi hết dòng mà NÉM** "readline was closed" →
   `Ctrl+D` in dòng lỗi rác thay vì thoát sạch.

## Bằng chứng chạy thật

- Lần 1: `> cong cu: 14` → lượt hỏng 401 → `> lich su van con. Thu lai.` (phiên
  không chết) → `/exit` sạch.
- Lần 2, terminal mới, cùng thư mục: `> lich su: 1 message o "..."` ⇒ **đọc tiếp**.
- 2 workspace khác → 2 file transcript khác, cùng thư mục state.

## 1 mutation KHÔNG bị bắt, nói thẳng

Đổi `rename` sang `truncate` vẫn 13 xanh — hai cách cho kết quả giống nhau trong
đường test. Khác biệt thật là **nguyên tử khi crash**, mà test không nhìn thấy.
Phần đó chưa được canh.

## Còn lại

- **Không rút gọn context**: đủ một buổi, không đủ cả ngày.
- **Không tìm kiếm hội thoại**: JSONL không có chỉ mục. Muốn thì đổi sang SQLite.
- **Không nạp `AGENTS.md` vào system prompt** — đáng làm, để sau.
