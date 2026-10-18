# brand/ — hình và màu logo Vyen

Thư mục này giữ **nguồn duy nhất** cho dấu hiệu thương hiệu Vyen.

| File | Vai trò |
|---|---|
| `mark.json` | **NGUỒN SỰ THẬT.** Hình + bảng màu. Đọc bởi `components/vyen-logo.tsx` (render trong app) và `scripts/build-icons.cjs` (sinh icon ngoài app). Sửa chỉ ở đây. |
| `logo-source.png` | Ảnh gốc 2048×2048 do chủ repo cung cấp. **Không dùng lúc chạy** — chỉ để đo lại khi logo đổi. |
| `render-cmp.cjs` | Công cụ đối chiếu mắt: sinh lại icon rồi dựng `cmp-big.png` (ảnh gốc bên trái, icon bên phải). Chạy tay khi cần soi. `cmp-big.png` **không theo dõi trong git** — 268KB nhị phân sinh ra, xoá thoải mái, chạy lại script là có. |

## Vì sao có `build-icons.cjs` ở `scripts/`

Đợt audit 2026-10-18 phát hiện **một thương hiệu nhưng ba logo**:

1. `components/vyen-logo.tsx` — logo render trong app
2. `app/icon.svg` — tab trình duyệt, hình 1 vòng gradient khác hẳn
3. `public/icons/*.png` — màu `#11835F`, **không thuộc bảng màu §2** và không
   khớp màu nào trong (1)

Nguyên nhân gốc: `scripts/generate-png-icons.cjs` từng bị **xoá** trong đợt dọn
code chết (`PLAN.md §2`), nên bộ PNG không còn đường nào sinh lại và trôi.

Sửa: `mark.json` làm nguồn chung, `npm run icons:build` sinh lại toàn bộ.
`tests/brand-placement.test.ts` canh bảng màu và quan hệ nguồn, nên trôi lần
nữa sẽ đỏ.

## Cách đo lại khi logo đổi

```bash
node brand/render-cmp.cjs        # xuất cmp-big.png (nguồn | dựng lại) để soi mắt
node scripts/build-icons.cjs     # sinh lại icon.svg + PNG + favicon
```

`cmp-big.png` là **bằng chứng** cho mọi tuyên bố "khớp/không khớp". Không có nó
thì các số trong `mark.json` chỉ là lời. Nó **không nằm trong git** — sinh ra
bằng lệnh trên, xoá thoải mái.

## Giới hạn đã biết

- **Bốn dải được dựng bằng THU NHỎ ĐỒNG DẠNG đường viền, không phải offset thật.**
  Hình não–đám mây có khía lõm ở bốn cạnh; khi thu nhỏ, khía lõm bị kéo vào
  trong nhiều hơn ảnh gốc. Khớp ở phần bo, lệch nhẹ ở phần lõm. Muốn khớp tuyệt
  đối phải vẽ tay bốn đường viền lồng nhau.
- **Bóng đổ trong ảnh không được dựng.** Nó là hiệu ứng render, không thuộc hình.
- Ở **16px** bốn dải gộp thành một vệt. Vì vậy avatar trợ lý đã bị gỡ khỏi tin
  nhắn (xem `tests/brand-placement.test.ts`), và cỡ nhỏ nhất dùng trong app là
  24px ở rail sidebar thu gọn.

## Số đo gốc

Ảnh 2048×2048. Khung logo: `x 271–1786`, `y 394–1724` → **1516 × 1331 px**,
tỉ lệ **1.1390** (không vuông — đó là lý do viewBox 34×34 để hình tự khoảng
trống đều hai bên). Quy đổi: `1 đv viewBox = 57.7 px nguồn`.

**Phân biệt hai thứ, dễ lẫn nhất:**

| | Phạm vi quét THÔ trong ảnh | Giá trị CHỌN trong `mark.json` |
|---|---|---|
| viền ngoài | `#186E53` … `#0C754D` | `#1B7455` → `#0D6A4B` |
| dải xanh | `#5FC26F` (trái) … `#319863` (phải) | `#82E767` → `#2F9462` |
| dải mint | `#CBFFD0` … `#D1F4DC` | `#D8FCDC` → `#C3E9D2` |
| mắt / miệng | tối nhất `#156750` | `#158360` |

Cột phải là thứ **đang chạy**; nó được chọn từ cột trái để khớp `DESIGN.md §2`.
Tương phản tính trên `#ffffff`: `brand` `#1b7455` **5.71:1**, `brand-deep`
`#158360` **4.72:1** (đều đạt AA), `brand-mid` `#2f9462` 3.79:1, `brand-lime`
`#82e767` 1.55:1 — chỉ để trang trí.

Độ dày dải, quét ngang qua giữa (bán kính giữa 618px), từ ngoài vào:
**viền 17px → xanh 65px → mint 89px → xanh 65px → trắng** (tổng 15.7% bề rộng).
Thang co trong `mark.json` suy ra đúng từ bốn con số này.

Mặt: mắt `Ø134px` tại `31.2% / 36.4%`, miệng `42px` tại `61.6%` chiều cao.