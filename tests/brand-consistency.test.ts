/**
 * Một sản phẩm, một câu tự giới thiệu, một dấu hiệu thương hiệu.
 *
 * Đợt audit 2026-10-18 đọc pixel thật trong file raster và đọc JSX thật, thấy
 * bốn thương hiệu cùng tồn tại trong một app:
 *
 *   1. `public/offline.html` vẽ logo chữ "V" gradient `#0A7E8C` → `#4ECB71` —
 *      màu nhấn teal của hệ CŨ, trước đợt đổi sang xanh logo. Trang đó hiện ra
 *      toàn màn hình khi mất mạng.
 *   2. Màn trống in HAI câu tự giới thiệu chồng nhau: tagline do `<VyenLogo
 *      size="lg">` kéo ra, và một `<p>` ngay bên dưới. Câu trên gọi app là
 *      "chat AI và coding agent", câu dưới gọi là "agent harness" — mâu thuẫn,
 *      cách nhau 24px.
 *   3. Hai chip "chế độ phê duyệt" render ở hai hàng, giống nhau đến từng class.
 *   4. Thẻ gợi ý hiện cả khi chưa có model — bấm vào chỉ điền vào một ô nhập
 *      mà ô đó không gửi được.
 *
 * Ở ba mục sau (2, 3, 4) test soi SOURCE. Suite chạy `environment: 'node'`
 * không có jsdom / @testing-library nên không render được React — xem chú thích
 * đầu `tests/composer-affordances.test.ts` về lý do dùng hai lớp.
 *
 * CRLF: file trên đĩa là CRLF (`core.autocrlf`) nên mọi regex có `\n` cứng sẽ
 * PASS ở máy dev và FAIL ở CI. `source()` ở dưới chuẩn hoá một lần cho mọi test.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

/** Đọc source và chuẩn hoá CRLF → LF. Mọi assert soi source dùng hàm này. */
function source(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** Bỏ comment để assert chỉ soi CODE, không soi chữ trong giải thích. */
function code(rel: string): string {
  return source(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/* ------------------------------------------------------------------ *
 * 1. offline.html mang thương hiệu của hệ cũ
 * ------------------------------------------------------------------ */

/** Màu của hệ CŨ, đã bị thay bằng xanh logo `accent` #0B7A53 (DESIGN.md §2.4). */
const LEGACY_BRAND_COLORS = ['#0A7E8C', '#0a7e8c', '#4ECB71', '#4ecb71', '#F7F9FC', '#f7f9fc'];

describe('offline.html mang đúng thương hiệu Vyen', () => {
  const html = source('public/offline.html');

  it('không còn một màu nào của hệ cũ', () => {
    const found = LEGACY_BRAND_COLORS.filter((c) => html.includes(c));
    expect(found).toEqual([]);
  });

  it('nền trang trùng `bg-sunken` (#f7f7f7) — màu splash mà theme_color khai', () => {
    // `app/manifest.ts:10` APP_BACKGROUND và `app/layout.tsx:37` themeColor đều
    // là #f7f7f7. Lệch là thấy vệt trắng nháy trước khi shell kịp vẽ — đó là
    // lý do §7 của DESIGN.md chốt hai chỗ đó phải trùng nhau.
    expect(html.toLowerCase()).toContain('#f7f7f7');
  });

  it('lấy dấu hiệu từ asset thương hiệu dùng chung, không vẽ logo riêng', () => {
    // Inline `<svg>` thứ hai là nơi thứ hai trong app tự dựng dấu hiệu Vyen —
    // đúng cái đã bị gỡ ở màn hình trống (message-list.tsx lấy `VyenLogo`).
    // Asset dùng chung: `public/icons/icon-192.png`.
    expect(html).not.toMatch(/<svg/);
    expect(html).toContain('icon-192.png');
  });

  it('nút dùng màu nhấn của app (#0B7A53), không phải teal của hệ cũ', () => {
    expect(html.toLowerCase()).toContain('#0b7a53');
  });
});

/* ------------------------------------------------------------------ *
 * 2. Màn trống chỉ có MỘT câu tự giới thiệu
 * ------------------------------------------------------------------ */

describe('màn trống chỉ tự giới thiệu đúng một lần', () => {
  const logo = code('components/vyen-logo.tsx');
  const list = code('components/chat/message-list.tsx');

  it('`<VyenLogo size="lg">` không kéo theo tagline riêng', () => {
    // Bản `lg` chỉ dựng mark + wordmark. Câu tự giới thiệu thuộc về màn hình,
    // không thuộc về component thương hiệu — nếu để trong logo thì mọi nơi
    // gọi `lg` đều bị in thêm một câu.
    //
    // Bản cũ cắt theo `logo.slice(logo.indexOf('if (isLarge)'))`, nhưng
    // `vyen-logo.tsx` dùng TERNARY `{isLarge ? (...) : (...)}` chứ không có câu
    // lệnh `if` — `indexOf` trả -1, `slice(-1)` chỉ còn 1 ký tự `}`, và
    // `not.toMatch(/text-read/)` trên 1 ký tự thì KHÔNG BAO GIỜ đỏ. Assert
    // trực tiếp trên cả file: mệnh đề thật là "component logo không chứa câu
    // tự giới thiệu", đúng bằng câu đó chứ không cần cắt nhánh nào.
    expect(logo).not.toContain('Agent harness tối giản');
    expect(logo).not.toMatch(/text-read/);
  });

  it('chữ tự giới thiệu nằm ở message-list, và nằm trong nhánh trạng thái rỗng', () => {
    // Comment ở `message-list.tsx:772-779` đã tự ghi đây là "câu tự giới thiệu
    // DUY NHẤT của màn hình" — code phải khớp đúng câu đó.
    expect(list).toMatch(/Agent harness tối giản/);

    // Khoảnh vực: nhánh `{!hasMessages ? ( ... ) : (` của tam phân. Mốc phải được
    // kiểm là có thật TRƯỚC khi cắt — bản cũ lấy mốc đóng bằng một chuỗi nhiều
    // dòng kèm thụt đầu dòng chính xác; nó trả -1 (mã đã đổi) nên `slice` chạy
    // tới hết file và mọi assert phía sau đều xanh vô nghĩa.
    const OPEN = '{!hasMessages ? (';
    const CLOSE = ') : (';
    const open = list.indexOf(OPEN);
    const close = list.indexOf(CLOSE, open);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);

    const emptyBranch = list.slice(open, close);
    expect(emptyBranch).toContain('Agent harness tối giản');
  });

  it('sidebar giữ đúng MỘT dòng thương hiệu, không lặp mô tả sản phẩm', () => {
    // Dòng "AI Innovations" là chữ thương hiệu đi cùng wordmark ở mọi app.
    // Mô tả sản phẩm thì do màn trống lo, không phải component logo — nếu logo
    // mang nó, mọi nơi gọi đều bị in thêm một câu.
    const occurrences = logo.match(/AI Innovations/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(logo).not.toMatch(/chat AI và coding agent/i);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Một chip "chế độ phê duyệt", và nó luôn đúng nghĩa
 * ------------------------------------------------------------------ */

describe('composer chỉ hiện chip chế độ phê duyệt đúng một chỗ', () => {
  const composer = code('components/composer.tsx');

  it('không còn hai chip trùng nhau ở dải công cụ và hàng chân', () => {
    const chipBody = composer.match(/<Zap[^>]*text-accent[^>]*\/>/g) ?? [];
    expect(chipBody).toHaveLength(1);
  });

  it('chip in nhãn chế độ phê duyệt, không in tiến độ goal loop', () => {
    // `goalLoopInfo` là "3/10" = số lượt lặp. In nó bên dưới icon `Zap` — vốn
    // là icon "chế độ phê duyệt" ở mọi nơi app — khiến người dùng tưởng đó là
    // thông tin về việc agent có hỏi trước khi ghi file hay không.
    expect(composer).not.toMatch(/goalLoopInfo\s*\|\|/);
  });

  it('tiến độ goal loop vẫn còn ở menu Tác vụ', () => {
    // Xoá khỏi hàng chân KHÔNG được xoá khỏi menu: đó là chỗ duy nhất còn lại.
    expect(composer).toMatch(/shortLabel: goalLoopActive \? `Goal \$\{goalLoopInfo/);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Thẻ gợi ý không hiện khi chưa thể gửi
 * ------------------------------------------------------------------ */

describe('thẻ gợi ý chỉ hiện khi app gửi được tin', () => {
  const list = code('components/chat/message-list.tsx');

  it('khối thẻ gợi ý nằm sau `hasModels &&', () => {
    // Bấm thẻ chỉ điền vào composer (`onSelectSuggestion`) — mà không có model
    // thì ô nhập không gửi được, đúng như chính thẻ "Thêm nhà cung cấp" nói.
    //
    // Tìm `suggestions.map(` chứ KHÔNG tìm `onSelectSuggestion`: tên đó xuất
    // hiện sớm hơn ở khai báo prop của component, nên `indexOf` sẽ trỏ vào type
    // thay vì chỗ render.
    const renderIdx = list.indexOf('suggestions.map(');
    expect(renderIdx).toBeGreaterThan(-1);
    const before = list.slice(Math.max(0, renderIdx - 400), renderIdx);
    expect(before).toMatch(/hasModels\s*&&/);
  });
});