# Sửa phát hiện của reviewer — đường giả lập CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa 1 Critical + 6 Important mà reviewer tìm ra cho đường giả lập của CLI (I-5).

**Architecture:** Không có cơ chế mới. Tất cả sửa nằm trong 4 file đã có
(`lib/emulated-agent.ts`, `lib/tool-support-cache.ts`, `cli/emulated.ts`, `cli/agent-turn.ts`)
+ 2 file nối (`cli/repl.ts`, `cli/index.ts`).

**Tech Stack:** TypeScript, AI SDK v4, vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-cli-core-design.md` §91 +
`docs/superpowers/plans/2026-10-19-cli-emulated.md`.

## Global Constraints

- **Lượt này: test ĐỎ TRƯỚC khi sửa** — reviewer đã chỉ ra lượt trước viết implementation
  trước test ở Task 2/3 (`AGENTS.md` §2.1). Mutation vẫn là kiểm tra bổ sung, không thay
  thế bằng chứng RED.
- Comment tiếng Việt **có dấu**; commit message **không dấu**.
- Mọi lời hứa trong comment mới phải có test đỏ khi bỏ lớp bảo vệ (`AGENTS.md` §2.1).
- Dùng lại cơ chế có sẵn (`AGENTS.md` §6): `wrapTools`, `messagesDaHoanThanh`,
  `evaluateUsageTrigger`, `TOOLS_UNSUPPORTED_RE` — **không** viết bản thứ hai.
- Ba gate mỗi task: typecheck 0 lỗi · test không đỏ (trừ 4 flaky `AGENTS.md` §1) · lint 0 lỗi mới.

## Review Focus

1. **Không mất dữ liệu người dùng**: câu trả lời của model phải nằm trong transcript trên đĩa.
2. **Một cơ chế**: REPL và `-p` phải dùng CHUNG một quyết định "native trước, giả lập khi bị chê".
3. **Lỗi tool phải tới được model** (đường giả lập không được nuốt lỗi thành "tạm thời không khả dụng").
4. **Lưới an toàn tràn ngầm phải sống** trên đường giả lập (usage + finishReason).

## Kịch bản & Test

**Người dùng thấy:** người dùng model local (không hỗ trợ function calling) gõ câu
hỏi ⇒ CLI **vẫn trả lời được** thay vì báo lỗi rồi dừng phiên; câu trả lời nằm
trong transcript trên đĩa nên đóng terminal rồi mở lại vẫn thấy, và lượt sau model
không hỏi lại điều nó vừa trả lời. Tool của CLI (`fs_*`, `shell_run`, `git_*`) chạy
thật, và khi bị từ chối thì model biết **lý do** chứ không thấy "tạm thời không khả
dụng".

| # | Tiêu chí | Test |
|---|---|---|
| 1 | Không mất dữ liệu người dùng: câu trả lời của model phải nằm trong transcript trên đĩa | `tests/cli-emulated.test.ts` |
| 2 | Một cơ chế: REPL và `-p` dùng chung một quyết định "native trước, giả lập khi bị chê" | `tests/cli-emulated.test.ts` |
| 3 | Lỗi tool phải tới được model (không nuốt thành "tạm thời không khả dụng") | `tests/cli-emulated.test.ts` |
| 4 | Lưới an toàn tràn ngầm phải sống trên đường giả lập (usage + finishReason) | `tests/emulated-agent.test.ts` |

> Tiêu chí #1 là chính Critical của lượt 5: lượt đó có "Review Focus" yêu cầu nó nhưng
> **không tiêu chí nào có test** ⇒ task "trả `messages.slice(soDauVao)`" thoả mãn được
> mà tiêu chí vẫn sai. Test cho #1 chỉ sinh ra ở lượt 6 (`tests/cli-emulated.test.ts`,
> case "file JSONL trên đĩa phải chứa câu trả lời").

---

### Task A (C1): câu trả lời cuối PHẢI vào transcript giả lập

**Files:**
- Modify: `lib/emulated-agent.ts` (nhánh prose, dòng ~391-395)
- Test: `tests/cli-emulated.test.ts`

**Root cause (đã đo, không phải suy đoán):** nhánh `if (isFinalRound || calls.length === 0)` gọi
`opts.onTextDelta(answer)` rồi `return` — **không** push `{role:'assistant', content: answer}`
vào `messages`. Lượt chỉ có prose ⇒ `messages` rỗng ⇒ transcript CLI không có câu trả lời.

**Đã kiểm chứng trước khi sửa:**
- `app/api/chat/route.ts:1808` và `lib/subagent.ts:327` chỉ đọc `status`/`roundsUsed`/`totalCalls`
  ⇒ push thêm **không** ảnh hưởng web/subagent.
- `messages` trong `runEmulatedLoop` là mảng **cục bộ** (`opts.messages.filter(...)` tạo mảng mới)
  ⇒ không mutate transcript của caller.

- [x] **Step 1: Viết test đỏ** — 2 test:
  1. `runEmulatedTurn` với model trả prose ⇒ `r.messages` phải chứa câu trả lời.
  2. `runRepl` với model giả ⇒ đọc file JSONL trên đĩa ⇒ phải thấy câu trả lời của assistant.
- [x] **Step 2: Chạy → RED**
- [x] **Step 3: Implement** — push `{ role: 'assistant', content: answer }` ngay trước `return`.
- [x] **Step 4: GREEN**
- [x] **Step 5: Mutation** — bỏ dòng push ⇒ test đỏ.
- [x] **Step 6: Gate + commit** — `fix(cli): ghi cau tra loi cuoi vao transcript duong gia lap`

---

### Task B (I5 + I6): `lib/emulated-agent.ts` — phần đã hoàn thành + finishReason

**Files:**
- Modify: `lib/emulated-agent.ts`
- Test: `tests/cli-emulated.test.ts`, `tests/emulated-agent.test.ts`

- [x] **Step 1: Viết test đỏ**
  1. Lượt giả lập hỏng giữa chừng (round 2 lỗi upstream) ⇒ phần tool đã chạy xong phải lấy
     lại được từ lỗi (dùng chung cơ chế `messagesDaHoanThanh` của CLI).
  2. `finishReason` của round cuối phải trả về (để `evaluateUsageTrigger` bắt được ca
     "tràn ngầm": `finishReason='stop'` mà `promptTokens > window`).
- [x] **Step 2: RED**
- [x] **Step 3: Implement** — `try/catch` quanh vòng lặp, gắn `messages.slice(soDauVao)` vào
  lỗi bằng WeakMap của module + export getter; thêm `finishReason?` vào `EmulatedLoopResult`.
- [x] **Step 4: GREEN**
- [x] **Step 5: Mutation** — bỏ phần gắn lỗi ⇒ test đỏ.
- [x] **Step 6: Gate + commit** — `fix(cli): giu phan da hoan thanh va finishReason o duong gia lap`

---

### Task C (I1 + I4): MỘT cơ chế "native trước, giả lập khi bị chê" cho cả REPL và `-p`

**Files:**
- Modify: `cli/agent-turn.ts` (export `wrapTools`, export `ganMessagesHoanThanh`)
- Modify: `cli/emulated.ts` (thêm `runTurn`)
- Modify: `cli/repl.ts` (dùng `runTurn`, xoá `chayLuot` cục bộ)
- Modify: `cli/index.ts` (`chayMotLuot` dùng `runTurn`)
- Test: `tests/cli-emulated.test.ts`

**Root cause:** `cli/index.ts:227` (`chayMotLuot`) gọi thẳng `runAgentTurn` ⇒ đường `-p` không
có fallback ⇒ model không hỗ trợ tools thì `-p` vẫn chết.

- [x] **Step 1: Viết test đỏ**
  1. `-p` (qua `chayMotLuot`): model chê tools ⇒ phải trả lời được.
  2. Tool của CLI bị từ chối (ném lỗi) trên đường giả lập ⇒ **model phải thấy lý do**
     (`{ok:false,error:...}`), không phải "Công cụ tạm thời không khả dụng".
  3. Usage của round cuối phải tới được `evaluateUsageTrigger` (không phải `null`).
- [x] **Step 2: RED**
- [x] **Step 3: Implement** — `runTurn` trong `cli/emulated.ts`: native trước; lỗi "không hỗ trợ
  tools" ⇒ ghi cache + chạy lại bằng đường giả lập với tool đã `wrapTools`.
- [x] **Step 4: GREEN**
- [x] **Step 5: Mutation** — bỏ `wrapTools` khỏi đường giả lập ⇒ test đỏ.
- [x] **Step 6: Gate + commit** — `fix(cli): dung chung mot co che chuyen duong gia lap cho REPL va -p`

---

### Task D (I2): test wiring `VYEN_EMULATED` / `providerBase` / `modelId`

**Files:**
- Test: `tests/cli-emulated.test.ts` (bổ sung)

- [x] **Step 1: Viết test đỏ** — `buildReplOptions({forceEmulated:true,…}).forceEmulated === true`;
  `providerBase`/`modelId` đi qua nguyên vẹn; REPL với `forceEmulated:true` ⇒ native **không**
  được gọi lần nào.
- [x] **Step 2: RED**
- [x] **Step 3: Implement** — chỉ sửa nếu test đỏ (có thể code đã đúng ⇒ test là bảo vệ).
- [x] **Step 4: GREEN**
- [x] **Step 5: Mutation** — đổi `'1'` thành `'true'` trong `cli/index.ts` ⇒ test đỏ.
- [x] **Step 6: Gate + commit** — `test(cli): bao ve wiring VYEN_EMULATED`

---

### Task E (I3): mẫu "không hỗ trợ tools" — bổ sung cách diễn đạt còn thiếu

**Files:**
- Modify: `lib/tool-support-cache.ts`
- Test: `tests/tool-support-cache.test.ts`

**Đã đo (không đoán):** mẫu hiện tại KHÔNG khớp 4 cách diễn đạt và khớp oan 2:
`function calling is not supported` ✗ · `Unsupported parameter: tools` ✗ ·
`tools parameter is not supported` ✗ · `Invalid schema for function 'fs_read'` **khớp oan** ✗.

**Quyết định (ghi lại vì sao KHÔNG siết):** nhánh `unsupported|invalid|unknown … (tool|function)`
bị khớp oan, nhưng đường giả lập gửi tool dạng **văn bản** (không gửi JSON schema) ⇒ lỗi
"Invalid schema" / "unknown tool" ở đường native **có thể** chạy được ở đường giả lập ⇒ không
phải khớp oan vô hại. Siết mẫu dùng chung lại rủi ro làm hỏng hành vi web đang chạy.
⇒ Chỉ **bổ sung** cách diễn đạt còn thiếu (chỉ thêm match ⇒ không làm hỏng case nào đang chạy).

- [x] **Step 1: Viết test đỏ** — 4 cách diễn đạt còn thiếu phải khớp.
- [x] **Step 2: RED**
- [x] **Step 3: Implement** — thêm mẫu vào `TOOLS_UNSUPPORTED_RE`.
- [x] **Step 4: GREEN**
- [x] **Step 5: Mutation** — bỏ mẫu vừa thêm ⇒ test đỏ.
- [x] **Step 6: Gate + commit** — `fix(lib): bu sung mau loi "khong ho tro tools"`

---

### Task F: gate cuối + ledger

- [x] `npm run typecheck` · `npm run test` · `npm run lint` · `npm run build` · `npm run docs:check`.
- [x] Ghi ledger lượt 6 (kết quả + mutation + cái gì **không** sửa và vì sao).
- [x] Commit: `docs(sdd): ledger luot 6 — sua 1 Critical + 6 Important cua reviewer`
