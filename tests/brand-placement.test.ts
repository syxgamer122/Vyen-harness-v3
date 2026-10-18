/**
 * Một thương hiệu, một hình, năm chỗ — và không chỗ thứ sáu.
 *
 * Quyết định sản phẩm 2026-10-18 (chủ repo): logo não–đám mây trong ảnh nguồn là
 * dấu hiệu chính thức. Nó hiện ở ĐÚNG năm chỗ và không chỗ nào khác:
 *
 *   1. Đầu sidebar (luôn hiện, kể cả sidebar thu gọn — rail cũ không có logo)
 *   2. Màn hình trống (màn hình đầu tiên người dùng mới thấy)
 *   3. Màn hình lỗi (`error.tsx` + `global-error.tsx` — trước đây trắng trơn)
 *   4. Icon ngoài app (tab trình duyệt, icon PWA, favicon, trang offline)
 *   5. Rail sidebar thu gọn
 *
 * Và KHÔNG hiện trong từng tin nhắn — avatar trợ lý bị gỡ. Cùng lý do OpenCode,
 * Cursor và Claude không có avatar trong tin: người dùng đọc transcript cả buổi,
 * đặt logo ở mọi tin là tiếng ồn lặp lại, không phải thông tin.
 *
 * Ở `environment: 'node'` nên không render được React — mọi assert soi SOURCE.
 * Xem chú thích đầu `tests/composer-affordances.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import mark from '@/brand/mark.json';

const ROOT = path.resolve(__dirname, '..');

function source(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}
function code(rel: string): string {
  return source(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Bảng màu đo từ ảnh nguồn — xem brand/README.md. */
const APPROVED = [
  '#1B7455', '#0D6A4B', // viền ngoài
  '#82E767', '#2F9462', // dải xanh (gradient)
  '#D8FCDC', '#C3E9D2', // dải mint
  '#1A8261', '#0F5C46', // mắt
  '#3EA260', '#7ED078', // vạch nối mắt
  '#158360',             // miệng
];

describe('logo xuất hiện đúng ở năm chỗ', () => {
  it('đầu sidebar có logo', () => {
    expect(code('components/sidebar.tsx')).toMatch(/<VyenLogo/);
  });

  it('rail sidebar thu gọn cũng có logo — không phải mất thương hiệu', () => {
    /*
     * Rail 56px là phần sidebar còn lại khi thu gọn. Trước đây nó chỉ có nút
     * icon, nên thương hiệu biến mất khỏi cửa sổ dù cột vẫn còn đó.
     */
    const sb = code('components/sidebar.tsx');
    const marker = sb.indexOf('{collapsed && (');
    expect(marker, 'không tìm thấy nhánh rail thu gọn trong sidebar').toBeGreaterThan(-1);
    const rail = sb.slice(marker);
    expect(rail).toMatch(/<VyenMark/);
  });

  it('màn hình trống có logo', () => {
    expect(code('components/chat/message-list.tsx')).toMatch(/<VyenLogo size="lg"/);
  });

  it('cả hai màn hình lỗi đều RENDER logo, không chỉ import', () => {
    // Regex không có `<` sẽ khớp cả dòng import, nên file chỉ import mà không vẽ
    // vẫn xanh — đúng lỗ hổng đã gặp ở `approvalPillLabel`.
    expect(code('app/error.tsx')).toMatch(/<VyenMark/);
    expect(code('app/global-error.tsx')).toMatch(/<VyenMark/);
  });

  it('màn hình lỗi không tự vẽ icon bằng SVG tay', () => {
    // Icon là lucide (`DESIGN.md §9.2`). `error.tsx` từng copy path tam giác cảnh
    // báo bằng tay trong khi `TriangleAlert` đã có sẵn và đang dùng ở
    // `components/diff-confirm.tsx:6`.
    expect(code('app/error.tsx')).not.toMatch(/<svg/);
  });
});

describe('không có avatar logo trong tin nhắn', () => {
  it('`message-item.tsx` không import và không vẽ dấu hiệu thương hiệu', () => {
    expect(code('components/chat/message-item.tsx')).not.toMatch(/VyenMark|VyenLogo/);
  });

  it('không còn ô đệm 26px giữ chỗ cho avatar đã xoá', () => {
    // Ô đệm tồn tại chỉ để tin thứ hai trở đi thẳng hàng với tin đầu khối. Avatar
    // đi rồi thì ô đệm là khoảng trống vô nghĩa.
    expect(code('components/chat/message-item.tsx')).not.toMatch(/h-\[26px\]\s*w-\[26px\]/);
  });

  it('bảng kê công việc không còn thụt lề 34px theo avatar', () => {
    // 34px = avatar 26px + gap 8px. Không avatar thì không lề.
    expect(code('components/chat/tool-trace.tsx')).not.toMatch(/pl-\[34px\]/);
  });
});

/**
 * Danh sách chính xác năm chỗ — và KHÔNG chỗ thứ sáu.
 *
 * Các test phía trên chỉ khẳng định từng chỗ CÓ mặt, cộng thêm một phủ định cục
 * bộ cho `message-item.tsx`. Thiếu mắt xích đúng như thế: thêm `<VyenMark size={16} />`
 * vào `composer.tsx` hay bất kỳ đâu trong `components/**` vẫn xanh — "năm chỗ, và
 * không chỗ nào khác" là quyết định của chủ repo, phải khoá được.
 *
 * Regex `<Vyen(Mark|Logo)\b` có dấu `<` nên KHÔNG khớp dòng import — chỉ khớp
 * thẻ JSX mở thật. `components/vyen-logo.tsx` có mặt vì `VyenLogo` (wordmark)
 * tự dựng `<VyenMark>` bên trong (`vyen-logo.tsx:181`); đó là thành phần, không
 * phải một chỗ hiển thị thứ sáu.
 */
describe('logo không xuất hiện ở nơi thứ sáu', () => {
  const ALLOWED = [
    'app/error.tsx',
    'app/global-error.tsx',
    'components/chat/message-list.tsx',
    'components/sidebar.tsx',
    'components/vyen-logo.tsx',
  ];

  function tsxFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) tsxFiles(rel, out);
      else if (entry.name.endsWith('.tsx')) out.push(rel);
    }
    return out;
  }

  it('đúng năm file render logo, không hơn không kém', () => {
    const found = tsxFiles('components')
      .concat(tsxFiles('app'))
      .filter((rel) => /<Vyen(Mark|Logo)\b/.test(code(rel)))
      .sort();

    expect(found).toEqual(ALLOWED);
  });
});

describe('mọi dấu hiệu Vyen ngoài app lấy từ cùng một hình', () => {
  it('`brand/mark.json` chứa đúng bảng màu đo được, không thừa không thiếu', () => {
    // Đây là HỢP ĐỒNG: danh sách chuỗi ở trên là số đo từ ảnh, `mark.json` là
    // nơi số đó được dùng. Lệch một bên là logo trong app với icon ngoài app
    // không còn là một hình nữa.
    expect(Object.values(mark.palette).sort()).toEqual([...APPROVED].sort());
  });

  it('`vyen-logo.tsx` đọc hình và màu từ `mark.json`, không khai lại', () => {
    // Nếu file này tự khai hex, nó thành nguồn sự thật thứ hai và trôi khỏi
    // `scripts/build-icons.cjs` — đúng cái lỗi đã xảy ra với bộ PNG cũ.
    expect(code('components/vyen-logo.tsx')).toMatch(/from '@\/brand\/mark\.json'/);
    const hexTrongComponent = [...code('components/vyen-logo.tsx').matchAll(/#[0-9a-fA-F]{6}/g)];
    expect(hexTrongComponent.map((m) => m[0].toUpperCase())).toEqual(['#FFFFFF']);
  });

  it('`app/icon.svg` khớp BYTE với bản `scripts/build-icons.cjs` sinh ra lúc này', () => {
    /*
     * Đây là cách duy nhất bắt được HÌNH trôi. Cách so chuỗi rời rạc
     * (`contains(mark.cloud)`, đủ màu, đúng số bản co) KHÔNG đủ: sửa một giá
     * trị thuộc tính trong `mark.json` — ví dụ `eyeR` — thì cả ba vẫn xanh vì
     * `eyeR` không xuất hiện dạng chữ trong file SVG để đối chiếu.
     *
     * Ở đây ta GỌI LẠI chính hàm dựng SVG của script và so với file đã commit.
     * Sửa `mark.json` mà quên `npm run icons:build` là đỏ ngay.
     */
    const { tiledSvg } = require('../scripts/build-icons.cjs') as { tiledSvg: () => string };
    expect(tiledSvg, 'build-icons.cjs phải export tiledSvg() cho test dùng lại').toBeTypeOf('function');
    expect(
      source('app/icon.svg'),
      'app/icon.svg đã cũ so với mark.json — chạy: npm run icons:build',
    ).toBe(tiledSvg());
  });

  it('`app/icon.svg` chỉ dùng màu trong bảng đo được', () => {
    const hexes = [...source('app/icon.svg').matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toUpperCase());
    expect(hexes.length).toBeGreaterThan(0);
    const lạ = hexes.filter((h) => !APPROVED.includes(h) && h !== '#FFFFFF');
    expect(lạ, `app/icon.svg còn màu ngoài bảng đo được: ${lạ.join(', ')}`).toEqual([]);
  });

  it('có script sinh lại icon, và script đó là nguồn của `app/icon.svg`', () => {
    // Trước đây script bị xoá, nên bộ PNG trôi khỏi logo và không còn đường nào
    // làm lại. Có script + test này thì trôi lần nữa sẽ bị bắt.
    const script = code('scripts/build-icons.cjs');
    expect(script).toMatch(/brand\/mark\.json/);
    expect(script).toContain("'app/icon.svg'");
  });

  it('mọi icon mà manifest khai đều tồn tại trên đĩa', () => {
    const manifest = source('app/manifest.ts');
    const srcs = [...manifest.matchAll(/'\/([^']+\.png)'/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) {
      expect(fs.existsSync(path.join(ROOT, 'public', s)), `thiếu file ${s}`).toBe(true);
    }
  });
});