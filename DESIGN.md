# DESIGN.md — Vyen Harness Design System

> **Mục đích:** Tài liệu này là quy chuẩn thiết kế UI/UX (Single Source of Truth) cho Vyen Harness. Mọi chỉnh sửa trong `components/` và `app/` cần tuân theo triết lý và hệ thống token dưới đây để giữ sự nhất quán, tinh tế nhưng **không làm cứng nhắc trải nghiệm người dùng**.
>
> **Lưu ý kỹ thuật khi đổi Token:** Hiện tại bảng màu khai báo ở cả `app/globals.css` và `tailwind.config.ts`, được kiểm tra bởi `tests/design-system.test.ts`. Khi thêm hoặc đổi giá trị một token cốt lõi (màu, thang chữ, shadow), hãy cập nhật đồng bộ cả 3 file này trong cùng một lượt.
>
> **Phạm vi của tài liệu này:** các quy tắc dưới đây là **định hướng**, không phải luật cưỡng chế. Chỗ ràng buộc thật là **test** — test kiểm CODE, không đọc tài liệu này. Nếu tài liệu và test lệch nhau, **test đúng**. Lý do thiết kế chi tiết của hệ cũ (bản 1410 dòng, chạy tới 2026-10-18) đã **xoá 2026-10-20** — lịch sử nằm trong git (`git log --diff-filter=D --name-only`).

---

## 1. Triết lý cốt lõi: "Quiet Precision"

Vyen là trung tâm điều khiển bình tĩnh cho công việc kỹ thuật phần mềm:
1. **Nội dung và bằng chứng là trọng tâm:** Giao diện tối giản trên nền sáng (Light-only), hạn chế khung viền thừa ("hộp trong hộp"). Lời giải thích của trợ lý đặt trực tiếp trên nền hội thoại; chỉ code, diff, bằng chứng thực thi và hộp thoại phê duyệt mới có khung bao riêng.
2. **Ba câu hỏi mọi màn hình phải trả lời ngay khi nhìn lướt:**
   - Agent đang làm gì?
   - Kết quả thay đổi ở đâu (đã kiểm chứng chưa)?
   - Có điều gì đang chờ người dùng quyết định không?
3. **Phân cấp thị giác tự nhiên:** Sử dụng khoảng trắng (whitespace), độ đậm chữ, tầng nền và viền mảnh 1px trước khi dùng đến đổ bóng.

---

## 2. Hệ thống Token Màu (Light-only)

Ứng dụng sử dụng một bảng màu sáng duy nhất. Không thêm biến thể `dark:` vào component.

### 2.1 Bề mặt (Surfaces)
| Token | HEX | Vai trò sử dụng |
|---|---|---|
| `bg-sunken` | `#f7f7f7` | Nền ngoài cùng của ứng dụng, sidebar, vùng trũng |
| `bg-base` | `#fcfcfc` | Vùng làm việc chính (luồng hội thoại, nền mặc định) |
| `bg-surface` | `#ffffff` | Khối nội dung nổi bật (thẻ cài đặt, vỏ composer, khối bằng chứng) |
| `bg-raised` | `#f5f5f5` | Trạng thái hover của hàng/nút, nền khối code, chip phụ |
| `bg-overlay` | `#ffffff` | Lớp nổi trên cùng (popover, dropdown, modal, dialog) |

*Lưu ý:* Được phép sử dụng độ mờ trên các token nền (ví dụ `bg-surface/85`, `bg-overlay/90`, `bg-sunken/70`) cho các dải sticky header, backdrop hoặc bề mặt nổi khi cần chiều sâu mềm mại.

### 2.2 Chữ (Typography Colors) — Đảm bảo tương phản đọc
| Token | HEX | Vai trò sử dụng |
|---|---|---|
| `text-primary` | `#18181b` | Nội dung chính, tiêu đề, văn bản hội thoại |
| `text-secondary` | `#575757` | Mô tả phụ, nhãn trường, thông tin bổ trợ |
| `text-tertiary` | `#6f6f6f` | Nhãn nhóm, gợi ý (placeholder), dấu thời gian (ưu tiên đặt trên nền sáng) |
| `text-disabled` | `#a3a3a3` | Chỉ dùng cho control bị vô hiệu hóa (`disabled`), không dùng cho nội dung đọc |
| `text-on-fill` | `#ffffff` | Chữ nằm trên nền tô đậm (như nút primary hoặc badge đậm) |

*Quy tắc:* Không dùng bảng màu mặc định của Tailwind (`zinc-*`, `gray-*`, `red-*`...). Hạn chế dùng opacity trên chữ chính để tránh rớt chuẩn tương phản WCAG AA; hãy ưu tiên chọn đúng tầng `primary` / `secondary` / `tertiary`.

### 2.3 Viền (Borders) — Luôn 1px
| Token | HEX | Vai trò sử dụng |
|---|---|---|
| `border-subtle` | `#f0f0f0` | Đường chia nội bộ giữa các dòng/phần tử bên trong một khối |
| `border-default` | `#e1e1e1` | Ranh giới của thẻ (card), nút phụ, chip, vỏ composer, dialog |
| `border-strong` | `#cccccc` | Trạng thái hover, được chọn (selected) hoặc cần nhấn mạnh ranh giới |
| `border-input` | `#949494` | Dành cho ô nhập liệu (`.field`, `.field-sm`, `.checkbox-box`) nơi viền là tín hiệu nhận diện chính (đạt chuẩn 3:1 WCAG 1.4.11 trên nền trắng) |

*Quy tắc:* Khi khai báo độ rộng viền (`border`, `border-t`, `border-b`...), luôn khai báo kèm màu viền tương ứng để tránh rơi về màu mặc định của trình duyệt.

### 2.4 Màu nhấn, Trạng thái & Diff
| Token | HEX | Vai trò sử dụng |
|---|---|---|
| `accent` | `#0B7A53` | Nhấn chủ đạo: nút chính, liên kết, viền focus, con trỏ |
| `accent-dim` | `#449879` | Vật thể đồ họa: cột biểu đồ, chấm trạng thái, thanh tiến trình |
| `accent-soft` | `#e8f2ee` | Nền nhấn nhạt: ghi chú của người dùng (`.user-note`), tag đang chọn |
| `success` | `#167a4a` | Hoàn tất, kiểm thử đạt |
| `warning` | `#9a6206` | Cảnh báo, bị bỏ dở, cần chú ý |
| `danger` | `#b3261e` | Lỗi thực thi, hành động xóa/nguy hiểm, từ chối |
| `info` | `#0369a1` | Thông tin hướng dẫn |
| `reasoning` | `#6d4aa8` | Chữ/icon của khối suy luận (khi làm nền phải dùng `bg-reasoning/10` kèm `text-primary`) |
| `diff-add` / `del` / `ctx` | `#1f7a3d` / `#b3261e` / `#575757` | Hiển thị thay đổi code (kết hợp nền mờ ~8% để dễ quét mắt) |

*Quy tắc Accessibility:* Không bao giờ chỉ dùng màu sắc để biểu đạt trạng thái. Mọi trạng thái phải luôn đi kèm nhãn chữ hoặc biểu tượng (icon).

### 2.5 Màu logo (khác hệ màu giao diện)
| Token | HEX | Đối chiếu trên trắng | Ranh giới |
|---|---|---|---|
| `--brand-lime` | `#82E767` | 1.55:1 | **trang trí** — không bao giờ làm chữ hay viền |
| `--brand-mid` | `#2F9462` | 3.79:1 | đạt 3:1 cho vật thể đồ hoạ |
| `--brand-deep` | `#158360` | 4.72:1 | đạt AA, sát ngưỡng |
| `brand` (chỉ có ở Tailwind) | `#1B7455` | 5.71:1 | đạt AA |

Bốn giá trị này đo từ pixel `brand/logo-source.png` (2026-10-18); bộ cũ lấy từ ảnh
logo thế hệ trước nên cả bốn đều lệch với hình đang render.

**Hình VÀ màu của logo sống ở `brand/mark.json`** — không phải trong
`components/vyen-logo.tsx`. Component và `scripts/build-icons.cjs`
(`npm run icons:build`) cùng đọc file đó.

Sửa màu thì sửa **cả ba**: `app/globals.css`, `tailwind.config.ts`,
`tests/design-system.test.ts`. Đổi *hình* thì sửa `mark.json` rồi chạy lại
`npm run icons:build`.

*Lưu ý khi đọc `tailwind.config.ts`:* chỉ `brand-lime`, `brand-mid`,
`brand-deep` là `token('--brand-…')` tức đọc từ CSS. `brand` là **hex viết thẳng**,
không có biến `--brand` tương ứng trong `globals.css` — đừng đi tìm nó.

Logo hiện ở **đúng năm chỗ**: đầu sidebar, rail sidebar thu gọn, màn hình trống,
hai màn hình lỗi, và icon ngoài app. `tests/brand-placement.test.ts` khoá danh
sách này.

---

## 3. Typography (Chữ & Phân cấp)

### 3.1 Hai họ chữ với vai trò tách biệt
- **`font-sans` (Inter) — Mặc định cho toàn bộ giao diện:** Hội thoại dài (`.claude-prose`), nhãn, nút bấm, menu, điều hướng, tiêu đề, thông báo và metadata.
- **`font-mono` (JetBrains Mono) — Chỉ dành cho dữ liệu kỹ thuật/máy:** Khối code, lệnh shell, đường dẫn file, tên tool kỹ thuật, ID/hash, payload JSON, dòng diff, số liệu thống kê trong bảng và phím tắt.

### 3.2 Thang cỡ chữ
| Token | Cỡ (px) | Vai trò sử dụng |
|---|---|---|
| `text-micro` | `10px` | Số đếm nhỏ trên badge, nhãn nhóm viết hoa (`uppercase`) |
| `text-meta` | `12px` | Dấu thời gian, metadata phụ, chú thích ngắn (`.field-hint`) |
| `text-body` | `13px` | Nội dung trong bảng dữ liệu, ô nhập nhỏ, danh sách dày |
| `text-ui` | `14px` | Cỡ mặc định của giao diện: nút bấm, menu, nhãn trường (`.field-label`), dòng tóm tắt tool |
| `text-read` | `16px` | Văn bản đọc dài trong hội thoại (`.claude-prose`), ô nhập chính của Composer |
| `text-head` | `20px` | Tiêu đề chính của modal, panel hoặc trang |

*Quy tắc:* Thông tin mà người dùng bắt buộc phải đọc để ra quyết định không được đặt ở cỡ `micro` (10px) hoặc `meta` (12px). Các trường hợp trưng bày đặc biệt (như Logo wordmark hoặc tiêu đề màn hình trống) được phép dùng cỡ riêng phù hợp với bố cục.

---

## 4. Bo góc, Chiều sâu & Z-Index

### 4.1 Thang bo góc (Đều 4 góc)
- **`rounded-sm` (4px):** Badge nhỏ, ô code inline.
- **`rounded` (6px):** Chip nhỏ, thẻ trạng thái phụ.
- **`rounded-md` (8px):** Nút chỉ có icon (`.icon-btn`).
- **`rounded-lg` (10px):** **Control tiêu chuẩn** — nút bấm (`.btn-*`), ô nhập (`.field`), hàng menu (`.menu-item`).
- **`rounded-xl` (12px):** Khối nội dung, thẻ cài đặt, popover/menu (`.surface-panel`), ghi chú người dùng (`.user-note`).
- **`rounded-2xl` (16px):** Khung hộp thoại lớn (Modal/Dialog), vỏ ngoài của Composer.
- **`rounded-full` (9999px):** Nút tròn, chấm trạng thái.

### 4.2 Chiều sâu (Box-shadow)
Sử dụng 4 lớp chiều sâu chuẩn (đồng bộ giữa `globals.css` và `tailwind.config.ts`):
- **`.lift-sm` (`shadow-lift-sm`):** Nổi nhẹ cho chip tương tác hoặc nút nổi nhỏ.
- **`.lift-md` (`shadow-lift-md`):** Khối nội dung nổi, thẻ cài đặt, vỏ composer, popover.
- **`.lift-lg` (`shadow-lift-lg`):** Lớp phủ cao nhất — Modal, Dialog, Toast.
- **`.well`:** Bóng đổ vào trong (`inset`) tạo cảm giác chìm cho ô nhập liệu.

### 4.3 Thang Z-Index (`lib/ui-z.ts`)
Luôn import và sử dụng hằng số từ `Z_CLASS` trong `lib/ui-z.ts` thay vì tự gõ `z-40`, `z-50`:
`content (0) < sidebarBackdrop (30) < sidebarDrawer (35) < dropdown (40) < popover (50) < toast (60) < approval (80) < approvalCritical (85) < navigation (90) < system (100)`.

---

## 5. Quy chuẩn Trải nghiệm Sản phẩm (UI/UX Patterns)

### 5.1 Bố cục 3 cột & Vùng xem mở rộng
- **Cột trái (Sidebar):** Danh sách phiên, tìm kiếm, chuyển đổi dự án và nút tạo tác vụ mới (*New task*).
- **Cột giữa (Thread & Composer):** Cùng dùng chung bề rộng chuẩn `maxWidth.thread` (`48rem` / `768px`) và đệm ngang `px-5` để luôn thẳng hàng.
- **Cột phải (`SessionRail`, bật từ `screens.rail: 1432px`):** Tóm tắt trạng thái công việc (Plan, file đã chạm, kiểm thử, điểm khôi phục). Dưới ngưỡng `1432px`, Plan thu thành một dải tóm tắt gọn để không chiếm chiều cao vùng đọc chat.
- **Vùng xem mở rộng (Extended Viewer):** Khi xem nội dung kỹ thuật dài (Diff lớn, File, Test log, Plan chi tiết), mở dưới dạng lớp phủ một ngữ cảnh cuộn duy nhất (đóng bằng `Esc`), giữ nguyên vị trí đọc của cuộc trò chuyện bên dưới.

### 5.2 Cấu trúc một Lượt hội thoại (Turn)
- **Định nghĩa Lượt:** Một lượt bắt đầu từ yêu cầu của người dùng và kéo dài cho tới khi Agent hoàn tất hoặc dừng hẳn (`lib/turns.ts`).
- **Turn Header:** Đầu mỗi lượt có tiêu đề gọn hiển thị `Tên công việc · Trạng thái`, kèm thông tin phụ (`thời gian · số thao tác · số file`). Các lượt đã đóng có thể gập/mở (`aria-expanded`) để quét nhanh lịch sử.
- **Hiển thị tin nhắn:**
  - **Người dùng (`.user-note`):** Khung gọn, bo góc `xl` (12px), nền `bg-accent-soft`.
  - **Trợ lý:** Văn bản biên tập đặt trực tiếp trên nền hội thoại (không bọc bong bóng chat). Các cập nhật liên tiếp trong cùng một lượt được gom chung mạch, có nhịp khoảng cách bên trong nhóm nhỏ hơn khoảng cách ngắt giữa hai lượt.
- **Không có logo/avatar trong từng tin** (2026-10-18). Mọi dòng của lượt — câu trả lời, bảng kê công việc, dòng usage, bằng chứng, banner lỗi — nằm chung lề 0, khớp mọi tin khác trong transcript. Trước đây lề 34px chỉ có ở câu trả lời và tool trace, còn các dòng còn lại ở 0px nên mép trái cột hội thoại bị răng cưa. Vai "ai đã nói" do nền tin người dùng và sự đối xứng trái–phải đảm nhiệm; `sr-only "Trợ lý:"` còn cho trình đọc màn hình.
- **Tiến trình subagent gom theo lượt, không theo sự kiện.** Annotation là nhật ký (`start` + N `progress` + `done`); `getSubagentAnnotations` trong `components/subagent-card.tsx` gom theo `runId` và lấy trạng thái cuối. Render thẳng từng sự kiện sẽ để lại các dòng `progress` cũ đứng quay vĩnh viễn sau khi lượt đã xong.

### 5.3 Hiển thị Tool & Tiến trình thực thi
- **Mặc định là dòng gọn (Compact Row), bấm vào mới mở thẻ chi tiết:**
  - Dòng gọn đọc một mạch: `Tên hành động dễ hiểu · Đối tượng/Tham số · Quy mô (+a −b / N dòng) · Thời gian · Nhãn trạng thái`.
  - Chỉ khi mở rộng mới hiển thị lệnh thô (raw command), stdout/stderr, payload hoặc diff chi tiết.
- **Nhóm theo giai đoạn (Phase Grouping):** Các lệnh gọi tool liên tiếp được gom theo mục đích (`Khảo sát` · `Thực hiện` · `Kiểm chứng` · `Khác` qua `lib/tool-phases.ts`) và có vạch màu trạng thái bên trái (`accent` đang chạy, `danger` lỗi, `warning` bỏ dở, `subtle` xong) để dễ quét mắt.
- **Nổi bật lỗi & phê duyệt:** Tool thành công có thể thu gọn, nhưng tool bị **lỗi** hoặc **đang chờ cấp quyền** phải luôn nổi lên rõ ràng, nêu rõ: *muốn làm gì → phạm vi/file bị ảnh hưởng → rủi ro → nút quyết định*.

### 5.4 Composer (Ô nhập liệu trung tâm)
- Nội dung người dùng gõ (`text-read` 16px) là trung tâm; hàng công cụ ở chân (`Model · Phạm vi thư mục · Gửi/Dừng`) dùng cỡ chữ nhỏ hơn (`≤ 14px`) để không cạnh tranh thị giác.
- Khi focus, vỏ Composer đổi viền sang `border-accent` và mở rộng nhẹ vùng nhập mà không làm giật/dịch chuyển danh sách tin nhắn phía trên.

### 5.5 Từ điển Trạng thái chuẩn (Không gộp lẫn 3 trục)
1. **Trạng thái Tool:** `trong hàng` (`queued`) · `đang chạy` (`running`) · `chờ bạn cho phép` (`waiting_approval`) · `xong` (`done` — chỉ báo lệnh đã chạy xong, không mang dấu tick xanh) · `lỗi` (`failed`) · `bị bỏ dở` (`abandoned`).
2. **Trạng thái Lượt (Nhiệm vụ):** `chờ bắt đầu` (`queued`) · `đang làm` (`running`) · `chờ bạn quyết định` (`waiting_approval`) · `xong` (`completed`) · `bị chặn` (`blocked` — thiếu điều kiện/thông tin) · `lỗi` (`failed`) · `đang dừng` (`stopping` — đã bấm Stop nhưng đợi tool thoát hẳn) · `đã hủy` (`cancelled`).
3. **Mức độ Bằng chứng (`lib/evidence.ts`):** Phân biệt rõ giữa việc Agent tự báo xong (`Code · đã báo xong`) và việc đã có biên nhận chạy test thực tế (`Kiểm thử · đã xác minh`).

---

## 6. Tiêu chuẩn Tương tác, Accessibility & Nghiệm thu

1. **Tương tác chuột & cảm ứng:**
   - Mọi phần tử bấm được (`button`, `[role="button"]`, `summary`) đều có `cursor: pointer`.
   - Các nút icon nhỏ phải đảm bảo vùng chạm thực tế tối thiểu `44×44px` (dùng `min-h-11` hoặc pseudo-element `after:absolute after:-inset-[...]`).
2. **Focus & Bàn phím:**
   - Không dùng `outline-none` trên các ô nhập liệu (trừ `textarea` bên trong Composer vì vỏ Composer đã đảm nhận trạng thái focus).
   - Mọi hộp thoại/overlay đều đóng được bằng phím `Esc` và trả lại focus đúng vị trí.
3. **Chuyển động (Motion):**
   - Hiệu ứng chuyển màu/đóng mở nằm trong khoảng `150ms–200ms` (trừ micro-interaction cơ học như xoay icon `100ms`).
   - Luôn tôn trọng `prefers-reduced-motion: reduce` và cài đặt `html[data-animations='off']`.
4. **Kiểm tra trước khi hoàn tất sửa đổi UI:**
   - Chạy `npx vitest run tests/design-system.test.ts` để đảm bảo không vi phạm token cốt lõi.
   - Đảm bảo không tràn ngang (`scrollWidth === clientWidth`) ở các mốc màn hình `375px`, `768px`, `1024px`, `1440px`.