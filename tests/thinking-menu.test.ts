/**
 * Logic menu mức suy luận (ThinkingMenu).
 *
 * vitest chạy ở environment 'node' (không jsdom/@testing-library) nên phần
 * keyboard wiring không test render được; các mảnh thuần được tách ra test ở đây.
 */
import { describe, expect, it } from 'vitest';
import {
  menuSubtitle,
  snappedTitle,
  supportedLevelsText,
  visibleLevelsFor,
} from '@/components/thinking-menu';

describe('visibleLevelsFor — menu chỉ liệt kê mức model nhận', () => {
  it('lọc theo danh sách hỗ trợ, giữ thứ tự thang', () => {
    expect(visibleLevelsFor(['high', 'low']).map((l) => l.key)).toEqual(['low', 'high']);
    expect(visibleLevelsFor(['medium', 'high', 'max']).map((l) => l.key)).toEqual([
      'medium',
      'high',
      'max',
    ]);
  });

  it('model chỉ hỗ trợ một mức: menu còn đúng một mục', () => {
    expect(visibleLevelsFor(['max']).map((l) => l.key)).toEqual(['max']);
    expect(visibleLevelsFor(['high']).map((l) => l.key)).toEqual(['high']);
  });

  it('mức ngoài bộ 4 cũ (minimal/xhigh/none) vẫn hiện được', () => {
    expect(visibleLevelsFor(['minimal', 'xhigh']).map((l) => l.key)).toEqual([
      'minimal',
      'xhigh',
    ]);
    expect(visibleLevelsFor(['none', 'low', 'high']).map((l) => l.key)).toEqual([
      'none',
      'low',
      'high',
    ]);
  });

  it('khai đủ 4 mức: giữ nguyên', () => {
    expect(visibleLevelsFor(['low', 'medium', 'high', 'max']).map((l) => l.key)).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ]);
  });

  it('không có metadata hoặc chỉ bật/tắt: hiện đủ cả thang', () => {
    const all = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    expect(visibleLevelsFor(null).map((l) => l.key)).toEqual(all);
    expect(visibleLevelsFor(undefined).map((l) => l.key)).toEqual(all);
    expect(visibleLevelsFor([]).map((l) => l.key)).toEqual(all);
  });

  it('model bắt buộc suy luận: KHÔNG có mục "Tắt" ở bất kỳ nhánh nào', () => {    expect(visibleLevelsFor(['none', 'low', 'high'], true).map((l) => l.key)).toEqual([
      'low',
      'high',
    ]);
    expect(visibleLevelsFor(null, true).map((l) => l.key)).not.toContain('none');
    expect(visibleLevelsFor([], true).map((l) => l.key)).not.toContain('none');
    // Gateway khai sai (chỉ "none") cũng không được để menu rỗng.
    expect(visibleLevelsFor(['none'], true).map((l) => l.key)).not.toContain('none');
    expect(visibleLevelsFor(['none'], true).length).toBeGreaterThan(0);
  });
});

describe('supportedLevelsText', () => {
  it('mức tiếng Việt theo thang low → max bất kể thứ tự khai báo', () => {
    expect(supportedLevelsText(['low', 'high'])).toBe('Thấp, Cao');
    expect(supportedLevelsText(['high', 'low'])).toBe('Thấp, Cao');
    expect(supportedLevelsText(['low', 'medium', 'high', 'max'])).toBe(
      'Thấp, Trung bình, Cao, Tối đa',
    );
  });

  it('danh sách rỗng → chuỗi rỗng', () => {
    expect(supportedLevelsText([])).toBe('');
  });
});

describe('menuSubtitle — phụ đề theo metadata', () => {
  it('không có metadata: mô tả tính năng chung', () => {
    expect(menuSubtitle(null, false)).toBe('Điều khiển độ sâu phân tích của AI');
    expect(menuSubtitle(undefined, false)).toBe('Điều khiển độ sâu phân tích của AI');
  });

  it('khai báo subset: liệt kê đúng các mức hỗ trợ', () => {
    expect(menuSubtitle(['low', 'high'], false)).toBe('Model hỗ trợ: Thấp, Cao');
  });

  it('toggle-only (efforts rỗng): gateway tự dịch', () => {
    expect(menuSubtitle([], false)).toBe('Gateway tự dịch mức thành bật/tắt');
  });

  it('mandatory: nối câu luôn suy luận vào mọi biến thể', () => {
    expect(menuSubtitle(null, true)).toBe(
      'Điều khiển độ sâu phân tích của AI · Model này luôn suy luận',
    );
    expect(menuSubtitle([], true)).toBe(
      'Gateway tự dịch mức thành bật/tắt · Model này luôn suy luận',
    );
    expect(menuSubtitle(['max'], true)).toBe(
      'Model hỗ trợ: Tối đa · Model này luôn suy luận',
    );
  });

  it('mandatory: không liệt kê "Tắt" trong khi phụ đề nói luôn suy luận', () => {
    // Nếu phụ đề ghi "luôn suy luận" mà danh sách lại có "Tắt" là tự mâu thuẫn
    // trong một panel (gateway khai sai cũng vậy).
    expect(menuSubtitle(['none', 'low'], true)).toBe(
      'Model hỗ trợ: Thấp · Model này luôn suy luận',
    );
    expect(menuSubtitle(['none', 'low'], false)).toBe('Model hỗ trợ: Tắt, Thấp');
  });
});

describe('snappedTitle — mức yêu cầu không được hỗ trợ', () => {
  it('nêu rõ mức hiệu lực và mức bị từ chối', () => {
    expect(snappedTitle('max', 'high')).toBe(
      'Mức suy luận: Cao (Model không hỗ trợ Tối đa, đang gửi Cao)',
    );
    expect(snappedTitle('medium', 'low')).toBe(
      'Mức suy luận: Thấp (Model không hỗ trợ Trung bình, đang gửi Thấp)',
    );
  });
});
