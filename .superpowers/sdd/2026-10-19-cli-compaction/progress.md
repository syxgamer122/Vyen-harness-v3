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

## Gate cuối toàn plan

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | 0 lỗi |
| `npm run lint` | 0 lỗi / 8 warning (baseline repo) |
| `npm run test` | 229/230 file, 3637 pass; 3 fail = flaky `secret-registry` (AGENTS.md §1) |
| `npm run build` | exit 0 |
| `npm run docs:check` | OK — 10 tài liệu, 589 file |
| BOM | 0 file nguồn có BOM (`tests/repo-hygiene.test.ts` canh) |


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
