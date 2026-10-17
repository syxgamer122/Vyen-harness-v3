/**
 * RED TEAM — các hàm thuần của ThinkingMenu (components/thinking-menu.tsx).
 * Metadata rác: mức ngoài thang, danh sách lặp/lộn thứ tự, rỗng.
 */
import { describe, expect, it } from 'vitest';
import {
  menuSubtitle,
  snappedTitle,
  supportedLevelsText,
  visibleLevelsFor,
} from '@/components/thinking-menu';
import type { ThinkingLevel } from '@/lib/provider-url';

const ALL_KEYS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

describe('RED TEAM visibleLevelsFor — metadata rác', () => {
  it('chỉ khai mức NGOÀI thang Vyen (ultra/extra-high): coi như toggle-only, hiện đủ thang', () => {
    const foreign = ['ultra', 'extra-high'] as unknown as ThinkingLevel[];
    expect(visibleLevelsFor(foreign).map((l) => l.key)).toEqual(ALL_KEYS);
  });

  it('mức trong thang (minimal/xhigh/none) KHÔNG bị coi là rác', () => {
    const known = ['none', 'minimal', 'xhigh'] as ThinkingLevel[];
    expect(visibleLevelsFor(known).map((l) => l.key)).toEqual(['none', 'minimal', 'xhigh']);
  });

  it('lặp mức và thứ tự lộn xộn: không trùng, vẫn đúng thang', () => {
    const messy = ['max', 'high', 'high', 'low', 'low'] as ThinkingLevel[];
    expect(visibleLevelsFor(messy).map((l) => l.key)).toEqual(['low', 'high', 'max']);
  });

  it('rỗng / null / undefined: không throw, không bao giờ rỗng', () => {
    expect(visibleLevelsFor([]).map((l) => l.key)).toEqual(ALL_KEYS);
    expect(visibleLevelsFor(null).map((l) => l.key)).toEqual(ALL_KEYS);
    expect(visibleLevelsFor(undefined).map((l) => l.key)).toEqual(ALL_KEYS);
  });
});

describe('RED TEAM menuSubtitle — metadata null / rỗng / lệch thứ tự', () => {
  it('null + mandatory: mô tả chung kèm ghi chú luôn suy luận', () => {
    expect(menuSubtitle(null, true)).toBe(
      'Điều khiển độ sâu phân tích của AI · Model này luôn suy luận',
    );
  });

  it('undefined + không mandatory: mô tả chung thuần', () => {
    expect(menuSubtitle(undefined, false)).toBe('Điều khiển độ sâu phân tích của AI');
  });

  it('mảng rỗng (toggle-only): gateway tự dịch', () => {
    expect(menuSubtitle([], false)).toBe('Gateway tự dịch mức thành bật/tắt');
    expect(menuSubtitle([], true)).toBe('Gateway tự dịch mức thành bật/tắt · Model này luôn suy luận');
  });

  it("['max','low'] + mandatory: liệt kê theo thang low→max bất kể thứ tự nhập", () => {
    expect(menuSubtitle(['max', 'low'], true)).toBe(
      'Model hỗ trợ: Thấp, Tối đa · Model này luôn suy luận',
    );
  });
});

describe('RED TEAM supportedLevelsText — thứ tự bất kể đầu vào', () => {
  it("['max','low'] sắp về 'Thấp, Tối đa'", () => {
    expect(supportedLevelsText(['max', 'low'])).toBe('Thấp, Tối đa');
  });

  it('đảo đủ 4 mức: vẫn in theo thang low→max', () => {
    expect(supportedLevelsText(['max', 'high', 'medium', 'low'])).toBe(
      'Thấp, Trung bình, Cao, Tối đa',
    );
  });

  it('mảng rỗng trả chuỗi rỗng (không "Model hỗ trợ: ")', () => {
    expect(supportedLevelsText([])).toBe('');
  });
});

describe('RED TEAM snappedTitle — requested trùng effective', () => {
  it("snappedTitle('max','max') không throw, nhắc cả hai mức", () => {
    const title = snappedTitle('max', 'max');
    expect(title).toContain('Mức suy luận');
    expect(title).toContain('Tối đa');
    expect(title).toContain('đang gửi Tối đa');
  });

  it('cặp thường: requested low, effective high', () => {
    expect(snappedTitle('low', 'high')).toBe(
      'Mức suy luận: Cao (Model không hỗ trợ Thấp, đang gửi Cao)',
    );
  });
});
