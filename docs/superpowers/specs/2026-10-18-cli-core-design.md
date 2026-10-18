# Vyen CLI — lõi Node và client dòng lệnh

Ngày: 2026-10-18 · Trạng thái: chờ duyệt

## 1. Quyết định

Vyen chuyển **100% sang CLI**. Agent loop và tool chạy trong một tiến trình Node.
Web/PWA và desktop **xoá khỏi phạm vi lần này**; UI được đóng băng rồi xoá sau khi
CLI đạt chuẩn.

Mốc xem lại desktop/web: **sau khi lõi hoàn thiện**, không phải trước.

Lý do đã ghi nhận: nếu web là hướng tối ưu thì các harness nổi tiếng đã chọn nó.
Claude Code và Codex đều là CLI.

## 2. Phạm vi

**Vào:** lõi Node thuần · CLI · adapter Anthropic-native · adapter OpenAI-compatible · session lưu file · tool trên `node:fs` · duyệt tool nguy hiểm.

**Ra:** web/PWA · desktop shell · design system · UI React.

## 3. Điều đã kiểm chứng

Các mục dưới đây đã đo trên repo, không phải suy đoán:

| Mệnh đề | Bằng chứng |
|---|---|
| Chỉ có adapter OpenAI | `package.json` có `@ai-sdk/openai`, **không** có `@ai-sdk/anthropic`. Anthropic chỉ xuất hiện qua `model-meta.ts` dò tên model để lấy trần context |
| Session store là Dexie | `lib/db.ts:1` `import Dexie` → IndexedDB, browser-only |
| `route.ts` không phải UI | 153KB, chứa `extractDelta`, `diagnoseUpstreamError`, `normalizeGatewayStreamError`, `linkAbortSignals`, `readJsonWithLimit`, `attachToolResultParts` |
| **46 file `lib/` chạm API trình duyệt** | quét `showDirectoryPicker|FileSystemHandle|Dexie|indexedDB|localStorage|navigator.storage|clipboard|share` |

Nhiều nhất: `db.ts` (16), `persistence.ts` (13), `auto-backup.ts` (13),
`tool-permissions.ts` (9), `store.ts` (8), `catalog.ts` (7), `fs-access.ts` (6).

**Đính chính một ước lượng quá nhẹ.** Trước khi viết spec này tôi đã nói "phần lớn
`lib/` sống sót, chỉ mất `db.ts` + `fs-access.ts`". Đo thật thì con số là **46
file**, không phải 2. Không phải cả 46 đều phải viết lại — nhiều cái thuộc tính
năng sẽ bị bỏ theo (auto-backup, cross-tab sync, staging sandbox). Nhưng **không
đo được cái nào thuộc loại nào thì không được lên kế hoạch bóc.**

## 4. Giai đoạn 0 — kiểm kê (bắt buộc, làm trước mọi thứ)

Một bảng, 46 dòng, mỗi dòng một quyết định:

| Cột | Giá trị |
|---|---|
| file | đường dẫn |
| API trình duyệt dùng ở đâu | dòng cụ thể |
| Loại | **giữ nguyên** · **viết lại** · **xoá theo tính năng** |
| Còn dùng bởi lõi? | có / không |

Đầu ra: danh sách "viết lại" và "xoá". Không có bảng này thì mọi kế hoạch phía
sau là phỏng đoán — và phỏng đoán ở 46 file là cách chắc chắn nhất để dựng
lại một cơ chế chắt vá.

Bảng này tự sinh bằng script quét, không đoán tay.

## 5. Bản đồ lõi

```
lib/                    lõi — phần lớn giữ nguyên, dọn theo giai đoạn 0
  provider/             MỚI — adapter anthropic | openai-compatible
                        + streaming, chẩn đoán lỗi (bóc từ route.ts)
  session/              MỚI — hội thoại JSONL, thay Dexie
  tools/fs-node.ts      MỚI — đọc/ghi file qua node:fs
cli/                    MỚI — client duy nhất
app/ components/ react/ XOÁ sau khi bóc xong
```

Không tạo thư mục `core/` — lõi **chính là `lib/`**. Tạo mới rồi di dời 40 file
là công việc rác.

## 6. Luồng chạy

```
vyen "đọc file này và tóm tắt"
  ↓ lib/session/      nạp JSONL, dựng ngữ cảnh có trần
  ↓ lib/provider/     adapter chọn theo cấu hình; streaming + chẩn đoán lỗi
  ↓ lib/agent-tools-server   model quyết định gọi tool
  ↓ lib/tools/fs-node.ts     thao tác file thật qua node:fs
  ↓ lib/spill/              phần bị cắt ghi ra file, model đọc lại được
  ↓ in ra console dạng text
```

## 7. An toàn và lỗi

| Tình huống | Xử lý |
|---|---|
| Tool nguy hiểm (`fs_write`, `fs_edit`, `shell_run`) | hỏi xác nhận trước. Đây là thứ người dùng tin CLI nhất — bỏ thì mất niềm tin |
| Model không hỗ trợ tool calling | rơi về `emulated-agent` (đã có, và là tài sản lớn nhất cho BYOK) |
| Provider chết giữa stream | `diagnoseUpstreamError` + `normalizeGatewayStreamError`, bóc từ `route.ts` |
| Ghi spill lỗi | best-effort, không ném — lỗi lưu không được biến tool call thành lỗi |
| Bí mật lọt vào ngữ cảnh hoặc đĩa | redact **trước** khi cắt, và **trước** khi ghi đĩa. Thứ tự này đã có test khoá |

## 8. Kiểm chứng

Mỗi hạng mục phải qua **cả ba** gate, không được bỏ:

1. `npm run typecheck` — 0 lỗi
2. `npm run test` — không đỏ (trừ 3 flaky đã ghi ở AGENTS.md §1)
3. **Mutation discipline** — làm hỏng đúng thứ test khoá, phải thấy đỏ, rồi trả lại

Quy tắc từ phiên 2026-10-18, áp dụng cho mọi test mới:

- Test phải **chứng minh đỏ trước khi sửa**. Test xanh lúc viết không chứng minh gì.
- Test đọc **artifact đã build** khi lỗi nằm ở tầng bundle. Test trên đồ thị module của
  vitest không soi được lỗi build — bản 1 đã đi qua `tsc`, `lint`, `next build`,
  143 test và full suite 3346 test mà tính năng vẫn chết.
- Marker của test phải đối chiếu **từng ký tự** với nguồn. Marker sai một ký tự
  làm test **luôn đỏ**, tức vô dụng.
- Cơ chế kiểm phải tự được kiểm: nếu quét/đếm có thể hỏng mà vẫn báo "sạch", test
  đó là xanh giả.

## 9. Ngoài phạm vi

Desktop shell · web/PWA · thiết kế lại trải nghiệm người dùng · đa người dùng ·
đồng bộ cloud · tự cập nhật.

## 10. Rủi ro đã biết

| Rủi ro | Mức | Giảm bằng |
|---|---|---|
| 46 file cần phân loại trước khi biết phải làm gì | cao | Giai đoạn 0 — bắt buộc làm trước |
| Viết lại `db.ts`/`fs-access.ts` tốn công hơn dự kiến | trung bình | kiểm kê từng file thay vì đoán theo tên |
| CLI không thắng được Claude Code về UX | **chấp nhận** | không phải mục tiêu; thắng ở BYOK rộng + model local |
| Bỏ staging sandbox/diff review | trung bình | tái dùng nguyên vẹn khi làm client desktop sau |