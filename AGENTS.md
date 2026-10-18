# AGENTS.md — quy ước làm việc trong repo này

Next.js 16 + React 19 + Tailwind 3. Giao diện và mã nguồn viết bằng **tiếng Việt**.
Tài liệu này là bản tóm tắt ngắn; **không** lặp lại những gì test đã canh.

## 1. Kiểm trước khi nói "xong"

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . --cache
npm run test         # vitest run
npm run docs:check   # script kiểm đường dẫn + lệnh trong tài liệu
npm run check        # check-supply-chain.cjs
```

Lint chạy được ở **0 lỗi**. Warning là baseline của repo — đừng sửa chúng và đừng
báo hồi quy khi số warning không tăng.

**Ba test/flaky đã biết, không phải hồi quy:**

| File | Vì sao đỏ |
|---|---|
| `tests/secret-registry.test.ts` | Ngân sách thời gian ~500ms cho regex chống ReDoS; chậm khi chạy song song. Chạy riêng thì xanh. |
| `tests/code-mode-escape.test.ts` | Timeout của worker thread. Chạy riêng thì xanh. |
| `tests/launch-desktop.test.ts` | Đỏ nếu cổng 3000 đang bị giữ — launcher thấy server sẵn nên không rơi vào nhánh fallback. Tắt dev server rồi chạy lại. |

## 2. Test mới phải chứng minh đỏ trước khi sửa

**Nguyên tắc quan trọng nhất của file này.**

Một test xanh lúc vừa viết không chứng minh nó canh được thứ gì. Trước khi coi
là xong, phải **làm hỏng đúng thứ mà test khoá** rồi chạy lại:

```
bình thường              → xanh
sửa code cho hỏng        → ĐỎ
trả lại                  → xanh
```

Ba cách hỏng đã gặp, đừng lặp lại:

1. **Regex khớp rộng hơn ý nghĩa.** `toMatch(/VyenMark|VyenLogo/)` khớp cả dòng
   `import` — xoá chỗ gọi thật thì test vẫn xanh. Phải có dấu `<` để chỉ khớp
   thẻ JSX, và phải khẳng định điểm cắt có thật trước khi cắt
   (`expect(idx).toBeGreaterThan(-1)`).
2. **Mốc tìm trả `-1`, phép cắt chạy tới hết file.** `slice(indexOf(x))` khi
   `indexOf` trả `-1` là `slice(-1)` — chuỗi 1 ký tự, mọi assert sau đó đều xanh
   vô nghĩa.
3. **Lệnh sửa file hỏng âm thầm.** PowerShell đọc UTF-8 thành ANSI nên
   `.Replace()` với chuỗi tiếng Việt **không khớp và không báo lỗi** — file giữ
   nguyên, test xanh, tưởng là đã kiểm chứng. Dùng
   `[System.IO.File]::ReadAllText/WriteAllText` với `Encoding::UTF8`, rồi **đọc
   lại xác nhận thay đổi đã vào**.

## 3. Sửa token màu phải sửa cả ba file

`tests/design-system.test.ts` canh chiều hai chiều giữa test, `tailwind.config.ts`
và `app/globals.css`. Sửa một bên thì test đỏ. Đây là hợp đồng, không phải sở
thích — sửa đồng thời cả ba trong một lượt.

Lưu ý cấu trúc: `brand-lime`, `brand-mid`, `brand-deep` là `token('--brand-…')`
(đọc từ CSS). `brand` là **hex viết thẳng**, không có biến `--brand` trong
`globals.css`.

## 4. Tài liệu

**Tài liệu không có hiệu lực. Test mới có.** Đo 2026-10-18: xoá hẳn `DESIGN.md`
khỏi repo thì `tests/design-system.test.ts` vẫn 47/47 xanh. Không test nào đọc
nội dung tài liệu.

Hệ quả: tài liệu viết ở thì mệnh lệnh nhưng không mệnh lệnh nào được canh sẽ
lệch dần khỏi code mà vẫn trông như luật, và agent sẽ tuân thủ luật đã chết. Vì
vậy:

- `DESIGN.md` — định hướng ngắn, không phải hợp đồng.
- `PLAN.md`, `PLAN-ui-audit.md` ở gốc repo — **lịch sử**, đã dánh nhãn.
- `docs/DESIGN-2026-10-06.md` — bản `DESIGN.md` cũ, lưu trữ.

`npm run docs:check` dùng `git ls-files`, nên **file mới phải `git add` trước**
thì nó mới được theo dõi — không add thì checker báo sai.

## 5. Ngôn ngữ

| Chỗ | Dấu tiếng Việt |
|---|---|
| Comment trong code, tài liệu | **CÓ** |
| Tin nhắn commit | **KHÔNG** (`fix(agents): sua Critical cua reviewer`) |

Commit theo `type(scope): mô tả`, scope là vùng code (`agents`, `brand`, `ui`…).

## 6. Code chết thì xoá hẳn

Chủ repo đã dặn: *"cái nào không cần thì xoá hết, không giữ lại"*. Đừng giữ lại
vì "có thể sau này cần" — và đừng refactor code không liên quan tới việc đang
làm. Xoá rồi để lại comment giải thích **vì sao** xoá, để người sau không thêm
lại.

**Rác nguy hiểm nhất không phải code mồ côi — là code TRÙNG LẮP.** Hai cơ chế
làm cùng một việc thì giết cái sai. Còn hơn, xoá cái **dùng số liệu bịa**:
`lib/capability-projection.ts` từng lọc MCP tool bằng byte ước lượng bịa đặt,
chiếm 6.420/16.000 byte ngân sách của Tool Router. Xoá xong mới thấy Tool
Router ngay cạnh đã làm đúng việc đó bằng BM25 trên schema thật.

### Trước khi xoá: tìm không ra KHÔNG phải bằng chứng

Đã suýt xoá nhầm code đang chạy. Nguyên nhân:

```powershell
Select-String -Path "app\**\*.ts" -Pattern "foo"   # KHÔNG recurse như tưởng
```

`**` trong PowerShell không luôn đệ quy — lệnh trên bỏ sót `app/api/chat/route.ts`,
nên kết luận `lib/capability-projection.ts` chết, trong khi `route.ts:73` đang
import nó. Đây là hướng sai chết người: tìm-hụt dễ dẫn tới xoá nhầm.

Ba điều phải làm trước khi kết luận "chết":

1. **Thử lệnh tìm lên một thứ chắc chắn còn sống** và xác nhận nó tìm thấy.
   Lệnh không tìm thấy thứ *đáng ra* phải thấy thì lệnh đó vô dụng.
2. **Không tin kết quả rỗng khi lệnh vừa in lỗi.** Regex sai làm `Select-String`
   ném lỗi *cho từng file* rồi trả kết quả rỗng với exit 0.
3. **Dùng công cụ recurse thật**: `rg`, tool `grep`, hoặc
   `Get-ChildItem -Recurse`. Không tin `**` trong PowerShell.

Cùng dạng với mục 3 của §2: thao tác im lặng không báo lỗi, kết quả sai, tưởng
đã kiểm chứng.

## 7. Bản đồ nhanh

| Việc | Ở đâu |
|---|---|
| Tool runtime của agent | `core/agent-runtime/` |
| Hook điều phối chat | `react/use-chat-orchestration.ts` |
| Multi-tab lock | `core/agent-runtime/tab-lock.ts` |
| Hình + màu logo | `brand/mark.json` → `components/vyen-logo.tsx` + `scripts/build-icons.cjs` |
| Bảng màu giao diện | `app/globals.css` + `tailwind.config.ts` + `tests/design-system.test.ts` |
| Test hợp đồng design system | `tests/design-system.test.ts` |
| Vị trí logo được phép hiện | `tests/brand-placement.test.ts` |

## 8. Trước khi báo xong

- [ ] `npm run typecheck` exit 0
- [ ] `npm run test` — không đỏ (trừ 3 flaky ở mục 1)
- [ ] `npm run lint` — không có lỗi mới
- [ ] `npm run docs:check` OK
- [ ] Test mới đã được chứng minh ĐỎ (mục 2)
- [ ] File mới đã `git add`
