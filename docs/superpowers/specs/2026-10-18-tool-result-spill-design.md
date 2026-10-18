# Spec: Tool Result Spill — bản 2 (sửa gốc C1 + C3)

- Ngày: 2026-10-18
- Bản 1: commit `b5a24d5`, đã implement trên `feat/tool-result-spill` (5 commit) — **dừng, chưa merge**
- Bản 2: viết sau khi final review tìm ra tính năng **không chạy trong production**
- Nguồn: `deepseek-harness` @ `packages/spill/*`, `docs/subsystems/spill.md`

---

## 0. Vì sao có bản 2

Bản 1 implement đủ 5 task, mọi gate xanh (`tsc`, `lint`, `build`, 143 test, full suite 3.346 test) — và **tính năng không chạy**. Hai lỗi độc lập, cùng một nguyên nhân gốc.

**C1 — spill là code chết trong bản build.** `lib/tool-limits.ts` gọi `eval('require')('./ipc.cjs')`. Trong bản build, đoạn đó nằm ở `.next/server/chunks/_10ewwxb._.js`, và `ipc.cjs` **không tồn tại dưới `.next`** (`Get-ChildItem .next -Recurse -Filter ipc.cjs` → rỗng) ⇒ `MODULE_NOT_FOUND` ⇒ `catch` ⇒ `null`. Không có lỗi runtime, không có log.

**C2 — hai instance.** `lib/ipc.cjs` được Turbopack **compile vào** sản phẩm server. Một `require` theo đường dẫn tới file thật sẽ tạo instance thứ hai, có `savedShellOutputs` Map riêng — khác instance mà whitelist `fs_read` dùng.

**C3 — nhánh spill không bao giờ được gọi.** `lib/agent-tools.ts:630` `capToolResult` cắt mọi kết quả tool server về ≤ 24.000, và `:719` áp nó **trước khi** kết quả tới `serializeToolResult`. Native path (function-calling — đường mặc định) không bao giờ vượt ngưỡng.

## 1. Nguyên nhân gốc: thiếu ranh giới module theo runtime

Hai module chứa **cả** code trình duyệt **lẫn** code chạy ở server:

| Module | Dùng bởi trình duyệt | Chạy ở server |
|---|---|---|
| `lib/agent-tools.ts` | `CLIENT_TOOL_DEFS`, `CLIENT_TOOL_NAMES` (`react/use-chat-orchestration.ts:177`); `toolResultBody` (`components/chat/tool-trace.tsx:34`) | `buildAgentTools`, `buildDelegateTool`, `capToolResult` |
| `lib/mcp/tool-mapper.ts` | `mapMcpTools`, `resolveMcpProxyTool`… (`react/use-chat-orchestration.ts:203-211`) | `formatMcpResultForModel` |

`lib/ipc.cjs` kéo `child_process` + `net`. Import nó từ module mà trình duyệt nạp ⇒ hỏng build.

Nên phần server **không thể** chạm Node. `eval` là cách lách — và lách thì vỡ, vì không tồn tại trong sản phẩm đã đóng gói.

**Lưu ý về thứ tự lỗi:** C2 chỉ là hệ quả của C1. Sửa C1 bằng đường dẫn sẽ tạo ra C2. Phải sửa bằng **cùng instance mà `server-bridge.ts:75` đã nạp**, tức import tĩnh trong sản phẩm server.

## 2. Mục tiêu

1. Kết quả tool > 24.000 ký tự → phần bị cắt **vẫn đọc lại được** bằng `fs_read` sẵn có, trên **cả** native lẫn emulated path.
2. Bí mật không bao giờ nằm trên đĩa.
3. Lỗi lưu không biến tool call thành công thành thất bại.
4. Ranh giới trình duyệt/server được **canh bằng test**, không chỉ bằng cách đặt file.
5. Không có chỗ nào thứ hai làm việc này.

Ngoài phạm vi: retention theo tuổi, ảnh, token-meter, spill cho session-reference, đường IndexedDB cho server từ xa.

## 3. Ranh giới module (thay đổi cấu trúc)

Tách theo **runtime**, không theo chủ đề:

```
lib/agent-tools.ts              ← DÙNG CHUNG (trình duyệt + server) — giữ nguyên tên
  CLIENT_TOOL_DEFS, CLIENT_TOOL_NAMES, NATIVE_EXCLUDED_CLIENT_TOOLS,
  toolResultBody, summarizeToolArgs, summarizeToolResult, formatToolNameList,
  TOOL_CATEGORY_MAP (nếu có)

lib/agent-tools-server.ts       ← CHỈ SERVER (mới)
  buildAgentTools, buildDelegateTool, capToolResult (có spill)
  import * as ipc from '@/lib/ipc.cjs'

lib/tool-result-server.ts        ← CHỈ SERVER (mới)
  serializeToolResult (có spill) — đường emulated
  import * as ipc from '@/lib/ipc.cjs'

lib/tool-limits.ts              ← DÙNG CHUNG — phép tính thuần, KHÔNG import Node
lib/mcp/tool-mapper.ts          ← DÙNG CHUNG — giữ nguyên tên, KHÔNG spill
```

Quy tắc: **module chỉ-server import module dùng chung được. Ngược lại thì không.**

Hệ quả cần chấp nhận: `agent-tools.ts`, `tool-limits.ts` và `tool-mapper.ts` nhỏ đi, nhưng đồ thị import trở nên nói thật điều gì chạy ở đâu — trước đây nó nói dối.

## 4. Spill nằm ở đâu

Đúng **một** chỗ: tầng kết quả tool phía server.

| Đường | Kết quả tool đi qua | Có spill? |
|---|---|---|
| Server tool, native | `capToolResult` (`lib/agent-tools-server.ts`) | ✅ **mới** |
| Server tool, emulated | `serializeToolResult` (`lib/tool-result-server.ts`) | ✅ **mới** |
| `shell_run` | `truncateShellOutput` trong ipc.cjs | ✅ đã có sẵn |
| **MCP** | `formatMcpResultForModel`, gọi ở `react/use-chat-orchestration.ts:1479` | ❌ **không thể** — xem bên dưới |
| `fs_read` | không bao giờ vượt `MAX_READ_CHARS` = 24.000 | không cần |
| Client tool khác | chạy trong trình duyệt, không có Node | không thể — chấp nhận |

**Vì sao MCP không thể có spill** (kết luận từ điều tra 2026-10-18, định
nghĩa lại sau khi kế hoạch ban đầu viết sai):

`formatMcpResultForModel` và `callMcpTool` chỉ được gọi ở
`react/use-chat-orchestration.ts` — MCP tool thực thi **trong trình duyệt**
qua `lib/desktop-bridge.ts`, không có đường server nào định dạng kết quả.
Trình duyệt không có hệ thống file. Tách `formatMcpResultForModel` sang
module server rồi cho nó spill sẽ kéo `child_process` + `net` vào bundle
trình duyệt, và `tests/spill-wiring.test.ts` sẽ đỏ chặn lại.

Muốn có spill cho MCP thì phải chuyển việc thực thi MCP tool sang server —
đó là thay đổi kiến trúc, không phải thay đổi cơ chế spill.

## 5. Xoá gì

| Xoá | Vì sao |
|---|---|
| `loadSpillSaver` + `eval('require')` | Đường nối sai, không tồn tại trong sản phẩm |
| Nhánh spill trong `serializeToolResult` | Trở về đúng vai: redact + cắt trần. Không chạm Node, không biết gì về spill |
| 4 test spill trong `tests/tool-limits-budget.test.ts` | Test sai chỗ — spill không đi qua đây nữa |
| 3 test loadSpillSaver trong cùng file | Cùng lý do |

**Giữ lại:** `saveSpillText` + registry `{path, kind}` + `readTargetOf` trong `lib/ipc.cjs` (Task 2 của bản 1). Phần đó đúng, chỉ là chưa ai gọi tới. `sanitizeSpillName`, `evictSavedOutputs`, kiểm thử shell-trước-spill — **tất cả giữ nguyên**.

## 6. Chốt chặn mới: test trên ARTIFACT đã build

Đây là điều bản 1 thiếu và là nguyên nhân gốc của việc C1 lọt qua mọi gate.

**Test 1 — artifact thật phải nối được.** Sau `npm run build`, đọc các file trong `.next/server/`, khẳng định `saveSpillText` **được nối** (không chỉ "không ném"). Đỏ với code hiện tại.

**Test 2 — ranh giới runtime được canh.** Duyệt đồ thị import bắt đầu từ các entry trình duyệt (`react/*.ts`, `components/**/*.tsx`, `app/page.tsx`); khẳng định **không** file nào trong đồ thị đó import `ipc.cjs`. Test này đỏ nếu ai đó đặt lại code server vào file dùng chung — tức chặn đúng lớp lỗi đã gây C1.

Vì sao cần: `try/catch` biến mọi lỗi module thành hành vi im lặng. Chỉ một test đọc sản phẩm thật mới bắt được. `build exit 0` chỉ chứng minh build không nổ, **không** chứng minh tính năng chạy.

## 7. Bất biến bắt buộc

- `redactSecretsDeep` / `redactSecretText` phải chạy **trước** khi ghi xuống đĩa. Khoá nằm ở phần GIỮA — phần hay chứa bí mật nhất — nên đây là ranh giới thứ hai sau "redact trước khi cắt" (`tests/secret-registry.test.ts:260`).
- Ngưỡng `TOOL_RESULT_MAX_CHARS = 24_000` và tỷ lệ 70/25 **không đổi** — hình dạng preview phải y hệt bản 1.
- Lỗi ghi file → fallback cắt trần cũ, **không** ném.
- Registry đẩy `shell` trước `spill` — shell đọc ngay trong lượt, spill sinh ra để đọc lâu hơn.
- Comment tiếng Việt. Commit không dấu.

## 8. Kiểm thử

| Test | Chứng minh |
|---|---|
| `tests/spill-wiring.test.ts` (mới) | Artifact build có nối `saveSpillText`; đồ thị import trình duyệt không chạm `ipc.cjs` |
| `tests/shell-tool.test.ts` | Giữ nguyên 23 test của bản 1 (sanitize, exclusive, thứ tự đẩy) |
| `tests/tool-limits-budget.test.ts` | Xoá 7 test spill; giữ nguyên phần budget cũ |
| Test mới cho `capToolResult` spill | > ngưỡng ⇒ có đường dẫn; ≤ ngưỡng ⇒ không ghi file |
| Test mới cho `formatMcpResultForModel` spill | Như trên |
| **Mutation**: gỡ `redactSecretsDeep` khỏi đường ghi đĩa | Phải ĐỎ |

## 9. Rủi ro đã biết

- **Web/PWA vẫn không có spill.** `ipc.cjs` chỉ ở server. Kết quả client tool vượt ngưỡng vẫn bị cắt. Không phải hồi quy — `fs_read` không vượt ngưỡng, `shell_run` đã có spill riêng.
- **Sửa import của nhiều test.** Các file import trực tiếp `buildAgentTools` / `formatMcpResultForModel` phải đổi đường dẫn. Danh sách phải đếm bằng grep, không đoán.
- **`mode: 0o600` không có tác dụng trên Windows** (Node chỉ dịch bit read-only). Bảo đảm thật sự là "không phải bí mật mà rule redact nhận ra" — nói vậy trong README thay vì ngụ ý bảo vệ quyền ghi.

## 10. Tiêu chí "xong"

- [ ] `npm run build` exit 0
- [ ] **Test artifact (Test 1) xanh** — không phải suy ra từ build, mà đọc `.next/server/` và kiểm
- [ ] **Test ranh giới (Test 2) xanh**
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` 0 lỗi mới, 8 warning baseline
- [ ] `npm run test` không đỏ (trừ 3 flaky ở AGENTS.md §1)
- [ ] `npm run docs:check` OK
- [ ] Thử tay trên **bản chạy thật** (`npm run start`): một tool server trả > 24.000 ký tự → model thấy đường dẫn → `fs_read` đọc lại được phần đã mất
- [ ] `grep -r "loadSpillSaver"` → rỗng
- [ ] `README.md` nói đúng những gì thật sự chạy, kể cả giới hạn web/PWA