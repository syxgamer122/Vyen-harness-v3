/*
 * "Chưa biết" phải trông như chưa biết, không trông như cảnh báo.
 *
 * `killSwitch === null` = CHƯA BIẾT: bridge chỉ có `setKillSwitch`, không có
 * lệnh đọc (xem comment ở scheduler-panel.tsx:148-159). Trước khi sửa, nhánh
 * `else` của biểu thức màu là `text-warning`, nên "tao không đọc được" hiện ra
 * y hệt "đang tạm dừng" / "lỗi". Người dùng lần đầu mở Cài đặt thấy một thẻ
 * cảnh báo về thứ mà họ chưa hề cấu hình.
 *
 * KHÔNG sửa: nhãn và câu giải thích "KHÔNG ĐỌC ĐƯỢC trạng thái" — đó là sự thật
 * trung thực, `tests/scheduler-panel-honesty.test.ts:120` đang khoá nó.
 *
 * KHÔNG ẩn thẻ khi danh sách lịch rỗng: bản vá đầu tiên có ẩn, rồi bị bỏ. Panel
 * đọc `db.schedules` (Dexie) còn daemon đọc `.vyen/schedules.json`
 * (`lib/scheduler/runner.ts:52`). Lịch do CLI thêm vào file — hoặc IndexedDB bị
 * xoá — vẫn chạy trong khi Dexie rỗng; ẩn thẻ lúc đó xoá van an toàn duy nhất
 * khỏi UI. Muốn ẩn thì phải hỏi `scheduler.list()` (bridge đã có sẵn), việc đó
 * cần một đợt riêng.
 *
 * Suite chạy environment 'node' (không jsdom, vitest.config.mts:11) nên phần JSX
 * khoanh bằng đọc source, đúng convention của scheduler-panel-honesty.test.ts.
 *
 * Mỗi `it` ghi rõ DÒNG nào đổi làm nó ĐỎ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

/** Đọc + chuẩn hoá EOL (file trên đĩa là CRLF, CI là LF). */
function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** Comment tiếng Việt hay nhắc đúng tên thứ đã bị gỡ — cắt đi trước khi so. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (c) => c.replace(/[^\n]/g, ' '));
}

const code = stripComments(read('components/scheduler/scheduler-panel.tsx'));

describe('scheduler — thẻ dừng khẩn cấp không được biến mất', () => {
  it('thẻ render vô điều kiện, không phụ thuộc danh sách lịch trong Dexie', () => {
    expect(
      code,
      'ẩn thẻ theo db.schedules là xoá van dừng khẩn cấp khi daemon còn lịch ở nguồn khác',
    ).not.toMatch(/\{hasSchedules &&/);
  });

  it('không còn biến hasSchedules nào dẫn từ danh sách lịch', () => {
    expect(code).not.toMatch(/const hasSchedules/);
  });
});

describe('scheduler — "không biết" không được tô như cảnh báo', () => {
  it('icon trạng thái null dùng màu trung tính', () => {
    expect(
      code,
      'killSwitch === null phải tô text-tertiary, không phải text-warning',
    ).toMatch(/killSwitch === null\s*\?\s*'text-tertiary'/);
  });

  it('xử lý null TRƯỚC, không để null rơi vào nhánh mặc định màu cảnh báo', () => {
    /*
     * Trước: `killSwitch === true ? 'text-danger' : 'text-warning'` — null rơi
     * vào nhánh else và thành màu cảnh báo. Assert bắt THỨ TỰ, không bắt chuỗi
     * con: biểu thức đúng vẫn chứa cặp `=== true ? 'text-danger' :
     * 'text-warning'` ở hai nhánh cuối.
     */
    const iconAt = code.indexOf('<AlertCircle size={13} className={killSwitch');
    expect(iconAt, 'không tìm thấy icon trạng thái scheduler').toBeGreaterThan(-1);
    const iconExpr = code.slice(iconAt, code.indexOf('\n', iconAt));
    expect(
      iconExpr,
      'nhánh đầu của biểu thức màu phải là null, không phải so sánh với true',
    ).toMatch(/className=\{killSwitch === null \? 'text-tertiary'/);
  });

  it('vẫn giữ màu nguy hiểm cho trạng thái "đang tạm dừng"', () => {
    expect(code, 'sửa màu của null không được nuốt luôn màu của true').toMatch(
      /killSwitch === true\s*\?\s*'text-danger'/,
    );
  });

  it('nhãn viết thường, nói đúng sự thật', () => {
    expect(
      code,
      'trạng thái chưa biết không phải lỗi — không in hoa như cảnh báo',
    ).toMatch(/'Chưa xác định được trạng thái Scheduler'/);
    expect(code, 'còn sót nhãn in hoa cũ').not.toContain('KHÔNG ĐỌC ĐƯỢC');
  });

  it('câu giải thích không dùng từ nội bộ', () => {
    // "Bridge" và "kill-switch" là thuật ngữ trong mã, không phải thứ người
    // dùng hiểu. Câu này đọc cho người, nên phải nói bằng lời của họ.
    // CÓ HAI nhánh `killSwitch === null`: nhãn trong <div> trước, câu giải
    // thích trong <p> sau. Lấy match CUỐI, không lấy nhãn.
    const branches = [...code.matchAll(/: killSwitch === null\s*\?\s*'([^']*)'/g)];
    expect(branches.length, 'không cắt được nhánh chưa biết').toBeGreaterThanOrEqual(2);
    expect(
      branches[branches.length - 1]![1],
      'câu giải thích còn dùng từ nội bộ',
    ).not.toMatch(/Bridge|kill-switch/);
  });

  it('nút trung tính khi chưa biết — chỉ đỏ khi đang chạy', () => {
    expect(
      code,
      'nút đỏ = "bấm là dừng mọi lịch"; khi chưa biết thì không có hành động nào chắc chắn',
    ).toMatch(/killSwitch === false \? 'border-danger text-danger' : ''/);
  });

  it('nhánh "không có scheduler" giữ nguyên', () => {
    // Ruling 5: nhánh này đã trung thực và có test riêng khoá
    // (scheduler-panel-honesty.test.ts:120).
    expect(code).toMatch(/'Scheduler không có trong bản này'/);
  });
});