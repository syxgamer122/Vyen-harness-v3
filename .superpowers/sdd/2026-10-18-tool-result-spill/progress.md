# SDD ledger — plan: docs/superpowers/plans/2026-10-18-tool-result-spill.md

Spec: docs/superpowers/specs/2026-10-18-tool-result-spill-design.md
Nhánh: feat/tool-result-spill (base 876d6e9)

## Pre-flight: giao diện dùng chung giữa các task

| From | Produces | To | Consumes | Thấy gì |
|---|---|---|---|---|
| T1 | `loadSpillSaver(): SpillSaver \| null`, `type SpillSaver = (content, suggestedName) => { savedTo, bytes, notice } \| null` | T2 | tên hàm trong ipc.cjs là `saveSpillText` | Khớp — T2 chỉ cần đặt tên đúng `saveSpillText`, trả đúng object 3 khoá |
| T1 | `loadSpillSaver()` | T4 | T4 gọi nó ở `serializeToolResult` | Khớp |
| T2 | registry value `{ path, kind }` | T3 | `readTargetOf` đọc `entry.path` | Khớp — phải sửa `ipc.cjs:321` vì hiện đang trả thẳng `path` |
| T2 | `saveSpillText` trả `{ savedTo, bytes, notice }` | T4 | T4 dùng `spilled.notice` | Khớp |

## Task 1: Chứng minh cơ chế require

- RED: `loadSpillSaver is not a function` — đúng lý do (thiếu tính năng), 2 test đỏ / 25 xanh.
- GREEN: 27/27 xanh sau khi cài loader.
- **Task 1: Ruling: mutation bỏ chặn `typeof window` KHÔNG làm test đỏ — test hiện vô nghĩa.** Lý do: `saveSpillText` chưa tồn tại (Task 2 chưa làm) nên `loadSpillSaver()` trả `null` dù có chặn hay không; `try/catch` phía sau cũng nuốt lỗi nếu không chặn. Vì vậy chặn `window` hiện là **fast-path chứ không phải chốt an toàn** — chốt an toàn thật là `try/catch`. Giữ lại chặn vì tránh `eval` trong bundle trình duyệt và làm rõ ý định. **Chuyển mutation proof sang Task 2**, lúc đó `saveSpillText` có thật và test mới phân biệt được. — Chi phí nếu sai: một test yếu ở Task 1, không gây hỏng runtime.
- Ruling: gỡ `// eslint-disable-next-line no-eval` vì config repo KHÔNG cấm `eval`; chính dòng disable đó làm warning tăng 8→9. Baseline AGENTS.md §1 là 8. — Chi phí nếu sai: nếu sau này bật rule no-eval thì phải thêm lại.
- Build exit 0. 4 import trace còn lại là `shell-policy.cjs` đi tới client qua `auto-pilot.ts:20` — có sẵn từ trước, không phải do thay đổi này. Không trace nào đi qua `tool-limits.ts` → xác nhận `eval('require')` không bị bundler phân tích tĩnh.
- **Task 1: complete (commits 876d6e9..b5796a6, tests: npx vitest run tests/tool-limits-budget.test.ts tests/tool-invocation-trim.test.ts tests/agent-tools.test.ts → 3 file 65/65 pass)**

## Task 2: saveSpillText + registry biết loại

- **Task 2: Ruling: KHÔNG dùng `describe.skipIf` cho describe mới.** Lần chạy đầu cho 12 pass / 9 **skip** — `skipIf(!saveSpillText)` làm test im lặng xanh trước khi có implementation. Xanh-có-skip không phải là đỏ. Bỏ guard → 9 fail thật với `saveSpillText is not a function`.
- **Task 2: Ruling: sửa `readTargetOf` (`ipc.cjs`) ngay ở Task 2, không chờ Task 3 như plan.** Plan để việc này cho Task 3, nhưng đổi value của Map sang `{path, kind}` làm `readTargetOf` trả object thay chuỗi ⇒ `fs_read` hỏng ngay ⇒ Task 2 để lại repo vỡ. Sửa luôn (3 dòng). Task 3 giữ phần test còn lại.
- **Task 2: Ruling: `flag: 'wx'` không test trực tiếp được** vì tên file chứa id ngẫu nhiên nên không thể tạo va chạm qua API công khai. Không viết test giả — ghi Ruling thay. Cái test được: sanitize 5 biến thể path độc hại, tên rỗng/toàn ký tự lạ, nội dung khớp byte-for-byte, hai lần ghi không đè nhau.
- **Task 2: Ruling (BUG THẬT của Task 1): đường dẫn require sai — `../ipc.cjs` thay vì `./ipc.cjs`.** `lib/tool-limits.ts` nằm ở `lib/`, nên `../ipc.cjs` chỉ tới `<repo>/ipc.cjs` — không tồn tại. `try/catch` nuốt lỗi và trả `null`, nên spill **không bao giờ hoạt động** mà tsc/lint/build/27 test đều xanh. Chỉ lộ ra khi viết test hỏi thẳng "trong Node, loader có trả về hàm không?" → `expected 'object' to be 'function'`. Đây là bug thứ 3 trong một buổi đều do **thao tác im lặng** (skip, cache, try/catch nuốt lỗi).
- Mutation nợ Task 1 ĐÃ TRẢ: bỏ chặn `typeof window` → 1 test đỏ (28 xuống 27). Khôi phục → 28/28 xanh.
- **Task 2: complete (tests: npx vitest run tests/shell-tool.test.ts tests/tool-limits-budget.test.ts tests/ipc-register.test.ts tests/bg-jobs.test.ts tests/desktop-llm-fetch.test.ts → 5 file 90/90 pass; tsc 0; lint 0/8 warning baseline)**

## Task 3: fs_read đọc file spill + đẩy shell trước

- `readTargetOf` đã sửa ở Task 2 nên Task 3 chỉ còn phần test.
- **Task 3: Ruling: 2 test này XANH NGAY lần đầu — không phải TDD, mà là test đặc tính hóa** cho hành vi Task 2 đã cài. Nên bằng chứng không phải lần chạy xanh mà là **mutation**: đảo comparator `a.kind === 'shell'` → `'spill'` thì **5 test đỏ**, gồm đúng test cần bảo vệ. Khôi phục → 23/23 xanh. Test bám đúng cơ chế thật (hỏng dây chuyền khiến nhiều test đỏ cùng lúc vì cùng một nguyên nhân).
- **Task 3: complete (tests: npx vitest run tests/shell-tool.test.ts tests/tool-limits-budget.test.ts tests/safe-spawn.test.ts tests/ipc-register.test.ts → 4 file 82/82 pass; tsc 0)**

## Task 4: serializeToolResult — spill hoặc truncate

- RED: 2/32 fail (đúng 2 test đòi spill). 2 test còn lại xanh sẵn vì spill chưa tồn tại — characterization.
- **Task 4: Ruling: đặt test vào `tests/tool-limits-budget.test.ts`, KHÔNG phải `tests/tool-result-body.test.ts` như plan.** File đó có header từ chối đúng việc này: *"Tách khỏi `summarizeToolResult` … **không test sự tồn tại của hàm kia**."* Thêm test serializeToolResult vào đó sẽ phá ý d�� thiết kế có chủ ý của file.
- **Task 4: Ruling: test bí mật ở phần giữa ĐỎ lần đầu vì TIỀN ĐỀ SAI của test, không phải vì code sai.** Hai lỗi: (a) filler `'x'.repeat(...)` không có dấu cách nên class `[A-Za-z0-9_-]{8,}` của rule `sk-` nuốt luôn filler, không còn gì để redact; (b) khoá đặt ở 14.000 trong khi `headLen ≈ 17.487` ⇒ nằm trong phần ĐẦU vẫn giữ lại, không phải phần giữa. Cả hai đều đã được cảnh báo sẵn ở `tests/secret-registry.test.ts:265-268` — tôi đọc chú thích SAU khi viết test. Sửa: filler `'x '` có dấu cách, 30.000 cặp = 60.000 ký tự để khoá nằm chắc trong đoạn bị lược.
- **MUTATION bắt buộc (quan trọng nhất phiên): gỡ `redactSecretText` → 2 test ĐỎ.** `secret-registry.test.ts` (có sẵn) canh redact-trước-khi-cắt; `tool-limits-budget.test.ts` (mới) canh redact-trước-khi-ghi-đĩa. Cả hai ranh giới đều đã chứng minh. Nếu test xanh thì spill đang ghi API key lên đĩa mà không dấu vết nào.
- **Task 4: complete (tests: npx vitest run tests/tool-limits-budget.test.ts tests/secret-registry.test.ts tests/tool-result-body.test.ts tests/shell-tool.test.ts tests/emulated-agent.test.ts → 5 file 143/143 pass; tsc 0; lint 0/8 warning baseline)**

## Task 5: tài liệu + gate

- docs:check OK (534 file) | build exit 0, 4 trace cũ của shell-policy.cjs, KHÔNG trace qua tool-limits.
- Full suite: 205/206 file, 3346 pass, 1 skip. Fail duy nhất = tests/launch-desktop.test.ts — flaky đã ghi ở AGENTS.md §1 (cổng 3000 bị dev server giữ).
- **Task 5: complete (commits c7c798b..736409f)**

## Final review — KHÔNG merge được. Tính năng KHÔNG chạy trong production.

Tôi TỰ xác minh, không tin báo cáo:

- **C1 xác nhận.** `.next/server/chunks/_10ewwxb._.js` chứa nguyên văn `let req=eval("require"), ipc=req("./ipc.cjs")`. `Get-ChildItem .next -Recurse -Filter ipc.cjs` → **rỗng**. Chunk nằm ở `.next/server/chunks/` nên require resolve theo chunk đó → MODULE_NOT_FOUND → catch → spillSaverCache = null. **Spill không bao giờ chạy.**
- **C2 suy ra từ C1.** Nếu sửa C1 bằng đường dẫn thì sẽ là instance thứ hai của savedShellOutputs, khác instance mà whitelist fs_read dùng.
- **C3 xác nhận.** `lib/agent-tools.ts:630` capToolResult cắt mọi tool server về ≤ 24.000, `:719` áp nó TRƯỚC khi kết quả tới serializeToolResult. Nhánh spill không bao giờ được gọi trên native path (đường mặc định).

**Final: Ruling: DỪNG, không merge.** Cả C1 lẫn C3 là quyết định kiến trúc, không phải vá nhanh. C1 cần module sink an toàn trình duyệt do server-bridge.ts nạp; C3 cần bỏ trần size của capToolResult — tức đổi tầng tool, không chỉ tool-limits.ts. — Chi phí nếu sai: merge lên main thì tính năng chết âm thầm, còn README đã tuyên bố nó chạy; không lỗi runtime, không log.

**Bài học:** `npm run build` exit 0 KHÔNG chứng minh tính năng chạy. Test chạy trên đồ thị module của vitest, nơi lib/ipc.cjs nằm cạnh lib/tool-limits.ts; runtime thật là chunk đã bundle, không có ipc.cjs. try/catch biến MODULE_NOT_FOUND thành hành vi im lặng — đúng loại lỗi thứ tư trong ngày, và lần này nó đi qua cả tsc, lint, build, 143 test, và full suite 3346 test. Mutation discipline chỉ chứng minh test bắt được thứ mình đo — không chứng minh thứ đó có mặt trong sản phẩm.

---

# Lần 2 — sửa C1 + C3

Plan: docs/superpowers/plans/2026-10-18-tool-result-spill-fix.md (5 task)

## Task 1: chứng minh C1 bằng artifact thật

- ĐỎ 2 | XANH 2 — đúng như plan dự đoán.
  - `bản build có mang saveSpillText` ĐỎ: expected to contain 'vyen-spill-'
  - `không còn require theo đường dẫn tới ipc.cjs` ĐỎ
  - `ranh giới runtime` XANH (chống TƯƠNG LAI — code hiện tại dùng eval, regex này không bắt)
  - `quét thật sự chạy (>5 module)` XANH
- **Task 1: Ruling: thêm test thứ tư — `đồ thị import tới được hơn 5 module`.** Không có trong plan. Lý do: test ranh giới quét đồ thị bằng regex; regex sai thì nó thấy KHÔNG gì và báo sạch — tức xanh giả. Đây là cơ chế kiểm chứng cho cơ chế kiểm chứng, loại lỗi thứ năm hôm nay (cùng dạng với skipIf, cache module scope, try/catch nuốt lỗi: đều là cơ chế có vẻ kiểm nhưng không soi được gì).
- **Task 1: complete (tests: npx vitest run tests/spill-wiring.test.ts → 2 failed | 2 passed; 2 failed chính là bằng chứng C1 còn sống)**

### Lỗi thứ sáu trong ngày: .ps1 không BOM bị đọc theo ANSI

`powershell -File script.ps1` với PowerShell 5.1 đọc file **không BOM** theo ANSI. Script của tôi chứa chuỗi tiếng Việt trong `Write-Output` → ký tự hỏng → **ParseError**, script không chạy dòng nào. Khác với 5 lỗi trước, lỗi này **báo lỗi to** nên dễ thấy — nhưng cùng cơ chế với AGENTS.md §2 (đọc UTF-8 thành ANSI).
- **Ruling: mọi script `.ps1` viết cho việc này phải ASCII-only.** Không dùng dấu tiếng Việt trong chuỗi, kể cả chuỗi chỉ để in ra. Comment tiếng Việt cũng bỏ — không đáng đổi.

### Lỗi thứ bảy trong ngày: test của tôi đặt tiền đề sai

`tests/agent-tools-spill.test.ts` bản đầu dùng `memory_search` với `query` 40.000 ký tự, kỳ vọng kết quả lớn. Sai ở ba chỗ, **không cái nào lộ ra nếu không đọc code**:
1. `memory_search` chỉ được đăng ký khi `memories.length > 0`. `buildAgentTools()` không tham số → `t.memory_search` là `undefined` → test sẽ ném lỗi, không phải đỏ có lý do.
2. Kết quả là `{matches, totalMemories, note}` — **không echo query**. Query dài không tạo ra kết quả dài.
3. `query` có `z.string().max(200)`.
- **Ruling: trước khi viết test, đọc code của fixture và hỏi "test này có TẠO RA được tình huống nó kiểm không?"** Test có thể xanh và vẫn vô nghĩa — nhưng chỉ vô nghĩa khi tiền đề sai. Đây là biến thể của `skipIf`/cache: cơ chế có vẻ kiểm, không kiểm gì.
- **Fixture đúng**: `memory_search` với 5 `MemoryItem` lớn (~45.000 ký tự tổng). `searchMemories` trả top-5 `{id,text}` **nguyên văn, không cắt** → memories vào là kết quả ra. Offline, tất định, kiểm soát tuyệt đối. Thêm test canh tiền đề: `kết quả nhỏ: không có gì để spill`.

### Lỗi thứ tám trong ngày: file .ts bị ghi bằng PowerShell → mojibake trong comment

`lib/agent-tools-server.ts` sinh ra bằng script PowerShell có here-string tiếng Việt. PowerShell 5.1 đọc `.ps1` không BOM theo ANSI → chuỗi hỏng ngay trong script → `WriteAllLines(UTF8)` ghi lại thành UTF-8 **của chuỗi đã hỏng**. Kết quả: `Phần CHẠY SERVER` thành `Pháº§n CHáºY SERVER`.
- **Vì sao không ai thấy**: nó nằm trong **comment**. `tsc` không đọc, `lint` không đọc, test không đọc. Đúng dạng AGENTS.md §2 mục 3 — thao tác hỏng âm thầm.
- **Ruling: mọi ghi file có tiếng Việt phải dùng Node**, không dùng PowerShell. `node` đọc/ghi UTF-8 mặc định. Script `.ps1` chỉ dùng cho thao tác **ASCII**.
- Đã có công cụ quét: `node scan-mojibake.mjs` quét mọi file trong `git diff` — 17 file, 0 dòng hỏng sau khi sửa.
- **Bẫy ngược lại**: `.gitattributes` hiện ra mojibake khi đọc bằng `Get-Content`, nhưng `node -e readFileSync(...,'utf8')` cho thấy file **sạch**. Cùng công cụ, hai chiều đối lập. Không sửa file chỉ vì hình thức hiển thị sai.

## Task 2: tách `agent-tools.ts` theo runtime + cài spill ở chỗ quyết định cắt

### Ranh giới đã vẽ
- **Server** (`lib/agent-tools-server.ts`, 608 dòng): `buildAgentTools`, `capToolResult`, `stableKey`, `hostOf`, `searchMemories`, khối doc/protocol (`formatToolProtocolManual`, `formatToolNameList`, `ALL_TOOL_PROTOCOL_NAMES`, `TOOL_SHORT_LABELS`), `buildDelegateTool`, `validateMemoryProposal`.
- **Chung** (`lib/agent-tools.ts`, 970 dòng): `CLIENT_TOOL_DEFS`, `toolResultBody`, `summarizeToolArgs/Result`, `DELEGATE_PARAMETERS`.
- **Quy tắc**: server import được chung, chung KHÔNG import server (sẽ thành vòng).

### Ruling: đã kiểm vòng import TRƯỚC khi cắt
`getDocRegistry` dùng `buildAgentTools` **và** `CLIENT_TOOL_DEFS`; `formatToolProtocolManual` dùng nó. Nếu để `formatToolProtocolManual` ở file chung thì: chung → server → chung. Grep toàn repo: nó chỉ dùng ở `emulated-agent.ts:31`, `route.ts:49`, test — **không component trình duyệt nào**. Nên cả khối doc/protocol sang server, vòng không xảy ra. Phát hiện này chỉ ra được khi **kiểm trước khi cắt**; cắt xong mới thấy thì phải hoàn tác toàn bộ.

### Ruling: biên cắt phải nằm NGOÀI khối JSDoc
Lần cắt đầu cắt giữa JSDoc → `/**` ở lại file cũ, thân `* ...` sang file mới, chừa ` */` trần. `tsc` báo `TS1109`. Hai lỗi ranh giới:
- `1048-1053` là JSDoc của `DELEGATE_PARAMETERS` — **thuộc về `CLIENT_TOOL_DEFS`** nên phải ở lại. Cắt ở `1046` (`}` cuối `formatToolNameList`).
- Khối `/* ---- Validate đề xuất ghi nhớ ---- */` phải đi **cùng** `validateMemoryProposal` (bắt đầu từ `1465`, không phải `1469`).

### Ruling: redact phải chạy TRƯỚC cap — đây là mấu chốt của C3
`capToolResult` ghi phần bị cắt ra đĩa. Nếu cap chạy trước, nó nhận nội dung **chưa redact** và ghi thẳng ra đĩa. Bí mật hay nằm ở phần giữa — tức phần bị lược khỏi ngữ cảnh — nên sẽ thoát mọi lớp che, vì không còn gì che nó trên đường về context nữa.
- Đổi `redactSecretsDeep(capToolResult(x))` → `capToolResult(redactSecretsDeep(x))`.
- Che đúng **thứ bị ghi đĩa**, không phải đúng thứ bị cắt khỏi context.

### Mutation discipline: 2/2 ĐỎ
| Mutation | Kết quả |
|---|---|
| Trả thứ tự `cap`-`redact` về cũ | **1 failed** — bắt đúng bí mật lọt xuống đĩa |
| Bỏ dòng `saveSpillText` | **3 failed** |
| Bản gốc | 6 passed |

### Phát hiện NGOÀI phạm vi C3 — cap chỉ cắt string, mảng đi lọt
Test ban đầu khẳng định `JSON.stringify(out) <= trần + 1000` và **ĐỎ: 45.425 > 25.000**. Nguyên nhân: `capToolResult` chỉ cắt trường `typeof === 'string'` ở cấp ngoài (đúng như docstring: "để shape kết quả không đổi"). `matches` của `memory_search` là **mảng** → đi thẳng qua. Hàm vẫn set `truncated: true` dù không cắt gì.
- **Không sửa ở đây.** Sửa nghĩa là đổi ngữ nghĩa cap cho MỌI tool (`web_search results[]`, MCP results…) → cần RED test riêng, việc riêng. Gộp vào đây là chắt vá.
- **Không xoá phát hiện**: test đã viết lại thành khẳng định điều spill **phải** bảo đảm (`spillNotice` ngắn, `truncated: true`), kèm comment giải thích vì sao **không** khẳng định trần. Xem mục này.

### Task 2 commit: `8333b71` — tsc 0 loi, 13/14 file xanh, 2 do la spill-wiring (dung)

## Task 3: BỎ — spill kết quả MCP là bất khả thi với kiến trúc hiện tại

Plan (b5fa851) bảo chuyển `formatMcpResultForModel` sang `lib/mcp/tool-mapper-server.ts` và cho nó spill. **Điều tra cho thấy sai tiền đề.**

Bằng chứng:
1. `formatMcpResultForModel` được gọi ở `react/use-chat-orchestration.ts:1479` — module **trình duyệt**.
2. `callMcpTool` cũng chỉ gọi ở `react/use-chat-orchestration.ts:1461`. MCP tool chạy ở trình duyệt qua `lib/desktop-bridge.ts`.
3. Không tồn tại bất kỳ đường SERVER nào nào gọi `callMcpTool` hay `formatMcpResultForModel` (grep toàn repo: chỉ client + test).

Hệ quả:
- Trình duyệt không có hệ thống file → **không thể** spill kết quả MCP. Không phải lựa chọn kỹ thuật, là giới hạn kiến trúc.
- Nếu làm theo plan: chuyển hàm vào module import `ipc.cjs` → `child_process` + `net` lọt vào bundle trình duyệt, và `tests/spill-wiring.test.ts` (Task 1) sẽ **ĐỎ** chặn lại.
- **Test ranh giới runtime viết ở Task 1 giờ có tác dụng thật**: nó chặn được một task trong plan đưa code chạy sai runtime vào bundle trình duyệt.

Nếu sau này muốn spill kết quả MCP, phải đổi kiến trúc: chuyển việc thực thi MCP tool sang server. Đó là việc riêng, không phải sửa gọn.

### Test trong plan Task 3 cũng sai — không chép
Plan viết `formatMcpResultForModel('x'.repeat(40_000))`:
- Hàm nhận **hai** tham số `(result: McpCallResult, toolName: string)`, không phải một chuỗi.
- Filler `'x'.repeat()` **không dấu cách**: dòng 379 gọi `redactSecretText`, rule `sk-` với class `[A-Za-z0-9_-]{8,}` sẽ nuốt cả 40k → không còn gì để cắt. Cùng bẫy filler như `tests/secret-registry.test.ts:265`.
Sai hai lần, và cả hai đều im lặng.

## Task 4: tách `serializeToolResult` ra module server — LÀM KHÁC PLAN

Plan bảo **xoá hẳn** spill khỏi `serializeToolResult` (đường emulated mất spill, chỉ native giữ được). Không làm vì:
- Sau khi bỏ Task 3, đường emulated là nơi DUY NHẤT còn có thể spill.
- `serializeToolResult` chỉ dùng ở `lib/emulated-agent.ts` — **server thuần**, không nằm trong đồ thị trình duyệt.
- Nên nó import tĩnh `lib/ipc.cjs` được y như Task 2, và giữ được spill thật cho đường emulated.

Làm:
- `lib/tool-result-server.ts` (mới): `serializeToolResult` + `import * as ipc from '@/lib/ipc.cjs'`.
- `lib/tool-limits.ts`: xoá `SpillSaver`, `loadSpillSaver`, `spillSaverCache`, `serializeToolResult`, và import `redactSecretText` (chỉ `serializeToolResult` dùng nó). Chỉ còn phép tính thuần. Thêm comment ghi rõ **hạn chế**: file này phải chạy được trong bundle trình duyệt, nên KHÔNG được import Node — nêu đích danh bản 1 đã vi phạm và không ai thấy.
- 4 test spill **chuyển** sang `tests/tool-result-server.test.ts` (không xoá — chúng khoá hành vi còn giữ). Thêm 2 test: hợp đồng trần ở nhiều ngưỡng, và ngưỡng mặc định lấy từ `TOOL_RESULT_MAX_CHARS`.
- 3 test `loadSpillSaver` bị xoá: hàm không còn tồn tại. Rủi ro chúng canh giờ do `spill-wiring.test.ts` canh mạnh hơn — duyệt đồ thị import từ entry trình duyệt thật, thay vì đoán qua `typeof window`.

**Task 4 commit `245f199`.** Gate: `tsc` 0 lỗi; 7 file / 164 test xanh.
**Mutation 2/2 ĐỎ:** bỏ dòng ghi đĩa → 2 failed; ghi bản **thô** thay vì bản đã redact → 1 failed (bắt đúng bí mật lọt xuống đĩa).

### Ruling: grep thô không phân biệt code sống với chú thích
Plan yêu cầu `grep "loadSpillSaver|SpillSaver|eval('require')"` → "không có kết quả nào". Grep trả **8 dòng**. Cả 8 đều là comment giải thích lịch sử (cố ý giữ lại, theo quy tắc "xoá rồi để lại comment giải thích vì sao xoá"). Lọc bỏ dòng bắt đầu bằng `*`/`//`/`/*` → **rỗng**.
- Không kết luận "còn sót" cũng không kết luận "sạch" từ grep thô. Cùng dạng với `describe.skipIf`, cache module scope, `try/catch` nuốt lỗi: **cơ chế có vẻ kiểm nhưng không phân biệt được trạng thái quan tâm**.

### Ruling: phải đọc code của fixture trước khi tin test của plan — lần thứ hai
Lần này lỗi ở **plan**, không ở tôi: plan Task 3 viết `formatMcpResultForModel('x'.repeat(40_000))` trong khi hàm nhận `(result: McpCallResult, toolName: string)`, và filler không dấu cách bị rule `sk-` nuốt. Sai hai lần, cả hai đều im lặng.

## Task 1 proof #1 ĐỎ VÌ LÝ DO SAI — tự phát hiện khi đọc lại code

`tests/spill-wiring.test.ts` khẳng định artifact chứa `'vyen-spill-'` (có dấu gạch nối). Đọc `lib/ipc.cjs:95`: `SPILL_FILE_PREFIX: 'vyen-spill'` — **KHÔNG có dấu gạch**. Dấu `-` do template `` `${SPILL_FILE_PREFIX}-${id}-...` `` thêm lúc ghép tên file, nên chuỗi liền `vyen-spill-` **không tồn tại trong bất kỳ bản build nào**, kể cả bản hoàn hảo.

Hệ quả: test **luôn đỏ**. Đỏ đúng cho bản build cũ, nhưng cũng đỏ với bản build hoàn hảo. Vậy lệnh "RED confirmed — C1 được chứng minh bằng sản phẩm thật" mà tôi báo ở Task 1 là **không có giá trị chứng minh**.

Đây là **gương** của lớp lỗi tôi đã ghi suốt phiên: không chỉ "cơ chế kiểm hỏng âm thầm báo sạch", mà còn "cơ chế hỏng báo đỏ". Test không bao giờ xanh không chứng minh gì — giống hệt test không bao giờ đỏ.

- **Ruling: khẳng định trên artifact phải đọc ngược lại nguồn và đối chiếu TỪNG KÝ TỰ trước khi tin.** Marker phải là chuỗi có thật trong file nguồn, không phải chuỗi ta nghĩ là có.
- Đã sửa marker thành `'vyen-spill'` (đúng `ipc.cjs:95`) và **thêm** test thứ ba: artifact không được chứa `eval('require')` ở cả hai dạng nháy đơn. Vì `eval('require')` là **cột sống của C1**: bundler không phân tích tĩnh nên `ipc.cjs` không được đóng gói cho lời gọi đó.
- Task 1 proof #2 (`không còn './ipc.cjs'`) thì **có giá trị**: đó là phép so sánh tuyệt đối, và nó đã đỏ có thật trên bản build cũ.

### Artifact sau khi sửa (đo trực tiếp, 130 file .js trong .next/server)
| Marker | Kết quả |
|---|---|
| `vyen-spill` | ✅ CÓ → `ipc.cjs` **đã** được Turbopack đóng gói vào sản phẩm server |
| `./ipc.cjs` | ✅ KHÔNG còn → C1 chết |
| `eval('require')` | ✅ KHÔNG còn → hack bản 1 đã gỡ |
| `saveSpillText`, `registerSavedShellOutput` | ✅ có |

### Ruling: test chỉ chứng minh ipc.cjs "có trong sản phẩm", KHÔNG chứng minh "tới được"
`lib/bridge/server-bridge.ts:75` đã import tĩnh `ipc.cjs` **từ trước** các thay đổi này. Nên `vyen-spill` có trong `.next/server` là điều đã đúng sẵn, và test marker **không phân biệt được** trạng thái trước/sau sửa. Cái thực sự bắt được C1 là test `./ipc.cjs` và `eval('require')` — vì chúng là phép so sánh tuyệt đối trên artifact.
- Test viết bằng regex/số đếm mà **không phân biệt được** hai trạng thái thì là test trang trí. Phải hỏi: "nếu đảo ngược thay đổi của tôi, test này có đỏ không?" — nếu không thì nó vô dụng dù xanh.

## Task 5: tài liệu + gate đầy đủ

- README:47 — bỏ "bất kỳ kết quả nào vượt 24.000 ký tự", nói đúng phạm vi là tool chạy trên server, và nói rõ MCP **không** có spill.
- README:162 — thêm: MCP không có spill (chạy trong trình duyệt, không có hệ thống file); `fs_read` vốn đã có trần sẵn; phần ghi đĩa là nội dung **đã redact**, bảo đảm là "không phải bí mật mà rule nhận ra" chứ không phải bảo vệ quyền ghi.
- Spec §3 và §4 — bỏ `lib/mcp/tool-mapper-server.ts` (không tạo), thêm `lib/tool-result-server.ts`. Spec trước đó **mâu thuẫn với chính nó**: bảng §4 nói MCP có spill ✅, dòng ngay dưới nói client tool "không thể — chấp nhận"; MCP *là* client tool. Chính mâu thuẫn đó là nguồn của Task 3 sai.