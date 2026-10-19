# Compaction cho CLI — nén ngữ cảnh khi hội thoại dài

Ngày: 2026-10-19 · Trạng thái: **đã chốt 4 quyết định ở §8** (có tiền lệ opencode) — sẵn sàng lập plan
Bản 2 — sửa 17 chỗ sau builder check độc lập; mọi khẳng định dưới đây đã **tự kiểm chứng lại
bằng mã nguồn thật**, không tin lời reviewer.

## 1. Vì sao

CLI hiện gửi **toàn bộ** lịch sử mỗi lượt (`cli/repl.ts:141` → `runAgentTurn({messages})`).
Hội thoại đủ dài là provider từ chối với lỗi "prompt is too long", và CLI **chết**:
`runAgentTurn` ném lỗi provider ra, `cli/repl.ts:157` bắt rồi in `> LOI: …`.

Repo đã có đủ phần khó, chỉ chưa ai nối vào CLI:

| Có sẵn | Ở đâu | Vai trò |
|---|---|---|
| Ước lượng token, ngưỡng nén, cắt, nhận diện lỗi tràn context | `lib/context-budget.ts` | Toán |
| Marker nén, state tích lũy, đóng gói phần cũ, **tóm tắt tất định không cần LLM** | `lib/context-compaction.ts` | Cơ chế |
| Prompt tóm tắt tiếng Việt | `app/api/compact/route.ts:120-127` | Bộ nén (chưa export — xem F2) |
| Ép `stream:false` cho `generateText` qua gateway | `lib/non-streaming-fetch.ts` | Bắt buộc |
| Đường truyền `fetch` cho adapter | `lib/provider/adapter.ts:43` | Kỹ thuật |
| Cắt trần kết quả tool + spill ra file | `lib/agent-tools-server.ts:127-154` (`capToolResult`) | Chưa dùng cho CLI — xem F3 |

Đường web đã dùng đúng những thứ này (`react/use-chat-orchestration.ts:3707-3833`).
CLI thì chưa, nên "làm việc cả ngày" vẫn chưa khả thi.

## 2. Mục tiêu / không mục tiêu

**Mục tiêu**

1. Nén tự động khi lịch sử vượt ngưỡng, và nén lại khi provider từ chối vì tràn context.
2. Nén thủ công bằng lệnh `/compact`.
3. Bản tóm tắt **sống sót qua các lần chạy** (đóng terminal rồi mở lại vẫn nhớ).
4. Không mất dữ kiện quan trọng khi nén: yêu cầu đã nêu, file đã đọc/sửa/ghi, việc dở dang.

**Không mục tiêu**

- Rút gọn context *chủ động* (tự nén khi token dưới ngưỡng) — chưa cần.
- Tìm kiếm hội thoại (JSONL không có chỉ mục) — việc riêng.
- Xoá web/PWA — việc riêng, chờ CLI đạt chuẩn.

**Phải KHÔNG xảy ra (anti-goal)**

- Không cắt bỏ lịch sử khỏi transcript trên đĩa. Nén là thu gọn *cái gửi cho model*, không
  phải xoá dữ liệu người dùng.
- Không để một lần nén làm hỏng chuỗi tool-call/tool-result — provider sẽ từ chối **mọi**
  lượt sau của phiên, tức một sự cố hiếm biến thành phiên chết vĩnh viễn.
- Không nén xong rồi báo thành công trong khi thực tế vẫn gửi lịch sử cũ (→ F14).

## 3. Ràng buộc đã đo

### 3.1 Ước lượng token KHÔNG chạy trên `CoreMessage` — thiếu 1.200×

`estimateContextTokens` (`lib/context-budget.ts:171`) đếm `part.text` và
`message.toolInvocations`. Cả hai đều là hình dạng **UI message** (`ai/react`):

- `ToolCallPart` / `ToolResultPart` (`ai@4.3.19`, `node_modules/ai/dist/index.d.ts:677,705`)
  **không có field `text`**.
- `CoreMessage` (`index.d.ts:832`) **không có field `toolInvocations`**.

Đo thật (script tạm, đã xoá): lịch sử gồm 1 user + 1 assistant(tool-call)
+ 1 tool(tool-result chứa 24.000 ký tự) + 1 assistant ⇒
`estimateContextTokens` trả **5**, thực tế **~6.000**. Thiếu **1.200×**.

Hệ quả: gọi thẳng `estimateContextTokens(messages)` của CLI thì compaction
**không bao giờ kích hoạt** — đúng dạng "số 0 trông rất hợp lý nên dễ tin"
(`AGENTS.md` §2.4).

⇒ Cần adapter `CoreMessage[] → BudgetMessageLike[]`.

### 3.2 `CoreMessage` tách tool-call và tool-result thành hai message

`CoreAssistantMessage` chứa part `tool-call`; `CoreToolMessage` (`role:'tool'`) chứa part
`tool-result`. UI message của web gộp cả hai vào một message nên **không** gặp vấn đề này.

Nếu điểm cắt rơi giữa `assistant(tool-call)` và `tool(tool-result)`, phần còn lại bắt đầu
bằng message `role:'tool'` không có tool-call đi trước ⇒ provider trả 400 ở **mọi** lượt
sau ("messages with role 'tool' must be a response to a preceding message with 'tool_calls'").

### 3.3 CLI không biết context window của model

`lib/models.ts:22` — `ModelCapabilityConfig` chỉ có `maxOutputTokens`, **không** có context
window. Web lấy được `contextLength` từ `/v1/models` của provider
(`lib/context-compaction.ts:180` `resolveContextWindow`); CLI chỉ có env ⇒ không có.

⇒ `resolveContextWindow(model, undefined)` → `FALLBACK_CONTEXT_WINDOW = 32_000` (nén sớm
hơn là hướng an toàn).

### 3.4 `generateText` cần `fetch` ép `stream:false`

`lib/non-streaming-fetch.ts:8-12` — gateway trả SSE khi thiếu trường `stream`, AI SDK ném
"Invalid JSON response". `ProviderRuntimeConfig.fetch` đã có đường truyền
(`lib/provider/adapter.ts:43`) nhưng `cli/index.ts:292-296` **chưa** truyền.

### 3.5 `git_diff` có thể trả 400.000 ký tự, không spill, không cắt

`lib/ipc.cjs:1041` cap output git ở `SHELL_OUTPUT_MAX_CHARS = 400_000`;
`lib/ipc.cjs:1509-1516` trả thẳng stdout cho tool `git_diff` — **không** spill, **không** cắt.

Trong khi đó `shell_run` thì đã an toàn: `truncateShellOutput` (`lib/ipc.cjs:654-699`) khi
vượt `SHELL_OUTPUT_LIMIT_BYTES = 50_000` thì spill full ra temp file, trả preview ≤
`SHELL_OUTPUT_PREVIEW_BYTES = 10_000` + đường dẫn đọc tiếp.

⇒ Một lần `git_diff` trong CLI có thể nhồi **~100.000 token** vào ngữ cảnh, trong khi
ước lượng chỉ thấy 6.000 (cap `TOOL_RESULT_ESTIMATE_CHARS = 24_000`). Thiếu **17×**.

Đây là lỗi **hiện hữu của CLI**, không phải chỉ lỗi của compaction: server đã cắt ở
`capToolResult` (`lib/agent-tools-server.ts:127-154`), CLI thì không.

## 4. Quyết định thiết kế

### 4.1 Bản tóm tắt đi vào **system prompt**, không thành message

Giống hệt web (`app/api/chat/route.ts:1617-1619` chèn `[Tóm tắt phần hội thoại đã nén
trước đó]` vào `composedSystem`).

Lý do: `runAgentTurn` đã có tham số `system` (`cli/agent-turn.ts:26`); biến summary thành
message `role:'user'` sẽ chen vào chuỗi tool và dễ sinh chuỗi hở. opencode chọn hướng
khác (checkpoint là một message) nhưng họ có mô hình message riêng, không phải `CoreMessage`
của AI SDK v4.

Hệ quả bắt buộc: transcript JSONL **không** chứa summary dưới dạng message ⇒ summary phải
lưu riêng (4.3) và nạp lại khi mở session.

### 4.2 Transcript giữ nguyên, chỉ *cái gửi cho model* bị cắt

`openSession` nạp **mọi** message trong file. Sau khi nén, REPL phải giữ lệnh cũ (để người
dùng đọc lại) nhưng **chỉ gửi** phần sau ranh giới + summary.

Giống web: Dexie giữ `db.messages` đầy đủ, server cắt `messages.slice(boundaryIndex+1)`.

### 4.3 Marker nén lưu thành **dòng JSONL mới**

Định dạng file hiện tại (`cli/session.ts:19-21`):

```
dòng 1: header   {"kind":"header","sessionId":…,"directory":…}
dòng 2+: message {"seq":N,"message":{…}}
```

Thêm:

```
{"kind":"compaction","throughCount":N,"summary":"…","state":{…},"createdAt":…}
```

**`throughCount` = số dòng message nằm TRƯỚC dòng marker trong file.** Không dùng `seq`:
`CoreMessage` không mang seq, mà `openSession` chỉ giữ một bộ đếm — buộc phải lộ seq ra
ngoài thì dễ lệch. Marker nằm **vật lý** sau các message nó thay, nên loader đếm được.

Quy tắc nạp:

- Lấy dòng `compaction` **cuối cùng**.
- Bỏ `throughCount` message đầu tiên; phần còn lại là lịch sử dùng để gửi cho model.
- `summary` trả ra riêng, REPL ghép vào system prompt mỗi lượt.

Vì sao để `summary` ở ngoài chuỗi message thay vì là một message `role:'user'`: giữ được
đúng hình dạng `CoreMessage` mà provider chấp nhận, và không phải sửa `kiemTraChuoi`.

**Ràng buộc phải xử lý:** `seq` phải theo dõi `maxSeq` đọc được từ file, **không** dùng
`messages.length` — sau khi cắt, `messages.length` ≠ số dòng đã ghi, nên seq sẽ đụng nhau.

### 4.4 Adapter `CoreMessage → BudgetMessageLike`

- **1:1 với `CoreMessage[]`** — mỗi message ra đúng một entry (message `role:'tool'` ra
  entry rỗng). `splitForCompaction` trả `firstKept` là **chỉ số** vào mảng được truyền vào;
  nếu adapter làm rơi message thì chỉ số lệch ⇒ cắt nhầm ⇒ mồ côi `role:'tool'`.
- Một entry `toolInvocations` cho **mỗi** tool call, gộp args (từ part `tool-call`) và
  result (từ part `tool-result`) theo `toolCallId` — đúng hình dạng UI message, để
  `extractFileOps` và `describeToolInvocation` của `lib/context-compaction.ts` dùng lại được
  không sửa một chữ.

Nếu tách thành hai entry (`call` + `result`), `serializeForCompaction` sẽ sinh **hai** dòng
mô tả cho mỗi tool call, và `toolInvocationChars` sẽ đếm trùng.

### 4.5 Điểm cắt phải nằm ngay trước một message `role:'user'`

Sửa một lần, giải quyết cả hai lỗi:

- **Mồ côi `role:'tool'`** (§3.2): nếu phần giữ lại bắt đầu bằng message `user`, thì mọi
  cặp tool-call/tool-result đều nằm trọn vẹn ở một bên.
- **Anthropic yêu cầu message đầu tiên là `user`**: `@ai-sdk/anthropic` không tự chèn
  message `user` đầu tiên. Nếu phần giữ lại bắt đầu bằng `assistant`, mọi lượt sau đều 400.

Cách làm — **tiến** điểm cắt tới message `user` kế tiếp (bỏ thêm, không giữ thêm):

1. Tìm message `user` **đầu tiên** có chỉ số ≥ điểm cắt dự kiến ⇒ cắt ở đó (bỏ nhiều hơn,
   phần giữ lại chắc chắn vừa ngân sách).
2. Nếu không có ⇒ tìm message `user` **cuối cùng** có chỉ số < điểm cắt dự kiến ⇒ cắt ở đó
   (giữ nhiều hơn, có thể vượt ngân sách — kiểm chứng sau khi nén sẽ bắt).
3. Nếu cả lịch sử không có message `user` nào ⇒ **không nén được**, trả `null`.

Hệ quả thẳng: hội thoại chỉ có **một** lượt (`user` + tool + assistant) thì **không nén
được** — không có chỗ cắt nào mà phần giữ lại vẫn hợp lệ. Đây là giới hạn thật, ghi rõ
chứ không giấu. (opencode tránh được nhờ cơ chế checkpoint thay thế toàn bộ lịch sử; Vyen
dùng kiểu "summary trong system prompt" nên phải giữ lịch sử thật.)

### 4.5b Mặc định context window của CLI là 200.000, không phải 32.000

`FALLBACK_CONTEXT_WINDOW = 32_000` (`lib/context-budget.ts:102`) là mặc định của **đường
web** — đường chat thuần. CLI là **agent coding**: mỗi kết quả tool tới 24.000 ký tự
(= 6.000 token), nên 32.000 token chỉ chứa nổi **~5** kết quả tool. Một lượt đọc 10 file
là đã tràn ⇒ nén sớm liên tục, và một lượt đơn lẻ không nén được (xem §4.5).

opencode dùng đúng **200.000** cho mô hình không khai context window
(`packages/schema/src/model.ts:142`). CLI lấy cùng mặc định đó.

⇒ Hằng mới `CLI_DEFAULT_CONTEXT_WINDOW = 200_000` trong `cli/compaction.ts`; web giữ
nguyên 32.000. Hai hằng khác nhau là **có chủ đích** (hai workload khác nhau), và mỗi bên
đều ghi rõ trong comment tại sao.

### 4.6 Ba điểm kích hoạt

| Trigger | Điều kiện | Hành vi |
|---|---|---|
| `auto` | ước lượng vượt ngưỡng | nén rồi gửi lượt đó |
| `manual` | người dùng gõ `/compact` | nén, không đổi câu hỏi đang chờ |
| `overflow` | provider trả lỗi tràn context | nén rồi **thử lại đúng 1 lần** |

Debounce 60 giây giữa hai lần nén (giống `use-chat-orchestration.ts:3713`) — **nhưng miễn
cho `overflow`**. Nếu không, một lần nén tự động vừa xong sẽ chặn luôn lần cứu, và lượt
đang bị gateway từ chối sẽ chết.

### 4.7 Khi gọi LLM tóm tắt hỏng

`buildEmergencySummary` (`lib/context-compaction.ts:453`) — tất định, không cần LLM, không
tốn request, không bao giờ thất bại. Trích được bằng thuật toán: yêu cầu đã nêu, file đã
sửa/ghi/đọc, kết luận cuối, ngữ cảnh lượt đang dở.

Quy tắc giống web (`use-chat-orchestration.ts:3789`): đường `auto`/`manual` mà không có
summary ⇒ **huỷ**, không cắt im lặng. Đường `overflow` ⇒ **buộc phải cắt**, vì lượt đang bị
gateway từ chối.

### 4.8 State tích lũy qua các lần nén

`mergeCompactionState` (`lib/context-compaction.ts:89`) giữ file đã đọc/sửa/ghi và yêu cầu đã
nêu qua mọi lần nén. Vì sao cần: bộ nén LLM mỗi lần chạy độc lập, không biết file nào đã
sửa ở lần trước — sau 2-3 lần nén, model mất sạch dấu vết công việc.

Marker lưu `state`; lần nén sau ghép state cũ vào khối ngữ cảnh có cấu trúc
(`formatCompactContextBlock`).

### 4.9 Bản tóm tắt phải **hợp nhất**, không phải thay thế

Bản tóm tắt ở lần nén thứ hai **phải chứa** cả nội dung lần nén thứ nhất. Nếu không, lần
nén thứ hai xoá sạch những gì lần thứ nhất đã ghi — đúng cái "sau 2-3 lần nén, model mất
sạch dấu vết công việc".

Cách làm (theo opencode): lượt tóm tắt nhận **cả** bản tóm tắt cũ lẫn phần mới, và yêu
cầu viết **một** bản tóm tắt hợp nhất. Marker giữ **một** `summary` — bản hợp nhất — nên
không phình vô hạn. Trần: `COMPACT_SUMMARY_MAX_CHARS = 16_000` (đã có ở
`lib/context-compaction.ts:523`) — summary nằm trong system prompt **mọi lượt**, không có
trần thì đó là rò rỉ context.

### 4.10 Context window: biến môi trường tùy chọn

`VYEN_CONTEXT_WINDOW` — người dùng khai cửa sổ thật của model BYOK. Bỏ trống ⇒
`CLI_DEFAULT_CONTEXT_WINDOW = 200_000` (xem §4.5b).

Tiền lệ opencode: `limit` lấy từ catalog models.dev; BYOK không có metadata ⇒ default
`{ context: 200_000, output: 32_000 }` (`packages/schema/src/model.ts:142`), và người dùng
override tay qua **config file** `provider.<id>.models.<modelId>.limit`
(`packages/core/src/config/plugin/provider.ts:97`) — **không có env var**.

Vyen khác opencode ở đúng một chỗ: CLI **không có config file**, chỉ có biến môi trường.
Nên env var là đường duy nhất để khai cửa sổ thật.

## 5. Sửa những chỗ bản 1 của thiết kế sai

| # | Bản 1 nói | Thực tế (đã kiểm) | Sửa |
|---|---|---|---|
| F1 | Truyền `fetch: nonStreamingFetch` cho adapter của chat | `createNonStreamingFetch` ghi đè `stream:false` **vô điều kiện** (`lib/non-streaming-fetch.ts:40`); `@ai-sdk/openai` gửi `stream:true` 3 chỗ, `@ai-sdk/anthropic` 1 chỗ ⇒ **mọi lượt chat sẽ hỏng** | **Hai** instance model: `lm` (chat, không `fetch`) và `lmNen` (tóm tắt, `fetch: nonStreamingFetch`) |
| F2 | Dùng `SUMMARY_SYSTEM` sẵn có | Nó là `const` **không export** ở `app/api/compact/route.ts:120`; grep không có bản thứ hai | Chuyển nó **và** hàm dựng prompt vào `lib/context-compaction.ts`; route import từ đó — một nguồn sự thật |
| F3 | Ước lượng thiếu 1.200× là vấn đề chính | Ngoài ra `git_diff` còn thiếu **17×** (§3.5) | **Bound kết quả tool ở tầng CLI** giống `capToolResult` của server: `saveSpillText` + cắt trần + `spillNotice` + `truncated:true`. Tách `capToolResult` ra module dùng chung, không viết bản thứ hai |
| F4 | Overflow ⇒ buộc cắt | `splitForCompaction` trả `null` khi `firstKept < MIN_MESSAGES_TO_COMPACT` (6) ⇒ hội thoại **≤ 13 tin** không nén được, kể cả đường overflow | Đường `overflow` phải có đường cắt riêng, bỏ qua sàn 6-tin |
| F5 | Debounce 60s cho mọi lý do | Sẽ chặn luôn lần cứu | **Miễn debounce cho `overflow`** |
| F6 | Chỉ xử lý mồ côi `role:'tool'` | Anthropic còn đòi message đầu là `user` | Điểm cắt **luôn** nằm trước message `user` (§4.5) |
| F7 | Adapter gộp call+result | Phải **1:1** với `CoreMessage[]` mới giữ được chỉ số | Ràng buộc 1:1 ghi vào thiết kế |
| F8 | `kiemTraChuoi` bắt được chuỗi hỏng | Nó chỉ bắt tool-call **thiếu** tool-result; mồ côi tool-result là vô hình | Thêm guard lúc nạp: message đầu tiên phải là `role:'user'` |
| F9 | Marker giữ `summary` + `state` | `state` chỉ giữ *đường dẫn file* và *yêu cầu* — mất quyết định và kết luận | Summary phải **hợp nhất** qua các lần nén (§4.9) |
| F10 | Marker dùng `throughSeq` | Không ai sinh ra `seq` đó | Dùng **`throughCount`** — số message trước marker (§4.3) |
| F11 | Chỉ nói tới REPL | `chayMotLuot` (`cli/index.ts:186-238`) cũng chết với lỗi tràn context | `-p` cũng phải có nén + thử lại |
| F12 | — | `/new` chỉ xoá trong RAM, file không đổi ⇒ marker cũ vẫn còn | Ghi rõ: file là chân lý, `/new` không xoá marker — **đúng hành vi `/new` hiện tại** (restart vẫn thấy lịch sử cũ) |
| F13 | Dùng `evaluateUsageTrigger` | Nó cần `finishReason`; `runAgentTurn` chỉ trả `promptTokens`/`completionTokens` | `runAgentTurn` trả thêm `finishReason` |
| F14 | — | "Nén thành công" có thể là nói dối | **Kiểm chứng sau khi nén**: ước lượng lại payload sau cắt; không giảm thì báo thất bại |
| F15 | Ngưỡng = lịch sử | System prompt của CLI chứa `AGENTS.md` tới 20.000 ký tự ≈ 5.000 token (`cli/instructions.ts:43`) | Ngân sách tính cả system + summary: `estimatePromptTokens(messages, [system, summary])` |
| F16 | — | Summary nằm trong system **mọi lượt** | Trần `COMPACT_SUMMARY_MAX_CHARS = 16_000` |
| F17 | Dùng `temperature: 0.3` như web | `lib/models.ts:34` `NO_TEMPERATURE`: model reasoning **400** nếu gửi `temperature` | Chỉ gửi `temperature` khi `capabilityFor(model).supportsTemperature` |

## 6. Những gì khác opencode, và vì sao

| opencode | Vyen (chọn) | Vì sao |
|---|---|---|
| Giữ 15k token gần nhất nguyên văn cạnh summary | `retainedTailBudget` = một nửa ngưỡng, tối thiểu 2k | Dùng chung `splitForCompaction` với web ⇒ không lệch hai đường |
| Provider từ chối "too long" ⇒ thử lại 70% → 50% → 35% | thử lại đúng 1 lần | Web cũng chỉ 1 lần; thêm bậc thang là việc riêng |
| Summary là một message checkpoint | summary nằm trong system prompt | `CoreMessage` của AI SDK v4 + `runAgentTurn` đã có `system` |
| Template tóm tắt có cấu trúc (Objective/Decisions/Next Move…) | `SUMMARY_SYSTEM` của repo + biến thể "hợp nhất" (§4.9) | Một nguồn sự thật; repo đã có prompt tiếng Việt + câu chống prompt-injection |
| State tích lũy qua các lần nén | `mergeCompactionState` | Đã có sẵn |
| Output tool bị giới hạn, full nằm trong file đọc tiếp | `shell_run` đã có (`ipc.cjs:654`); `git_diff` **chưa** → phải bổ sung (F3) | opencode: "Shell stores combined process output in its backing file and returns a bounded tail with the full-output path when truncated" |

## 7. Cấu trúc file dự kiến

| File | Vai trò |
|---|---|
| `cli/compaction.ts` (**mới**) | adapter `CoreMessage → BudgetMessageLike`; hàm nén; ghép system prompt |
| `cli/session.ts` (sửa) | đọc/ghi dòng `compaction`; `seq` theo `maxSeq`; trả `compaction` khi mở; guard message đầu |
| `cli/repl.ts` (sửa) | 3 điểm kích hoạt; cắt `messages` trong RAM; `/compact` |
| `cli/index.ts` (sửa) | dựng **hai** model (`lm`, `lmNen`); `VYEN_CONTEXT_WINDOW`; `-p` dùng chung đường nén |
| `cli/agent-turn.ts` (sửa) | trả thêm `finishReason` |
| `lib/context-compaction.ts` (sửa) | chuyển `SUMMARY_SYSTEM` + prompt hợp nhất vào đây; thêm hàm dựng prompt |
| `app/api/compact/route.ts` (sửa) | import `SUMMARY_SYSTEM` từ `lib/context-compaction.ts` thay vì định nghĩa riêng |
| `lib/tool-result-cap.ts` (**mới**) hoặc `lib/tool-result-server.ts` (sửa) | `capToolResult` dùng chung cho server và CLI (F3) |
| `lib/tools/ipc-node.ts` (sửa) | áp `capToolResult` cho mọi kết quả tool của CLI |
| `scripts/cli-migration/import-graph.ts` (sửa) | thêm entry mới vào `CORE_ENTRIES`; chạy lại `build-inventory.ts` |

Không tạo file mới cho thứ đã có (`AGENTS.md` §6).

## 8. Quyết định (có tiền lệ opencode)

Cả 4 câu đã trả lời bằng mã nguồn opencode, không phải bằng phỏng đoán.

### 8.1 `VYEN_CONTEXT_WINDOW` — **CÓ**, mặc định 200.000

opencode không có env var nhưng **có** override tay qua config file
(`provider.<id>.models.<modelId>.limit`). Vyen CLI không có config file ⇒ env var là đường
duy nhất. Mặc định lấy đúng của opencode: **200.000** (xem §4.5b — 32.000 của đường web
quá nhỏ cho agent coding).

### 8.2 `/compact` trong REPL — **CÓ**

opencode có `/compact` là **keymap command của TUI**
(`packages/tui/src/routes/session/index.tsx:953-976`, `slash: { name: "compact" }`, keybind
`<leader>c` ở `packages/tui/src/config/keybind.ts:130`) và là **builtin của ACP**
(`packages/cli/src/acp/catalog.ts:10`). Nó **luôn chạy**, kể cả khi `compaction.auto = false`
(`packages/core/src/session/compaction.ts:210`).

Vyen không có TUI ⇒ đặt ở `parseCommand` của REPL (`cli/repl.ts:46`), cùng kiểu với
`/exit` và `/new`.

### 8.3 Model tóm tắt — **dùng luôn model đang chat**

opencode có agent ẩn tên `"compaction"` (`packages/core/src/plugin/agent.ts:120-124`),
**không set model** ⇒ mặc định dùng model của session; người dùng cấu hình model riêng
được qua `agents.compaction.model` (`packages/core/src/config/plugin/agent.ts:105`).

Vyen: **dùng model đang chat**, không thêm `VYEN_COMPACT_MODEL`. Lý do: opencode cần cơ
chế đó vì họ có cả hệ thống config + nhiều agent ẩn (`title`, `summary`, `compaction`);
Vyen BYOK với một model, thêm biến là thêm một đường phải kiểm mà không đổi được gì.

Lưu ý: **không gửi `temperature`** cho model reasoning (F17).

### 8.4 Kết quả tool dài — **CÓ, spill ra file**

opencode làm hai tầng:

| Tầng | File | Cắt |
|---|---|---|
| Generic cho **mọi** tool | `~/.local/share/opencode/tool-output/tool_<id>` | **đầu**, 2.000 dòng / 50 KiB |
| Riêng cho shell | `~/.local/share/opencode/shell/<projectID>/<shellID>.out` | **đuôi** (tail) |

(`packages/core/src/tool-output.ts:13-14,55,67-118`; `packages/core/src/shell.ts:144,242-257`.)
Cơ chế generic **bỏ qua** tool đã tự khai `metadata.truncated`. File nằm ngoài thư mục
project, retention 7 ngày.

Vyen: `shell_run` **đã có sẵn** tầng shell (`lib/ipc.cjs:654-699`: spill full ra temp file,
trả preview ≤ 10.000 byte + `savedTo` + `previewHint`). **Thiếu tầng generic** — `git_diff`
trả thẳng tới 400.000 ký tự (§3.5).

⇒ Áp `capToolResult` của server (`lib/agent-tools-server.ts:127-154`) cho **mọi** tool của
CLI: `saveSpillText` + cắt trần + `spillNotice` + `truncated: true`. Đúng mô hình opencode,
và dùng lại code có sẵn thay vì viết bản thứ hai (`AGENTS.md` §6).

Trong bản tóm tắt, opencode cắt tool output còn **1.250 ký tự**
(`packages/core/src/session/compaction.ts:100`); Vyen dùng `TOOL_TRACE_CHAR_CAP = 300` cho
dấu vết tool (`lib/context-compaction.ts:202`) — chặt hơn, giữ nguyên.

## 9. Còn lại cho người xây

- Chi tiết hàm ký và nơi đặt từng dòng.
- Thứ tự task và cách chia test.
- Chỗ chính xác để ghép `summary` vào system prompt (thứ tự với phần hướng dẫn tool).
- Có cần `capToolResult` xử lý riêng kết quả **không phải chuỗi** (object) không.
