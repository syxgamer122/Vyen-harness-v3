/** @jsxImportSource @opentui/react */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../cli/tui/app';
import { Composer } from '../cli/tui/composer';
import { Header } from '../cli/tui/header';

/** Sự kiện phím giống hệt thứ OpenTUI nhận từ terminal. */
const PHIM = (name: string, shift = false) =>
  ({
    name,
    sequence: name === 'return' ? '\r' : name,
    ctrl: false,
    shift,
    meta: false,
    option: false,
    eventType: 'press' as const,
    repeated: false,
  }) as never;

const plainText = (t: { renderer: { root: { findDescendantById: (id: string) => unknown } } }): string => {
  const r = t.renderer.root.findDescendantById('composer') as { plainText?: string } | undefined;
  return r?.plainText ?? '';
};

describe('header', () => {
  it('hiện tên thư mục và mức dùng ngữ cảnh', async () => {
    /* 16.000 / 200.000 = 8% — con số chọn sẵn để kỳ vọng suy ra từ yêu cầu
     * ("hiện phần trăm ngữ cảnh đã dùng"), không phải từ một phép tính tay. */
    const t = await testRender(
      <Header workspace="du-an" tokens={16000} windowTokens={200000} />,
      { width: 80, height: 3 },
    );
    await t.renderOnce();
    const f = t.captureCharFrame();
    expect(f).toContain('# vyen · du-an');
    expect(f).toContain('16,000 tok');
    expect(f).toContain('8%');
    t.renderer.destroy();
  });

  it('chưa có lượt nào thì không bịa số token', async () => {
    const t = await testRender(<Header workspace="du-an" tokens={null} windowTokens={200000} />, {
      width: 80,
      height: 3,
    });
    await t.renderOnce();
    expect(t.captureCharFrame()).toContain('-- tok');
    t.renderer.destroy();
  });
});

describe('ô nhập', () => {
  it('Enter gửi dòng, và ô nhập được xoá sau khi gửi', async () => {
    const onSubmit = vi.fn();
    const t = await testRender(<Composer focused onSubmit={onSubmit} />, { width: 60, height: 5 });
    await t.renderOnce();
    for (const ch of 'xin chao') t.renderer.keyInput.emit('keypress', PHIM(ch));
    t.renderer.keyInput.emit('keypress', PHIM('return'));
    await t.renderOnce();
    expect(onSubmit).toHaveBeenCalledWith('xin chao');
    expect(plainText(t)).toBe('');
    t.renderer.destroy();
  });

  it('Shift+Enter xuống dòng, KHÔNG gửi', async () => {
    const onSubmit = vi.fn();
    const t = await testRender(<Composer focused onSubmit={onSubmit} />, { width: 60, height: 5 });
    await t.renderOnce();
    t.renderer.keyInput.emit('keypress', PHIM('a'));
    t.renderer.keyInput.emit('keypress', PHIM('return', true));
    t.renderer.keyInput.emit('keypress', PHIM('b'));
    await t.renderOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(plainText(t)).toBe('a\nb');
    t.renderer.destroy();
  });
});

describe('hộp duyệt', () => {
  const app = (props: Partial<React.ComponentProps<typeof App>> = {}) => (
    <App
      workspace="w"
      modelLabel="m"
      windowTokens={1000}
      tokens={null}
      blocks={[]}
      running={false}
      approval={{ id: 7, tool: 'fs_write', moTa: '  path: a.txt' }}
      onSubmit={vi.fn()}
      {...props}
    />
  );

  it('hiện mô tả lệnh và lời nhắc mặc định là KHÔNG', async () => {
    const t = await testRender(app(), { width: 80, height: 24 });
    await t.renderOnce();
    const f = t.captureCharFrame();
    expect(f).toContain('duyệt tool');
    expect(f).toContain('path: a.txt');
    expect(f).toContain('[y/N]');
    t.renderer.destroy();
  });

  /* Phím trả lời hộp duyệt do **store** nghe, không phải App — vì nếu cả hai
   * cùng nghe Esc trên một emitter thì App (đăng ký trước) gỡ lời hỏi khỏi
   * hàng đợi ⇒ store thấy "không còn lời hỏi" ⇒ **cắt lượt**. Xem
   * `tests/tui-bridge.test.ts` và `tests/tui-scenario.test.tsx`. */

  it('ô nhập bị blur khi đang hỏi duyệt — gõ không chen vào dòng', async () => {
    const onSubmit = vi.fn();
    const t = await testRender(app({ onSubmit }), { width: 80, height: 24 });
    await t.renderOnce();
    for (const ch of 'abc') t.renderer.keyInput.emit('keypress', PHIM(ch));
    await t.renderOnce();
    expect(plainText(t), 'ô nhập phải mù khi đang hỏi duyệt').toBe('');
    expect(onSubmit).not.toHaveBeenCalled();
    t.renderer.destroy();
  });
});

/* ============ DÒNG TRẠNG THÁI ============
 *
 * Đo 2026-10-21 (review độc lập): dòng trạng thái **không bao giờ hiện** — ô nhập
 * và dòng trạng thái nằm cùng hàng nên textarea vẽ đè lên. Mà dòng trạng thái
 * là chỗ duy nhất nói "đang chạy" / "chờ bạn quyết" / "chat" ⇒ mất nó thì người
 * dùng không biết lượt đã xong chưa.
 *
 * Test này render **App** (không phải Composer lẻ) vì lỗi nằm ở bố cục cột
 * của App — Composer lẻ thì vẫn đúng. */
describe('dòng trạng thái', () => {
  it('hiện dòng trạng thái khi không có hộp duyệt', async () => {
    const t = await testRender(
      <App
        workspace="w"
        modelLabel="m"
        windowTokens={1000}
        tokens={null}
        blocks={[]}
        running={false}
        onSubmit={vi.fn()}
      />,
      { width: 80, height: 12 },
    );
    await t.renderOnce();
    expect(t.captureCharFrame(), 'dòng trạng thái phải hiện').toContain('chat · m');
    t.renderer.destroy();
  });

  it('hiện "đang chạy" khi lượt đang chạy', async () => {
    const t = await testRender(
      <App
        workspace="w"
        modelLabel="m"
        windowTokens={1000}
        tokens={null}
        blocks={[]}
        running
        onSubmit={vi.fn()}
      />,
      { width: 80, height: 12 },
    );
    await t.renderOnce();
    expect(t.captureCharFrame()).toContain('đang chạy · m');
    t.renderer.destroy();
  });
});
