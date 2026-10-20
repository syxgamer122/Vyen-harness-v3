/**
 * Cổng dependency: OpenTUI phải render được headless TRONG repo này, trên Node
 * (không có Bun), trước khi ta xây bất cứ thứ gì.
 *
 * ============ VÌ SAO CỔNG NÀY TỒN TẠI ============
 *
 * Mọi quyết định về TUI (đảo ESM, cách mount, cách test) đều dựa trên một giả
 * định: "OpenTUI chạy được ở đây". Giả định đó phải được **kiểm trong chính
 * repo**, không phải ở một thư mục tạm ngoài — vì ở đây có `vitest.config.mts`
 * riêng, `setupFiles` riêng, và package là CommonJS.
 *
 * Đây là test đầu tiên của cả chuỗi TUI: nó đỎ trước khi package được cài, và
 * xanh sau khi cài — nên nó chứng minh được đúng thứ nó tên.
 */
import { describe, expect, it } from 'vitest';
import { createTestRenderer } from '@opentui/core/testing';
import { TextRenderable } from '@opentui/core';

describe('OpenTUI chạy được trong repo này', () => {
  it('render khung chữ headless, không cần Bun', async () => {
    const t = await createTestRenderer({ width: 40, height: 8 });
    try {
      t.renderer.root.add(new TextRenderable(t.renderer, { content: 'Vyen TUI' }));
      await t.renderOnce();
      expect(t.captureCharFrame()).toContain('Vyen TUI');
    } finally {
      t.renderer.destroy();
    }
  });
});
