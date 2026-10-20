# SDD ledger — plan: docs/superpowers/plans/2026-10-19-cli-compaction.md

Spec: docs/superpowers/specs/2026-10-19-cli-compaction-design.md (bản 2)
Workspace: `.superpowers/sdd/2026-10-19-cli-compaction/`

## Setup

- **Ruling: tạo workspace thủ công** thay vì chạy `sdd-workspace` — máy không có bash
  (`Get-Command bash` → rỗng), script là shell script. Tạo đúng đường dẫn skill quy định:
  `<repo-root>/.superpowers/sdd/<plan-basename>/`. Chi phí nếu sai: không có.
- **Ruling: không tạo git worktree riêng.** Lý do: repo đã cài `node_modules` (534 package),
  worktree mới phải cài lại (chậm, và plan này chỉ thêm file + sửa file lõi đang chạy).
  Đang ở nhánh `feat/provider-layer` — KHÔNG phải `main`/`master`, nên đã đúng yêu cầu
  "không implement trên main". Chi phí nếu sai: không có gì để cô lập vì không sửa file
  đang chạy.
- Nhánh: `feat/provider-layer`, base `2712e79`. Working tree sạch trừ:
  - `docs/cli-migration-inventory.md` — sinh lại (thiếu `cli/index.ts` trong CORE_ENTRIES).
  - `docs/superpowers/specs/2026-10-19-cli-compaction-design.md` — mới, đã `git add`.
  - `docs/superpowers/plans/2026-10-19-cli-compaction.md` — mới, đã `git add`.
- `npm run docs:check` OK (10 tài liệu, 583 file theo dõi) — đã chạy sau khi add 2 file.

## Pre-flight: giao diện dùng chung giữa các task

| Task tiêu thụ | Task sản xuất | Cần dùng | Tìm thấy |
|---|---|---|---|
| 5 | 1 | `toBudgetMessages(messages): BudgetMessageLike[]` | Khớp — Task 5 gọi trong `chooseCut` và `compactConversation` |
| 5 | 3 | `COMPACT_SUMMARY_SYSTEM`, `buildCompactPrompt` | Khớp — cùng module `lib/context-compaction.ts` |
| 5 | 4 | `firstKept` trong `CompactOutcome` khớp `session.compact({firstKept})` | Khớp — cùng tên, cùng nghĩa (số message ĐẦU bị nén bỏ) |
| 7 | 4 | `session.compact()`, `session.compaction`, `session.reset()` | Khớp |
| 7 | 5 | `compactConversation`, `withSummary`, `CLI_DEFAULT_CONTEXT_WINDOW` | Khớp |
| 7 | 6 | `runAgentTurn` trả `usage.finishReason` | Khớp |
| 8 | 1, 2, 3, 5 | `CORE_ENTRIES` thêm `lib/context-compaction.ts`, `cli/context-adapter.ts`, `cli/compaction.ts` | Khớp |

**Ruling: `firstKept` = số message ĐẦU bị nén bỏ (không phải chỉ số của message đầu tiên
được giữ).** `splitForCompaction` trả `firstKept` là **chỉ số** trong mảng; nhưng khi
Task 5 dịch nó qua ranh giới `user` thì giá trị đó thành **số phần tử bị bỏ đi** — và
`session.compact()` cần đúng con số đó để tính `throughCount`. Giữ một nghĩa duy nhất:
`firstKept` = chỉ số trong `CoreMessage[]` của message ĐẦU TIÊN được giữ, đồng thời là
số message bị bỏ (vì `older = messages.slice(0, firstKept)`). Hai nghĩa này TRÙNG NHAU
chứ không mâu thuẫn. Chi phí nếu sai: `throughCount` lệch ⇒ mở lại session mất/lặp lịch sử.

## Nợ mang từ trước (không thuộc plan này, chưa trả)

- `lib/ipc.cjs` không audit `fsWrite`/`fsDelete` — đã sửa ở tầng CLI (`host.audit`), nhưng
  `ipc.cjs` vẫn không ghi ⇒ **web** không có vết ghi file. Việc của `ipc.cjs`, không phải CLI.
- `DANGEROUS_CHANNELS` / `READ_ONLY_CHANNELS` viết tay ⇒ thêm channel mới vào `ipc.cjs` thì
  test đỏ (đúng ý) nhưng phải có người sửa.

## Task 1: Adapter `CoreMessage → BudgetMessageLike`

**Ruling: khai `CORE_ENTRIES` ngay trong task tạo file, không dồn tới Task 8.** Plan ghi
việc này ở Task 8, nhưng `tests/repo-hygiene.test.ts:85` bắt buộc **mọi** file trong
`cli/` phải có trong `CORE_ENTRIES` ⇒ task tạo file mà chưa khai là để lại repo đỏ.
Sửa: mỗi task tạo file trong `cli/` khai ngay, và chạy lại `build-inventory.ts`.
Chi phí nếu sai: không có — đây là thứ tự đúng của guard.

**Ruling: commit Task 1 gồm cả `scripts/cli-migration/import-graph.ts` + bảng kiểm kê
sinh lại** (plan chỉ list 2 file). Lý do: bảng kiểm kê là **sinh ra**, sửa tay là sai —
nó phải khớp `CORE_ENTRIES` sau mỗi lần thay đổi. Chi phí nếu sai: không có.

- **RED:** `Cannot find package '@/cli/context-adapter'` — đúng lý do plan dự đoán.
- **GREEN:** 5/5. typecheck 0 lỗi. lint 0 lỗi / 8 warning (baseline).
- **Mutation:** `invocations.length > 0` → `> 999` ⇒ **3 test đỏ** (gộp invocation,
  ước lượng thấy tool result, tool-call chưa có kết quả). Đã xác minh mutation **đã áp
  dụng** bằng grep trước khi chạy test. Trả lại ⇒ 5/5.
- `tests/repo-hygiene.test.ts` + `tests/cli-migration-scan.test.ts` ⇒ 34/34 xanh.
- **Task 1: complete (commits 965eabf..aad1c7f, tests: npx vitest run tests/cli-context-adapter.test.ts → 5/5 pass)**

## Task 2: Cắt trần kết quả tool cho CLI

**Ruling: `capToolResult` nhận thêm tham số `saver?: SpillSaver` thay vì dùng hàm spill
nội bộ.** Plan nói "dùng chung `capToolResult`" nhưng chưa nói spill lấy từ đâu. Vấn đề
thật: `lib/tools/ipc-node.ts` nạp `ipc.cjs` bằng `'../ipc.cjs'`, còn
`lib/tool-result-server.ts` nạp bằng `'@/lib/ipc.cjs'` — hai specifier khác nhau. Nếu mỗi
bên tự import, một bên có thể giữ **instance khác** ⇒ spill ghi vào registry của instance
này còn `fs_read` đọc registry của instance kia ⇒ **file spill không đọc được** (đúng
dạng lỗi "hai instance của cùng một module" đã mắc ở lượt 4 phiên trước). Truyền tay
hàm của chính instance đang dùng ⇒ không thể lệch. Chi phí nếu sai: không có.

**Ruling: bản ghi đĩa luôn được REDACT (`spillRedacted`), kể cả ở đường server.**
Đường server redact trước khi gọi cap (`guarded`) nên redact thêm là no-op — placeholder
là `[redacted]`, không khớp rule nào. Đường CLI thì **không** redact lúc chạy (CLI chỉ
che lúc ghi transcript, vì model cần đọc được khoá nó vừa đọc) ⇒ nếu spill nguyên văn thì
một `.env` đọc được nằm trọn trong file tạm, **ngoài** transcript đã che. Đây là chốt
chặn duy nhất của đường CLI. Chi phí nếu sai: một lần redact thêm trên chuỗi lớn.

**Ruling: `capToolValue` cắt theo TỪNG hình dạng (chuỗi / mảng / object), giữ nguyên
hình dạng.** Tool của CLI trả 3 kiểu: `fs_list`/`fs_search` trả **mảng**, `fs_read` trả
**object**, `git_diff` trả **chuỗi thô**. Đổi mảng thành object thì model nhìn thấy thứ
khác với lúc nó gọi tool. Mảng ⇒ bỏ mục cuối cho tới khi vừa ngân sách, thêm MỘT mục
đánh dấu. Chi phí nếu sai: model phải đoán hình dạng.

- **RED:** 5/5 test đỏ. Test tích hợp đỏ **đúng lý do** (`expected 600 to be less than
  600`) ⇒ điều kiện tiên quyết đạt, test không rỗng.
- **GREEN:** 5/5.
- **Mutation:** `return capToolValue(r, spillSaver)` → `return r` ⇒ **1 test đỏ** (test
  tích hợp `fs_list`). Đã xác minh mutation **đã áp dụng** bằng grep (dòng 822) trước
  khi chạy test. Trả lại ⇒ 5/5.
- typecheck 0 lỗi · lint 0 lỗi / 8 warning (baseline) · full suite **227/228 file,
  3601 pass**, 3 fail **toàn bộ** trong `tests/secret-registry.test.ts` (ngân sách thời
  gian 500ms, đo được 662–863ms). Chạy RIÊNG file đó: **2/44 đỏ** — đúng mẫu AGENTS.md
  §1 ghi (1, 1, 2 test đỏ). `lib/secret-registry.ts` **không** bị sửa, và test đó gọi
  thẳng registry chứ không gọi code mới ⇒ không phải hồi quy.
- **Task 2: complete (commits aad1c7f..4713ac1, tests: npx vitest run tests/cli-tool-result-cap.test.ts → 5/5 pass)**

## Task 3: Prompt tóm tắt dùng chung

**Ruling: `edit` không khớp được với tiếng Việt trong `app/api/compact/route.ts` — dùng
`node` để sửa file.** Lý do: file có dấu và `edit` báo "Could not find oldString" dù đã
đọc thấy nội dung đúng. Đây là biến thể của lỗi "đọc UTF-8 thành ANSI" (`AGENTS.md` §2).
Script sửa **tự kiểm số lần khớp** (throw nếu không đúng 1 lần) và in kết quả sau khi
sửa ⇒ không có thao tác im lặng. Chi phí nếu sai: không có.

**Ruling: `buildCompactPrompt` dùng chung cho CẢ HAI đường, không chỉ CLI.** Đường web
trước đây tự dựng `userPrompt` bằng mảng 5 phần tử. Nay nó gọi `buildCompactPrompt` —
một nguồn sự thật cho phần "dẫn dắt + transcript". Khác biệt giữa hai đường chỉ còn ở
chỗ **bản tóm tắt trước**: web gửi nó bằng một message `role:'system'` riêng trong
payload, CLI đưa vào prompt. Chi phí nếu sai: không có.

- **RED:** 5/5 test mới đỏ (43 test cũ vẫn xanh) — `buildCompactPrompt is not a function`.
- **GREEN:** 48/48.
- **Mutation:** xoá câu "HỢP NHẤT" khỏi `COMPACT_SUMMARY_SYSTEM` ⇒ **1 test đỏ** (test
  "system prompt có câu HỢP NHẤT"). Đã xác minh mutation đã áp dụng bằng grep. Trả lại ⇒
  48/48.
- typecheck 0 lỗi · lint 0 lỗi / 8 warning (baseline) · `tool-persistence-compaction` +
  `cli-migration-scan` + `repo-hygiene` ⇒ 82/82 xanh.
- **Khai `lib/context-compaction.ts` trong `CORE_ENTRIES`** ngay task này (cùng ruling với
  Task 1). Bảng kiểm kê sinh lại: đồ thị lõi 53 → **54** file.
- **Task 3: complete (commits 4713ac1..c503e66, tests: npx vitest run tests/tool-persistence-compaction.test.ts → 48/48 pass)**

## Task 4: Marker compaction trong JSONL

**Ruling: `SessionStore.messages` và `.compaction` là GETTER, không phải thuộc tính thường.**
Lý do: `compact()` phải **cắt** mảng lịch sử đang dùng. Nếu `messages` là thuộc tính thường
thì gán lại nó sẽ thay thế tham chiếu mà `cli/repl.ts` đang giữ ⇒ REPL và store lệch nhau.
Getter giữ đúng một nguồn. Chi phí nếu sai: không có.

**Ruling: sửa FIXTURE của test "khoá xuất hiện trong NỘI DUNG lịch sử nạp lại cũng phải che"
(thêm một message `user` ở đầu file) — KHÔNG nới guard.** Test cũ cố tình tạo file bắt đầu
bằng message `tool`; đó chính là hình dạng chuỗi hở mà guard mới chặn. Ý của test là
**redact**, không phải orphan ⇒ thêm message `user` ở đầu giữ nguyên ý và làm file hợp lệ.
Chi phí nếu sai: mất một ca hợp lệ của guard; nhưng guard đó có test riêng (test "message
đầu còn lại là role tool ⇒ NÉM").

**Ruling: `seq` lấy từ `maxSeq` đọc được từ file, không phải `messages.length`.** Sau khi
nén, `messages` là hậu tố của các dòng message ⇒ `messages.length` nhỏ hơn số dòng đã ghi.
Hiện chưa chỗ nào đọc `seq` khi nạp nên hậu quả mới là "file khó hiểu", nhưng để seq đụng là
quả bom cho người sau. Test canh seq trong file là duy nhất và tăng dần.

- **RED:** 6/6 test mới đỏ (22 test cũ xanh).
- **GREEN:** 28/28.
- **Mutation 1:** `throughCount = daGhi - dangDung.length + input.firstKept` → `input.firstKept`
  ⇒ **1 test đỏ** ("nén lần thứ hai thì bỏ TÍCH luôn"). Đã xác minh mutation đã áp dụng
  (dòng 234). Trả lại.
- **Mutation 2 — KHÔNG BỊ BẮT lần đầu.** `let seq = maxSeq` → `messages.length` ⇒ **28/28
  VẪN XANH**. Nguyên nhân: test cũ nén rồi `append` **trong cùng phiên** — mà lỗi seq chỉ
  xảy ra lúc **MỞ LẠI** session sau khi nén (bộ đếm được dựng lại từ `messages.length`).
  Test rỗng, không phải mutation vô dụng. Sửa test: nén → **đóng** → **mở lại** → append.
  Với mutation còn tại chỗ: **1 test đỏ** (`expected 3 to be 4` — seq bị trùng). Trả lại ⇒
  28/28.
- typecheck 0 lỗi · lint 0 lỗi / 8 warning (baseline) · không BOM.
- **Task 4: complete (commits c503e66..143446a, tests: npx vitest run tests/cli-session.test.ts → 28/28 pass)**

## Task 5: Ranh giới nén + hàm nén

**Ruling: `splitForCompaction` thêm tham số thứ 4 `minMessagesToCompact` (mặc định
`MIN_MESSAGES_TO_COMPACT`) thay vì viết hàm cắt riêng.** Đường web không đổi hành vi
(mặc định giữ nguyên). Đường `overflow` của CLI truyền `0` — nếu còn dính sàn 6 tin
thì hội thoại ≤13 tin không cứu được, dù nó nặng. Chi phí nếu sai: không có.

**Ruling: `CLI_DEFAULT_CONTEXT_WINDOW = 200_000`, KHÁC `FALLBACK_CONTEXT_WINDOW` (32.000)
của đường web.** Đường web là chat thuần; CLI là agent coding — mỗi kết quả tool tới
24.000 ký tự (=6.000 token) nên 32.000 token chỉ chứa nổi ~5 kết quả tool, và một lượt
đọc 10 file là đã tràn mà lịch sử 1 lượt thì **không nén được** ⇒ phiên chết. opencode
dùng đúng 200.000 (`packages/schema/src/model.ts:142`). Hai hằng khác nhau là **có chủ
đích** (hai workload khác nhau), mỗi bên ghi rõ trong comment.

**Ruling: `chooseCut` cắt TIẾN tới message `user` kế tiếp (bỏ nhiều hơn), không lùi.**
Lùi (giữ thêm) thì phần giữ lại có thể vượt ngân sách. Nếu không có `user` ở phía sau
thì lùi về `user` gần nhất ở phía trước; nếu không có `user` nào, hoặc cắt ở 0 ⇒
không nén được (trả `null`).

**Ruling: thêm `force` vào `CompactInput`** (plan không có). Đường `overflow` cần ép nén
dù chưa vượt ngưỡng — không có tham số này thì Task 7 không nối được.

**Ruling: fixture của test phải NẶNG khi test "nén thành công".** Bản đầu dùng lịch sử
6 message nhỏ ⇒ bản tóm tắt (≈250 ký tự) **lớn hơn** phần bị bỏ ⇒ payload không giảm
⇒ 'failed'. Đó là hành vi ĐÚNG (chống báo thành công sai), nhưng không phải ca ta đang
kiểm. Tách thành `msgsNang` (tool result 30.000 ký tự) cho các ca 'ok', và `msgsNhe`
cho ca 'failed' + ca 'chưa vượt ngưỡng'. Chi phí nếu sai: không có.

- **RED:** module chưa có ⇒ test file không import được.
- **GREEN:** 13/13.
- **Mutation 1:** bỏ `options?.force ? 0 : undefined` khi gọi `splitForCompaction` ⇒ **7
  test đỏ**. Đã xác minh mutation áp dụng (dòng 132; dòng 205 là `undefined` có sẵn
  trong `formatCompactContextBlock`, không phải mutation). Trả lại.
- **Mutation 2 (yếu):** `u <= 0` thay bằng `u = split.firstKept` ⇒ 1 đỏ — nhưng **test
  "keep bắt đầu bằng user" KHÔNG đỏ**, tức test chưa nhạy với luật ranh giới. Nguyên
  nhân: fixture cũ rơi vào message `user` sẵn nên cả có lẫn không luật đều xanh.
- **Sửa test cho nhạy:** thêm case "khi điểm cắt rơi GIỮA lượt thì vẫn cắt tới message
  user" với `windowTokens: 32_000` (điểm cắt theo token rơi vào giữa lượt).
- **Mutation 3 (mạnh):** bỏ vòng tìm `user` ở phía sau (`batDau = split.firstKept + 1000`)
  ⇒ **8 test đỏ** (gồm case mới). Đã xác minh áp dụng (dòng 141). Trả lại ⇒ 13/13.
- **typecheck đỎ lần đầu:** stub `doGenerate` của test thiếu `finishReason` ⇒ `tsc` bắt
  được (`Property 'finishReason' is missing`). Sửa stub ⇒ typecheck 0 lỗi. Đây là bằng
  chứng cụ thể cho `AGENTS.md` §1: **test xanh không bảo đảm code biên dịch được**.
- typecheck 0 lỗi · lint 0 lỗi / 8 warning (baseline) · không BOM · `repo-hygiene` +
  `cli-migration-scan` 34/34 · đồ thị lõi 54 → **55** file.
- **Task 5: complete (commits 143446a..fe35483, tests: npx vitest run tests/cli-compaction.test.ts → 13/13 pass)**

## Task 6: `runAgentTurn` trả `finishReason`

**Ruling: dùng `fullStream` ở CẢ HAI nhánh, không await `result.finishReason`.** Lý do đã
ghi ngay trong mã: `result.finishReason` là một Promise, và comment sẵn có trong file đã
ghi rõ "khi provider lỗi, `finishReason` không bao giờ settle" ⇒ await nó là **treo CLI**.
Part `finish` trong `fullStream` thì tới đúng lúc nó tới. Nhánh không có tool trước đây
dùng `textStream` — chuyển sang `fullStream` là tương đương (cùng là dấu chữ) và lấy
được `finishReason`. Chi phí nếu sai: treo CLI khi provider lỗi.

- **RED:** 3/3 test mới đỏ (12 test cũ xanh).
- **GREEN:** 15/15. typecheck 0 lỗi · lint 0 lỗi / 8 warning (baseline) · không BOM.
- **Mutation:** bỏ `case 'finish'` ⇒ **3 test đỏ**. Đã xác minh mutation đã áp dụng (grep
  `case 'finish'` **không còn kết quả nào** — đây là cách xác minh "không còn" chứ không
  phải "còn"). Trả lại ⇒ 15/15.
- **Task 6: complete (commits fe35483..b7012b6, tests: npx vitest run tests/cli-agent-turn.test.ts → 15/15 pass)**

## Task 7: Nối vào REPL + `/compact` + đường `-p`

**Ruling: `session.messages` là nguồn DUY NHẤT — REPL bỏ bản sao `let messages = [...opts.session.messages]`.**
Hai mảng lệch nhau sau `/new` ⇒ khi nén, marker ghi sai ⇒ mở lại session là MẤT hoặc LẶP
lịch sử. `session.messages` là getter trả đúng mảng hiện hành. Chi phí nếu sai: mất lịch
sử khi nén — lỗi không đo được cho tới khi thử mở lại phiên.

**Ruling: tạo file test RIÊNG `tests/cli-repl-compaction.test.ts`** thay vì nhồi vào
`tests/cli-repl.test.ts`. Lý do: file mới cần stub model cho `generateText`, session 20
message, và kiểm system prompt của lượt sau — nhồi vào làm file cũ mất dễ đọc. Cùng
nguyên tắc "mỗi file một trách nhiệm".

**Ruling: debounce 60s CHỈ cho đường `auto`.** Người dùng gõ `/compact` thì phải có tác
dụng — chặn bằng debounce là điều khó chịu không giải thích được. Đường `overflow` thì
càng không được chặn (đó là lần cứu duy nhất). Spec ghi "debounce 60s" chung — đây là
lệch có chủ đích, ghi lại đây.

**Ruling: `buildModelConfigs` trả HAI CẤU HÌNH (chat | nen), không phải hai model.** Vì
sao: `cli/index.ts` gọi `main()` ở module scope ⇒ **không import được trong test** ⇒
phần dựng model phải nằm ở module khác thì mới test được. Trả cấu hình (chứ không trả
model) thì test quan sát được chỗ khác nhau: `chat.fetch` là fetch của người dùng,
`nen.fetch` là `nonStreamingFetch`. Chi phí nếu sai: không có.

**Ruling: `statusCodeOf` đặt ở `cli/compaction.ts`**, dùng chung bởi REPL và `-p` —
không viết hai bản.

- **RED:** `tests/cli-repl-compaction.test.ts` 4 test đỏ (REPL chưa có `/compact`, chưa nén);
  `tests/cli-compaction.test.ts` 1 test đỏ (`buildModelConfigs` chưa có).
- **GREEN:** `cli-repl-compaction` + `cli-repl` + `cli-compaction` ⇒ **38/38 xanh**.
- **Test của tôi sai 1 lần:** "lỗi KHÔNG phải tràn context thì không thử lại" dùng lịch
  sử dài ⇒ nén **tự động** đã chạy trước lượt ⇒ `session.compaction` có là **đúng**.
  Sửa: dùng lịch sử NGẮN cho test đó (lúc đó nén tự động không kích hoạt).
- **Mutation 1:** `buildModelConfigs` cho model CHAT cũng dùng `nonStreamingFetch` ⇒
  **2 test đỏ**. Đã xác minh áp dụng (dòng 307). Trả lại.
- **Mutation 2:** tắt nhánh thử lại khi tràn context trong REPL ⇒ **1 test đỏ** (test
  "provider từ chối vì tràn context…"). Đã xác minh áp dụng (dòng 209). Trả lại.
- **LƯU Ý VỀ `edit`:** lần trả lại mutation 2, `edit` **báo lỗi** "Could not find
  oldString" nhưng **đã áp dụng thay đổi**. Đã xác minh bằng grep (`false &&` còn 0
  kết quả, dòng 209 đúng mã) chứ không tin thông báo của công cụ. Đây là "sửa file hỏng
  âm thầm" theo kiểu mới: **công cụ báo sai trạng thái**.
- typecheck 0 lỗi · lint 0 lỗi / 8 warning (baseline) · không BOM.

## Task 8: Đưa file lõi mới vào `CORE_ENTRIES` + sinh lại bảng kiểm kê

**Ruling: REPL dùng `session.messages` (getter) làm nguồn DUY NHẤT, không giữ bản sao.**
Bản cũ giữ `let messages = [...opts.session.messages]`. Hai mảng lệch nhau sau `/new` ⇒ khi
nén, `throughCount` tính trên mảng sai ⇒ mở lại session là **mất hoặc lặp** lịch sử.
Getter của `SessionStore` trả đúng mảng hiện hành ⇒ một nguồn. Chi phí nếu sai: mất
lịch sử người dùng — lỗi nặng nhất trong toàn bộ plan.

**Ruling: `/new` gọi `session.reset()` (xoá RAM, file giữ nguyên).** Giữ nguyên hành vi
cũ: `/new` là "quên đi" chứ không phải "xoá đi"; mở lại cùng thư mục thì lịch sử cũ vẫn
còn trên đĩa (đây là hành vi **đã có** từ trước, không phải hồi quy).

**Ruling: debounce 60s CHỈ cho đường `auto`.** `manual` (người gõ `/compact`) và
`overflow` (lần cứu) luôn chạy. Chặn lệnh mà người dùng gõ tay là điều khó chịu không
giải thích được. opencode cũng vậy: `compaction.auto = false` thì manual vẫn chạy
(`packages/core/src/session/compaction.ts:210`).

**Ruling: tách `createCompactionRunner` vào `cli/compaction.ts` để REPL và `-p` dùng
chung.** Không thì phần nén bị viết hai lần ⇒ hai nguồn sự thật. Runner đọc
`session.compaction` lúc khởi tạo ⇒ **bản tóm tắt nạp lại từ đĩa** (sống sót qua các
lần chạy) ✓.

**Ruling: `buildModelConfigs(cfg)` trả HAI cấu hình model; `cli/index.ts` dựng model từ
chúng.** `cli/index.ts` gọi `main()` ở module scope ⇒ **không import được trong test**,
nên phần dựng model phải nằm ở module khác thì mới test được. Test canh: chat GIỮ
`fetch` của người dùng, chỉ lượt tóm tắt mới bị ép `stream:false`; kèm test hành vi
`nonStreamingFetch` thật sự biến `stream:true` thành `stream:false`.

**Ruling: test "lỗi KHÔNG phải tràn context" dùng lịch sử NGẮN.** Bản đầu dùng lịch sử
dài ⇒ nén **tự động** đã chạy trước lượt ⇒ `session.compaction` có là đúng, khẳng định
"không nén" sai. Sửa: lịch sử ngắn ⇒ không có nén tự động ⇒ canh đúng điều cần canh.

- **RED:** `tests/cli-repl-compaction.test.ts` 4 test đỏ (REPL chưa có tính năng) ·
  `tests/cli-compaction.test.ts` 1 test đỏ (`buildModelConfigs` chưa có).
- **GREEN:** 22/22 (`cli-compaction` + `cli-repl-compaction`).
- **Mutation 1:** `buildModelConfigs` cho model CHAT cũng dùng `nonStreamingFetch` ⇒
  **2 test đỏ**. Đã xác minh áp dụng (dòng 307). Trả lại.
- **Mutation 2:** tắt đường thử lại khi tràn context (`if (false && …)`) ⇒ **1 test đỏ**
  ("provider từ chối vì tràn context thì nén lại và THỬ LẠI đúng một lần"). Đã xác minh
  áp dụng (dòng 209). Trả lại.
- 7 file CLI test ⇒ **91/91 xanh** · typecheck 0 lỗi · lint 0 lỗi / 8 warning (baseline).
- **Smoke thật:** `npx tsx cli/index.ts` ⇒ vẫn khởi động, in `> cong cu: 14`, nạp
  `AGENTS.md`, provider + token trần. Không có hồi quy ở đường chạy thật.
- **Task 7: complete (commits b7012b6..c443335, tests: npx vitest run tests/cli-*.test.ts → 91/91 pass)**

## Task 8: CORE_ENTRIES + sinh lại bảng kiểm kê

**Ruling: các entry `CORE_ENTRIES` đã được khai NGAY trong task tạo file (Task 1, 3, 5),
không dồn tới Task 8 như plan.** Lý do: `tests/repo-hygiene.test.ts:85` bắt buộc
**mọi** file trong `cli/` phải có trong `CORE_ENTRIES` ⇒ task tạo file mà chưa khai là
để lại repo đỏ. Task 8 vì thế chỉ còn: xác minh + sinh lại bảng + gate.

**Ruling: GIỮ ledger trong git thay vì xoá workspace.** Skill `executing-plans` bảo xoá
workspace khi review sạch ("git history là bản ghi"). Nhưng repo này đang **track** 3
ledger cũ (`.superpowers/sdd/2026-10-18-*/progress.md`) — đó là quy ước của chủ repo,
và các `Ruling:` trong ledger là thứ diff KHÔNG giữ lại. Chi phí nếu sai: một file
markdown thừa trong repo.

- Bảng kiểm kê sinh lại: **không có diff** ⇒ đã khớp `CORE_ENTRIES`. Đồ thị lõi:
  52 → **56** file.
- `cli-migration-scan` + `repo-hygiene` ⇒ 34/34 xanh.
- `npm run build` ⇒ **exit 0** (bảng route đầy đủ) — build thật chứ không chỉ `tsc`.
- `npm run docs:check` ⇒ OK (10 tài liệu, 589 file).
- **Full suite:** 229/230 file, **3637 pass**, 3 fail — **toàn bộ** trong
  `tests/secret-registry.test.ts` (ngân sách thời gian 500ms, đo được 610ms). Đây là
  flaky đã ghi ở `AGENTS.md` §1 ("Đỏ cả khi chạy riêng"). `lib/secret-registry.ts`
  **không** bị sửa trong toàn bộ plan, và test đó gọi thẳng registry chứ không gọi
  code mới ⇒ không phải hồi quy.
  - Một lần chạy trước đó có **2** file đỏ ⇒ file thứ hai là flaky worker-thread
    (`code-mode-escape`) hoặc `launch-desktop` (cổng 3000). Chạy riêng cả hai ⇒
    **83/83 xanh** ⇒ xác nhận là flaky tải máy, không phải hồi quy.
- **Task 8: complete (commits c443335..d187eb1, tests: npm run test → 229/230 file, 3637/3641 pass; 3 fail đều là flaky `secret-registry` đã ghi ở AGENTS.md §1)**

## Lượt 2 — REVIEW ĐỘC LẬP CỦA TÔI (subagent `big-pickle`, review package 2712e79..e555301)

Reviewer đọc diff và tự dựng script thử. Kết quả: **0 Critical, 3 Important, 6 Minor**.
Tôi **tự kiểm chứng lại từng cái** bằng cách chạy code, không tin lời reviewer.

### VỀ NHÁNH LẠI — có agent/session khác làm việc SONG SONG trong repo

Trong lúc review chạy, repo có thêm commit của tôi **không** tự viết:
`c592920` (trùng message với `c443335`), `0734251` (bỏ diff sinh ra khỏi tracking),
`79676f4` ("sua 4 diem reviewer"). Trong đó có `scripts/if-1-plus-1.ts` — sinh ra từ
dòng lệnh lạ của chủ repo lúc 22:17:58.

⇒ Mọi phát hiện của reviewer tôi phải kiểm lại trên **trạng thái mới nhất**, không phải
trên trạng thái lúc tôi giao. Và fix pass của session kia đã sửa 4 điểm (I-1 `/new`
bỏ tóm tắt, I-2 bắt tràn ngầm, I-3 cap mảng, I-4 kết quả vừa đúng trần).

### Important — đã sửa (bởi tôi, phiên này)

**I-A: marker nén ghi xuống đĩa KHÔNG redact** — **ĐÃ SỬA**
`cli/session.ts` ghi `JSON.stringify(marker)` thô, trong khi dòng message thì redact.
Mà bản tóm tắt được sinh từ lịch sử CHƯA redact trong RAM (CLI chỉ che lúc ghi
transcript) ⇒ một khoá đọc từ `.env` có thể nằm nguyên trong `~/.vyen/cli/sessions/*.jsonl`.
Đây là hợp đồng mà chính repo đã ghi ở `cli/session.ts:33-47` ("redact trước khi ghi đĩa").
Sửa: `JSON.stringify(redactSecretsDeep(marker))`.
Test: 2 test mới trong `tests/cli-session.test.ts` (summary chứa khoá; `state.completedRequests`
chứa khoá) — RED trước, GREEN sau.

**I-B: debounce KHÔNG tiến khi nén thất bại** — **ĐÃ SỬA**
`lanNenGanNhat` chỉ được đặt khi nén **thành công** ⇒ nếu nén cứ thất bại (đĩa đầy,
model không trả lời) thì **mỗi lượt lại gọi lại model tóm tắt** ⇒ mỗi lượt đều tốn
tiền mà không nén được gì. Sửa: đặt timestamp ở cả nhánh nén thất bại lẫn nhánh ghi
marker lỗi.
Test: dùng session giả có `compact()` ném ⇒ gọi `nen('auto')` hai lần ⇒ model chỉ được
gọi **1** lần. Mutation (bỏ dòng timestamp) ⇒ đỏ ("expected 2 to be 1").

**I-C: nén TỰ ĐỘNG không có test cô lập** — **ĐÃ SỬA**
Xoá dòng `if (nen) await nen.nen('auto')` thì suite vẫn xanh ⇒ trigger chủ động chính
có thể hỏng mà không ai thấy. Test mới: lịch sử vượt ngưỡng, **không** `/compact`,
**không** provider lỗi ⇒ phải nén, và lượt ĐẦU đã phải mang summary trong system
prompt. Mutation (tắt nén tự động) ⇒ đỏ ("expected 0 to be greater than 0").

### Minor — đã sửa

**M-4: BA bản sao của cùng một phép tính** — **ĐÃ SỬA**
`jsonLengthOf` (private ở `lib/context-budget.ts`), `jsonLengthOf` (private ở
`lib/tool-result-server.ts`) và `serializedLength` (private ở file đó) — ba bản giống
hệt nhau. Đây là "hai nguồn sự thật" (`AGENTS.md` §6). Gộp về **một** hàm export
`jsonLengthOf` trong `lib/tool-limits.ts` (chỉ phép tính thuần, không I/O ⇒ cả
`lib/context-budget.ts` lẫn `lib/tool-result-server.ts` đều import được).

### BÀI HỌC — tôi MẮC LẦM Ở M-4, và AGENTS.md ĐÃ SỬA ĐÚNG CHỖ

Bản đầu tôi xoá `jsonLengthOf` ở `lib/tool-result-server.ts` vì reviewer nói "dead
duplicate". Tôi **tin lời reviewer** mà chỉ grep **định nghĩa** (`function
jsonLengthOf`) chứ **không** grep **chỗ dùng**. Kết quả: `tsc` báo 4 lỗi
`Cannot find name 'jsonLengthOf'` — hàm đó **đang được dùng ở 4 chỗ** (trong code cắt
mảng của fix pass session kia).

Đây đúng là dạng lỗi `AGENTS.md` §2.4 + §6: "số 0 là kết quả đáng ngờ — kiểm lại **phép
đo** chứ không phải kết quả". Tôi đã khôi phục hàm, rồi **gộp** cả ba bản về một chỗ
một cách đúng đắn.

**AGENTS.md đã được cập nhật trong lúc tôi làm** và thêm đúng hai luật cho đúng cái
lỗi này:
- §6.4 "Quét cả cây, không chỉ thư mục code" (ký hiệu còn sống có thể nằm trong
  `tests/`, fixture, hay chỉ xuất hiện dưới dạng *chuỗi*).
- §7.3 "Đổi hợp đồng thì grep mọi caller".

⇒ Bài học cho lượt này: **mọi lời reviewer nói "hàm này chết" phải tự grep chỗ dùng
trước khi xoá.** Đã tuân thủ từ đây.

### Minor còn mở (ghi ra để chủ repo quyết)

- **M-2**: `scripts/if-1-plus-1.ts` — file CỦA CHỦ REPO (tạo lúc 22:17:58 từ dòng lệnh
  lạ), không phải test nào của repo sinh ra. **Không xoá file của chủ repo.** Nhưng nó
  bị commit với message **trùng hệt** `c443335` (`c592920`) ⇒ lịch sử git khó đọc.
  Không sửa được lịch sử đã có; lần sau đừng để hai commit trùng message.
- **M-3**: khi thử lại sau tràn context, chữ đã stream của lượt hỏng vẫn nằm trên màn
  hình và câu trả lời in ra lần hai. opencode cũng vậy.
- **M-5**: đường `-p` (`chayMotLuot`) nằm sau `main()` ở module scope ⇒ **không import
  được trong test** ⇒ các trigger của `-p` chưa có test. Cần tách `chayMotLuot` ra
  module riêng thì mới test được.
- **M-6**: `openSession` ném thì CLI in "chay tiep, chi khong nho duoc" rồi thoát mã 1 —
  có sẵn từ trước, nhưng guard mới của `openSession` (message đầu là `tool`) khiến nó
  dễ gặp hơn.

## Gate cuối toàn plan

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | 0 lỗi |
| `npm run lint` | 0 lỗi / 8 warning (baseline repo) |
| `npm run test` | 229/230 file, 3647 pass; 2 fail = flaky `secret-registry` (AGENTS.md §1) |
| `npm run build` | exit 0 |
| `npm run docs:check` | OK — 10 tài liệu, 589 file |
| BOM | 0 file nguồn có BOM (`tests/repo-hygiene.test.ts` canh) |

## Lượt 3 — sau khi sửa 3 Important + 1 Minor của reviewer

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | 0 lỗi |
| `npm run lint` | 0 lỗi / 8 warning (baseline) |
| `npm run test` | 229/230 file, **3647 pass**; 2 fail = flaky `secret-registry` |
| `npm run build` | exit 0 |



# FINAL REVIEW — reviewer độc lập (subagent, đọc review package 2712e79..d187eb1)

Reviewer tự dựng script thử, fuzz `chooseCut` trên **160.000** lịch sử ngẫu nhiên, và đối
chiếu từng mục Review Focus. Kết quả: **0 Critical**, **4 Important**, **6 Minor**.

Đã tự kiểm chứng lại từng phát hiện bằng cách chạy code, không tin lời reviewer.

## Important — đã sửa

### I-1: `/new` không bỏ bản tóm tắt của phiên cũ — **ĐÃ SỬA**
`createCompactionRunner` giữ `summary`/`state` trong RAM; `session.reset()` chỉ xoá mảng
lịch sử ⇒ phiên MỚI vẫn mang bản tóm tắt của phiên CŨ (và cả khối "đã đọc file
này"). Model tưởng nó vừa sửa file của phiên trước ⇒ hành động theo ngữ cảnh cũ.
Sửa: thêm `reset()` cho `CompactionRunner`; lệnh `/new` gọi nó.
Chi phí nếu sai: model hành động theo ngữ cảnh của phiên đã kết thúc.

### I-2: `finishReason` chưa ai dùng — nhánh "tràn ngầm" chưa có — **ĐÃ SỬA**
Đây là một bước của plan (Task 7, Step 4, mục 3) mà tôi **đã bỏ sót**. `evaluateUsageTrigger`
chỉ được gọi ở đường web ⇒ `finishReason` là field chết ⇒ lời hứa trong comment không có
test đỏ (`AGENTS.md` §2.1).
Sửa: REPL kiểm `evaluateUsageTrigger` sau MỖI lượt thành công; `kind !== 'skip'` ⇒ nén
(`nen('tran-ngam')` — ép cắt, không debounce). Test: usage báo `promptTokens=300.000` với
`windowTokens=32.000` và `finishReason='stop'` ⇒ phải nén, **dù provider không báo lỗi gì**.

### I-3: cap không bound object có field MẢNG — **ĐÃ SỬA**
`capToolResult` chỉ cắt field **chuỗi**. `git_status` trả `{branch, entries:[…]}` và
`bg_status` trả `{jobs:[…]}` — mảng nằm ở cấp trên ⇒ kết quả 88.072 ký tự vượt trần
24.000, trong khi ước lượng luôn cắt ở 24.000 ⇒ thiếu 3,7× ⇒ compaction không kích hoạt
đúng lúc. Sửa: cắt field mảng (bỏ mục cuối, thêm mục đánh dấu) + nhánh dự phòng thay
cấu trúc lồng bằng con trỏ tới bản spill.

### I-4: kết quả VỪA ĐÚNG trần bị báo "đã cắt" + spill thừa — **ĐÃ SỬA**
`fs_read` trả `{content: 24.000 ký tự, …}` ⇒ JSON dài hơn trần ~45 ký tự vì overhead của
chính nó ⇒ cap chạy ⇒ model bị báo `truncated: true` ⇒ **đọc lại file** ⇒ đúng cái lãng
phí token mà `lib/tools/ipc-node.ts` đã ghi chú là bug. Sửa: chỉ đánh dấu "đã cắt" và
spill khi **thật sự cắt được gì**; chênh lệch chỉ do overhead thì trả nguyên kết quả.

### Minor đã sửa
- **M-2**: xoá comment lơ lửng mô tả `capToolResult` cũ trong `lib/agent-tools-server.ts`.
- **M-4**: `session.compact()` ghi đĩa lỗi thì làm sập CLI với lỗi thô → bọc `try/catch`
  trong runner, báo ra và bỏ lần nén đó.
- **M-5**: thêm test "sau khi thử lại, lịch sử vẫn nguyên vẹn" (câu hỏi xuất hiện đúng
  một lần, lịch sử bắt đầu bằng `user`).
- **M-1 + vệ sinh repo**: `scripts/if-1-plus-1.ts` là file CỦA CHỦ REPO (tạo lúc
  22:17:58, không phải test nào của repo sinh ra) bị lệch vào commit vì lệnh `git commit`
  của tôi bị chạy hai lần. **Không xoá file của chủ repo** — chỉ báo lại.
  Ngoài ra `review-package.diff` (1,18 MB, diff sinh ra) bị commit nhầm cùng lệnh `git add`
  thư mục workspace ⇒ đã `git rm --cached` + thêm `.superpowers/sdd/*/review-*.diff` vào
  `.gitignore` để không tái diễn.

### Minor hoãn (ghi ra để chủ repo quyết)
- **M-3**: khi thử lại sau tràn context, chữ đã stream của lượt hỏng vẫn nằm trên màn
  hình và câu trả lời in ra lần hai. opencode cũng vậy. Không sửa trong lượt này.
- **M-6**: `openSession` ném thì CLI in "chay tiep, chi khong nho duoc" rồi thoát mã 1 —
  có sẵn từ trước, nhưng guard mới của `openSession` khiến nó dễ gặp hơn.

## Mutation của lượt sửa review — tất cả đều bị bắt

| Mutation | Kết quả |
|---|---|
| Tắt nhánh bắt tràn ngầm (`quyetDinh.kind !== 'skip'`) | 1 đỏ |
| Bỏ `nen?.reset()` ở lệnh `/new` | 1 đỏ |
| Tắt nhánh cắt field mảng trong `capToolResult` | 1 đỏ |

**Hai mutation ĐẦU TIÊN không bị bắt lần đầu** — test chưa cô lập được nhánh:
- "tràn ngầm": dùng lịch sử NẶNG ⇒ nén **tự động** đã nén trước ⇒ test xanh dù đã tắt
  nhánh. Sửa: dùng lịch sử NHỎ (ước lượng dưới ngưỡng) nhưng usage báo vượt.
- "cap mảng": nhánh dự phòng cũng bound được kết quả ⇒ test chỉ kiểm kích thước thì xanh
  dù đã tắt nhánh. Sửa: kiểm **hình dạng** (mảng còn là mảng và ngắn hơn).

Đây là lần thứ hai trong phiên này một test "xanh" hoá ra không canh gì — và lần này
mutation KHÔNG áp dụng vào code sai, mà test đơn giản là chưa đủ sắc.


---

# LƯỢT 4 — REVIEW TOÀN NHÁNH (reviewer `minimax-m3.1-flash-free`, range `fe5a0c0..994bc03`)

Reviewer soi **58 file / +12.314 dòng** (toàn bộ phần vừa merge lên `main`): 0 Critical,
**5 Important**, 10 Minor. Tôi tự kiểm chứng từng cái bằng cách **chạy code**, không tin lời reviewer.

## Đã sửa (4 Important)

### I-1. Lượt hỏng giữa chừng làm MẤT vết mọi tool đã chạy — **ĐÃ SỬA**

`cli/agent-turn.ts` ném lỗi **trước** khi đọc `result.response` ⇒ `fs_write` đã ghi file mà
transcript không có dấu vết ⇒ `/compact` không biết file nào vừa bị sửa, và đường `overflow`
thử lại ⇒ model **làm lại** đúng các tool call đó ⇒ ghi file hai lần.

**Đo lại (reviewer nói khác):** `result.response.messages` không **reject** — nó resolve ra
**`undefined`** ⇒ không khôi phục được từ đó. Nhưng `fullStream` **có** phát part
`tool-call` lẫn `tool-result`, và `args` là **object đã parse** (đo bằng script, đã xoá) ⇒
dựng lại được từ chính stream.

Cách sửa: gom part tool trong vòng lặp `fullStream` → dựng lại message đúng hình dạng
`response.messages` (một message assistant gộp tool-call, một message tool gộp tool-result) →
**chỉ giữ cặp ĐẦY ĐỦN** (tool-call không có tool-result thì bỏ — ghi nó là tạo chuỗi hở, mà
chuỗi hở làm provider từ chối MỌI lượt sau) → gắn vào chính lỗi qua `WeakMap` (không bọc
lỗi, vì bọc thì `diagnoseUpstreamError` mất status code) → REPL gọi `session.appendAll()`.

**Ruling: gắn partial vào lỗi qua `WeakMap` thay vì bọc lỗi trong class mới.** Bọc lỗi làm
`APICallError.isInstance(e)` false ⇒ `diagnoseUpstreamError` mất status code ⇒ chẩn đoán lỗi
provider (401/429/5xx) bị hỏng. Chi phí nếu sai: phải sửa thêm một lớp bọc lỗi.

Test: 3 test ở `tests/cli-agent-turn.test.ts` (lỗi vẫn nổi; phần đã chạy còn nguyên; mọi
tool-call được ghi đều có tool-result tương ứng) + **1 test ở tầng nối** trong
`tests/cli-repl-compaction.test.ts` (REPL thật sự ghi xuống transcript, và mở lại được).
Mutation: bỏ lệnh `appendAll` ở REPL ⇒ test tầng nối đỏ ✓.

### I-2. Nhật ký audit ghi bí mật thô ra đĩa — **ĐÃ SỬA**

`lib/tools/ipc-node.ts` ghi thẳng dòng audit ra đĩa, **không** qua `redactSecretText`. Mà
`ipc.cjs` audit lệnh shell nguyên văn (`lib/ipc.cjs:953`) và `bg-run` (`:1428`) ⇒ một câu
`curl -H "Authorization: Bearer …"` là đủ để có khoá trong `~/.vyen/cli/vyen-audit.log`.

Cùng chuỗi đó: transcript thì đã che, spill thì đã che, audit log **của web** thì đã che
(`lib/audit-log.ts:246`) — chỉ audit log **của CLI** là chưa.

**Ruling: bọc hàm audit (`auditGoc`) thay vì chỉ che ở chỗ ghi file.** Nếu chỉ che trong
hàm ghi mặc định thì `opts.audit` mà caller tiêm vào vẫn nhận dòng thô. Bọc ở một chỗ ⇒
mọi đường đều được che. Chi phí nếu sai: không có.

Test: 2 test ở `tests/ipc-node-debts.test.ts` (tên file chứa khoá; lệnh shell chứa khoá).
Cả hai đỏ trước khi sửa, có **bằng chứng runtime** (khoá thật nằm trong file audit).
Mutation: bỏ `redactSecretText` ⇒ 2 test đỏ ✓.

### I-3. Phím Esc được quảng cáo nhưng **không nối vào CLI thật** — **ĐÃ SỬA**

`cli/terminal.ts` có `watchInterrupt` viết đầy đủ + 2 file test; `cli/repl.ts` có
`AbortController` + option `watchInterrupt` + test; nhưng `cli/index.ts` **không truyền**
`watchInterrupt` cho `runRepl` ⇒ `AbortController` không bao giờ được `abort()` ⇒ **bấm Esc
không làm gì cả**, dù header của chính file quảng cáo Esc hoạt động.

Cách sửa (2 phần):
1. `cli/index.ts` tách `buildReplOptions()` ra **hàm export** và chỉ gọi `main()` khi được
   gọi trực tiếp (`require.main === module`) ⇒ **tầng nối import được trong test**.
2. `cli/terminal.ts`: cổng duyệt hỏi **trong lúc lượt đang chạy** ⇒ `watchInterrupt` đang
   bật raw mode. Nay `hoi()` **tắt raw mode** khi hỏi và bật lại sau, và cờ `dangHoi` làm
   `Esc` trong lúc hỏi **không** bị hiểu là yêu cầu dừng lượt (người dùng đang trả lời
   câu hỏi, Esc ở đó nghĩa là "tôi không biết").

Test: `tests/cli-repl-wiring.test.ts` (mới) — `buildReplOptions` phải trả `watchInterrupt` là
hàm, phải truyền `modelNen` riêng, `windowTokens` chỉ khi có; + 2 test ở
`tests/cli-terminal.test.ts` (raw mode tắt/bật; Esc khi hỏi duyệt không dừng lượt).
Mutation: `watchInterrupt: undefined` ⇒ test đỏ ✓.

### I-4. `fs_read` không nói model đọc tiếp từ đâu — **ĐÃ SỬA**

Mô tả tool bảo model *"gọi lại với `start_line` lớn hơn"* mà kết quả không nói nó dừng ở
dòng nào ⇒ "lớn hơn" là bao nhiêu? Model đoán ⇒ đọc lại trùng hoặc đọc hụt ⇒ tốn tiền mà
không tiến. Với file > 24.000 ký tự thì đây là **mọi lượt**.

Sửa: `applyReadWindow` trả thêm `startLine`/`endLine`; kết quả tool trả thêm `path` (bám
`lib/fs-access.ts:410-417` của web).

**Ruling: `endLine` đếm DÒNG THẬT, khác bản web.** Web tính
`endLine = startIndex + content.split('\n').length` ⇒ file 5 dòng (kết thúc bằng `\n`) bị báo
là **6** ⇒ model hỏi `start_line=6` ⇒ nhận về dòng rỗng ⇒ lại hỏi tiếp ⇒ **mắc vòng lặp
đọc lại**. CLI là sản phẩm còn lại (web sẽ bị xoá) nên ở đây đếm đúng số dòng thật.
Chi phí nếu sai: CLI lệch 1 đơn vị với web trong khi web còn sống.

Test: `tests/ipc-node-read.test.ts` (mới) — 3 test (đủ `path`/`startLine`/`endLine`; cửa sổ
dòng; file bị cắt trần thì `endLine` nhỏ hơn tổng số dòng). Mutation: bỏ
`startLine`/`endLine` ⇒ 3 test đỏ ✓.

## Minor đã sửa

- **M-2**: header `cli/index.ts` còn ghi *"Không có compaction"* và không liệt kê
  `/compact` lẫn `VYEN_CONTEXT_WINDOW` ⇒ đã sửa cả ba.

## Minor còn mở (ghi ra để chủ repo quyết)

- **M-1**: `/new` chỉ xoá tóm tắt trong RAM; mở lại session thì tóm tắt cũ quay lại (marker
  trên file vẫn còn). Spec F12 có chấp nhận `/new` không xoá marker **cho lịch sử**, nhưng
  bản tóm tắt là thứ khác.
- **M-3**: khi thử lại sau tràn context, chữ đã stream của lượt hỏng vẫn nằm trên màn hình
  và câu trả lời in ra lần hai. opencode cũng vậy.
- **M-5 / M-8**: đường `-p` (`chayMotLuot`) vẫn nằm sau `main()` ở module scope ⇒ **không
  test được**. Đã làm `cli/index.ts` import được (guard `require.main`), nhưng `main()` vẫn
  tự đọc `process.env` và tự tạo terminal ⇒ chưa tách được để test từng nhánh.
- **M-6**: `openSession` ném thì CLI in "chay tiep, chi khong nho duoc" rồi thoát mã 1 — có
  sẵn từ trước, nhưng guard mới của `openSession` (message đầu là `tool`) khiến nó dễ gặp
  hơn.
- **M-4**: test `tests/cli-migration-scan.test.ts` dựng file probe **trong `cli/`** ⇒
  `repo-hygiene` quét `cli/` mà không bỏ qua dotfile ⇒ nếu hai file test chạy song song thì
  hygiene có thể đỏ **với lý do sai**. Chưa bắt được trong 6 vòng chạy nhưng xác suất
  không phải 0.
- **M-10**: `/compact` không debounce nhưng `reset()` không xoá `lanNenGanNhat` ⇒ `/new` xong,
  lượt kế tiếp có thể bị chặn nén tự động còn 60s.

## I-5 — CẦN CHỦ REPO QUYẾT (không tự làm)

Spec §7 (`docs/superpowers/specs/2026-10-18-cli-core-design.md:91`): *"Model không hỗ trợ tool
calling → rơi về `emulated-agent` (đã có, và là tài sản lớn nhất cho BYOK)"*. CLI hiện **không**
có đường này: `cli/repl.ts` luôn truyền `tools` vào `streamText` ⇒ provider từ chối tool ⇒ lỗi
⇒ phiên dừng. Với BYOK + model local (đúng thứ CLI nhắm tới) thì đây là ca chết cả session.

Không plan nào ghi việc này (4 plan đều không có) ⇒ không coi là hồi quy, nhưng nó là **hàng
của spec**. Hoặc làm, hoặc ghi rõ "chưa hỗ trợ" vào tài liệu.

## Gate lượt 4

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | 0 lỗi |
| `npm run lint` | 0 lỗi / 8 warning (baseline) |
| `npm run test` | **231/232 file, 3660 pass**; 3 fail = flaky `secret-registry` (AGENTS.md §1) |
| Smoke CLI | `> cong cu: 14`, nạp `AGENTS.md`, REPL sẵn sàng (sau khi thêm guard `require.main`) |


---

# LƯỢT 5 — I-5: ĐƯỜNG GIẢ LẬP CHO MODEL KHÔNG HỖ TRỢ FUNCTION CALLING

Spec `docs/superpowers/specs/2026-10-18-cli-core-design.md` §91: *"Model không hỗ trợ tool calling
→ rơi về `emulated-agent` (đã có, và là tài sản lớn nhất cho BYOK)"*. CLI **không** có đường
này. Đây là hàng của spec, nên làm.

## Vì sao quan trọng (đã kiểm chứng)

`cli/repl.ts` luôn gửi `tools` cho provider ⇒ provider từ chối ⇒ lỗi ⇒ **phiên dừng**. Với
BYOK + model local (đúng thứ CLI nhắm tới) thì đó là **chết cả session**, không phải lỗi nhỏ.

## 4 task

| Task | Nội dung |
|---|---|
| 1 | `TOOLS_UNSUPPORTED_RE` chuyển từ `app/api/chat/route.ts` vào `lib/tool-support-cache.ts` (**một nguồn** cho web + CLI); `runEmulatedLoop` trả về **message MỚI** |
| 2 | `cli/emulated.ts` (mới) — `runEmulatedTurn` bọc `lib/emulated-agent.ts` với bộ tool của CLI |
| 3 | Nối vào REPL + `VYEN_EMULATED` |
| 4 | `CORE_ENTRIES` + sinh lại bảng kiểm kê + gate cuối |

## Ruling

- **Ruling: dùng LẠI `lib/emulated-agent.ts` thay vì viết vòng lặp thứ hai.** Nó đã có đủ 5 lớp
  loop protection, parser khoan dung, anti-hallucination. Viết bản thứ hai là "hai nguồn sự
  thật" (`AGENTS.md` §6). Chi phí nếu sai: không có.
- **Ruling: `TOOLS_UNSUPPORTED_RE` chuyển vào `lib/tool-support-cache.ts`, KHÔNG viết bản mới
  cho CLI.** Bản cũ `/tool|function/i` ăn vào lỗi tool của CHÍNH app ("Error executing tool
  web_search: fetch failed") ⇒ tước agent của model đó 10 phút vì một lần tool hỏng mạng.
  Chi phí nếu sai: không có.
- **Ruling: đường giả lập dùng instance model RIÊNG (`modelNen`, có `fetch: nonStreamingFetch`).**
  Vòng lặp giả lập dùng `generateText` (buffered) ⇒ không gửi `stream`; gateway bỏ qua
  trường đó và trả SSE ⇒ AI SDK ném "Invalid JSON response" ⇒ đường giả lập chết âm thầm.
  Chi phí nếu sai: không có.
- **Ruling: mọi tool của CLI là "server tool" của vòng lặp giả lập** (không qua `clientTools`).
  `clientTools` là đường của web (yield turn về renderer); CLI chạy tool cục bộ qua
  `lib/ipc.cjs` ⇒ phải đi qua `tools` để thực thi thật. Chi phí nếu sai: tool không chạy.
- **Ruling: `EmulatedLoopResult` THÊM field `messages` (bắt buộc, không phải optional).** Hai
  file test mock `runEmulatedLoop` phải thêm `messages: []` — đó là sửa test theo hợp đồng mới,
  không phải nới kiểu.
- **Ruling: phát hiện "model chê tools" qua `isToolsUnsupportedError`, KHÔNG qua `status 400`
  + chữ "tool".** Dùng đúng mẫu đã đo của web.

## Quy trình — tự thừa nhận 2 lần viết implementation TRƯỚC test

Task 2 và Task 3 tôi viết **implementation trước test** ⇒ test chạy xanh ngay ⇒ **không có
bằng chứng RED**. Đúng mẫu `AGENTS.md` §2.1.

Bù lại bằng **mutation proof** (bằng chứng mạnh hơn: test BẮT ĐƯỢC lỗi):

| Mutation | Kết quả |
|---|---|
| Task 1: `isToolsUnsupportedMessage` → `/tool/i` | 2 test đỏ ✓ |
| Task 2: bỏ `tools` khỏi lời gọi `runEmulatedLoop` | 1 test đỏ ✓ |
| Task 2: `onTextDelta` không gom text | 2 test đỏ ✓ |
| Task 3: tắt nhánh tự chuyển sang giả lập | 2 test đỏ ✓ |
| Task 3: bỏ `markEmulated` (ghi cache) | 1 test đỏ ✓ |

**Và một mutation của tôi là NO-OP:** lần đầu tôi "bỏ `markEmulated`" bằng cách thêm
comment vào dòng lệnh gọi — lệnh gọi vẫn còn ⇒ test vẫn xanh ⇒ tưởng test rỗng. Đúng bẫy
`AGENTS.md` §2.2 ("mutation không áp dụng" ≠ "test rỗng"). Đã sửa lại cho thật và bắt được.

## Test thêm được

- `tests/tool-support-cache.test.ts` (mới) — mẫu khớp/không khớp.
- `tests/emulated-agent.test.ts` — `messages` trả về là phần MỚI.
- `tests/cli-emulated.test.ts` (mới) — tool CLI chạy thật; REPL tự chuyển; native chỉ thử
  MỘT lần (lượt sau đi thẳng giả lập nhờ cache 10 phút).

## Lỗ hổng phát hiện (ghi ra, KHÔNG tự sửa)

Mẫu đã đo của web **không** khớp cách diễn đạt "Function calling IS not supported" (mẫu
`functions?\s+(?:are|is)\s+(?:not\s+supported|…)` cần "function" đứng trước, không khớp
"function calling"). "This model does not support function calling" thì khớp ✓. Tôi **giữ
nguyên** danh sách mẫu đã đo (đó là điểm của việc gộp về một nguồn) và sửa kỳ vọng test
cho đúng phạm vi đã đo. Mở rộng mẫu = đoán, mà `AGENTS.md` §6 nói đừng đoán.

## Gate lượt 5

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | 0 lỗi |
| `npm run lint` | 0 lỗi / 8 warning (baseline) |
| `npm run test` | **233/234 file, 3673 pass**; 2 fail = flaky `secret-registry` |
| `npm run build` | exit 0 |
| `npm run docs:check` | OK — 10 tài liệu, 596 file |


---

# LƯỢT 6 — SỬA PHÁT HIỆN CỦA REVIEWER (1 Critical + 6 Important)

Reviewer: subagent độc lập (model minimax), review `f250d23..380dae3` (4 commit của lượt 5).
Kết quả: **0 Critical** ở lượt 5 trước review… nhưng khi tôi **tự kiểm chứng lại bằng probe**
thì tìm ra **1 Critical thật** mà reviewer đã chỉ ra đúng. Bài học: đừng tin lời "gate xanh"
là đủ — phải đo hành vi thật.

Plan: `docs/superpowers/plans/2026-10-20-cli-emulated-fixes.md` (6 task).

## Tôi tự kiểm chứng từng phát hiện (không tin lời reviewer)

| Phát hiện | Cách tôi kiểm chứng | Kết quả |
|---|---|---|
| **C1** câu trả lời không vào transcript | Đọc `lib/emulated-agent.ts:385-395` + **probe end-to-end** (chạy `runRepl`, đọc file JSONL trên đĩa) | **ĐÚNG** — JSONL chỉ có message `user` |
| **I1** `-p` không có fallback | Đọc `cli/index.ts:227` (`chayMotLuot` gọi thẳng `runAgentTurn`) | **ĐÚNG** |
| **I2** không test wiring | grep `tests/` cho `forceEmulated\|VYEN_EMULATED` | **ĐÚNG** — 0 kết quả |
| **I3** mẫu thiếu/khớp oan | **ĐO bằng chính mẫu đang ship** (17 chuỗi) | **ĐÚNG** — 4 chuỗi thiếu, 2 khớp oan |
| **I4** lỗi tool bị nuốt | Đọc `lib/emulated-agent.ts:444-446, 554-556` | **ĐÚNG** |
| **I5** mất phần đã hoàn thành | Đọc WeakMap `messagesHoanThanh` (chỉ `runAgentTurn` ghi) | **ĐÚNG** |
| **I6** usage = null | Đọc `cli/repl.ts:232` + `lib/context-budget.ts:278` (`promptTokens <= 0` ⇒ `'skip'`) | **ĐÚNG** — lưới tràn ngầm chết |

**Một phát hiện của tôi sai**: script đo đầu tiên báo "does not support tools or function
calling" KHÔNG khớp — nhưng test lại đơn lẻ báo khớp. Hoá ra tôi **đọc lệch dòng** output
(đánh số thứ tự case khác với thứ tự in). Đã đo lại bằng script có **đánh số case + kỳ vọng
tường minh** ⇒ 17/17 đúng. ⇒ Bài học: phải kiểm lại **phép đo**, không chỉ kết quả
(`AGENTS.md` §2.4).

## 6 task

| Task | Nội dung | File |
|---|---|---|
| A (C1) | push câu trả lời cuối vào transcript giả lập | `lib/emulated-agent.ts` |
| B (I5+I6) | phần đã hoàn thành khi lượt hỏng + `finishReason` + usage round cuối | `lib/emulated-agent.ts`, `cli/emulated.ts`, `cli/agent-turn.ts` |
| C (I1+I4) | **MỘT** cơ chế `runTurn` cho cả REPL và `-p`; bọc tool bằng `wrapTools` | `cli/emulated.ts`, `cli/repl.ts`, `cli/index.ts` |
| D (I2) | test wiring `VYEN_EMULATED` / `providerBase` / `modelId` + `docCauHinhGiaLap` | `cli/index.ts`, `tests/cli-repl-wiring.test.ts` |
| E (I3) | bổ sung 3 cách diễn đạt còn thiếu vào mẫu | `lib/tool-support-cache.ts` |
| F | gate cuối + ledger + M4 (web dùng chung một cửa vào) | `app/api/chat/route.ts` |

## Quy trình — LẦT NÀY TEST ĐỎ TRƯỚC (khác lượt 5)

Lượt 5 tôi viết implementation trước test ở 2 task ⇒ không có bằng chứng RED. Lượt này
**mọi task** đều: viết test → thấy ĐỎ → sửa → XANH → mutation.

| Task | Bằng chứng RED | Mutation | Kết quả mutation |
|---|---|---|---|
| A | 2 test đỏ (1 cái đọc JSONL trên đĩa) | bỏ dòng `messages.push` | 3 test đỏ ✓ |
| B | 3 test đỏ | bỏ `messagesHoanThanh.set` | 2 đỏ ✓ |
| B | (cùng trên) | bỏ `onUsage` | 1 đỏ ✓ |
| C | 2 test đỏ (`chayMotLuot` chưa export; lỗi tool bị nuốt) | bỏ `wrapTools` + bỏ nhánh chuyển đường | 6 đỏ ✓ |
| D | 3 test đỏ (`docCauHinhGiaLap` chưa có) | `'1'`→`'true'` + rơi `forceEmulated` | 2 đỏ ✓ |
| E | 3 test đỏ | bỏ 3 mẫu vừa thêm | 3 đỏ ✓ |

**Mutation của tôi phải là mutation THẬT**: ở lượt trước tôi đã "bỏ lời gọi" bằng cách
thêm comment vào dòng lệnh gọi (lệnh gọi vẫn còn) ⇒ test vẫn xanh ⇒ tưởng test rỗng
(`AGENTS.md` §2.2). Lượt này mọi mutation đều **xoá hẳn** hành vi và được xác nhận bằng
`Select-String` trước khi chạy test.

## Ruling

- **Ruling: đường giả lập gửi tool dạng VĂN BẢN ⇒ lỗi "Invalid schema for function" và
  "unknown tool name" KHÔNG phải khớp oan vô hại.** Đường native gửi JSON schema (gateway
  chê ⇒ lỗi), đường giả lập gửi mô tả chữ ⇒ lỗi đó có thể **không** xảy ra. Nên hạ cấp
  10 phút là CỨU, không phải tổn thất. ⇒ **KHÔNG siết** mẫu dùng chung (siết thì rủi ro
  làm hỏng hành vi web đang chạy). Chỉ BỔ SUNG.
- **Ruling: usage của đường giả lập lấy ROUND CUỐI, không phải TỔNG.** Ở đường native,
  `promptTokens` là kích thước MỘT request ⇒ đúng bằng kích thước ngữ cảnh. Ở đường giả
  lập có N round, mỗi vòng gửi lại toàn bộ lịch sử ⇒ TỔNG vượt cửa sổ ngay cả khi ngữ cảnh
  thật còn nhỏ ⇒ báo nén oan. Web làm đúng thế này (`lastStepUsage`).
- **Ruling: bọc tool TRONG `runEmulatedTurn`, không phải trong `runTurn`.** Bọc ở hàm lượt
  giả lập ⇒ mọi caller đều được, không phụ thuộc ai nhớ gọi. (Tôi viết sai lần đầu — đặt
  ở `runTurn` — test bắt được ngay ⇒ dời vào.)
- **Ruling: một cơ chế `runTurn` cho cả REPL và `-p`.** Trước đó quyết định "native trước,
  giả lập khi bị chê" nằm rời ở REPL ⇒ `-p` không có ⇒ `-p` vẫn chết. Viết lại quyết định
  ở hai nơi là "hai nguồn sự thật" (`AGENTS.md` §6).

## Cảnh báo: `package.json` bị npm làm bẩn ⇒ **BUILD VỠ**

Trong lúc chạy gate, `package.json` bị npm **tự thêm** các field (`description`, `main`,
`type: "commonjs"`, …) ⇒ `npm run build` **HỎNG**:
`Specified module format (CommonJs) is not matching the module format of the source code`.

Đã `git checkout -- package.json` ⇒ build xanh lại (exit 0).

⇒ Bài học cho mọi lượt: **kiểm `git status` sau mỗi lệnh npm**, và **luôn chạy `npm run build`
trong gate** — typecheck/test/lint đều xanh với package.json hỏng.

## Minor của reviewer — XỬ LÝ / KHÔNG XỬ LÝ

| M | Nội dung | Quyết định |
|---|---|---|
| M1 | `opts.tools` là điều kiện thừa của nhánh fallback | **Giữ** — đúng logic: không có tool thì không thể bị "chê tools"; và `force` + 0 tool vẫn chat bình thường |
| M2 | `force` không ép được khi thiếu `modelNen` | **Giữ** — CLI thật luôn có `modelNen`; thêm nhánh báo lỗi to là đội hình thừa |
| M3 | in trùng khi chuyển giữa chừng | **Giữ** — lỗi "không hỗ trợ tools" luôn ở request ĐẦU (gateway chê trước khi sinh nội dung) ⇒ không có chữ đã stream để in trùng |
| M4 | web dùng regex thô, CLI dùng helper | **ĐÃ SỬA** — `route.ts` dùng `isToolsUnsupportedMessage` ⇒ một cửa vào |
| M5 | `runEmulatedTurn` trả `text`/`roundsUsed`/`totalCalls` mà REPL không dùng | **Giữ** — hợp đồng của hàm lượt, hữu ích cho `-p` và test |
| M6 | `envEmulated` dựng lại mỗi lượt | **Giữ** — nằm NGOÀI vòng lặp rồi; chi phí không đáng kể |

## Test thêm được

- `tests/cli-emulated.test.ts`: +17 test (C1 transcript, I5 phần đã hoàn thành, I6 usage,
  I1 `-p`, I4 lỗi tool tới model, I2 ép đường giả lập).
- `tests/cli-repl-wiring.test.ts`: +5 test (wiring + `docCauHinhGiaLap`).
- `tests/tool-support-cache.test.ts`: +4 test (cách diễn đạt còn thiếu + KHÔNG khớp lỗi
  tham số khác).

## Gate lượt 6

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | 0 lỗi |
| `npm run lint` | 0 lỗi / 8 warning (baseline) |
| `npm run test` | xem bên dưới |
| `npm run build` | exit 0 (sau khi trả `package.json`) |
| `npm run docs:check` | OK |


---

# LƯỢT 7 — SỬA AGENTS.md SAU KHI PHÂN TÍCH VÌ SAO VẪN CÒN LỖI

Câu hỏi của chủ repo: *"tại sao đã rất kĩ trong lập kế hoạch và thực thi code mà đến cuối
vẫn lỗi — luật AGENTS.md chưa đủ hay có bất cập ở đâu?"*. Tôi trả lời bằng **dữ kiện của
chính phiên này**, rồi sửa `AGENTS.md` và làm cho luật mới **có hiệu lực** (test canh),
vì §4 của chính AGENTS.md nói: tài liệu không có hiệu lực, test mới có.

## Chẩn đoán (không phải "không cẩn thận")

Ba tầng lệch nhau:

| Tầng | Ở đâu | Lệch ở đâu |
|---|---|---|
| Tiêu chí (văn xuôi) | `## Review Focus` trong plan | *"Transcript của lượt giả lập phải ghi được"* — **không tiêu chí nào có test** |
| Việc (mã) | Task trong plan | Task chỉ nói *"trả `messages.slice(soDauVao)`"* ⇒ **thoả mãn được** khi tiêu chí vẫn sai |
| Kiểm chứng | test + review | test xanh vì kỳ vọng lấy từ code (`toBe(2)` — con số đếm từ code); **không có review** trước khi push |

Ba cách sửa lỗi tương ứng:
- **Luật 1** — mỗi tiêu chí = một dòng trong bảng "tiêu chí → test".
- **Luật 2** — kỳ vọng lấy từ YÊU CẦU, không lấy từ code.
- **Luật 3** — mỗi feature có ≥ 1 test kịch bản end-to-end.
- **Luật 4** — review độc lập là BẮT BUỘC trước khi push.

## Kiểm chứng từng luật bằng failure THẬT (RED baseline)

Không dùng "cảm thấy đúng" — mỗi luật phải **bắt được** lượt 5 (lượt có Critical):

| Luật | Áp vào lượt 5 ⇒ kết quả |
|---|---|
| Luật 1 | Bảng "tiêu chí → test" **không tồn tại** ⇒ ĐỎ ✓ (đo bằng bản sao test với `TU_NGAY='2026-10-19'`: 4 assertion đỏ, đúng chỗ) |
| Luật 2 | `expect(r.messages.length).toBe(2)` — 2 là số đếm từ code ⇒ kỳ vọng đổi theo implementation ⇒ **vi phạm** ✓ |
| Luật 3 | Lượt 5 chỉ có test tầng hàm (`messages`), không có test đọc file JSONL trên đĩa ⇒ **vi phạm** ✓ (lỗi nằm đúng ở đó) |
| Luật 4 | Lượt 5 **push 4 commit** mà không gọi `requesting-code-review` ⇒ **vi phạm** ✓ (ledger có review cho lượt 2/3/4, không có cho lượt 5) |

## Luật mới CÓ hiệu lực: `tests/plan-traceability.test.ts`

Plan (trong `docs/superpowers/plans/`, từ 2026-10-20) phải có mục `## Kịch bản & Test`:
câu `**Người dùng thấy:**` + bảng `| # | Tiêu chí | Test |`. Test canh: mỗi mục đánh số
trong `## Review Focus` có một dòng bảng, và file test nêu ở bảng tồn tại (khi plan đã xong).

**3 mutation, cả 3 đều bị bắt:**

| Mutation | Kết quả |
|---|---|
| Xoá dòng bảng của tiêu chí #1 | ĐỎ: *"tiêu chí 1 … không có dòng 'tiêu chí → test' ⇒ văn xuôi không có hiệu lực"* ✓ |
| Trỏ file test không tồn tại | ĐỎ: *"file test không tồn tại: tests/khong-ton-tai.test.ts (dòng 4)"* ✓ |
| Xoá cả mục `## Kịch bản & Test` | ĐỎ 3 assertion ✓ |

## Review độc lập của chính patch này (dogfood Luật 4)

Reviewer (minimax) soi patch và tìm **2 Critical + 4 Important + 6 Minor**. Tôi **tự kiểm
chứng từng cái** trước khi sửa — và cả 2 Critical đều ĐÚNG:

| Phát hiện | Kiểm chứng của tôi | Xử lý |
|---|---|---|
| **C1** `npm run docs:check` ĐỎ (placeholder `tests/ten-file.test.ts` trong AGENTS.md) | Chạy `docs:check` ⇒ đỏ đúng dòng 141 ✓ | Đổi placeholder thành `tests/<ten-file>.test.ts` (regex path không khớp) ⇒ docs:check OK ✓ |
| **C2** cơ chế chỉ canh HÌNH THỨC, không canh NỘI DUNG; và file mẫu của patch tự vi phạm luật | Đọc lại bảng của plan ⇒ đúng là chép từ plan cũ, **không khớp** `Review Focus` của chính nó ✓ | Sửa bảng cho khớp + **bỏ** phần hứa "tiêu chí không có test thì ĐỎ" (chỉ hứa thứ test thật canh) ✓ |
| **I1** "file test phải tồn tại" làm ĐỎ repo khi plan đang làm dở | **Xảy ra ngay trong phiên**: full-suite đỏ vì plan TUI của session song song chưa có file test ✓ | Chỉ áp cho plan **đã xong** (không còn `- [ ]`) ✓ |
| **I2** quét không đệ quy + phạm vi theo tiền tố ngày ⇒ fail-open | Đọc code ✓ | Quét đệ quy + file không có ngày ⇒ coi như TRONG phạm vi (fail-closed) ✓ |
| **I3** guard "không rỗng" canh nhầm số; regex bỏ sót `- 1.`; CRLF làm hỏng parse | Đọc code ✓ | Thêm guard "parse ra ≥1 tiêu chí"; regex nhận `- 1.` / `1)` / `**1.**`; chuẩn hoá CRLF + bỏ khối code ✓ |
| **I4** lệch ngày 2026-10-21 vs 2026-10-20 | Đọc code ✓ | Sửa header ✓ |
| **M5** §10 ghi "trừ 3 flaky" mà §1 liệt kê **bốn** | Đọc file ✓ | Sửa thành 4 ✓ |

## Điều tôi BÁO OAN reviewer, và điều tôi TỪ BỎ sau khi đo

Reviewer đề xuất ràng buộc **nội dung** (dòng bảng phải chứa cụm từ dẫn nhập của tiêu
chí). Tôi đã thử — và nó **bắt oan một plan hợp lệ của agent khác**: tiêu chí *"Màn hình"*
↔ dòng bảng nói *"Transcript … cùng block"* — cùng một thứ nhưng không dùng chung từ nào.

⇒ **BỎ** ràng buộc nội dung. Cơ chế chỉ canh **hình thức** (tiêu chí ↔ dòng bảng; file
tồn tại), và `AGENTS.md` nói rõ điều đó: *"Test KHÔNG canh được việc dòng bảng có thật sự
phủ tiêu chí hay không … Đừng hứa quá thứ test canh."* ⇒ đúng §2.1 (không viết lời hứa
không kèm test đỏ).

Luật 2/3/4 được ghi rõ là **quy tắc cho agent, KHÔNG có test canh** — để §4 không bị
lạm dụng thành "mọi luật đều phải có test".

## Còn nợ (chưa làm, ghi ra để không quên)

- **AGENTS.md gần chạm trần của CLI**: `cli/instructions.ts` cắt file hướng dẫn ở
  `MAX_INSTRUCTION_CHARS = 20_000` ký tự, cắt **phần đuôi** ⇒ §9 (bản đồ) + §10
  (checklist) là thứ bị cắt đầu tiên. Đo 2026-10-20: file dài 16.993 byte (13.9k ký tự)
  trước, **18.265 ký tự** sau ⇒ còn ~1.7k ký tự đệm. Thêm ~1.8k ký tự nữa là mất §10.
  Cần chủ repo quyết: nâng trần, hay rút gọn AGENTS.md, hay chuyển checklist lên đầu.
- Luật 2/3/4 chỉ là quy tắc tự khai ⇒ cần reviewer đọc mỗi lượt (đã thêm vào §10 với
  nhãn *tự khai* / *có test canh*).

## Gate lượt 7

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | 0 lỗi |
| `npm run lint` | 0 lỗi / 8 warning (baseline) |
| `npm run docs:check` | OK — 10 tài liệu, 599 file, 0 lệch (sau khi sửa C1) |
| `npm run build` | exit 0 |
| `npm run test` | xem bên dưới |


### Lượt 7b — cắt AGENTS.md (bài học về context)

Chủ repo nói đúng: *"AGENTS.md chỉ là checklist hướng dẫn thô mà để tận 10.000 dòng trở
lên thì AI ngu làm sao nổi"*. Đo thật:

| Mốc | AGENTS.md |
|---|---|
| Trước lượt 7 | 16.993 byte (≈13.9k ký tự) |
| Sau §2.5 (bản đầu) | 22.379 byte (18.265 ký tự) — **sát trần CLI** |
| **Sau khi cắt (bản này)** | **14.905 byte (12.525 ký tự ≈ 3.1k token)** — nhỏ hơn bản gốc |

⇒ 4 luật mới **không tốn token nào**: cắt được 5.700 ký tự truyện/dữ kiện để bù.

Cách cắt: giữ **luật** + **bảng "lý do thường bỏ qua"** (mật độ cao, là thứ khiến agent
tuân thủ); bỏ các đoạn kể chuyện dài ⇒ dữ kiện nằm ở ledger, mỗi lượt đọc **đúng phần
lượt hiện tại**, không đọc cả file.

Thêm vào đầu AGENTS.md: repo có hàng chục nghìn dòng plan/ledger/design doc — chúng là
**lịch sử**, không phải đầu vào của lượt làm việc; một lượt chỉ cần file này + plan của
lượt đang làm + spec liên quan.

**Không di dời file lịch sử** (repo theo quy ước §4: giữ tại chỗ + dán nhãn; nhiều test
trỏ tới đường dẫn plan cũ trong comment).
