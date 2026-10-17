/**
 * Khoá copy + điều kiện hiển thị của thanh trạng thái và tab "Giao diện".
 *
 * Vì sao soi SOURCE chứ không render DOM: repo chạy vitest environment 'node'
 * (không jsdom / testing-library — xem `vitest.config.mts`), cùng lý do với
 * `tab-runtime-state.test.ts` và `design-system.test.ts`. Soi source chỉ đáng
 * tin khi mốc regex chắc: mỗi `it` dưới đây ghi rõ đảo ngược điều kiện nào thì
 * nó ĐỎ, để một lần sửa sau làm hỏng là đỏ chứ không xanh giả.
 *
 * Bối cảnh: đánh giá của người dùng trên ảnh QA `docs/design-qa/` (chụp
 * 06–08/10) nêu ba lỗi còn đúng trong mã — dấu `·` treo lơ lửng ở mobile, nhãn
 * "ACT"/"PLAN"/"rảnh"/"Steering" kiểu terminal, và ngữ cảnh vượt 100% không giải
 * thích. Ba khối describe tương ứng ba lỗi đó.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeMeter, fmt } from '@/components/context-meter';

const ROOT = path.resolve(__dirname, '..');

/** Đọc + chuẩn hoá EOL (`core.autocrlf` làm regex `\n` lệch giữa các máy). */
function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** Cắt comment, thay bằng khoảng trắng để giữ nguyên số dòng trong message đỏ. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (c) => c.replace(/[^\n]/g, ' '));
}

/** Đoạn source giữa hai mốc, có assert mốc tồn tại để regex hỏng phải ĐỎ. */
function slice(rel: string, start: string, end: string): string {
  const src = read(rel);
  const i = src.indexOf(start);
  expect(i, `${rel}: không tìm thấy mốc mở "${start}" — mốc/regex đã hỏng`).toBeGreaterThan(-1);
  const j = src.indexOf(end, i);
  expect(j, `${rel}: không tìm thấy mốc đóng "${end}" — mốc/regex đã hỏng`).toBeGreaterThan(-1);
  return src.slice(i, j);
}

const STATUS_LINE = 'components/chat/status-line.tsx';
const APPEARANCE_TAB = 'components/settings/appearance-tab.tsx';

describe('status line — dấu phân cách phải cùng breakpoint với nội dung', () => {
  /**
   * ĐỎ khi: `<Sep />` của workspace trở lại KHÔNG có `hidden` — lúc đó ở 375px
   * hàng trạng thái in một dấu `·` trơ trọi giữa tên model và chỉ số ngữ cảnh,
   * vì span workspace là `hidden … lg:inline`. Đó là ký hiệu không mang thông
   * tin, đúng lỗi người dùng phản hồi ("còn dấu · thừa").
   */
  it('Sep của workspace bị ẩn cùng span workspace dưới lg', () => {
    const block = slice(STATUS_LINE, '{workspace && (', 'Ngữ cảnh: MỘT thanh');
    expect(block, 'đoạn workspace phải còn <Sep />').toMatch(/<Sep\s/);
    expect(block, 'Sep của workspace thiếu `hidden` → dấu · hiện ở mobile').toMatch(
      /<Sep className="[^"]*hidden[^"]*"/,
    );
    expect(block, 'Sep của workspace thiếu `lg:` → ẩn cả ở desktop').toMatch(
      /<Sep className="[^"]*lg:inline/,
    );
    /* Span nó phân cách vẫn phải là `hidden … lg:inline`; đổi span thành hiện
       mọi bề rộng cũng là đổi quyết định bố cục, phải đỏ để người sửa biết. */
    expect(block).toMatch(/className="hidden flex-none truncate text-tertiary lg:inline"/);
  });

  /**
   * ĐỎ khi: một trong hai `<Sep />` còn lại (mode/trạng thái, ngữ cảnh) bị gắn
   * `hidden` — chúng phân cách hai thứ HIỆN Ở MỌI bề rộng, ẩn đi là mất nhịp
   * đọc trên desktop.
   */
  it('hai Sep của mode/trạng thái và ngữ cảnh vẫn hiện ở mọi bề rộng', () => {
    const code = stripComments(read(STATUS_LINE));
    const plain = code.match(/<Sep \/>/g) ?? [];
    expect(plain, 'phải có đúng 2 Sep không điều kiện').toHaveLength(2);
  });
});

describe('status line — nhãn tiếng Việt, bỏ idiom terminal', () => {
  /**
   * ĐỎ khi: nhãn pill quay lại `'plan'` / `'act'` — pill sẽ in "PLAN"/"ACT"
   * (kèm `uppercase`), tức đúng thứ người dùng lần đầu đọc như mã nội bộ.
   *
   * Soi đúng BIỂU THỨC RENDER, không soi mọi literal `'plan'` trong file:
   * `'plan' | 'act'` ở khai báo prop là KIỂU DỮ LIỆU của `agentMode`, và
   * `agentMode === 'plan'` là điều kiện — cả hai đều là mã, không in ra màn hình.
   * Cấm cả hai thì phải đổi luôn hợp đồng kiểu, một việc khác hẳn.
   */
  it('nhãn pill mode là chữ Việt, không phải plan/act', () => {
    const code = stripComments(read(STATUS_LINE));
    expect(code).toMatch(/\{agentMode === 'plan' \? 'Khảo sát' : 'Thực hiện'\}/);
    /* Nhãn trợ năng cũng phải nói bằng tiếng Việt; "ACT mode"/"PLAN mode" là
       đúng kiểu terminal bị phản hồi. */
    for (const word of ['ACT mode', 'PLAN mode']) {
      expect(code, `còn nhãn trợ năng "${word}"`).not.toContain(word);
    }
  });

  /**
   * ĐỎ khi: `uppercase` quay lại — nhãn đã là chữ Việt có nghĩa ("Khảo sát"),
   * in hoa + giãn chữ vừa thừa vừa phá đúng thứ cần đọc.
   */
  it('pill mode không in hoa nhãn', () => {
    const pill = slice(STATUS_LINE, 'onToggleAgentMode && (', 'Trạng thái:');
    expect(pill, 'pill mode còn `uppercase`').not.toContain('uppercase');
  });

  /**
   * ĐỎ khi: đổi `runLabel` về 'idle'/'running' (màn hình đọc "Trạng thái:
   * idle") hoặc trả lại 'rảnh' — "rảnh" đọc như nhận xét về tải hệ thống chứ
   * không phải trạng thái của agent.
   */
  it('runLabel là sẵn sàng / đang chạy / tra cứu web', () => {
    const code = stripComments(read(STATUS_LINE));
    expect(code).toMatch(/const runLabel =[^;]*'sẵn sàng'/);
    expect(code).toMatch(/const runLabel =[^;]*'đang chạy'/);
    expect(code).toMatch(/const runLabel =[^;]*'tra cứu web'/);
    for (const word of ['idle', 'running', 'no workspace', 'rảnh']) {
      expect(code, `còn từ trạng thái sai cho UI "${word}"`).not.toContain(`'${word}'`);
    }
  });

  /**
   * ĐỎ khi: xoá `runLabel` khỏi `aria-label` — màn hình đọc mất trạng thái chạy.
   */
  it('aria-label vẫn đọc được nhãn trạng thái', () => {
    expect(read(STATUS_LINE)).toMatch(/aria-label=\{`Trạng thái: \$\{runLabel\}`\}/);
  });
});

describe('status line — ngữ cảnh vượt trần phải nói được', () => {
  /**
   * ĐỎ khi: bỏ chữ "vượt trần" khỏi chuỗi hiển thị. `computeMeter` cố ý
   * KHÔNG clamp percent (`tests/context-meter.test.ts:49`) nên lượt dài in
   * `196k / 128k`; con số đúng nhưng tự nó không giải thích được vì sao vượt
   * 100%, và đáp án ("hội thoại quá trần model, cần nén") lại là một việc người
   * dùng làm được ngay. Chỉ tô đỏ là đưa nghĩa bằng màu, §6 cấm.
   */
  it('vượt trần thì hiện chữ vượt trần cạnh con số', () => {
    expect(read(STATUS_LINE)).toMatch(/meter\.ratio > 1 \? ' · vượt trần' : ''/);
  });

  /**
   * ĐỎ khi: tooltip quay lại một câu cho mọi trường hợp — người dùng phải rê
   * chuột mới thấy, đúng lúc họ đang bối rối nhất.
   */
  it('tooltip phân nhánh theo vượt trần và nói rõ phải làm gì', () => {
    const title = slice(STATUS_LINE, 'Ngữ cảnh: MỘT thanh', '{/* Cụm phải');
    expect(title, 'tooltip không phân nhánh theo ratio > 1').toMatch(/meter\.ratio > 1/);
    expect(title, 'tooltip vượt trần thiếu chữ VƯỢT TRẦN').toContain('VƯỢT TRẦN');
    expect(title, 'tooltip vượt trần không hướng tới hành động nén').toContain('nén');
  });

  /**
   * Số học của meter là hợp đồng riêng, đã khoá ở `context-meter.test.ts`. Ở
   * đây chỉ khẳng định lại điều lớp hiển thị dựa vào: `ratio` KHÔNG clamp nên
   * `> 1` mới là điều kiện đúng. Nếu ai đó clamp `ratio` thì test này đỏ —
   * đúng, vì lúc đó chữ "vượt trần" sẽ không bao giờ hiện.
   */
  it('ratio vượt 100% vẫn > 1 để lớp hiển thị bắt được', () => {
    const m = computeMeter(196_000, 128_000);
    expect(m.ratio).toBeGreaterThan(1);
    expect(m.percent).toBeGreaterThan(100);
    expect(m.tone).toBe('error');
    /* Chuỗi người dùng đọc được, ghép đúng như component in ra. */
    expect(`${fmt(196_000)} / ${fmt(m.safeMax)} · vượt trần`).toBe('196k / 128k · vượt trần');
  });
});

describe('status line — cụm hành động chat chỉ hiện khi chat có tin nhắn', () => {
  /**
   * Nén và Xoá đã có `hasMessages` từ trước, riêng Xuất thì không: nên ở chat
   * rỗng người dùng bấm được một nút xuất ra một file rỗng. Ba hành động này
   * cùng một điều kiện vì cùng một lý do — hội thoại rỗng thì không có gì để
   * nén, không có gì để xoá, không có gì để xuất.
   *
   * Bảng dưới liệt kê từng hành động với điều kiện phải có, viết tay từ mã
   * đang chạy chứ không suy ra từ mã nguồn.
   */
  const GUARDED: Array<[string, RegExp]> = [
    ['Xuất', /\{hasMessages\s*&&\s*\(?\s*<ChatExportMenu\b[^>]*\/>\s*\)?\s*\}/],
    ['Nén', /\{hasMessages\s*&&\s*\(?\s*canCompact/],
    ['Xoá', /\{hasMessages\s*&&\s*\(?\s*\(confirmClear/],
  ];

  /**
   * ĐỎ khen: bỏ `<ChatExportMenu chatId={currentChatId} />` ra khỏi
   * `{hasMessages && ...}` — đúng trạng thái trước bản vá này.
   */
  it('cả ba hành động header cùng chịu hasMessages', () => {
    const code = stripComments(read(STATUS_LINE));
    for (const [ten, re] of GUARDED) {
      expect(code, `hành động "${ten}" không nằm trong \`{{hasMessages && ...}}\``).toMatch(re);
    }
  });

  /**
   * ĐỎ khen: `ChatExportMenu` phải còn nằm trong cụm nút phải của header —
   * không phải ai đó dựng lại nó ở chỗ khác cho "hợp bố cục" rồi quên điều
   * kiện. Mốc ở đây là nó nằm SAU `ThinkingMenu` (cùng cụm) và TRƯỚC nút Nén.
   * Mốc nút Nén là `onClick={onCompact}` chứ không phải `canCompact`: tên prop
   * xuất hiện hai lần (destructure + điều kiện render) nên so vị trí sẽ đo nhầm.
   */
  it('ChatExportMenu vẫn nằm trong cụm nút phải của header', () => {
    const code = stripComments(read(STATUS_LINE));
    const i = code.indexOf('<ChatExportMenu');
    expect(i, 'không tìm thấy <ChatExportMenu> trong status line').toBeGreaterThan(-1);
    /* Cả hai mốc đều phải tồn tại TRƯỚC khi so vị trí: `indexOf` trả -1 khi
       không thấy, mà -1 lại nhỏ hơn mọi chỉ số — so thẳng sẽ xanh khi cái
       cần tìm đã bị xoá hoặc đổi tên. */
    const thinking = code.indexOf('<ThinkingMenu');
    expect(thinking, 'không tìm thấy <ThinkingMenu> — mốc đã đổi').toBeGreaterThan(-1);
    expect(thinking).toBeLessThan(i);
    const compact = code.indexOf('onClick={onCompact}');
    expect(compact, 'không tìm thấy nút Nén — mốc đã đổi').toBeGreaterThan(-1);
    expect(compact).toBeGreaterThan(i);
  });
});

describe('settings — tab Giao diện không dùng thuật ngữ tiếng Anh', () => {
  /**
   * ĐỎ khi: trả lại `steering` / `follow-up` trong copy hiển thị. Hai từ đó là
   * tên nội bộ của cơ chế hàng đợi; người dùng phổ thông không có cách nào suy
   * ra "steering" nghĩa là gõ tin khi AI đang chạy.
   *
   * Soi trên chuỗi hiển thị (`aria-label`, `option`) chứ KHÔNG soi cả file:
   * `settings.steeringMode` / `settings.followUpMode` là TÊN BIẾN của store —
   * cấm chúng là cấm luôn hợp đồng dữ liệu đã lưu của người dùng.
   */
  it('không còn steering/follow-up trong copy người dùng đọc', () => {
    const code = stripComments(read(APPEARANCE_TAB));
    /* Chuỗi trong nháy kép của aria-label + nội dung option; `settings.steeringMode`
       không nằm trong nháy nên không bị bắt oan. */
    const copy = code.match(/aria-label="[^"]*"|<option[^>]*>[^<]*<\/option>/g) ?? [];
    expect(copy, 'không tìm được chuỗi copy nào — mốc regex đã hỏng').not.toHaveLength(0);
    for (const s of copy) {
      for (const word of ['steering', 'Steering', 'follow-up', 'Follow-up']) {
        expect(s, `copy còn thuật ngữ "${word}": ${s}`).not.toContain(word);
      }
    }
  });

  /**
   * ĐỎ khi: đổi key store `steeringMode` / `followUpMode` cho "đẹp". Đó là hợp
   * đồng dữ liệu đã lưu của người dùng (`lib/message-queue.ts` +
   * `lib/store.ts:461`), đổi key mà không migrate là mất cài đặt đã lưu.
   */
  it('key store giữ nguyên steeringMode/followUpMode', () => {
    const code = stripComments(read(APPEARANCE_TAB));
    expect(code).toContain('settings.steeringMode');
    expect(code).toContain('settings.followUpMode');
  });

  /**
   * ĐỎ khi: bỏ nhãn mới — hai ô chọn phải tự nói được mình là ô nào, nếu không
   * người dùng thấy hai dropdown cùng hai lựa chọn "từng tin"/"tất cả" và
   * không biết đổi cái nào.
   */
  it('hai ô chọn có nhãn riêng, phân biệt được', () => {
    const code = stripComments(read(APPEARANCE_TAB));
    expect(code).toMatch(/aria-label="Tin nhập thêm khi AI đang trả lời"/);
    expect(code).toMatch(/aria-label="Tin xếp hàng chờ AI rảnh"/);
    expect(code).toContain('Tin nhập thêm: từng tin');
    expect(code).toContain('Tin chờ AI rảnh: từng tin');
  });
});
