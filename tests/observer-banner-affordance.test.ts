/*
 * Băng quan sát đa tab: không được là ngõi cụt, và phải đọc được.
 *
 * Ba sự thật mà test này khoá, đều là thứ đã hỏng:
 *
 *  1. NGÕI CỤT. Băng render khi `!isLeader`. Trạng thái `OBSERVER` thuần
 *     (tab thứ hai mở lên: lock đã có chủ, mình hỏi xong, không được) có
 *     `isAcquiring === false` và `isLeaderFrozen === false`. Trước đây nút
 *     chiếm quyền nằm sau `{(isAcquiring || isLeaderFrozen) && (`, nên ở
 *     đúng trạng thái đó KHÔNG render nút nào — mà effect lúc mount không
 *     chạy lại, nên cả phiên. Không có ô nhập, không có nút, không có lỗi.
 *
 *  2. TƯƠNG PHẢN. Chữ băng là `text-xs` (12px) tức chữ THƯỜNG, ngưỡng
 *     WCAG AA là 4.5:1. Cặp cũ `text-warning` (#9a6206) trên nền
 *     `bg-warning/10` phủ lên `bg-sunken` (#f7f7f7) ra #f4f0e4 → 4.06:1.
 *     Nút dùng `text-warning` trên `bg-warning/20` → 3.50:1.
 *
 *  3. Đo bằng công thức WCAG thật, không chép số. Token đọc từ
 *     `tailwind.config.ts`, nền dưới cùng đọc từ `<body className=…>` của
 *     `app/layout.tsx`. Đổi giá trị token trong config là test đỏ ngay —
 *     đó là điều kiện để con số trong comment còn đúng.
 *
 * `core.autocrlf`: file trên đĩa là CRLF, CI là LF → chuẩn hoá một lần.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.resolve(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const UI_SRC = read('components/chat-interface.tsx');
const BANNER = UI_SRC.slice(
  UI_SRC.indexOf('{!isLeader && ('),
  UI_SRC.indexOf('<StatusLine'),
);
expect(BANNER.length, 'không cắt được khối băng — mốc trong chat-interface.tsx đã đổi').toBeGreaterThan(200);

/* ------------------------------------------------------------------ */
/* Token thật, đọc từ cấu hình                                        */
/* ------------------------------------------------------------------ */

const CONFIG = read('tailwind.config.ts');
const HEX_MAP: Record<string, string> = Object.fromEntries(
  [...CONFIG.slice(CONFIG.indexOf('const hex = {'), CONFIG.indexOf('} as const')).matchAll(
    /^\s*'?([\w-]+)'?:\s*'(#[0-9a-fA-F]{6})'/gm,
  )].map((m) => [m[1]!, m[2]!.toLowerCase()]),
);
/*
 * ĐẾN ĐÂY CHỈ CẦN CHỨNG MINH BẢNG ĐỌC ĐƯỢC, KHÔNG CẦN ĐẾM.
 *
 * Bảng `hex` có 29 key nhưng chỉ 25 màu: `surface`/`overlay`/`on-fill` cùng
 * `#ffffff`, `secondary`/`diff-ctx` cùng `#575757`, `danger`/`diff-del` cùng
 * `#b3261e`. Trước đây assert này đếm key nên đỏ với 29 ≠ 25 — và vì nó đứng
 * ở cấp FILE nên hỏng cả suite, tức là phần khoá "băng quan sát không phải
 * ngõi cụt" và "tương phản WCAG" bên dưới không chạy lấy một assert.
 *
 * HỢP ĐỒNG BẢNG MÀU THUỘC VỀ `tests/design-system.test.ts`: ở đó bảng §2 được
 * khoá hai chiều (mọi hex trong config phải có mặt trong test và ngược lại), và
 * thêm một màu mới làm test đó đỏ — đã kiểm bằng mutation: "bảng màu trong test
 * khớp tailwind.config.ts theo cả hai chiều". Chép lại con số ở đây chỉ để
 * "bảng màu đổi thì đỏ", tức biến một bảo hiểm đã có ở nơi khác thành quả bom
 * cấp file. Ở đây chỉ cần biết regex còn khớp; token nào thiếu thì `token()`
 * báo đúng tên ngay.
 */
const DISTINCT_COLORS = new Set(Object.values(HEX_MAP));
expect(
  DISTINCT_COLORS.size,
  'không đọc được bảng `hex` trong tailwind.config.ts — regex chắc đã hỏng',
).toBeGreaterThan(0);

/** Nền sâu nhất bên dưới băng: `<body className="… bg-sunken …">`. */
const BODY_BG = read('app/layout.tsx').match(/<body[^>]*\bbg-([a-z-]+)\b/)?.[1];
expect(BODY_BG, 'không tìm thấy class nền trên <body> — app/layout.tsx đã đổi').toBeTruthy();

type RGB = [number, number, number];
const parseHex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]: RGB) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** Tỉ lệ tương phản WCAG 2.x. */
const ratio = (fg: RGB, bg: RGB) => {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};
/** Lớp phủ `bg-<token>/<alpha>` phủ lên nền sâu nhất — đúng thứ trình duyệt dựng. */
const overlay = (fg: RGB, alpha: number, bg: RGB): RGB =>
  fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i])) as RGB;

const token = (name: string): RGB => {
  const hex = HEX_MAP[name];
  expect(hex, `tailwind.config.ts không có token "${name}"`).toBeTruthy();
  return parseHex(hex!);
};

const AA_NORMAL = 4.5;

/* ------------------------------------------------------------------ */
/* 1. Ngõi cụt                                                        */
/* ------------------------------------------------------------------ */

/** Điều kiện (nếu có) đứng ngay trước thẻ <button> của nút chiếm quyền. */
function takeControlGuard(): string | null {
  return BANNER.match(/\{([^{}]+?)&&\s*\(\s*<button[^>]*onClick=\{forceStealLock\}/)?.[1] ?? null;
}

describe('băng quan sát — mọi trạng thái đều phải còn đường ra', () => {
  /**
   * ĐỎ khi: bọc nút trong `{isLeaderFrozen && (`, `{isAcquiring && (`, hay bất
   * kỳ điều kiện trạng thái nào — tức làm một trạng thái không có hành động.
   */
  it('nút chiếm quyền không nằm sau điều kiện trạng thái nào', () => {
    expect(BANNER, 'băng phải còn nút gọi forceStealLock').toMatch(/onClick=\{forceStealLock\}/);
    expect(
      takeControlGuard(),
      'nút chiếm quyền bị ghim vào điều kiện trạng thái → có ngõi cụt',
    ).toBeNull();
  });

  /**
   * ĐỎ khi: đổi cổng ngoài `{!isLeader && (`. Đây là bằng chứng rằng test
   * bên trên ĐANG nhìn đúng chỗ: hai test cùng đỏ khi băng bị hỏng, không
   * phải hai test độc lập vô nghĩa.
   */
  it('cổng của băng chỉ hỏi !isLeader, nên phủ đủ cả ba trạng thái', () => {
    expect(BANNER).toMatch(/^\{!isLeader\s*&&\s*\(/);
    expect(BANNER, 'cổng ngoài không được loại ACQUIRING').not.toMatch(/ACQUIRING/);
  });

  /**
   * ĐỎ kwhen: bỏ `onClick={forceStealLock}` — nút còn hiện nhưng bấm không
   * được, tức trang trí chứ không phải hành động.
   */
  it('nút nối vào forceStealLock và có nhãn', () => {
    expect(BANNER).toMatch(/onClick=\{forceStealLock\}/);
    expect(BANNER).toContain('Chiếm quyền điều khiển');
  });

  /**
   * ĐỎ khi: gộp ACQUIRING vào nhánh của OBSERVER — lúc đang đàm phán mà băng
   * bảo "chỉ đọc", tức nói dối trước khi ai hỏi xong.
   */
  it('ACQUIRING có câu riêng, không mượn câu của OBSERVER', () => {
    expect(BANNER).toMatch(/isAcquiring\s*\?/);
    expect(BANNER).toMatch(/'Đang giành quyền điều khiển[^']*'/);
  });

  /**
   * ĐỎ khi: câu của OBSERVER trở lại kiểu "chỉ đọc" trơ trọn, hoặc nói thêm
   * một điều mà ở trạng thái đó chưa xảy ra (vd "đã bị tab kia chiếm quyền
   * khỏi bạn" trong khi bạn chưa từng là leader). Người dùng phải hiểu ngay
   * VÌ SAO mình không gõ được.
   */
  it('nhánh OBSERVER nói thẳng là tab khác đang giữ quyền', () => {
    const observerCopy = BANNER.match(/:\s*'(Một tab khác[^']*)'/)?.[1];
    expect(observerCopy, 'nhánh cuối của băng phải là câu của OBSERVER').toBeTruthy();
    expect(observerCopy!).toMatch(/tab khác/i);
    expect(observerCopy!).toMatch(/không gõ được/i);
  });

  /**
   * ĐỎ khi: đưa dấu gạch dài (em dash) trở lại vào câu của băng.
   */
  it('câu trong băng không có dấu gạch dài', () => {
    expect(BANNER).not.toContain('—');
  });
});

/* ------------------------------------------------------------------ */
/* 2. Tương phản — đo bằng công thức, không chép số                  */
/* ------------------------------------------------------------------ */

const BANNER_CLASS = BANNER.match(/className="([^"]*)"/)?.[1] ?? '';
const BUTTON_CLASS = BANNER.match(/<button[\s\S]*?className="([^"]*)"/)?.[1] ?? '';
expect(BANNER_CLASS, 'không lấy được class của băng').toBeTruthy();
expect(BUTTON_CLASS, 'không lấy được class của nút chiếm quyền').toBeTruthy();

describe('băng quan sát — tương phản WCAG AA', () => {
  /**
   * ĐỎ khi: đổi token chữ của băng (vd về `text-warning`, 4.01:1) hoặc đổi
   * giá trị token trong `tailwind.config.ts`. Chữ 12px là chữ THƯỜNG nên
   * ngưỡng là 4.5:1, không phải 3:1.
   */
  it('chữ băng đạt 4.5:1 trên nền mà chính nó vẽ ra', () => {
    const textToken = BANNER_CLASS.match(
      /text-(primary|secondary|tertiary|warning|danger|accent|success|on-fill)\b/,
    )?.[1];
    expect(textToken, 'không tìm thấy token chữ của băng').toBeTruthy();
    const alpha = Number(BANNER_CLASS.match(/bg-warning\/(\d{1,3})\b/)?.[1]);
    expect(Number.isFinite(alpha), 'băng phải tô nền bằng một nét warning có alpha').toBe(true);
    const bg = overlay(token('warning'), alpha / 100, token(BODY_BG!));
    const value = ratio(token(textToken!), bg);
    expect(
      value,
      `${textToken} trên bg-warning/${alpha} phủ ${BODY_BG} chỉ đạt ${value.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  /**
   * ĐỎ khi: quay lại cặp `text-warning` trên `bg-warning/20` (3.50:1 ở 10px)
   * cho nút. Chữ trên nền tô đậm phải dùng `text-on-fill` — token sinh ra đúng
   * để trả lời câu hỏi "chữ màu gì để đọc được trên nút tô đậm".
   */
  it('chữ nút chiếm quyền đạt 4.5:1 trên nền nút tô đậm', () => {
    expect(BUTTON_CLASS, 'nút phải tô đặc, không dùng nét mờ').toMatch(/\bbg-warning\b/);
    expect(BUTTON_CLASS, 'chữ trên nền tô đậm phải là text-on-fill').toMatch(/\btext-on-fill\b/);
    expect(BUTTON_CLASS, 'nền nút không được dùng alpha — sẽ nhạt đi và mất tương phản').not.toMatch(
      /\bbg-[a-z-]+\/\d{1,3}\b/,
    );
    const value = ratio(token('on-fill'), token('warning'));
    expect(value, `text-on-fill trên bg-warning chỉ đạt ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });

  /**
   * Khoá lại CÁI CŨ, và khoá luôn lý do: `text-warning` (#9a6206) trên nền
   * `#f7f7f7` trần đã chỉ 4.58:1, nên bất kỳ nét phủ nào cũng đẩy nó xuống
   * dưới 4.5:1. Đổi bảng màu đủ nhiều để token này lại đạt thì test đỏ và
   * nhắc xem lại chỗ này thay vì âm thầm giữ một cặp chữ không bao giờ đạt.
   */
  it('text-warning không thể đạt AA ở bất kỳ nét phủ nào trên nền sunken', () => {
    const bare = ratio(token('warning'), token(BODY_BG!));
    expect(bare, 'nền đã đủ tốt thì nét phủ càng làm hỏng').toBeLessThanOrEqual(5);
    for (const alpha of [0.05, 0.1, 0.2, 0.3, 0.5]) {
      const value = ratio(token('warning'), overlay(token('warning'), alpha, token(BODY_BG!)));
      expect(
        value,
        `text-warning trên bg-warning/${alpha * 100} đạt ${value.toFixed(2)}:1 — lúc đó dùng lại được`,
      ).toBeLessThan(AA_NORMAL);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Vùng chạm                                                       */
/* ------------------------------------------------------------------ */

/**
 * Thang cỡ chữ đọc từ chính `tailwind.config.ts` — nếu ai đó đổi px thì số
 * tính ở dưới tự đổi theo, không chép số cứng vào comment.
 */
const FONT_SCALE = Object.fromEntries(
  [...CONFIG.matchAll(
    /(micro|meta|body|ui|read|head):\s*\['(\d+(?:\.\d+)?)px',\s*\{\s*lineHeight:\s*'([\d.]+)'\s*\}/g,
  )].map((m) => [m[1]!, { px: Number(m[2]), lh: Number(m[3]) }]),
);
expect(Object.keys(FONT_SCALE).length, 'không đọc được thang fontSize trong tailwind.config.ts').toBe(6);

/** Tailwind: 1 đơn vị spacing = 0.25rem, gốc 16px ⇒ 4px. */
const UNIT_PX = 4;

describe('băng quan sát — nút chiếm quyền phải bấm được bằng tay', () => {
  /**
   * Vùng chạm = chiều cao khung chữ + padding, CỘNG phần nới bằng `after:-inset`
   * (lớp trong suốt phủ quanh nút, đúng cách `composer.tsx` và `branch-switcher.tsx`
   * làm cho nút icon). Yêu cầu: 44px — ngưỡng WCAG 2.5.5 và HIG của Apple, dùng
   * vì nút này chỉ xuất hiện ở tình huống người dùng đang bị chặn gõ.
   *
   * Trước bản vá này: `text-micro` + `py-0.5`, không `after:` ⇒ 18px.
   */
  it('vùng chạm đủ 44px kể cả phần nới bằng after:', () => {
    const sizeKey = BUTTON_CLASS.match(/\btext-(micro|meta|body|ui|read|head)\b/)?.[1];
    expect(sizeKey, 'không tìm thấy cỡ chữ của nút — thang đã đổi').toBeTruthy();
    const { px, lh } = FONT_SCALE[sizeKey!]!;

    const padY = Number(BUTTON_CLASS.match(/\bpy-([\d.]+)\b/)?.[1] ?? Number.NaN);
    expect(Number.isFinite(padY), 'không đọc được padding dọc của nút').toBe(true);

    /* `after:-inset-[6px]` (px) hoặc `after:-inset-2` (spacing). */
    const insetRaw = BUTTON_CLASS.match(/after:-inset-\[(\d+(?:\.\d+)?)px\]/)?.[1];
    const insetUnit = BUTTON_CLASS.match(/after:-inset-(\d+(?:\.\d+)?)\b/)?.[1];
    const insetPx = insetRaw !== undefined ? Number(insetRaw) : Number(insetUnit ?? 0) * UNIT_PX;
    expect(
      BUTTON_CLASS,
      'nút không nới vùng chạm bằng after: — khung nhìn thấy nhỏ hơn hẳn vùng bấm',
    ).toMatch(/after:-inset-/);
    /*
     * `after:` mà thiếu `content-['']` thì KHÔNG sinh ra phần tử giả nào, nên
     * vùng bấm rút về đúng 29px trong khi mọi phép tính bên trên vẫn ra 45.
     * Đây là tiền đề của cả phép cộng, nên phải khoá riêng.
     */
    expect(
      BUTTON_CLASS,
      'thiếu `after:content-[""]` ⇒ không có phần tử giả, vùng chạm chỉ còn khung nút',
    ).toMatch(/after:content-\[''\]/);

    const box = px * lh + 2 * padY * UNIT_PX;
    const target = box + 2 * insetPx;
    expect(
      target,
      `nút cao ${box}px + nới ${insetPx}px mỗi bên = ${target}px vùng bấm`,
    ).toBeGreaterThanOrEqual(44);
  });

  /**
   * Nới vùng chạm CHỈ đúng khi băng còn chỗ chứa nó.
   *
   * Băng là con đầu tiên của `flex h-full flex-col overflow-hidden`, và băng
   * có `py-1.5` (6px). Nới 8px thì trên nhô ra khỏi mép trên của container
   * 2px ⇒ `overflow-hidden` cắt mất ⇒ vùng bấm thật còn ~43px, tức dưới
   * ngưỡng 44px dù phép tính trên vẫn ra 45. Đây là lỗi mà assert "45px ≥ 44"
   * ở trên KHÔNG bắt được, vì nó chỉ đọc class của nút chứ không đọc bố cục
   * quanh nó.
   *
   * ĐỎ khi: băng quay về `py-1.5` trong khi nút vẫn `after:-inset-2`.
   */
  it('băng chừa đủ padding cho phần nới, không bị overflow-hidden cắt', () => {
    const insetUnit = BUTTON_CLASS.match(/after:-inset-(\d+(?:\.\d+)?)\b/)?.[1];
    const insetRaw = BUTTON_CLASS.match(/after:-inset-\[(\d+(?:\.\d+)?)px\]/)?.[1];
    const insetPx = insetRaw !== undefined ? Number(insetRaw) : Number(insetUnit ?? 0) * UNIT_PX;

    const bannerPadY = Number(BANNER_CLASS.match(/\bpy-([\d.]+)\b/)?.[1] ?? Number.NaN);
    expect(Number.isFinite(bannerPadY), 'không đọc được padding dọc của băng').toBe(true);

    expect(
      bannerPadY * UNIT_PX,
      `băng chỉ có ${bannerPadY * UNIT_PX}px padding nhưng nút nới ${insetPx}px ⇒ phần nới tràn ra ngoài và bị cắt`,
    ).toBeGreaterThanOrEqual(insetPx);
  });

  /**
   * ĐỎ khen: nhãn nút ở bậc `micro` (10px) thì nhỏ hơn cả chữ băng chứa nó
   * (`text-xs`). Bậc `ui` là bậc dành cho nhãn nút theo thang ở §13.2.
   */
  it('nhãn nút không dùng cỡ micro', () => {
    expect(BUTTON_CLASS, 'nhãn nút vẫn ở 10px').not.toMatch(/\btext-micro\b/);
    expect(BUTTON_CLASS, 'nhãn nút phải ở bậc dành cho nút').toMatch(/\btext-ui\b/);
  });
});
