# SDD ledger — plan: docs/superpowers/plans/2026-10-20-audit-fixes-12.md

## Setup

- Worktree: `C:\Users\Admin\.local\share\opencode\worktree\e739c0\audit-fixes-12` (branch `fix/audit-12`, base `3d31dc2`).
- Vì sao worktree: phiên song song của người dùng đang commit trong cây chính (`3d31dc2` xoá 12 file docs) — làm trong worktree để không lẫn.
- `node_modules` của worktree là junction sang cây chính (không cài lại dependency).
- Không có bash trên máy ⇒ script `sdd-workspace`/`task-start`/`task-done` không chạy được; ledger ghi tay theo đúng format của script.

## Pre-flight (scan giao diện dùng chung)

- Task 11 (quét export chết) **phải chạy sau cùng**: nó thấy mọi export mới của Task 1–10. Các export đó đều được test của task tương ứng dùng ⇒ không bị flag. Ruling: giữ thứ tự này — cost nếu sai: test quét đỏ giả.
- Task 1 (tokenizer) ảnh hưởng mọi lệnh shell trong repo ⇒ mỗi task sau có sửa `lib/ipc.cjs` phải chạy lại `tests/p0-security-audit.test.ts` + `tests/auto-pilot.test.ts` + `tests/safe-spawn.test.ts`.
- Task 2 (redact lúc ghi) có thể làm đỏ test đang assert kết quả tool **thô** ⇒ các test đó phải được soi, không được "sửa cho xanh" mà không đọc kỹ.
- Task 3 (`fs_read.start_char`) đụng schema tool ⇒ `lib/agent-tools-server.ts` sinh manual tự động từ schema, không sửa tay.

## Ruling (fix pass sau review)

Review độc lập (subagent, có probe end-to-end) trả về: **1 Critical + 3 Important + 8 Minor**. Đã sửa trong một pass:

- **Critical #1** — đường `-p` xử lý nhánh tràn context TRƯỚC rồi mới ghi phần đã hoàn thành ⇒ `continue` bỏ qua lệnh ghi ⇒ mất kết quả tool ⇒ lượt thử lại làm lại tool (ghi file hai lần). Sửa: chuyển `messagesDaHoanThanh` + `appendAll` LÊN TRÊN (y hệt `cli/repl.ts`). Test kịch bản overflow mới — và **mutation check**: đưa thứ tự cũ về ⇒ test ĐỎ ✓.
- **Important #2** — `tokenizeCommandLine` mặc định POSIX dù JSDoc nói "theo nền tảng" ⇒ `lib/safe-spawn.ts` (gọi không có options) vẫn nuốt `\` trên Windows. Sửa: mặc định theo `process.platform`.
- **Important #3 + #4** — redact lúc ghi chạy **hai** lượt (deep-redact + redact trên JSON) ⇒ ~1,4 s đồng bộ mỗi lần ghi payload 400 KB; và bí mật sâu ≥ 12 tầng vẫn lọt (deep-redact có giới hạn độ sâu). Sửa: **một** lượt trên chuỗi JSON đã serialize (không giới hạn độ sâu) rồi parse lại để lưu.
- **Minor #5** (hồi quy TÔI tự gây) — chặn `%…%` chung giết `git log --format=%h%n%s`. Sửa: chỉ chặn với binary chạy qua `cmd.exe /d /c` (`dir`, `echo` — xem `resolveSpawnTarget`).
- **Minor #6** — `start_char: 0` bị schema cho phép nhưng code bỏ qua ⇒ hợp đồng sai. Sửa: 0 nghĩa là "đọc từ đầu".
- **Minor #7** (hồi quy TÔI tự gây) — desktop `fs_read` đưa CẢ file vào taint tracker (payload đo bằng ký tự ⇒ tốn thêm chuỗi 10 MB/lần đọc). Sửa: truyền `win.content`.
- **Minor #8** — assertion `not.toContain('LOI')` rỗng (không chẩn đoán nào chứa chữ hoa đó). Sửa: dùng chuỗi thật sự xuất hiện (`phai doi key`).
- **Minor #9** — quét export chết không tính file cấu hình ở thư mục gốc ⇒ dễ flag oan. Sửa: đưa chúng vào tần suất.
- **Minor #10** — cắt preview chỉ bỏ MỘT ký tự `U+FFFD` ở đầu (cắt giữa chuỗi 4 byte sinh tối đa 3). Sửa: bỏ hết dải `U+FFFD` đầu.
- **Minor #11** — cảnh báo "dòng 1 đã bị bỏ" in cả khi file rỗng (không mất gì). Sửa: file rỗng chỉ ghi header; cảnh báo chỉ khi thật sự bỏ dòng.

**Deferred (không vào fix pass):**
- Minor #12 — chế độ `merge` của nạp sao lưu vẫn giữ `wsSnapshots` cũ. Lý do: `merge` KHÔNG ghi đè chat đã tồn tại (chỉ bỏ qua) ⇒ ảnh chụp của các chat đó vẫn hợp lệ; ảnh chụp mồ côi đã bị `deleteChatCascade` dọn. Để mở, cần xác định "chat nào bị xoá nhưng ảnh chụp còn" — ngoài phạm vi lượt này.
- DNS rebinding giữa lúc kiểm và lúc nối — đã ghi rõ trong mã (T5), cần dispatcher của undici để ghim IP.
- Edge runtime không có `node:dns` ⇒ bỏ qua kiểm IP — có từ trước, ngoài phạm vi.
- `lib/safe-spawn.ts` là code chết (chỉ test gọi) — ngoài phạm vi 12 lỗi; đã sửa lỗi mặc định tokenizer nên đường đó cũng đúng.

## Ruling

- Task 2: Ruling — hợp đồng cũ "kết quả tool dưới trần giữ nguyên object gốc" bị **đổi có chủ đích** (che bí mật lúc ghi), nên `tests/tool-result-redact-order.test.ts` được sửa theo hợp đồng mới (`toEqual` + không có cờ `truncated`) thay vì `toBe` (so sánh danh tính object). Lý do: hợp đồng cũ chính là chỗ rò rỉ bí mật vào DB và file sao lưu. Các test còn lại của file (thứ tự redact→cắt) giữ nguyên và vẫn xanh. Cost nếu sai: mất khả năng đồng nhất object ⇒ không ai cần (không có caller nào so sánh danh tính).
- Task 1: Ruling — quy tắc chặn `%VAR%` áp cho **mọi nền tảng** (không chỉ Windows) để test tất định và để luật nhất quán; `printf %s` vẫn qua vì không có cặp `%…%`. Cost nếu sai: trên POSIX một tên file chứa `%a%` bị từ chối (hiếm, và chặn có lý do).
- Task 1: Ruling — `isPathLexicallyOutside` chặn mọi `^[a-zA-Z]:` (kể cả `C:Users` không có dấu gạch chéo) thay vì `^[a-zA-Z]:[\\/]`, để bản đường dẫn bị tokenizer bóp méo trên POSIX cũng bị chặn. Cost nếu sai: tên file POSIX bắt đầu bằng `x:` bị từ chối (hiếm).
- Task 3: Ruling — phạm vi **mở rộng** so với plan: plan nói "CLI path + schema", nhưng schema `fs_read` là **dùng chung** (`CLIENT_TOOL_DEFS`) cho cả web lẫn desktop ⇒ thêm `start_char` mà web im lặng bỏ qua sẽ tạo lỗi MỚI (model đọc lại đúng chunk cũ). Vì vậy: tách logic cắt vào `lib/fs-read-window.ts` (MỘT bản thay cho 3 bản đã drift) và nối vào cả 4 đường đọc (CLI, web FSA, desktop, staging overlay). Hệ quả có lợi: bản web/desktop hết lệch `endLine` 1 dòng với file có dấu xuống dòng cuối. Cost nếu sai: diff to hơn dự kiến; test cũ của web/desktop vẫn xanh nên công thức mới không phá hợp đồng đã ghim.
- Task 3: Ruling — tham số đọc tiếp đặt tên `start_char` (offset **tuyệt đối** trong file) và bỏ qua `start_line`/`line_count` khi có nó; kết quả trả `nextStartChar` (offset đọc tiếp) + `nextStartLine`. Tên trong kết quả camelCase (`nextStartChar`) khớp `startLine`/`endLine` sẵn có; mô tả tool nói rõ `start_char = nextStartChar`. Cost nếu sai: model phải tự nối tên camelCase↔snake_case (mô tả đã nói rõ).
- Task 3: Ruling — kỳ vọng "50.000 ký tự cần 2 lần đọc" của test đầu là SAI (trần 24.000 ⇒ cần 3 lần); sửa theo yêu cầu (đọc tới khi hết, nối lại đúng bằng file) thay vì theo cách tôi vừa viết.

## Trạng thái

- [x] Task 1: Chặn `%VAR%` + giữ đường dẫn Windows (lib/shell-policy.cjs) — commit 9a5a61d
- [x] Task 2: Che bí mật lúc ghi DB và lúc xuất sao lưu (lib/db.ts, lib/backup.ts) — commit d0406d1
- [x] Task 3: `fs_read` đọc tiếp được đuôi dòng dài — commit 2e67bba (+ e8308ca chú thích JSDoc)
- [x] Task 4: Transcript CLI tự phục hồi khi header hỏng — commit c2c0f4f
- [x] Task 5: Chặn hostname có IP riêng trong `web_fetch` — commit 07c2404
- [x] Task 6: Lượt `-p` bị lỗi vẫn ghi transcript, chẩn đoán đi qua `note` — commit 7b7216c
- [ ] Task 7: Preview output shell không bao giờ rỗng (lib/ipc.cjs)
- [ ] Task 8: Nạp sao lưu "ghi đè" xoá cả ảnh chụp workspace (lib/backup.ts)
- [ ] Task 9: Bridge chặn Origin/Referer lạ (lib/bridge/server-bridge.ts)
- [ ] Task 10: Tài liệu CLI không còn nói "không có compaction" (cli/index.ts)
- [x] Task 11: Xoá export chết + test quét cây nguồn — commit e2488f0
- [x] Task 12: Cổng chất lượng + review độc lập — review xong (1 Critical + 3 Important + 8 Minor), fix pass commit 3b0cafe

## Vòng 2 — kiểm chứng cổng duyệt thật + dọn code chết (sau khi đã merge/push vòng 1)

Vòng 1 đã merge (`d157e72`) + push. Vòng 2 làm phần "kiểm chứng chuỗi ghi file thật" mà báo cáo audit chưa chạm tới.

**Phát hiện mới (do chạy thật, không phải đọc code):** cổng duyệt của CLI **hỏi vào hư không** khi stdin là pipe.
- Đo: `("y" | npm run cli -p "…")` ⇒ npm đọc hết stdin rồi đóng ⇒ tới lúc cổng duyệt hỏi thì `stdin.readableEnded === true` (đo bằng log tạm) ⇒ `rl.question()` không bao giờ resolve ⇒ event loop rỗng ⇒ **tiến trình thoát im lặng code 0 giữa lượt**.
- Trước fix: câu hỏi không bao giờ hiện ra, tool bị từ chối với thông điệp "Nguoi dung KHONG duyet" — **đổ lỗi oan cho người dùng**.
- Sửa: (1) `cli/terminal.ts` tạo readline interface **lúc hỏi** (đo trên `node:readline/promises`: tạo sớm ⇒ `question()` trả null; tạo lúc hỏi ⇒ trả đúng "y"); (2) `hoi()` trả `null` ngay nếu stdin đã EOF ⇒ approver từ chối **có lý do** (`note`) và lượt không bị cắt; (3) `cli/approve.ts` phân biệt EOF (`null`) với Enter trống (`''`): Enter ⇒ hỏi lại đúng 1 lần rồi dừng (trước đó hỏi tới 5 lần).
- Task 13 trong plan + test đỏ trước (4 ca).

**Dọn code chết (Task 14):** `lib/safe-spawn.ts` (chỉ test gọi) bị xoá. Nhưng `tests/windows-batch-escape.test.ts` + `tests/windows-node-bypass.test.ts` cũng trỏ vào nó ⇒ `npm run typecheck` **bắt được** (grep đầu tôi bị cắt) ⇒ chuyển 2 file test sang canh hành vi **đang chạy thật** (`escapeBatchArg`, `resolveSpawnTarget` trong `lib/ipc.cjs` — export ra cho test). ⇒ Coverage bảo mật (escape `%`/`&` cho cmd.exe, bypass node cho npm/npx) **không bị mất**.

**Kiểm chứng thật (fake provider OpenAI-compatible cục bộ ⇒ không tốn credit, không phụ thuộc quota model free):**
| Tình huống | Kết quả |
|---|---|
| pipe, không có terminal | câu hỏi duyệt hiện ra; tool bị **từ chối có lý do**; lượt **không bị cắt**; file không được tạo |
| `VYEN_YOLO=1`, ghi trong workspace | file thật được ghi: `ket-qua.txt = [HELLO VYEN]` ✓ |
| `VYEN_YOLO=1`, ghi **ngoài** workspace | path-guard chặn: "Duong dan tuyệt doi bi cam trong workspace"; file đích **không** tồn tại ✓ |

**Cổng cuối:** typecheck 0 · lint 0 lỗi (8 warning baseline) · test 245/246 file xanh (đỏ duy nhất: `tests/secret-registry.test.ts` — flaky đã biết) · docs:check OK · plan-traceability 16/16.

## Vòng 3 — VERIFIER ĐỘC LẬP bác bỏ 4 kết luận của tôi + sửa lỗ hổng

Tôi dispatch một verifier (subagent, có quyền bác bỏ, phải tự chạy probe) để **kiểm chứng lại** chính các kết luận của tôi. Kết quả: **4 kết luận của tôi sai/tuyên bố quá mạnh**, và verifier tìm thêm 3 lỗ hổng.

**Kết luận của tôi bị bác (đã sửa):**
- **B1** — "không còn lưu secret thô": SAI. Chỉ `result` được che; **`args` của tool lưu THÔ** ⇒ `fs_write` mang khoá trong `args.content` ⇒ khoá nằm trong IndexedDB và trong file sao lưu.
- **B2** — "row cũ cũng không rò": SAI. Đường export dùng `redactSecretsDeep` (trần `DEEP_REDACT_MAX_DEPTH = 12`) ⇒ kết quả lồng ≥ 12 cấp **vẫn lộ** (đo: sâu 11 che, sâu 12 lộ).
- **F1** — "stdin là pipe thì từ chối": SAI CHÍNH XÁC. Điều kiện thật là **stdin ĐÃ KẾT THÚC**; pipe còn dữ liệu thì câu trả lời vẫn được đọc ("y" ⇒ duyệt).
- **H3** — "file spill không bao giờ bị xoá": SAI. Trong MỘT tiến trình thì có dọn (registry tối đa 50). Đúng là **mồ côi giữa các tiến trình**.

**Lỗ hổng mới do verifier tìm ra (đều đã sửa):**
- **H1 (thật)** — đường xoá chat trong khung chat (`react/use-chat-orchestration.ts`) chỉ xoá `messages`+`chats`, **không** dọn `wsSnapshots` ⇒ snapshot mồ côi ⇒ nạp lại backup (merge) ⇒ nút "Hoàn tác" ghi **nội dung file CŨ xuống đĩa**. (Tôi đã kết luận "merge thì an toàn" vì chỉ kiểm `deleteChatCascade` — thiếu đường xoá trong UI.)
- Import chết ở `lib/agent-tools.ts` kéo module server `web-backend` vào **bundle client** ⇒ trong trình duyệt `node:dns` lỗi ⇒ tầng kiểm IP **biến mất im lặng**.
- Comment của tokenizer hứa sai (`"C:\dir\"` thực tế ném "unclosed quote" — fail-closed nhưng tài liệu sai).

**Sửa trong vòng này (mỗi cái test đỏ trước):**
| # | Sửa | File |
|---|---|---|
| 15 | Che bí mật trong `args` (không chỉ `result`) | `lib/db.ts`, `lib/backup.ts` |
| 16 | Đường export không còn trần độ sâu (che trên chuỗi JSON) | `lib/secret-registry.ts` (`redactSecretJson`), `lib/backup.ts` |
| 17 | Xoá chat trong khung chat dọn cả ảnh chụp (dùng `deleteChatCascade`) | `react/use-chat-orchestration.ts` |
| 18 | **Ghim IP** — đóng DNS rebinding | `lib/web-fetch-pinned.ts` (mới), `lib/web-backend.ts` |
| 19 | Dọn file spill/shell mồ côi (> 24 giờ) lúc module nạp | `lib/ipc.cjs` |
| 20 | Xoá import chết ⇒ module server không lọt vào bundle client | `lib/agent-tools.ts` |

**Ghim IP (mục 18) — chi tiết:**
- Cơ chế đã THỬ NGHIỆM (không suy đoán): `node:https` với `lookup` tự định nghĩa trả IP đã kiểm ⇒ HTTP 200, body đúng, **chứng thương TLS vẫn kiểm theo hostname** ⇒ không cần hạ TLS, không cần dependency mới.
- Bẫy Node 20+: `autoSelectFamily` ⇒ `lookup` được gọi với `{all:true}` ⇒ callback phải trả **mảng**; trả sai dạng ⇒ "Invalid IP address: undefined" (đã dính ở lần thử đầu).
- Seam đổi: transport cũ là `globalThis.fetch` ⇒ test stub `vi.stubGlobal('fetch')`; nay là `__setFetchImpl` ⇒ phải chuyển **6 file test** (web-backend, agent-tools, jina-reader-fallback, web-jina-reader, tool-limits-budget, emulated-agent). Trong `emulated-agent.test.ts` stub phục vụ **cả** model giả lẫn web ⇒ phải nối cả hai, không thay thế bừa.
- Kiểm chứng bằng **mạng thật**: `fetchReadablePage('https://example.com/')` → "Example Domain" ✓; `searchWeb('vyen ai')` → engine `ddg-html`, 10 hits ✓.
- Test mới `tests/web-fetch-pinned.test.ts` dùng DNS thật (`localtest.me` → 127.0.0.1 ⇒ bị chặn) + server thật cục bộ (chứng minh ghim IP hoạt động, Host header giữ nguyên).

**Cổng cuối vòng 3:** typecheck 0 · lint 0 lỗi (8 warning baseline) · test 248/249 file xanh (đỏ duy nhất `tests/secret-registry.test.ts` — flaky đã biết) · docs:check OK · plan-traceability 16/16 · build exit 0.

## Cổng chất lượng cuối (sau fix pass)

| Cổng | Kết quả |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 lỗi, 8 warning (baseline: 2 unused eslint-disable + 6 exhaustive-deps) |
| `npm run test` | 244/246 file xanh, 3747 test pass. File đỏ: `tests/secret-registry.test.ts` + `tests/redteam-picker.test.ts` — **2 file flaky đã biết** (AGENTS.md §1: ngân sách thời gian, đỏ theo tải máy; chạy riêng thì xanh — đã kiểm ở cả HEAD và base) |
| `npm run docs:check` | OK — 9 tài liệu, 0 lệch (600 file theo dõi) |
| `npm run build` (Turbopack) | exit 0 |

Ghi chú môi trường: `npm run build` trong worktree cần `node_modules` là thư mục THẬT — Turbopack từ chối junction trỏ ra ngoài ("Symlink node_modules is invalid, it points out of the filesystem root"). Đã copy node_modules thật vào worktree rồi build xanh.

## Kết luận

13 commit trên branch `fix/audit-12` (base `3d31dc2`): 12 mục audit đã kiểm chứng + 1 commit fix pass sau review. **Chưa merge và chưa push** — merge vào `main` là việc của người dùng (AGENTS.md §2.5 Luật 4: review độc lập đã có ✓).

**Một mục của báo cáo audit bị BÁC khi kiểm chứng**: "SecretRegistry.register() trim giá trị ⇒ bí mật có khoảng trắng thừa không bị che" — SAI. Probe cho thấy giá trị đã trim là **substring** của bản gốc ⇒ vẫn khớp và vẫn bị che. Không sửa mục đó.
