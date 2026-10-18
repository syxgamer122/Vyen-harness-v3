# Spec: Spill kết quả tool (Tool Result Spill)

- Ngày: 2026-10-18
- Phạm vi: Spec #1 trong chuỗi port mẫu kiến trúc từ DeepSeek Harness (dsh). Độc lập với các spec sau (`subagent-control`, session log).
- Trạng thái: chờ review
- Nguồn tham khảo: `deepseek-harness` @ `packages/spill/spill`, `packages/spill/spill-local`, `packages/spill/spill-policy`; `docs/subsystems/spill.md`

---

## 1. Vấn đề

`lib/tool-limits.ts:28` đặt `TOOL_RESULT_MAX_CHARS = 24_000`. `truncateToolResult` (`:41-49`) cắt middle-truncate giữ 70% đầu + 25% đuôi, rồi **vứt bỏ phần giữa vĩnh viễn**:

```
...[đã cắt bớt N ký tự ở giữa]...
```

Hệ quả thực tế:

- `fs_read` trả tối đa 24.000 ký tự nên vừa khít — không lỗi.
- `shell_run` cắt ở 2.000 dòng / 50 KB (`README.md:47`) — phần bị cắt **có** đường đọc lại (`savedTo`).
- **Mọi tool còn lại không có đường đọc lại.** Kết quả `web_fetch` 60.000 ký tự, `code_verify` với log dài, `fs_search` trả 30 dòng — cắt là mất.

Mô hình dự đoán của agent dựa vào dữ liệu đã biến mất → model đoán bừa, hoặc gọi lại tool với tham số khác tốn thêm một vòng. Đây là dạng lỗi tốn tiền nhất: sai âm thầm.

Trong dsh, `docs/subsystems/spill.md:90` mô tả seam:
> "It persists the FULL `content` and REJECTS on a real storage failure."

Và `:92` nói rõ chính sách thay thế:
> "replaces an over-`maxInlineTokens` text/image result with ordered head/tail content and a spill address, best-effort: a save failure keeps the original inline result rather than turning a successful call into an `isError`."

## 2. Mục tiêu

Thay "cắt rồi quên" bằng "cắt nhưng vẫn đọc lại được".

Tiêu chí thành công:

1. Kết quả tool vượt ngưỡng → nội dung **đầy đủ** vẫn tồn tại ở nơi `fs_read` đọc được, và model được cho biết đường dẫn.
2. Ngưỡng và hình dạng preview **không đổi** so với hiện tại (24.000, 70% đầu + 25% đuôi) — không đổi hành vi ngoài ý muốn.
3. Lỗi ghi file **không** biến một tool call thành công thành thất bại.
4. Bí mật không bao giờ nằm trên đĩa.
5. Không sinh code chết mới.

Ngoài phạm vi: retention/cleanup theo tuổi, giữ ảnh, định giá token, spill cho session-reference, đường IndexedDB cho web. Xem §9.

## 3. Quyết định thiết kế

| Quyết định | Lý do — căn cứ |
|---|---|
| Lưu ra **file**, không vào Dexie | `spill-local/src/store.ts:115` dùng `open(path,'wx',0o600)` thẳng, **không** qua `ctx.fs`. Lý do: model đọc lại bằng `read`/`grep`/`fs_read` **sẵn có**, không cần tool mới. Dexie sẽ bắt buộc phải viết `spill_read` mới — tệ hơn. |
| File do **app tự ghi, ngoài workspace** | `README.md:47`: temp file output shell là *"ngoại lệ duy nhất ngoài workspace, chỉ file do app ghi trong phiên hiện tại"*. `lib/ipc.cjs:592` đã có registry cho đúng loại file này. Tái dùng, không bịa cơ chế mới. |
| Ghi bằng `node:fs` từ **server** | `serializeToolResult` chạy chủ yếu ở server: `lib/emulated-agent.ts:463,560`, `lib/mcp/tool-mapper.ts:382,391,396`. `app/api/chat/route.ts:100` khai báo `runtime='nodejs'` → có quyền ghi file. Không cần vòng IPC. |
| Ngưỡng **giữ nguyên 24.000** | `maxInlineTokens` của dsh mặc định là *tắt*; Vyen đang bật. Không sửa hằng số hành vi nếu không được yêu cầu. |
| Lỗi lưu → **giữ nguyên inline** | `docs/subsystems/spill.md:92`. `isError` sau một tool call thành công là hành vi sai. |
| `redact` **trước** khi spill | `lib/tool-limits.ts:62-65`: phải redact trước khi cắt, vì khoá bí mật vắt qua ranh giới cắt không khớp regex nào. Spill bản thô ⇒ bí mật nằm trên đĩa. **Thứ tự này là ràng buộc, không phải tuỳ chọn.** |

## 4. Thành phần

### 4.1 `lib/spill/types.ts` (mới)

```ts
/** Yêu cầu lưu một artifact. */
interface SaveTextSpill {
  /** Gợi ý tên tệp. Backend tự sanitize thành MỘT path segment an toàn. */
  suggestedName: string;
  /** Toàn văn cần lưu (UTF-8), ĐÃ redact. */
  content: string;
}

/** Kết quả lưu: locator + độ dài byte + hướng dẫn đọc lại. */
interface SpillRef {
  /** Handle opaque. Consumer hiển thị kèm retrievalHint, KHÔNG parse. */
  locator: string;
  bytes: number;
  retrievalHint: string;
}
```

`locator` là **string thường**, không branded type. Vyen chưa có quy ước branded id (`core.md` của dsh là ngôn ngữ riêng của họ); thêm branded id ở đây là trả phí không đổi lấy gì.

### 4.2 `lib/spill/store.ts` (mới)

Hàm thuần, không async, không class:

```ts
function saveTextSpill(input: SaveTextSpill): SpillRef
```

- Thư mục đích: cùng temp root mà `lib/ipc.cjs` dùng cho output shell.
- Tên tệp: `<random>-<sanitize(suggestedName)>` — tránh trùng, `sanitize` giữ đúng **một** path segment (bỏ `/`, `\`, `..`).
- Ghi **exclusive** (`flag: 'wx'`) để symlink có sẵn không thể chuyển hướng — theo `spill-local/src/store.ts:115`.
- Ném lỗi nếu ghi thất bại. Người gọi quyết định degrade.

### 4.3 `lib/spill/notice.ts` (mới)

Sinh dòng thông báo cho model. Theo `spill-policy/src/notice.ts` của dsh: nêu **số byte đã bị lược bỏ** và cách đọc lại. Không phải "nội dung đã bị cắt" chung chung — phải đủ để model biết mình đang thiếu bao nhiêu và lấy ở đâu.

### 4.4 `lib/tool-limits.ts` (sửa)

`serializeToolResult` (`:52-67`) đổi đúng một chỗ:

```
raw = JSON.stringify(result)
  ↓ redactSecretText(raw)              // giữ nguyên thứ tự này
  ↓ spill-or-truncate (logic mới, thay truncateToolResult)
```

Logic mới (giữ nguyên hợp đồng cũ khi không spill):
- `redacted.length <= maxChars` → trả `redacted`, **không đổi**.
- Ngược lại → thử `saveTextSpill({ suggestedName: <tên tool>.txt, content: redacted })`.
  - Thành công → trả `head + GAP + tail + notice(ref)` với **tổng ký tự vẫn ≤ `maxChars`**.
  - Thất bại → rơi về `truncateToolResult(redacted, maxChars)` y hệt hiện tại.

`truncateToolResult` giữ nguyên, không xoá — dùng làm đường fallback và để test cũ không đổi.

### 4.5 `fs_read` chấp nhận đường dẫn spill

`fs_read` (`react/use-chat-orchestration.ts:1750`) phải đọc được tệp spill. Cơ chế sẵn có: `lib/ipc.cjs:622` kiểm "đường dẫn này có phải temp file app tự ghi trong phiên này không". Spill phải đăng ký vào **cùng registry đó**.

> **Rủi ro chưa xác minh — xem §11.** Đây là mắt nối duy nhất chưa kiểm chứng được và là thứ phải làm đầu tiên khi triển khai.

## 5. Luồng dữ liệu

```
tool trả về result
  ↓
JSON.stringify                    (tool-limits.ts:58, có try/catch sẵn)
  ↓
redactSecretText                  (bắt buộc trước mọi thứ)
  ↓
len <= 24_000 ?  ── có ──▶ trả thẳng, kết thúc
  ↓ không
saveTextSpill(redacted)
  ├─ thành công ─▶ head(70%) + GAP + tail(25%) + notice(locator, bytes)
  │                 tổng ≤ 24_000
  └─ thất bại  ─▶ truncateToolResult(redacted)   ← hành vi cũ, y hệt
```

Sau đó model thấy trong kết quả:

```
<phần đầu>
...
[...]

<phần đuôi>

[Phần giữa (12.480 ký tự) đã lưu: C:\...\abc123-shell_run.txt
 Đọc bằng fs_read(path, start_line, line_count) hoặc fs_search(path).]
```

Model gọi `fs_read` với `start_line`/`line_count` (`README.md:36`) → đọc đúng phần nó cần. Không tốn thêm một vòng LLM để "re-fetch toàn bộ".

## 6. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| `JSON.stringify` ném | Đã có try/catch → `'"[kết quả không serialize được]"'`. Không đổi. |
| Không đĩa đầy / không quyền ghi | `saveTextSpill` ném → fallback `truncateToolResult`. **Tool call vẫn thành công.** |
| `sanitize(suggestedName)` ra chuỗi rỗng | Dùng tên mặc định `spill.txt`. Không ném. |
| `fs_read` gọi tới tệp spill đã bị xoá | Trả lỗi `FsError` bình thường. Tool khác không ảnh hưởng. |
| `redactSecretText` không nhận ra bí mật | Không thay đổi — đây là hạn chế có sẵn, ghi ở `PLAN.md:988-991`. Không mở rộng phạm vi. |

Nguyên tắc chung: **spill là best-effort. Mất spill = mất tiện ích, không phải mất tác vụ.**

## 7. Kiểm thử

Bám theo `tests/` hiện có — không framework mới.

| Test | Kiểm |
|---|---|
| `tests/spill.test.ts` | `saveTextSpill` tạo tệp, tên sanitize đúng, nội dung khớp byte-for-byte, ghi exclusive (lần 2 cùng tên không overwrite) |
| `tests/spill.test.ts` | `serializeToolResult` ≤ ngưỡng → **không** tạo tệp nào |
| `tests/spill.test.ts` | > ngưỡng + lưu được → tệp chứa **bản đã redact**, không chứa chuỗi thử bí mật |
| `tests/spill.test.ts` | > ngưỡng + lưu lỗi (mock `node:fs.writeFile` ném) → output khớp **chính xác** `truncateToolResult` cũ |
| `tests/spill.test.ts` | Tổng ký tự preview ≤ `maxChars` ở mọi tỷ lệ head/tail |
| `tests/spill.test.ts` | **Mutation bắt buộc**: bỏ `redactSecretText` khỏi chuỗi → phải đỏ |
| `tests/spill.test.ts` | `suggestedName` = `../../evil.txt` → kết quả nằm trong temp root, không thoát ra ngoài |
| `tests/spill.test.ts` | `maxChars` tùy biến (`EMU_MAX_RESULT_CHARS`) vẫn spill đúng |

Cập nhật test hiện có nếu chúng khẳng định hành vi cắt: `agent-tools.ts:258` có comment nói rõ cố ý **không** dùng `truncateToolResult` — kiểm tra không bị ảnh hưởng.

Chạy: `npx vitest run tests/spill.test.ts` (CI đã có `ci.yml:31` chạy toàn bộ).

## 8. Tài liệu phải cập nhật

`npm run docs:check` kiểm path/script/env có thật — nhưng **không** kiểm claim dạng prose. Nên phải sửa tay:

| File | Sửa |
|---|---|
| `README.md:165` | *"kết quả tool bị cắt ở 24.000 ký tự"* → phải nói rõ phần bị cắt **vẫn đọc lại được** và ở đâu |
| `README.md:47` | Nói rõ temp file giờ dùng chung một cơ chế cho mọi tool, không chỉ `shell_run` |
| `PLAN.md` §8 "Việc chưa làm" | Gỡ mục liên quan nếu có |

## 9. Ngoài phạm vi (có chủ ý)

- **Retention / cleanup theo tuổi.** Tệp spill tích tụ trong temp root. `spill-local/src/cleanup.ts` của dsh là 19 KB. Ở đợt này chấp nhận tích tụ; temp dir của OS tự dọn khi khởi động lại.
- **Ảnh.** dsh giữ content block ảnh + định giá token ảnh (`spill-policy/src/index.ts:57-75`). Vyen chưa dùng ContentBlock. Bỏ.
- **Spill cho session-reference.** Bỏ.
- **Token-meter.** Vyen đếm ký tự, không đếm token. Không đưa vào.
- **Đường IndexedDB cho web.** Xem §10.

## 10. Ràng buộc đã biết: web/PWA

Cơ chế nằm ở `node:fs` chạy trên Next.js server. Điều này đúng khi **Next server chạy trên cùng máy với workspace** — tức đúng trong mô hình triển khai thật của Vyen:

- Desktop: `launch-desktop.cjs` spawn Next server cục bộ ✅
- Web/PWA chạy `next start` cục bộ ✅
- Web server từ xa (chưa tồn tại) ❌ tệp nằm trên máy server, client không đọc được

**Không phải hồi quy:** trên web/PWA hành vi là truncate như cũ — không mất gì so với hiện tại. Và `shell_run` / `git_*` vốn đã là desktop-only (`lib/agent-tools.ts:1162`), nên phần lớn tool sinh output lớn cũng chỉ chạy desktop.

Nếu sau này Vyen có server từ xa nhiều người, phải làm đường IndexedDB. Đó là spec riêng, không kéo vào đây.

## 11. Rủi ro chưa xác minh

**`fs_read` có đọc được tệp do server ghi không?** — đây là rủi ro duy nhất có thể làm hỏng thiết kế.

Đã xác minh: `lib/ipc.cjs:622` có cơ chế kiểm "đường dẫn là temp file app ghi trong phiên này", và `:314` nói `fs_read` đã có bản riêng đọc loại đó.

**Chưa xác minh:** registry đó được đăng ký từ đâu, và tiến trình Next.js server có nằm trong cùng phạm vi với `lib/ipc.cjs` hay không.

Hai đường đi nếu không nối được:

1. **Fallback A — dùng nếu registry không nối được:** ghi vào `<workspace>/.vyen/spills/`, dùng đúng cơ chế miễn phê duyệt mà temp file shell đang có. Đọc được mọi nơi kể cả web. Điều kiện phải xác minh: cơ chế miễn phê duyệt có áp dụng cho thư mục con `.vyen/` hay chỉ cho temp dir.
2. **Fallback B — chỉ khi A không dùng được:** thêm tool `spill_read`. Nhiều việc hơn, và làm mất lý do chính của việc chọn file. **Tránh nếu có thể.**

Việc đầu tiên khi triển khai: đọc `lib/ipc.cjs` quanh `:592-650` và `lib/bridge/` để xác định chính xác phạm vi registry, rồi chọn A hay B. Không suy đoán từ tài liệu.

## 12. Tiêu chí "xong"

- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npx vitest run` xanh, gồm mutation test ở §7
- [ ] `npm run docs:check` exit 0
- [ ] Thử tay: một tool trả >24.000 ký tự → model thấy đường dẫn → `fs_read` đọc lại được phần đã mất
- [ ] Thử tay: `shell_run` lỗi đĩa (giả lập) → tool call vẫn thành công
- [ ] `README.md` đã sửa §8