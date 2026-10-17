/*
 * Màn trống phải có lối vào cho người mới.
 *
 * Trước khi sửa, khi chưa có model: màn trống chỉ có logo, mô tả và 2 thẻ gợi ý.
 * Muốn gửi thì phải gõ, bấm gửi, rồi mới nghe "Thêm nhà cung cấp ở Cài đặt"
 * (`react/use-chat-orchestration.ts:5474`) — một dòng chữ, không có nút, và
 * người dùng đã phải gõ một câu vô nghĩa với dự án chưa cấu hình.
 *
 * Sửa: khi danh sách model rỗng, màn trống hiện thẻ dẫn dắt có nút bấm mở thẳng
 * Cài đặt → tab `providers` (`settings-tabs.ts:26`), nơi đã có sẵn
 * `ProviderManager` với nút "Thêm nhà cung cấp" (`providers-tab.tsx:42`).
 *
 * Vì sao điều kiện đến bằng prop chứ không đọc store: `message-list.tsx` không
 * import `useAppStore` — nó là component trình bày. `chat-interface.tsx` đã có
 * `orch.MODELS`.
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

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (c) => c.replace(/[^\n]/g, ' '));
}

const list = stripComments(read('components/chat/message-list.tsx'));
const shell = stripComments(read('components/chat-interface.tsx'));

/** Vị trí thẻ dẫn dắt = chỗ chữ "Thêm nhà cung cấp" đầu tiên trong màn trống. */
const cardAt = list.indexOf('Thêm nhà cung cấp');

describe('màn trống — có lối vào khi chưa có model', () => {
  it('message-list nhận prop hasModels', () => {
    expect(list, 'thiếu prop hasModels — không biết khi nào cần thẻ dẫn dắt').toMatch(
      /hasModels:\s*boolean/,
    );
  });

  it('message-list nhận prop onAddProvider, không tự gọi store', () => {
    expect(list).toMatch(/onAddProvider:\s*\(\)\s*=>\s*void/);
    expect(
      list,
      'message-list là component trình bày — không được tự gọi openSettings',
    ).not.toMatch(/openSettings/);
  });

  it('thẻ dẫn dắt chỉ hiện khi KHÔNG có model', () => {
    expect(list, 'thiếu điều kiện !hasSchedules cỡ hasModels quanh thẻ').toMatch(
      /\{!hasModels && \(/,
    );
  });

  it('thẻ nằm TRƯỚC 2 thẻ gợi ý', () => {
    expect(cardAt, 'không tìm thấy thẻ dẫn dắt').toBeGreaterThan(-1);
    const suggestionsAt = list.indexOf('suggestions.map(');
    expect(suggestionsAt).toBeGreaterThan(-1);
    expect(
      cardAt < suggestionsAt,
      'thẻ dẫn dắt phải trên thẻ gợi ý — người mới thấy nó đầu tiên',
    ).toBe(true);
  });

  it('2 thẻ gợi ý cũ vẫn còn', () => {
    expect(list, 'bỏ thẻ gợi ý là mất chức năng không ai yêu cầu gỡ').toContain('suggestions.map(');
  });

  it('nút trong thẻ gọi onAddProvider', () => {
    expect(list).toMatch(/onClick=\{onAddProvider\}/);
  });
});

describe('màn trống — nút mở đúng chỗ', () => {
  it('chat-interface truyền hasModels từ MODELS', () => {
    expect(shell).toMatch(/hasModels=\{orch\.MODELS\.length > 0\}/);
  });

  it('chat-interface truyền onAddProvider mở thẳng tab providers', () => {
    expect(
      shell,
      'phải mở tab providers — tab đó đã chứa ProviderManager',
    ).toMatch(/onAddProvider=\{\(\) => useAppStore\.getState\(\)\.openSettings\('providers'\)\}/);
  });

  it('chat-interface import store để gọi action', () => {
    expect(shell).toMatch(/import\s*\{\s*useAppStore\s*\}\s*from\s*'@\/lib\/store'/);
  });
});