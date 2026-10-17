# PLAN — Kết quả audit UI/UX + kế hoạch đẹp hơn Codex

Ngày: 2026-10-10. Audit READ-ONLY, chưa sửa file UI nào.
6 subagent chạy song song, mỗi agent một vùng file không overlap; mọi claim
quan trọng đã được tự kiểm chứng lại bằng code/CSS đã build + công thức WCAG
có calibrate.

## Bối cảnh quyết định cách đọc kết quả

Dự án CÓ design system cố ý. `DESIGN.md` mô tả hệ đang chạy, có 7 ràng buộc
cứng được `tests/design-system.test.ts` canh. App **light-only** là hợp đồng
(§7), không phải thiếu sót. Vì vậy "đẹp hơn Codex" **không** phải copy palette
tối của Codex — mà là: mật độ thông tin, giảm chrome, chiều sâu đọc được,
đúng nhịp 8px, một màu nhấn tiết chế.

Độ trưởng thành: **4/5** (cả 6 agent đồng ý). Không có mục nào "cần làm lại
từ đầu".

---

## Đã tự kiểm chứng (không tin báo cáo agent)

| Claim | Cách kiểm | Kết quả |
|---|---|---|
| `.uic` đè `font-semibold`/`tracking` | grep vị trí trong CSS đã build | **ĐÚNG.** `.uic` idx 67001 > `.font-semibold` 56693, `.tracking-[0.08em]` 57359. Unlayered thắng `@layer utilities`. **11 call site** đều mất weight/tracking: sidebar:550, vyen-logo:71,88, message-list:590, staging-panel:75, workspace-checkpoints:203, tool-approval-dialog:120… |
| Audit log bị Settings che | đọc `ui-z.ts` + 2 file dialog | **ĐÚNG.** Audit 90 vs Settings 100 (`system`), cùng portal `document.body`. Click rơi xuống backdrop Settings → `e.target === e.currentTarget` (settings-dialog.tsx:146) → **đóng luôn Settings**. |
| `.notice-warn` fail AA | tính lại bằng WCAG, calibrate `#767676`=4.54 / `#595959`=7.00 | **SAI ở chỗ tôi đo, ĐÚNG ở chỗ override.** `warning` trên `bg-raised` = 4.67:1 → pass AA, con số 4.38 trong comment là sai. NHƯNG `composer.tsx:1122` còn đổi nền sang `bg-warning/10`, và trên nền đó `text-warning` chỉ còn **4.11–4.46:1** (tuỳ nền gốc) → dưới ngưỡng. Override `text-primary` **vẫn cần**, giữ nguyên. Agent sửa đã bác bỏ đúng chỉ đạo sai của tôi. |
| `lift-md` không đọc ra chiều sâu | composite 2 lớp bóng lên `#ffffff` | **ĐÚNG.** Lớp tiếp xúc `0.06` đen → `#f0f0f0` (240), lớp quanh `-4px/0.08` → 235. Mờ 4–8% trên giấy trắng là dưới ngưỡng mắt. |
| Gửi trùng tin nhắn | grep `submittingRef` toàn file | **ĐÚNG.** Chỉ **1 lượt duy nhất** — khai báo ở `composer.tsx:677`, không đọc/ghi. Comment 670-676 mô tả đúng invariant rồi bỏ dở. |
| Quota 0% vẫn hiện thanh xanh | đọc `storage-quota-meter.tsx:96` | **ĐÚNG.** `Math.max(2, percentage)` → 2% lúc 0%. File cũng **không có trong** `TOKENIZED_COMPONENTS` nên không test nào canh. |
| Focus trap tranh nhau | đọc `use-focus-trap.ts` | **ĐÚNG.** `:93` chỉ guard Escape; nhánh `Tab` ở `:99` không có → hai dialog chồng cùng giành focus. |
| Escape hứa nhưng không chạy | grep `workspace-checkpoints.tsx` | **ĐÚNG.** Có `aria-modal` (`:191`) + chữ `$ Esc to cancel` (`:271`) nhưng **không** `useFocusTrap`, không `keydown`. |

---

## Bug thật (đã xác minh — nên sửa trước)

1. **`composer.tsx:677` — double-send.** `submittingRef` không được dùng. `submitDraft`
   await `onSubmit` (~15s gather context) trước khi append; `isLoading` là closure cũ
   nên không chặn Enter thứ hai. → gửi trùng, tính phí trùng, 2 lượt trả lời.
2. **`audit-viewer-dialog.tsx:205` — z 90 vs Settings 100.** Mở nhật ký kiểm toán
   từ trong Cài đặt → bị backdrop phủ, click ăn vào backdrop Settings và **đóng
   Cài đặt**. Tính năng an toàn mở ra như không có gì xảy ra.
3. **`globals.css:326` `.uic` unlayered.** Đè mọi `font-*`/`tracking-*` khi đứng
   cạnh. Sửa 1 dòng → nhãn section + wordmark về đúng weight trên toàn shell.
4. **`storage-quota-meter.tsx:96`** thanh 2% lúc 0% + thiếu `role="progressbar"`.
5. **`workspace-checkpoints.tsx:188`** khai `aria-modal` nhưng không trap focus,
   Escape không hoạt động — trong khi UI hứa có.
6. **`message-list.tsx:770`** nút "xuống tin mới nhất" là `absolute` không có
   ancestor positioned → rơi **dưới composer**, tức vô dụng đúng lúc cần nhất.
7. **`message-item.tsx:650`** chỉ truyền `status="aborted"` → nhánh `error` trong
   `MessageStatusBadge` không bao giờ chạy; lỗi chỉ hiện ở đáy transcript.
8. **`use-focus-trap.ts:99`** thiếu guard đỉnh-stack cho nhánh Tab.

## Làm đẹp (làm sau, cần soi bằng mắt)

- **Chiều sâu** (token, chưa ai đo): `lift-md` mờ 4–8% trên nền gần trắng.
  Đề xuất: lớp tiếp xúc `0 1px 2px rgb(24 24 27 / 0.07)`. Đây là thay đổi
  nâng cảm nhận chất lượng lớn nhất, và là **token** → phải sửa `globals.css` +
  `tailwind.config.ts` + `tests/design-system.test.ts` cùng lượt.
- **Giảm chrome mỗi lượt** — hiện có 3 thẻ viền/tô màu mỗi lượt (reasoning,
  subagent, orchestrator), đúng cái "everything is a card" mà §13.1 cảnh báo.
  Reasoning → 1 dòng phẳng; subagent → cùng rail `pl-[34px]`; orchestrator →
  `rounded-lg`.
- **Bỏ `$` trong sidebar** — `globals.css:336-339` tự phê bình "giao diện đọc
  như một cửa sổ terminal"; `$` lặp ở mọi nhóm ngày mang thông tin bằng 0.
- **Gộp gutter sidebar** — hiện có 3 lề trái 12/16/24px.
- **`tracking` chưa có thang** — 165 call site `tracking-[...]` tự chế, đây là
  trục duy nhất chưa có thang; thêm `wide`/`caps` sẽ thay 165 magic number.
- **Sửa số sai trong comment** `composer.tsx:1115` và `:1546` (4.38:1 → 4.67:1;
  và 4.01:1 → số thật của `text-warning` trên `bg-warning/10`). Override
  `text-primary` giữ nguyên — nó vẫn cần thiết, chỉ mô tả lại lý do.

## Không làm (có chủ đích)

- Dark mode — vi phạm ràng buộc #6.
- Thêm shadow source thứ 5 — ràng buộc #1.
- Đổi `accent #2a7360` — đạt AA ở mọi nền, đúng lựa chọn 1 màu nhấn.

## Trạng thái sửa (cập nhật cuối)

**Xong + verify xanh:**
- **(1) Double-send** — khoá `submittingRef`, nhưng phải bỏ qua `queueAs` (xem ghi chú
  Thứ tự đề xuất). typecheck sạch, 125/125.
- **(2) Audit log bị Settings che** — `Z_CLASS.navigation` → `Z_CLASS.system`.
  Bất biến `approval < approvalCritical < navigation < system` giữ nguyên vì
  `lib/ui-z.ts` không đổi; `tests/a11y-contract.test.ts` canh nó và xanh.
- **(5) Escape chết** — thêm `useFocusTrap` cho `workspace-checkpoints.tsx`,
  `onEscape` bọc `useCallback` (nằm trong deps effect trap, arrow inline sẽ gắn
  lại listener mỗi lần mở diff).
- **Focus trap tranh Tab** — guard đỉnh-stack nâng lên trên cả hai nhánh.
- **Toast im lặng với screen reader** — vùng `aria-live` luôn trong DOM.
- **Toast ghi đè** — `notice-store.ts` thành FIFO (trần 5, bỏ trùng), chữ ký
  `showNotice`/`clearNotice`/`useNotice` không đổi nên 76 call site không phải
  sửa. Thêm `resetNotices()` cho unmount.
- **(7) Lỗi không hiện cạnh tin** — truyền `m.status` thật (nhánh `error` chạy
  được), banner lỗi ghim ra khỏi container cuộn, `role="alert"` + nút Thử lại.
- **(4) Quota 0%** — bỏ `Math.max(2, …)`, thêm `role="progressbar"`, migrate alias
  → token thật, và **thêm file vào `TOKENIZED_COMPONENTS`** (trước đó không ai canh).
- **Hàng rỗng** có nhãn SR — `rowIsEmpty` lấy từ đúng hàm mỗi khối con tự dùng.
- **Giảm chrome mỗi lượt** — reasoning thành dòng phẳng (bo đều, preview dòng
  ĐẦU để bề rộng ổn định khi stream), subagent vào cột `pl-[34px]` trên cùng rail
  `ToolChip`, orchestrator `rounded-lg`, evidence badge lên `text-meta`,
  `highlight.tsx` về `bg-accent-soft text-accent`, code block/blockquote về đúng
  thang bo góc + viền 1px.

**Verify gộp:** 5 file test UI **167/167 pass** · design-system **47/47** ·
a11y-contract **17/17** · lint **0 error, 8 warning** (baseline 9, giảm 1 vì
session trước đã xoá `tests/telemetry-tab.test.ts` — không phải do đợt này).

- **`.uic` cascade (BUG 3) — XONG, có bằng chứng build thật.** Chuyển vào
  `@layer components`. Tôi build CSS và đo lại: `.uic` **19160** <
  `.font-semibold` **47287** < `.tracking-[0.08em]` **47841** → `.uic` **thua**,
  đúng như mong đợi. Thêm assertion chặn cả hai đường lách; **tôi đã tự phá thử**
  (dịch `.uic` ra ngoài layer) và test đỏ đúng dòng thông điệp → không phải test
  rỗng. Đã khôi phục.
- **Chiều sâu — XONG, nhưng đề xuất của tôi SAI và đã bị bác bỏ.** Tôi đề xuất
  `0 1px 2px rgb(24 24 27/.07)`. Agent dựng bóng thật (Gaussian) và đo: bản đó
  **yếu hơn** bản cũ. Tôi tô phỏng lại độc lập và xác nhận **agent đúng, tôi sai**
  — nén blur 3→2px thu hẹp vùng tích luỹ alpha, `/.07` không bù kịp; vấn đề là
  **TỔNG alpha** chứ không phải blur. Giá trị đã áp dụng:
  `0 1px 3px rgb(24 24 27/.08), 0 6px 16px -4px rgb(24 24 27/.10)`.
  Lưu ý thang: `lift-lg` đang ở 9.5% nên biên trên của `lift-md` còn **1.4 điểm**
  — nâng tiếp phải nâng cả `lift-lg`, nếu không đảo thang.
- **2 comment sai** (`16.4:1`→`17.72:1`, `6.4:1`→`7.81:1`) đã sửa.

## Thứ tự đề xuất

1. **Ba bug nghiêm trọng (1, 2, 3)** → verify: typecheck + test liên quan; sửa
   token thì sửa cả 3 file cùng lượt.
   - **(1) Double-send — XONG.** typecheck exit 0, composer + design-system
     **125/125 pass**. Nhưng khoá phải **bỏ qua `queueAs`**: Alt+Enter xếp
     follow-up là hành vi cố ý (Alt+↑ lấy lại tin đã queue) và phải dùng được khi
     lượt trước đang chờ context. Khoá chung sẽ nuốt mất tính năng đó. `finally`
     cũng phải có điều kiện, nếu không một lượt queue kết thúc sau sẽ xoá khoá
     của lượt đang gửi thật → mở lại đúng cửa sổ double-send.
2. Bug 4–8 → verify: mở app thử (empty input, double submit, refresh) theo AGENTS.md §5.
3. Đợt chiều sâu + giảm chrome → verify: chụp 375/1024/1440 trước–sau, đo 0px tràn ngang.

## Ghi chú

- Không phải git repo → file sửa copy vào `.audit-backup-20261010/ui-fixes/` trước.
- **Đã xoá** 2 file `.bak` (`react/use-chat-orchestration.ts.bak-…`,
  `app/api/chat/route.ts.bak-…`) sau khi xác minh: không import ở đâu, và `tsc`
  không đưa chúng vào program (loại `.bak`). Backup vẫn còn trong
  `.audit-backup-20261010/ui-fixes/`.
- **Sửa** `scripts/check-docs-sync.cjs:61` — nó loại `node_modules`/`.git`/`.next`
  nhưng không loại `.audit-backup-*`, nên đợt này dựng lên 30 lỗi docs giả từ bản
  backup đã lỗi thời. Đây là script quét cây thư mục vì dự án không có git.
- `npm run docs:check` VẪN đỏ sau khi sửa trên, vì còn lệch dòng thật có sẵn
  từ session dead-code trước (chủ yếu do `DOCS_TSX_ARCHITECTURE.md` đã bị gỡ
  2026-10-11, nên các điểm lệch thuộc về doc đó đã hết; phần còn lại là số file
  test ghi 220 thực tế 224). **Không sửa ở đợt này** — cần một đợt riêng cập nhật docs.
- `react/use-streaming-text.ts`: không có call site nào. Trước đây được giữ lại vì
  `DOCS_TSX_ARCHITECTURE.md:442` mô tả nó như một tầng kiến trúc; doc đó đã gỡ
  nên lý do giữ không còn. **Đã chốt (2026-10-15): xoá** — `b1b9e8e`.

## Còn lại — cần user quyết

1. **`tests/message-item-timeline.test.ts:75,77` khoá vị trí cũ của reasoning**
   ("dời nó lên trên là ĐỎ", "phải là khối cuối cùng"). §15.1 yêu cầu reasoning ở
   TRÊN tool trace. Đợt này giữ vị trí cũ vì sửa test là việc khác.
2. **`.field-label` cùng loại lỗi tiềm ẩn** — `globals.css:319` cũng khai ngoài
   layer và vẫn khai `font-weight`/`letter-spacing`. Chưa nổ vì chưa call site nào
   ghép nó với `font-*`/`tracking-*` (grep 74 chỗ, 0 khớp), nhưng lần ghép tới sẽ
   hỏng im lặng y hệt `.uic`.
3. **`use-chat-orchestration.ts:3047`** provider trả rỗng thì chỉ ghi annotation
   `{error:'EMPTY_RESPONSE'}`, KHÔNG đặt `status:'error'` → badge lỗi ở cấp tin không
   bắt được trường hợp này.
4. **`use-chat-orchestration.ts:801`** `showNotice` nằm trong `for` loop ghi hàng
   loạt file → một đợt có thể đẩy hàng chục thông báo. Đã có trần 5 ở store nhưng
   gốc rễ nên gom lỗi rồi báo một thông báo.
5. **Chiều sâu chưa nghiệm thu bằng mắt** — §12/§14.9 vẫn chưa đạt. Con số đo
   được trên mã, chưa có ảnh. Cần chụp 375/1024/1440 và soi.
6. **`npm run typecheck` đang đỏ ~9 lỗi ở `lib/teamwork/` + `tests/teamwork-*`** —
   session khác đang sửa song song, **không phải lỗi đợt này** (timestamp cho thấy
   file bị ghi đúng lúc tôi kiểm, và lỗi đổi từ `temporalContext` sang module
   `context` không tồn tại). Phần UI verify độc lập: 167/167 xanh.

---
---

# Đợt audit 2 — 2026-10-13

Audit READ-ONLY, chưa sửa file UI nào. 7 subagent, mỗi agent một vùng file không
overlap. Mọi claim dưới đây được gắn nhãn **ĐÃ TỰ KIỂM** (tôi tự đọc code hoặc
grep lại) hoặc **CHƯA KIỂM** (chỉ có báo cáo agent, phải đọc lại trước khi sửa).
Quy tắc của đợt này: **claim CHƯA KIỂM thì không sửa theo.**

## Phạm vi

| Lô | Vùng | File | Trạng thái |
|---|---|---|---|
| A | Shell & điều hướng | 18 | xong |
| B | Transcript | 24 | xong (chạy lại lần 2) |
| C | Composer & ngữ cảnh | 11 | xong |
| D | Settings & panel | 44 | xong (chạy lại lần 2) |
| E | Overlay & a11y | 18 | xong |
| F | Hệ thiết kế & token | 9 | xong |
| G | Dead code sweep | toàn repo | **đang chạy nền** |

## Đánh giá chung

Cái làm tốt, nói trước để không sửa nhầm: số 7 ràng buộc cứng **giữ được ở bề
mặt**. Đếm lại: `box-shadow` toàn repo = **4 chỗ** (đúng ràng buộc #1), bán kính
bất đối xứng = **0** (#2), bậc px tự chế lệch thang 6 bậc = **0** (#3), modifier
opacity trên token chữ = **0** (#4), biến thể `dark:` = **0** (#6). 6 dialog đều
có `role="dialog"` + `aria-modal` + nhãn và đều lấy z từ `Z_CLASS`. Backdrop nuốt
click đúng kiểu `stopPropagation`, Escape luôn là hành động AN TOÀN, focus mở đúng
nút huỷ ở cả `DiffConfirm` lẫn `ShellConfirm`.

Điểm đáng lo nhất về mặt kỹ thuật **không nằm ở UI**, mà ở chỗ hệ thống tự đặt
tên sai dẫn tới hành vi sai: bảng phân quyền tool.

---

## Bug thật

### P0 — Chặn 1 tool trong bảng Cài đặt âm thầm chặn cả nhóm · ĐÃ TỰ KIỂM

`lib/tool-permissions.ts:265` đọc `permissions[toolName]`, `:281` đọc
`permissions[category]` — **cùng một khoá phẳng**. Mà:

- `lib/tool-catalog.ts:31` — `ALL_TOOL_CATEGORIES` chứa đúng ba tên `fs_read`,
  `fs_write`, `delegate`
- `lib/tool-catalog.ts:199,245,489` — có tool **trùng tên** với category của nó:
  `name: 'fs_read'`, `name: 'fs_write'`, `name: 'delegate'`

⇒ Bấm "Chặn" ở đúng hàng tool `fs_read` cũng tạo khoá `fs_read`, mà khoá đó lại
là override của **category** `fs_read` ⇒ `fs_list`, `fs_search`, `skill_load`,
`code_skeleton`, `code_symbols`, `code_verify` (6 tool) bị chặn theo. Tương tự
`fs_write` ⇒ `code_patch` + `fs_edit`.

Đây là **tính năng an toàn ghi sai phạm vi**, trên màn hình để người dùng tin.
Cần namespace (vd `cat:` / `tool:`) cho một nhánh + `validateToolPermissions`
dọn khoá cũ.

### P1 — Escape trong ô nhập xoá vĩnh viễn tin đã queue · ĐÃ TỰ KIỂM

`components/composer.tsx:1027-1030`: `if (e.key === 'Escape') { onStop(); return; }`
— không guard `isStreaming`, không `preventDefault`, không hỏi.
`react/use-chat-orchestration.ts:4150-4151`:
`steeringRef.current = []; followUpRef.current = [];` chỉ giữ lại **một** tin mới
nhất, phần còn lại mất. Escape là phím phản xạ để đóng mọi thứ, người dùng bấm
một cái là mất 4 tin, chỉ có toast 4s.

### P1 — `.field-label` khai ngoài `@layer`, đè 18 call site · ĐÃ TỰ KIỂM

`app/globals.css:364` (`.field-label`), trong khi `@layer base` kết ở `:200` và
`@layer components` mở ở `:384` ⇒ nằm ngoài **mọi** layer. Nó khai
`font-size: 0.875rem` + `font-weight: 500` + `color` + `letter-spacing`.
Agent F đo trên CSS đã build trong `.next/`: `grep -c "@layer"` = **0** ⇒ hệ
không có cascade layer thật, thắng bằng thứ tự. `.text-read` ở vị trí 3421,
`.field-label` ở 3882 ⇒ thắng.

Call site bị vô hiệi (18), nặng nhất: `components/settings/data-tab.tsx:178`
(`field-label text-read text-danger` ⇒ "Vùng nguy hiểm" hiện 14px mực đen thay vì
16px đỏ). Còn: `appearance-tab.tsx:53,92,149`, `auto-backup-section.tsx:74`,
`data-tab.tsx:86,169`, `memories-section.tsx:107`, `providers-tab.tsx:36`,
`safety-tab.tsx:43`, `slash-commands-section.tsx:67,77,104`,
`settings-agent-memory.tsx:85`, `settings-skills.tsx:85,144`,
`mcp/mcp-settings-panel.tsx:418`, `mcp/tool-grants-panel.tsx:97`,
`provider-manager.tsx:428`.

Cùng loại, còn khai ngoài layer và **đang** gây hậu quả: `.claude-prose table`
(`globals.css:814`, `font-size: 13px` đè `text-sm` ở `markdown-renderer.tsx:390`),
`.fx-shimmer-text` (`:950`), `.diff-line-*` (`:1000-1009`).

Sửa `.field-label` giống hệt cách `.uic` đã được sửa. Nhưng **đừng chỉ vá từng
cái** — assertion hiện chỉ canh `.uic`; phải thêm assertion quét *mọi* recipe khai
`font-*`/`text-*`/`color` xem có nằm trong `@layer` không.

### P1 — Focus trap không bắt được `<summary>` · ĐÃ TỰ KIỂM

`lib/hooks/use-focus-trap.ts:5-6`: `FOCUSABLE_SELECTOR` không có `summary`.
`<summary>` điều hướng bằng UA chứ không qua `tabindex` nên selector không khớp.

Hậu quả tại `components/workspace-checkpoints.tsx:252` (mỗi file là một `<summary>`):
Tab tới cuối rồi `preventDefault()` quay về đầu ⇒ **người dùng bàn phím không mở
được nội dung diff sẽ bị ghi đè/xoá mà không xem được**. `app/globals.css:197`
còn khai `summary { cursor: pointer }` — hệ coi nó là phần tử bấm được.

Sửa: thêm `summary` vào mảng selector. Một dòng.

### P1 — Vùng chạm hai nút chồm nhau 8px · ĐÃ TỰ KIỂM (cơ chế)

`components/chat/message-item.tsx:211` — nút `h-6 w-6` (24px) nới
`after:-inset-[10px]`; `:262` và `:529` đặt `gap-0.5` (2px). Vùng chạm của nút
kế bắt đầu ở 26−10 = 16px trong khi nút hiện tại kết thúc ở 24px ⇒ **8px trên
24px bề rộng trỏ sang nút kế**, nút sau trong DOM ăn đè. Ở nhánh trợ lý (`:538-541`,
"Tạo lại") nghĩa là lệch 8px là chạy lại cả lượt.

*Giới hạn: tôi xác minh được CSS và hộp, chưa mở trình duyệt bấm thử.*

### P1 — `.btn-primary:hover` thành nền xám sáng + chữ trắng · CHƯA KIỂM

`components/ui/button.tsx:30` `hover:bg-strong`; `strong = #cccccc`
(`tailwind.config.ts:57`), `on-fill = #ffffff` (`:90`) ⇒ **1.61:1**, fail AA. Nút
biến mất đúng lúc chuột lên nó. `danger` tệ hơn: nút đỏ chuyển xám khi hover.
13 call site. (Lưu ý: `components/ui/button.tsx` **không component nào import** —
xem mục code chết; nhưng `.btn-primary` là recipe trong `globals.css` và được
dùng thật ở `audit-viewer-dialog.tsx:289`.)

### P1 — `DESIGN.md` mô tả một file không chạy · CHƯA KIỂM

`components/chat/stream-bubble.tsx` **không component nào mount** (grep toàn repo
chỉ ra chính nó + `data-testid`), nhưng:
- `DESIGN.md:500` dùng nó làm **ngoại lệ duy nhất** cho `backdrop-blur`
- `DESIGN.md:612-615` mô tả "khối suy luận đã sửa" nằm trong đó

⇒ App thật không có blur nào, hợp đồng đang bảo vệ một file chết. Cùng cơ chế:
`components/ui/text-shimmer.tsx` cũng 0 importer, và còn **trùng chức năng** với
`components/effects/index.tsx:88-92` (hai API khác nhau cho một việc).

### P1 — Panel "Quyền MCP Động" không bao giờ có dữ liệu · CHƯA KIỂM

`components/mcp/tool-grants-panel.tsx:47` đọc kv `mcp:tool-grants`; grep toàn repo
chỉ ra **3** lượt, tất cả trong chính file này (đọc + hai lần ghi rỗng). Chuỗi
`SCHEMA_MUTATED` chỉ tồn tại trong file. Panel luôn rơi vào empty state `:125-128`,
trong khi `:122` hứa "Hệ thống tự động vô hiệu hóa quyền nếu Schema bị thay đổi".

---

## Bản vá chắp — chỗ tôi chưa kiểm nhưng đáng soi trước

Các mục dưới đều **CHƯA KIỂM**, gom lại vì cùng một mùi: khai một thứ trong UI mà
tầng dưới không có dữ liệu, hoặc hai chỗ cùng cấu hình một khái niệm.

1. **Panel tự khai "đã xác minh" chỉ từ lời model.** `plan-panel.tsx:58-62`
   (`prog.done === prog.total ? 'verified'`) + `subagent-card.tsx:38-44` (dò chuỗi
   `"verified"`/`"test pass"` trong kết quả) — trái `lib/evidence.ts:51` ("**Không
   bao giờ** nhảy lên verified nếu không có VerificationReceipt") và §15.5 tách
   "xong" ↔ "đã xác minh" làm hai trục độc lập.
2. **Bảng phân quyền lệch taxonomy.** `lib/tool-catalog.ts:30` 8 category **không
   có** `mcp`; `lib/tool-permissions.ts:36-85` 8 nhóm **có** `mcp`. ⇒
   `tool-permissions-table.tsx:190-196` render dòng "Model Context Protocol (MCP)
   (0 tool)" vĩnh viễn rỗng trên web, trong khi policy **có** đọc `permissions['mcp']`
   (`:287`) và **không UI nào** ghi được khoá đó. `handleReset :116-125` cũng không
   có `mcp`.
3. **Temperature không có đường đọc.** `lib/models.ts:144 buildGenerationParams`
   **0 call site**; `model-contracts.ts:30 unsupportedParams` không có reader;
   `app/api/chat/route.ts:2288` gửi `{ temperature: temperature ?? 0.7 }` thẳng.
   Ô Temperature đẩy giá trị tới gateway cho cả model reasoning vốn trả 400.
4. **"Dexie v14" là chiều ghi một chiều.** `tool-permissions.ts:326,345`
   (`loadToolPermissionsFromDb` / `syncToolPermissionsToDb`) chỉ được gọi từ
   `tests/`, trong khi UI vẫn quảng cáo "Mọi thay đổi được lưu tự động (Zustand +
   Dexie v14)" (`tool-permissions-table.tsx:319`).
5. **Chỉ mục tìm kiếm Cài đặt nói sai sự thật.** `settings/settings-tabs.ts:73`
   mô tả ô "API Key OpenAI chính gốc" — không tồn tại; `:79` nói "60+ công cụ" trong
   khi `TOOL_CATALOG` có **36** entry.
6. **Thành công mặc đồ warning, lỗi mặc đồ màu thành công.**
   `auto-backup-section.tsx:146` render cả chuỗi thành công bằng `notice-warn`;
   `settings-skills.tsx:173` render lỗi bằng `text-accent`.
7. **`data-tab.tsx:127`** nói "nạp xong sẽ hỏi lại xác nhận" trong khi
   `window.confirm` chạy **trước** khi nạp (`:50-55`).

---

## Code thừa / code chết

### Chết hẳn, 0 importer

| Nơi | Bằng chứng |
|---|---|
| `components/ui/button.tsx`, `icon-button.tsx`, `pill.tsx`, `disclosure-row.tsx` | ~300 dòng primitive, grep toàn repo chỉ trúng `tests/design-system.test.ts:132-135` (comment: "đăng ký NGAY từ đầu để đợt refactor sau"). Cả 4 còn lệch hợp đồng: vùng chạm 14–40px, dưới 44px mà §12 mục 3 chốt. |
| `components/chat/stream-bubble.tsx` | 0 mount. Còn chứa `text-cyan-glow`, `hover:bg-rose-danger/20`, `max-w-4xl`. |
| `components/ui/text-shimmer.tsx` | 0 import, trùng chức năng `effects/index.tsx:88-92`. |
| `lib/models.ts:144` `buildGenerationParams` | 0 call site. |

### Chỉ sống nhờ test, app không dùng

| Nơi | Bằng chứng |
|---|---|
| `lib/hud-store.ts` | 7/9 mutator không call site. `clearLanes`/`removeLane` không có ⇒ **HUD không bao giờ được xoá**, số liệu chat cũ vẫn hiện khi đã sang chat khác. `HudLane.turn`/`elapsedSec`/`parallelShots` không có đường ghi ⇒ luôn 0. `LaneKind` khai 4 giá trị, chỉ `'main'` dùng. |
| `lib/notice-store.ts` FIFO trần 5 | xem mục "Claim tôi bác bỏ". |
| `lib/tool-permissions.ts:326,345` | chỉ `tests/` gọi. |

### Chết trong chính hệ thống token

| Nơi | Bằng chứng |
|---|---|
| `tailwind.config.ts:143-147` `zinc:{200,500,600}` | 0 call site — **và test `:588` cấm xoá**, tức assertion đang khoá code chết. |
| `tailwind.config.ts` `amber-warn`, `'border-subtle'`, `head: 20px`, `'3xl': '20px'`, `hex['brand-*']` | 0 call site từng cái. |
| `globals.css:122-126` `--surface`, `--surface-raised`, `--surface-bubble`, `--surface-muted`, `--foreground`, `--muted-foreground`, `--brand`, `--brand-accent` | 0 `var()` và không có key `colors` tương ứng. **Bẫy tên:** `--surface` = `252 252 252` (= `--bg-base`) trong khi Tailwind `surface` = `#ffffff`. |
| `globals.css` `.menu-item-danger`, `.claude-input`, `.settings-card-head`, `.diff-line-*` | 0 call site. |
| `components/effects/index.tsx:98-107` `PulseGlow` | 0 nơi gọi. Dùng lại sẽ tái phát `ring-*` — mà `ring-*` là 0 call site khác trong repo. |
| `components/settings/settings-tabs.ts:100-113` | 6/10 nhánh `switch` không tới được: grep `openSettings(` chỉ truyền 5 giá trị. |

### Chết lặt trong component

- `components/chat/message-status-badge.tsx:24-30` — nhánh `status === "streaming"`
  không tới được (call site duy nhất nằm trong `failedTurn`).
- `components/evidence-badge.tsx:15` — prop `size` khai nhưng không destructure; hai
  call site vẫn truyền.
- `components/composer.tsx:442` `wrapRef` chỉ được gán, không nơi nào đọc.
- `components/vyen-logo.tsx:80,81` — props `withWordmark`/`className` không ai
  truyền, nhánh `if (!withWordmark) return` là code chết.
- `react/use-chat-orchestration.ts:978-979` — `steeringCount`/`followUpCount` được
  set nhưng **không trả ra khỏi hook** ⇒ hai state chết, mỗi lần drain lại re-render
  cả `chat-interface`.
- `lib/context-compaction.ts:326` `WRITE_TOOLS` — khai mà không dùng.

---

## Claim tôi BÁC BỎ — không sửa theo

1. **"Hàng đợi toast đầy thì vứt bản tin MỚI" (báo P1).** **SAI.** Đọc
   `lib/notice-store.ts:57-62`: có comment tường minh — *"Hàng đầy thì BỎ bản mới,
   không bỏ bản cũ: hàng là FIFO, thứ tự đọc là thứ tự đến."* Đây là quyết định có
   chủ đích, không phải bug. Nỗi thật còn lại chỉ là: lỗi mất dữ liệu đi qua đúng
   hàng đó thì biến mất không dấu vết — đó là **đánh đổi thiết kế**, sửa được nếu
   muốn, không phải lỗi.
2. **Con số "165 call site `tracking-[...]`" của đợt trước.** Đếm thật:
   `tracking-[...]` = **6** (4× `0.08em`, 2× `0.05em`); cộng `tracking-wide` 7 +
   `tracking-wider` 8 = **21** tổng. Đợt trước đã nhân ~8×. Mục "thêm thang tracking"
   trong danh sách làm đẹp của đợt 1 dựa trên con số sai ⇒ **mục đích vẫn đúng**
   (không có thang), nhưng mức độ không tệ như đã ghi.
3. **"`tests/message-item-timeline.test.ts:75,77` trái §15.1".** Agent tự bác bỏ
   sau khi đọc: §15.1 (`DESIGN.md:1265-1271`) chỉ chốt thứ tự đọc của **bản tổng kết**
   và nguyên tắc "lời giải thích, tool và kết luận không được cùng một độ nổi";
   reasoning không được nêu tên. Test khoá reasoning dưới `<MessageUsage>` **không
   trái**. Muốn đổi thì phải thêm mục vào `DESIGN.md` trước, không phải sửa test.
4. **`lib/use-stick-to-bottom.ts` là code chết.** Không — đang dùng thật ở
   `react/use-chat-orchestration.ts:41,3957`.

---

## Cái tôi chưa nghiệm thu được

- **Chiều sâu vẫn chưa nghiệm thu bằng mắt.** Đợt trước đã nâng `lift-md`; đợt này
  đo lại tổng alpha: `lift-sm` 0.05 · `lift-md` 0.18 · `lift-lg` 0.19 · `well` 0.04.
  Agent F **không tái lập được** con số 8,1% ghi trong `globals.css:281-282` bằng
  mô hình của nó (cho 2,77%). Số trong DESIGN.md và test là nguồn đáng tin hơn mô
  hình. Cần chụp 375/1024/1440 và soi mắt — **đây vẫn là khoảng trống lớn nhất
  của cả hai đợt.**
- **Chưa mở app.** Không claim nào trong báo cáo này là quan sát trực tiếp từ
  trình duyệt; tất cả là đọc code.
- **Chưa chạy `npm run typecheck` / `lint` / test.** Đợt này read-only.
- **Lô G (dead code sweep) chưa xong** — `lib/teamwork/` (~40 file), `app/api/`
  (9 route), `react/` (4 file), `bin/`, `scripts/`, artifact ở gốc repo. Phần lớn
  code chết có giá trị nhất nằm ở đó.

---

## Thứ tự đề xuất

1. **P0 phân quyền tool** — sửa phạm vi ghi sai trên màn hình an toàn, và cần
   migration khoá cũ.
2. **P1 `.field-label`** — sửa 1 dòng + thêm assertion quét *mọi* recipe, đừng chỉ
   vá `.uic`.
3. **P1 Escape xoá tin đã queue** — mất dữ liệu, người dùng không hề biết.
4. **P1 focus trap bỏ sót `<summary>`** — 1 dòng, mở khoá xem diff bằng bàn phím.
5. **P1 vùng chạm chồm nhau** — mở trình duyệt bấm thử rồi mới chọn giá trị inset.
6. **Bản vá chắp mục 1–7** — cần quyết định của bạn: xoá, hay nối dữ liệu thật vào.
7. **Code chết**: 4 file `components/ui/*` + `stream-bubble.tsx` + `text-shimmer.tsx`
   ≈ 500 dòng. Nhưng chúng **đang được test canh** và `DESIGN.md` mô tả ⇒ xoá phải
   sửa `DESIGN.md` + test cùng lượt.
8. **`TOKENIZED_COMPONENTS` chỉ có 59 file** trong khi `components/`+`app/` có 83
   file `.ts(x)` ⇒ **25 file không chịu assertion palette / Tailwind-mặc-định /
   opacity-chữ / `dark:` / cỡ-px**. Đây là lý do gốc vì sao các lỗi trên lọt qua.

## Cần quyết định của bạn

- `components/ui/*` (4 file) và `stream-bubble.tsx`: **xoá** (kéo test + DESIGN.md
  theo) hay **dùng lại** (refactor call site sang đó)?
- `lib/hud-store.ts` 7/9 mutator chết: xoá, hay nối `clearLanes` vào lúc đổi chat?
- Đợt 1 còn treo: `react/use-streaming-text.ts` có call site không — **đã trả lời 2026-10-15**: grep toàn repo 0 call site; đã xoá (`b1b9e8e`).

---
---

# Pass xoá code chết — 2026-10-14

Lô G (dead-code sweep) **chết do lỗi mạng** (`getaddrinfo ETIMEOUT`), nên phạm vi
xoá giới hạn ở đúng những gì 6 lô đã quét xong. Mỗi mục dưới đây đều được grep
lại trước khi cắt — **không có mục nào chỉ dựa vào báo cáo agent**, và 3 claim
sai của agent đã bị chặn lại (xem cuối).

## Đã xoá

**Component chết hẳn (0 importer), kéo theo test + `DESIGN.md` cùng lượt**

| Xoá | Kéo theo |
|---|---|
| `components/chat/stream-bubble.tsx` | `tests/design-system.test.ts` (TOKENIZED_COMPONENTS), `tests/a11y-contract.test.ts` (danh sách overlay), `DESIGN.md` §8.1 + §11 — cả 3 chỗ đều đang mô tả hệ đang chạy nên phải viết lại, không xoá dòng |
| `components/ui/button.tsx`, `icon-button.tsx`, `pill.tsx`, `disclosure-row.tsx`, `text-shimmer.tsx` | 5 mục trong TOKENIZED_COMPONENTS. Thư mục `components/ui/` giờ rỗng. |
| `components/effects/index.tsx` → `TextShimmer` | xoá `stream-bubble` làm nó mất call site duy nhất |

**Lib chết**

| Xoá | Bằng chứng |
|---|---|
| `lib/hud-store.ts`: 7/9 mutator + `activeLaneId` (−111 dòng) | mỗi mutator chỉ có 2 lượt = khai báo interface + thân hàm |
| `lib/models.ts` `buildGenerationParams` | 1 lượt duy nhất = chính dòng định nghĩa |
| `lib/workspace-checkpoints.ts` `listSnapshots`, `WS_MAX_FILE_BYTES` | mỗi cái 1 lượt |
| `lib/context-compaction.ts` `WRITE_TOOLS` | khai mà không dùng (`READ_TOOLS` cạnh bên thì dùng) |
| `lib/audit-log.ts` alias `verifyAuditLogChain`; bỏ `export` cho `getDiskAnchorPath`, `pruneAuditLogs` | 3 hàm còn dùng nội bộ, chỉ là không ai import |
| `lib/search-utils.ts` bỏ `export` cho 2 hằng | dùng nội bộ |
| `react/use-chat-orchestration.ts` `steeringCount`, `followUpCount` | **chỉ có đúng 2 dòng khai báo** — không setter nào gọi tới, không được trả ra khỏi hook. Comment ngay trên nói "state chỉ để render + đếm" đã thành lời nói dối nên sửa lại theo. |
| `lib/evidence.ts` bỏ `stage` + `cert` khỏi giá trị trả về của `describeEvidence` | `badgeText` là **literal riêng**, không phải `${stage} · ${cert}` — nên 2 field kia chỉ là bản sao của hai nửa trong `badgeText`, không component nào đọc. `tests/evidence-badge.test.ts` chuyển sang assert `badgeText` (giữ nguyên ý nghĩa canh). |

**Token / config chết**

| Xoá | Ghi chú |
|---|---|
| `app/globals.css`: 8 biến `--surface`, `--surface-raised`, `--surface-bubble`, `--surface-muted`, `--brand`, `--brand-accent`, `--foreground`, `--muted-foreground` | 0 `var()`, không có `var(--${…})` động. Di sản của bộ tên token kiểu shadcn tồn tại song song với §2. **Giữ** `--surface-code` (đang dùng) và 3 biến `--brand-lime/mid/deep` (tailwind map). |
| `app/globals.css`: `.menu-item-danger`, `.claude-input`, `.settings-card-head`, cả khối `.diff-line-added/removed/context` | 0 call site từng cái |
| `tailwind.config.ts`: khối `zinc: {200,500,600}` | config tự dặn "Xoá khi grep `zinc-` không còn kết quả" — grep rỗng nên điều kiện đã thành hiện thực |
| `tailwind.config.ts`: `'amber-warn'`, `colors['border-subtle']` | 0 call site |

**Prop chết**: `components/evidence-badge.tsx` prop `size` (không destructure, không tác dụng) + 2 call site `message-item.tsx:715`, `agent-hud.tsx:126`.

**Doc sửa theo (vì nó mô tả hệ đang chạy, xoá code mà không sửa doc là tạo doc sai)**: `DESIGN.md` §2 alias `--brand*`, §8.1 claim "chỗ duy nhất dùng `backdrop-blur`", §11 lịch sử `stream-bubble`, §8.2 `.menu-item` ghi `font-mono` trong khi code đã là `font-sans` + `.menu-item-danger` không còn tồn tại.

**Test sửa theo**: `tests/design-system.test.ts` — assertion zinc đảo từ "còn đúng 3 bậc" thành "không còn khối `zinc: {`", vì trạng thái cần bảo vệ bây giờ là sự vắng mặt. `tests/a11y-contract.test.ts` bỏ entry đã xoá. `tests/evidence-badge.test.ts` 2 assertion chuyển từ `stage`/`cert` sang `badgeText`.

## KHÔNG xoá — và vì sao

Ba mục agent báo là chết nhưng tôi kiểm thấy sai:

1. **`hex['brand-lime'|'brand-mid'|'brand'|'brand-deep']`** — agent báo 0 tham chiếu. Sai:
   `tests/design-system.test.ts:511` chốt `hex` đúng **25 key** và mọi giá trị phải
   thuộc `PALETTE_TOKENS`; 4 giá trị brand nằm trong đó (`:54`). Xoá là phá
   hợp đồng bảng màu §2.
2. **Nhánh `status === "streaming"` trong `MessageStatusBadge`** — agent báo không
   tới được. Sai: `lib/db.ts:25` khai
   `StoredMessageStatus = 'complete' | 'streaming' | 'aborted' | 'error'`, và
   `message-item.tsx:476` đọc status từ **DB** — tin bị lưu dở lúc app đóng giữa
   lượt mang đúng `'streaming'`.
3. ~~**6 nhánh `case` alias trong `resolveSettingsTab`**~~ — **ĐÃ SỬA 2026-10-16,
   và lập luận cũ ở đây SAI.** `settingsInitialTab` **không** nằm trong
   `partialize` (`lib/store.ts`) và bị xoá khi đóng Cài đặt, nên nó thuần
   in-memory, **không sống qua reload** — không có dữ liệu phiên cũ nào mang
   id cũ tới `resolveSettingsTab`. Hàm đã rút còn một kiểm tra
   `SETTINGS_TABS.some(...)` (`components/settings/settings-tabs.ts`), và 3
   call site đã chuyển sang id hiện hành (`skills`→`extensions`,
   `stats`→`data`, `chung`→`safety`).

Ngoài ra giữ có chủ đích: `fx-bar-bounce` trong `tailwind.config.ts` —
`components/effects/index.tsx` ghi rõ *"đừng xoá vội khi chưa biết còn ý định
dùng lại không"*. `fx-sweep` / `fx-dot-bounce` cũng còn trong config nhưng không
class nào gọi tới (hai component dựng chúng đã bị xoá). `useFxEnabled` thì **đã
xoá** (zero-usage) — cơ chế tắt animation giờ là một lớp CSS duy nhất trong
`globals.css` (`prefers-reduced-motion` + `html[data-animations='off']`), được
canh ở `tests/startup-weight.test.ts`.

## Chưa nghiệm thu

`npm run typecheck` và `npm run lint` **chưa chạy xong** — server restart hai lần,
giết cả job nền. Test hẹp (`design-system`, `a11y-contract`, `evidence-badge`,
`composer-affordances`, `startup-weight`) đã chạy nền, kết quả ghi ở mục sau khi có.
Chưa mở app. Lô G vẫn chưa quét được `lib/teamwork/`, `app/api/`, `bin/`,
`scripts/`, artifact gốc repo — phần code chết còn lại nằm ở đó.

---

# Verify + đóng các mục còn treo — 2026-10-17

Lần đầu chạy toolchain thật (`node_modules` trống → `npm ci` 651 pkg; Node 24).

| Lệnh | Kết quả |
|---|---|
| `vitest run` | 198/198 file, 3258 pass, 2 skip, **0 fail** |
| `tsc --noEmit` | 0 lỗi |
| `npm run lint` | 0 lỗi, 8 warning (có sẵn) |
| `npm run docs:check` | OK — 9 tài liệu, 0 lệch (513 file) |
| `verify:security` | cả 3 script PASS 100% |

## Bug thật tìm ra khi verify (đã sửa)

1. **`lib/tool-call-budget.ts:58`** — lỗi có sẵn từ trước (hash file khớp backup):
   JSDoc chứa `fs_*/` đóng block comment giữa chừng ⇒ **project không typecheck
   được**. Viết lại thành `` `fs_*` / `shell` / `git` ``.
2. **`components/error-boundary.tsx`** — prop `fallback` bị xoá nhầm ở đợt trước,
   còn `components/chat/tool-trace.tsx` vẫn truyền (ý định thật: markdown hỏng thì
   hiện lại đoạn lời thô). Đã trả prop.
3. **`lib/auto-pilot.ts`** — gỡ import `getTurnTaintState` nhưng bỏ sót call site
   ⇒ `ReferenceError` trong `tests/taint-tracker.test.ts`.
4. **Vòng import** do `reasoning-capability` lấy hằng từ `provider-url` (file này
   import ngược `parseModelReasoning`) ⇒ hằng chưa khởi tạo lúc module eval, 25
   file test đỏ. Tách `lib/thinking-levels.ts` làm module lá không import gì.
5. **Test lệch implementation** (có sẵn): `context-budget.test.ts` 3 assert tính
   ngưỡng không qua `clampReserveTokens`; `a11y-contract.test.ts` đòi
   `chat-interface.tsx` import `ApprovalQueue` trong khi hàng đợi dựng ở
   `useApprovalBridge`. Viết lại theo đúng hành vi đang chạy.

## D3 — return của `useChatOrchestration` thừa 7 field

`activeLeafId`, `allStoredMessages`, `streamingContent`, `streamingReasoning`,
`activeProvider`, `workspaceRoot`, `toolPermissions` — `chat-interface.tsx` là
consumer **duy nhất** và không đọc field nào trong đó. `streamingContent` /
`streamingReasoning` chết trọn (khai rồi chỉ trả ra); `isStreamingAssistant`
sinh ra chúng cũng chết theo.

## Sáu mục "chờ chốt xoá" — BÁC BỎ, đều đang sống

| Mục | Bằng chứng |
|---|---|
| `lib/security-sast.ts` | `lib/bridge/server-bridge.ts:192` import runtime (`runSecuritySast`) cho handler `vyen:security-audit`. Claim "orphan UI" **sai**; xoá là tắt kiểm tra bảo mật. |
| `lib/safe-spawn.ts` | 0 importer runtime — nhưng nó là bản CHUẨN có test; `lib/ipc.cjs:703` là bản copy của `escapeWindowsBatchArg` và comment ghi rõ "giữ nguyên logic để hai đường escape giống nhau". Xoá bản chuẩn thì đường live mất test. **Giữ.** |
| 4 bản protected-path policy | `isProtectedPath` (path-utils) dùng ở `auto-pilot.ts` + `core/agent-runtime/capability-context.ts`; `isProtectedFsPath` dùng trong `fs-access.ts`; `isSystemDenylistedPath` là nội bộ path-utils. Có **chồng lấn** giữa hai bản đầu nhưng đây là lớp bảo mật phân tầng, gộp lại là refactor nhạy cảm chứ không phải xoá code chết. |
| 4 memory store | `memory/store` (2 import), `agent-memory` (5), `agent-memory-client` (2), `recall` (2), `zeromem/persistence` (2) — đều có call site. Claim "trùng nhau" **sai**. |
| `edit-blocks` vs `sarsed/patcher` | Cả hai sống: `lib/agent-tools.ts:46` import `@/lib/sarsed/tools`. |
| Test-only helpers | `getActiveBridgeToken`, `resetBridgeTokenForTests` ("Chỉ dùng bởi test"), `persistedTraceCount` ("test + chẩn đoán"), `startEpisode`/`endEpisode` — là **hook test có chủ đích**; `persistedTraceCount` là đường duy nhất để assert dedupe của batching. Xoá = mất coverage, không thu được gì. **Giữ.** |

## Các mục audit còn treo — đã đóng

- `composer.tsx` `wrapRef`: không còn trong code.
- `lib/tool-permissions.ts:326,345`: file còn 278 dòng, hai hàm đó không tồn tại.
- `components/vyen-logo.tsx` prop `className`: **có** call site thật (`message-item.tsx:607`).
- `context-compaction.ts` `WRITE_TOOLS`: đã xoá ở pass trước.
- `zinc:{200,500,600}` / `.menu-item-danger` / 8 biến `--surface*`: đã xoá ở pass trước.