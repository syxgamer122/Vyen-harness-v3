/*
 * Nút chọn model bị khoá mà không nói lý do.
 *
 * `disabled={disabled || models.length === 0}` (model-selector.tsx:341) khoá nút
 * khi danh sách model rỗng, nhưng `triggerTitle` (cùng file) chỉ có hai nhánh:
 * "đang chọn model bị gỡ" và "đã có model". Cả hai đều trả `undefined` cho
 * trường hợp danh sách rỗng → `title={triggerTitle}` = undefined, chỉ còn
 * `disabled:opacity-40`. Người dùng lần đầu thấy một nút xám, không biết phải
 * làm gì; lối ra ("Thêm nhà cung cấp") nằm ở `use-chat-orchestration.ts:5474`
 * và chỉ chạy khi bấm gửi.
 *
 * Nhánh thứ ba ("đã có model nhưng chưa chọn") cũng trả `undefined`, dù nhãn
 * hiện "Chưa chọn model" — cùng một kiểu mù, chỉ khác chỗ.
 *
 * Suite chạy environment 'node' (không jsdom, vitest.config.mts:11) nên đọc
 * source, đúng convention của tests/scheduler-panel-honesty.test.ts.
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

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (c) => c.replace(/[^\n]/g, ' '));
}

const src = stripComments(read('components/model-selector.tsx'));

const titleStart = src.indexOf('const triggerTitle');
const titleEnd = src.indexOf('return (', titleStart);
const triggerTitle =
  titleStart > -1 && titleEnd > titleStart ? src.slice(titleStart, titleEnd) : '';

describe('model selector — nút bị khoá phải nói lý do', () => {
  it('cắt được khối triggerTitle để soi', () => {
    expect(titleStart, 'không tìm thấy triggerTitle').toBeGreaterThan(-1);
    expect(triggerTitle.length).toBeGreaterThan(100);
  });

  it('có nhánh riêng cho danh sách model rỗng, nói ra lối ra', () => {
    expect(
      triggerTitle,
      'thiếu nhánh models.length === 0 — nút bị khoá mà không giải thích',
    ).toMatch(/models\.length === 0\s*\?\s*'[^']*Thêm nhà cung cấp[^']*'/);
  });

  it('nhánh rỗng nói đúng thao tác kế tiếp, không chỉ nói thiếu model', () => {
    // "Chưa có model nào." một mình là mù — người dùng biết thiếu gì mà
    // không biết làm gì. Nhánh phải chứa cả mệnh đề "ở Cài đặt".
    expect(triggerTitle).toMatch(/models\.length === 0\s*\?\s*'[^']*Cài đặt[^']*'/);
  });

  it('nhánh cuối của chuỗi trả chuỗi, không phải undefined', () => {
    /*
     * Bám vào ĐUÔI chuỗi ternary, không quét cả khối: trong mảng có
     * `current.ctx !== undefined ? … : undefined` — đó là mẹo `.filter(Boolean)`,
     * không phải một nhánh trả về undefined.
     */
    expect(triggerTitle.trimEnd()).toMatch(/:\s*'[^']+';\s*$/);
  });

  it('nhánh "đã có model nhưng chưa chọn" cũng có lời', () => {
    expect(triggerTitle).toMatch(/:\s*'Chưa chọn model[^']*'/);
  });
});

describe('model selector — nút trigger vẫn gắn title đó', () => {
  it('title={triggerTitle} còn nguyên trên nút', () => {
    expect(src).toMatch(/title=\{triggerTitle\}/);
  });

  it('điều kiện khoá nút vẫn là models.length === 0', () => {
    // Đổi thành selectableModels sẽ khoá cả trường hợp chỉ còn model media đã
    // gỡ — thay đổi hành vi, cần một đợt riêng, không lẫn vào bản vá lỗi này.
    expect(src).toMatch(/disabled=\{disabled \|\| models\.length === 0\}/);
  });
});