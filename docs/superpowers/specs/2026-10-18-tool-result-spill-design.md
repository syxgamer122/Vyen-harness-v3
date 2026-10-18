# Spec: Spill kết quả tool (Tool Result Spill)

- Ngày: 2026-10-18
- Phạm vi: Spec #1 trong chuỗi port mẫu kiến trúc từ DeepSeek Harness (dsh). Độc lập với các spec sau (`subagent-control`, session log).
- Trạng thái: chờ review — **đã sửa lần 2** sau khi AGENTS.md §6 bổ sung luật "dùng lại cái đang có".
- Nguồn tham khảo: `deepseek-harness` @ `packages/spill/spill`, `packages/spill/spill-local`, `packages/spill/spill-policy`; `docs/subsystems/spill.md`

---

## 0. Lần sửa này thay đổi gì

Bản đầu đề xuất tạo mới `lib/spill/{types,store,notice}.ts`. Đó là **dựng hệ thống thứ hai cho một việc đã có cơ chế** — đúng thứ AGENTS.md §6 cấm.

Bản này sửa: **mở rộng `lib/ipc.cjs`**, vốn đã làm đúng việc này cho `shell_run`.

Rủi ro mà bản đầu dấu ở §11 (chưa xác minh) nay đã có bằng chứng — xem §11.

## 1. Vấn đề

`lib/tool-limits.ts:28` đặt `TOOL_RESULT_MAX_CHARS = 24_000`. `truncateToolResult` (`:41-49`) cắt middle-truncate giữ 70% đầu + 25% đuôi, rồi **vứt bỏ phần giữa vĩnh viễn**:

```
...[đã cắt bớt N ký tự ở giữa]...
```

Hệ quả:

- `fs_read` trả tối đa 24.000 ký tự nên vừa khít — không lỗi.
- `shell_run` cắt ở 2.000 dòng / 50 KB (`README.md:47`) — phần bị cắt **có** đường đọc lại (`savedTo`).
- **Mọi tool còn lại không có đường đọc lại.** `web_fetch` 60.000 ký tự, `code_verify` với log dài — cắt là mất.

Model mất dữ liệu rồi đoán bừa, hoặc gọi lại tool tốn thêm vòng LLM. Đây là dạng lỗi tốn tiền nhất: sai âm thầm.

dsh mô tả seam (`docs/subsystems/spill.md:90, :92`): lưu **toàn bộ** content, thay kết quả quá ngưỡng bằng head/tail + địa chỉ spill, **best-effort** — lỗi lưu thì giữ nguyên kết quả inline, không biến call thành công thành `isError`.

## 2. Mục tiêu

Thay "cắt rồi quên" bằng "cắt nhưng vẫn đọc lại được".

Tiêu chí thành công:

1. Kết quả tool vượt ngưỡng → nội dung **đầy đủ** vẫn tồn tại ở nơi `fs_read` đọc được, và model được cho biết đường dẫn.
2. Ngưỡng và hình dạng preview **không đổi** (24.000, 70% đầu + 25% đuôi).
3. Lỗi ghi file **không** biến tool call thành công thành thất bại.
4. Bí mật không bao giờ nằm trên đĩa.
5. **Không tạo thêm cơ chế chồng lên cơ chế sẵn có.**
6. Không sinh code chết mới.

Ngoài phạm vi: retention theo tuổi, giữ ảnh, định giá token, spill cho session-reference, đường IndexedDB. Xem §9.

## 3. Quyết định thiết kế

| Quyết định | Lý do — căn cứ |
|---|---|
| **Mở rộng `lib/ipc.cjs`**, không tạo `lib/spill/` | `ipc.cjs:633` `truncateShellOutput` đã làm đúng việc này cho shell: ghi full ra temp file + `registerSavedShellOutput` + `fs_read` đọc lại được qua whitelist `ipc.cjs:319`. Dựng thêm là chắt vá. |
| Lưu ra **file**, không vào Dexie | `spill-local/src/store.ts:115` ghi thẳng `node:fs`, không qua `ctx.fs`. Đọc lại bằng `fs_read` **sẵn có**, không cần tool mới. Dexie sẽ bắt buộc phải viết `spill_read` mới. |
| Ghi bằng `node:fs` từ **server** | `serializeToolResult` chạy chủ yếu ở server: `lib/emulated-agent.ts:463,560`, `lib/mcp/tool-mapper.ts:382,391,396`. `app/api/chat/route.ts:100` khai báo `runtime='nodejs'`. Không cần vòng IPC. |
| Ngưỡng **giữ nguyên 24.000** | `maxInlineTokens` của dsh mặc định tắt; Vyen đang bật. Không sửa hằng số hành vi nếu không được yêu cầu. |
| Lỗi lưu → **giữ nguyên inline** | `docs/subsystems/spill.md:92`. `isError` sau một call thành công là hành vi sai. |
| `redact` **trước** khi spill | `lib/tool-limits.ts:62-65`: phải redact trước khi cắt, vì khoá bí mật vắt qua ranh giới cắt không khớp regex nào. Spill bản thô ⇒ bí mật nằm trên đĩa. **Ràng buộc, không phải tuỳ chọn.** |
| **Tách chính sách sống khỏi shell output** | `ipc.cjs:599` giới hạn 50 file và **xoá file khỏi đĩa khi đẩy ra** (`:615`). Đúng cho shell output — agent đọc ngay trong lượt đó, sai cho spill — spill sinh ra để đọc *sau*, có thể sau cả lần compaction. Xem §4.2. |

## 4. Thành phần

### 4.1 `lib/ipc.cjs` — sửa (không tạo file mới)

Registry hiện tại: `savedShellOutputs` là `Map<key, path>` (`:600`), tự dọn khi >50.

Đổi value thành `{ path, kind }` với `kind: 'shell' | 'spill'`, và tách chính sách đẩy ra:

- Đầy thì **ưu tiên loại `shell` cũ nhất** trước (nó chết cùng lượt, không ai đọc nữa).
- Chỉ loại `spill` khi đã hết `shell` và vẫn vượt trần.

Hàm mới, đặt cạnh `truncateShellOutput`:

```
saveSpillText(content, suggestedName) -> { savedTo, bytes, previewHint } | null
```

Trả `null` khi ghi lỗi — người gọi fallback. Ghi **exclusive** (`flag: 'wx'`) theo `spill-local/src/store.ts:115` để symlink có sẵn không chuyển hướng được. Tên `<random>-<sanitize(suggestedName)>`, `sanitize` giữ đúng **một** path segment.

Trần riêng cho spill (`SPILL_REGISTRY_MAX`), đặt lớn hơn hẳn 50 vì tuổi thọ khác hẳn.

### 4.2 `lib/ipc.cjs` — whitelist `fs_read`

`ipc.cjs:319` hiện kiểm `isSavedShellOutput(payload.relPath)`. Sửa thành kiểm **cả hai loại** — spill phải đọc được qua cùng đường. Không thêm nhánh riêng cho `fs_read`.

### 4.3 `lib/tool-limits.ts` — sửa một chỗ

`serializeToolResult` (`:52-67`):

```
raw = JSON.stringify(result)
  ↓ redactSecretText(raw)              // giữ nguyên thứ tự này
  ↓ len <= 24_000 ? → trả thẳng
  ↓ saveSpillText(redacted)
     ├─ thành công → head + GAP + tail + notice(savedTo, bytes)
     └─ null      → truncateToolResult(redacted)   ← hành vi cũ, y hệt
```

`truncateToolResult` giữ nguyên, không xoá — dùng làm fallback và giữ test cũ xanh.

### 4.4 Dòng thông báo cho model

Nêu **số byte đã bị lược bỏ** và cách đọc lại, theo `spill-policy/src/notice.ts` của dsh. Không phải "nội dung đã bị cắt" chung chung — model phải biết mình đang thiếu bao nhiêu và lấy ở đâu.

Sinh ngay trong `saveSpillText` (đã có `bytes`) thay vì một module `notice.ts` riêng.

## 5. Luồng dữ liệu

```
tool trả về result
  ↓ JSON.stringify                      (tool-limits.ts:58, có try/catch sẵn)
  ↓ redactSecretText                    (bắt buộc trước mọi thứ)
  ↓ len <= 24_000 ? ── có ──▶ trả thẳng
  ↓ không
  ↓ saveSpillText(redacted)
     ├─ OK   ─▶ head(70%) + GAP + tail(25%) + notice(savedTo, bytes), tổng ≤ 24_000
     └─ lỗi ─▶ truncateToolResult(redacted)   ← y hệt hiện tại
```

Model thấy:

```
<phần đầu>
...
[...]

<phần đuôi>

[Phần giữa (12.480 ký tự) đã lưu: C:\...\vyen-spill-a3f2-web_fetch.txt
 Đọc bằng fs_read(path, start_line, line_count) hoặc fs_search(path).]
```

Rồi `fs_read` với `start_line`/`line_count` (`README.md:36`) → đọc đúng phần cần, không tốn thêm vòng LLM.

## 6. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| `JSON.stringify` ném | Đã có try/catch → `'"[kết quả không serialize được]"'`. Không đổi. |
| Không đĩa đầy / không quyền ghi | `saveSpillText` trả `null` → fallback `truncateToolResult`. **Tool call vẫn thành công.** |
| `sanitize(suggestedName)` ra chuỗi rỗng | Dùng tên mặc định `spill.txt`. Không ném. |
| Spill bị đẩy khỏi registry | File bị xoá → `fs_read` trả lỗi tệp không tồn tại. Tool khác không ảnh hưởng. |
| Registry tràn toàn bộ là spill | Đẩy spill cũ nhất. Chấp nhận mất dữ liệu cũ — cùng đánh đổi với shell output. |
| `redactSecretText` không nhận ra bí mật | Không thay đổi — hạn chế có sẵn ghi ở `PLAN.md:988-991`. Không mở rộng phạm vi. |

Nguyên tắc chung: **spill là best-effort. Mất spill = mất tiện ích, không phải mất tác vụ.**

## 7. Kiểm thử

| Test | Kiểm |
|---|---|
| `tests/shell-tool.test.ts` (bổ sung) | `saveSpillText` tạo tệp, tên sanitize đúng, nội dung khớp byte-for-byte, ghi exclusive |
| `tests/shell-tool.test.ts` | **Mutation bắt buộc**: bỏ `redactSecretText` khỏi chuỗi → phải đỏ |
| `tests/shell-tool.test.ts` | `suggestedName` = `../../evil.txt` → nằm trong tmpdir, không thoát ra ngoài |
| `tests/shell-tool.test.ts` | **Ưu tiên đẩy `shell` trước `spill`**: đầy registry thì file shell cũ bị xoá, spill còn nguyên |
| `tests/shell-tool.test.ts` | `isSavedShellOutput` (hoặc hàm tổng quát hoá) trả `true` cho path spill |
| `tests/tool-result-body.test.ts` | ≤ ngưỡng → **không** tạo tệp nào |
| `tests/tool-result-body.test.ts` | > ngưỡng + lưu được → tệp chứa **bản đã redact** |
| `tests/tool-result-body.test.ts` | > ngưỡng + lưu lỗi (mock `node:fs.writeFileSync` ném) → output khớp **chính xác** `truncateToolResult` cũ |
| `tests/tool-result-body.test.ts` | Tổng ký tự preview ≤ `maxChars` ở mọi tỷ lệ head/tail, kể cả `EMU_MAX_RESULT_CHARS` |

Chạy: `npx vitest run tests/shell-tool.test.ts tests/tool-result-body.test.ts`. CI đã chạy toàn bộ (`ci.yml:31`).

## 8. Tài liệu phải cập nhật

`docs:check` kiểm path/script/env — không kiểm claim dạng prose. Sửa tay:

| File | Sửa |
|---|---|
| `README.md:165` | *"kết quả tool bị cắt ở 24.000 ký tự"* → nói rõ phần bị cắt **vẫn đọc lại được** và ở đâu |
| `README.md:47` | Temp file giờ dùng chung một cơ chế cho mọi tool, không chỉ `shell_run` |

## 9. Ngoài phạm vi (có chủ ý)

- **Ảnh.** dsh giữ content block ảnh + định giá token ảnh (`spill-policy/src/index.ts:57-75`). Vyen chưa dùng ContentBlock.
- **Spill cho session-reference.** Bỏ.
- **Token-meter.** Vyen đếm ký tự, không đếm token.
- **Đường IndexedDB cho web/PWA.** Xem §10.
- **Dọn file spill theo tuổi.** `spill-local/src/cleanup.ts` của dsh là 19 KB. Đợt này dựa vào đẩy-ra-registry; tmpdir của OS tự dọn khi khởi động lại.

## 10. Ràng buộc đã biết: web/PWA

Cơ chế nằm ở `node:fs` chạy trên Next.js server. Đúng khi **Next server chạy trên cùng máy với workspace**:

- Desktop: `launch-desktop.cjs` spawn Next server cục bộ ✅
- Web/PWA chạy `next start` cục bộ ✅
- Web server từ xa (chưa tồn tại) ❌ tệp nằm trên máy server, client không đọc được

**Không phải hồi quy**: trên web/PWA hành vi là truncate như cũ. Và `shell_run` / `git_*` vốn đã desktop-only (`lib/agent-tools.ts:1162`), nên phần lớn tool sinh output lớn cũng chỉ chạy desktop.

Nếu sau này có server từ xa nhiều người, phải làm đường IndexedDB — spec riêng.

## 11. Rủi ro §11 đã giải — có bằng chứng

Bản đầu nêu rủi ro: *"liệu `fs_read` đọc được tệp do server ghi không?"*. **Đã xác minh được, cùng tiến trình:**

```
app/api/bridge/route.ts:5-6, :71   → initServerBridge()
lib/bridge/server-bridge.ts:75      → require('../ipc.cjs')
app/api/chat/route.ts:100          → runtime = 'nodejs'
```

`initServerBridge()` chạy ở API route Next.js; `route.ts` cũng ở Next.js server. Cùng tiến trình → cùng cache `require` của Node → **cùng một instance `savedShellOutputs`**.

Nên `serializeToolResult` gọi `require('../ipc.cjs')` sẽ thấy đúng registry mà `fs_read` kiểm ở `ipc.cjs:319`.

**Rủi ro mới phát hiện khi đọc code** — và là lý do §4.1 phải tách chính sách đẩy ra:

`ipc.cjs:599, :610-619` giới hạn 50 file, và **xoá file khỏi đĩa** khi bị đẩy ra. Thiết kế đúng cho shell output (đọc ngay trong lượt, xoá là được), nhưng sai cho spill (thiết kế để đọc *sau*, có thể sau compaction). Nếu dùng nguyên xi, một phiên dài sẽ xoá mất đúng những file mà model còn định đọc.

## 12. Tiêu chí "xong"

- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run lint` — 0 lỗi mới
- [ ] `npx vitest run` xanh, gồm mutation test §7
- [ ] `npm run docs:check` OK
- [ ] Không tạo file mới nào ngoài `tests/` — dấu hiệu đã mở rộng đúng chỗ
- [ ] Thử tay: tool trả >24.000 ký tự → model thấy đường dẫn → `fs_read` đọc lại được phần đã mất
- [ ] Thử tay: `shell_run` lỗi đĩa (giả lập) → tool call vẫn thành công
- [ ] Registry đầy → spill còn nguyên, shell bị đẩy trước
- [ ] `README.md` đã sửa §8