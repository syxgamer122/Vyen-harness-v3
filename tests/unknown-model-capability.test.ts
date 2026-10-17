/**
 * Capability của model BYOK — suy luận theo id, không có catalog built-in.
 *
 * Lỗi thật đã gặp: gửi ảnh cho `gemma-3-12b` (provider có, app không khai
 * báo) thì model trả "this model does not support image input". Nguyên nhân
 * gốc: app rơi về model mặc định, mà mặc định có supportsImages=true, nên
 * vision-bridge không kích hoạt và ảnh đi thẳng lên model chữ thuần.
 *
 * Sau khi gỡ catalog built-in (BYOK 100%), nguyên nhân gốc không còn khả năng
 * — nhưng phương án BẢO THỦ vẫn là hành vi đúng và phải được giữ: model không
 * nhận diện được coi như KHÔNG xem được ảnh. Sai hướng này chỉ làm ảnh bị mô tả
 * bằng chữ (vẫn dùng được); sai hướng kia làm hỏng hẳn lượt chat.
 */

import { describe, expect, it } from 'vitest';
import { capabilityFor, resolveChainFor } from '@/lib/models';
import { shouldBridgeImages } from '@/lib/vision-bridge';

describe('model lạ (không nhận diện được) — coi như không xem được ảnh', () => {
  it.each(['qwen3.6-plus', 'gemma-3-12b', 'model-tu-che-abc', 'vendor/ten-mo-rac'])(
    'bật vision-bridge thay vì gửi ảnh thô: %s',
    (id) => {
      const c = capabilityFor(id);
      expect(c.supportsImages).toBe(false);
      expect(c.supportsPdf).toBe(false);
      // Bridge bật ⇒ ảnh sẽ được mô tả bằng chữ thay vì gửi thô.
      expect(shouldBridgeImages(c)).toBe(true);
    },
  );

  it('gửi ĐÚNG id model lạ lên gateway (không thay bằng model khác)', () => {
    expect(resolveChainFor('gemma-3-12b')).toContain('gemma-3-12b');
  });
});

describe('model có khai báo capability — giữ nguyên', () => {
  it('model vision nhận ảnh', () => {
    const c = capabilityFor('gpt-4o');
    expect(c.supportsImages).toBe(true);
    expect(shouldBridgeImages(c)).toBe(false);
  });

  it('model chữ thuần vẫn bật bridge', () => {
    const c = capabilityFor('o1-mini');
    expect(c.supportsImages).toBe(false);
    expect(shouldBridgeImages(c)).toBe(true);
  });
});

describe('model reasoning không nhận temperature', () => {
  it.each(['o3-mini', 'o1', 'deepseek-reasoner'])('bỏ temperature cho %s', (id) => {
    expect(capabilityFor(id).supportsTemperature).toBe(false);
  });

  it('model thường giữ temperature', () => {
    expect(capabilityFor('gpt-4o').supportsTemperature).toBe(true);
  });
});

describe('resolveChainFor — không có model dự phòng do app tự chọn', () => {
  it('chuỗi chỉ chứa id người dùng chọn (+ biến thể gạch chấm)', () => {
    expect(resolveChainFor('my-model')).toEqual(['my-model']);
    expect(resolveChainFor('gpt-4.1')).toEqual(['gpt-4.1', 'gpt-4-1']);
  });

  it('id rỗng → không có tên nào để thử (route báo lỗi, không đoán model)', () => {
    expect(resolveChainFor('')).toEqual([]);
  });
});