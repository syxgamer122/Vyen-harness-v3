/*
 * Nút "cuộn xuống tin nhắn mới nhất" không được hiện ở màn trống.
 *
 * Cờ `isAtBottom` của `useStickToBottom` là trạng thái DÙNG CHUNG cho cả
 * session: nó chỉ được set lại trong `setStick` (`lib/use-stick-to-bottom.ts`),
 * mà điều kiện ghim đều cần có tin nhắn. Màn trống không có gì để ghim, nên
 * không có scroll event nào set lại cờ — người dùng cuộn lên giữa một chat
 * dài rồi bấm sang chat mới sẽ mang cờ `false` sang màn trống, và nút cuộn
 * hiện lên trên màn hình không có gì để cuộn tới. Trước đây điều kiện ở
 * `message-list.tsx` chỉ là `!isAtBottom`.
 *
 * Suite chạy `environment: 'node'` (không jsdom) nên không render được React.
 * Vì vậy hai lớp, đúng như `tests/composer-affordances.test.ts`:
 *
 *   1. Test hàm thuần — import `showJumpToLatest` từ component và gọi thật.
 *   2. Test soi SOURCE — bắt đúng dòng JSX gọi hàm đó. Lớp này quan trọng:
 *      hàm viết đúng mà không ai gọi thì lỗi vẫn sống.
 *
 * CRLF: file trên đĩa là CRLF, `source` dưới đây đã chuẩn hoá một lần.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { showJumpToLatest } from '@/components/chat/message-list';

const source = fs
  .readFileSync(path.resolve(__dirname, '../components/chat/message-list.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

/** Bỏ comment để assert chỉ soi code, không soi chữ trong giải thích. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('nút cuộn xuống — ẩn khi chat không còn tin nhắn', () => {
  /**
   * ĐỎ khen: bốn tổ hợp, kỳ vọng viết tay chứ không suy ra từ hàm.
   *
   * ĐỎ khi: bỏ vế `hasMessages` (trường hợp 1 — cờ dở từ chat trước làm nút
   * hiện trên màn trống), hoặc đảo điều kiện, hoặc đổi `hasMessages` thành một
   * biến khác (ví dụ `isLoading`).
   */
  it('bốn tổ hợp cờ và tin nhắn, chỉ một tổ hợp được hiện', () => {
    expect(showJumpToLatest(false, false), 'chat rỗng mà cờ dở thì không được hiện').toBe(false);
    expect(showJumpToLatest(false, true), 'chat rỗng, cờ đáy').toBe(false);
    expect(showJumpToLatest(true, true), 'chat có tin nhắn, đang ở đáy').toBe(false);
    expect(showJumpToLatest(true, false), 'chat có tin nhắn, người dùng đã cuộn lên').toBe(true);
  });
});

describe('nút cuộn xuống — JSX phải gọi hàm, không tự chế điều kiện', () => {
  /**
   * ĐỎ khi: đổi `{showJumpToLatest(hasMessages, isAtBottom) && (` thành
   * `{!isAtBottom && (` — hàm vẫn còn, vẫn đúng, mà lỗi quay lại màn hình.
   */
  it('điều kiện render nút là hàm showJumpToLatest với đúng hai đối số', () => {
    expect(code).toContain('showJumpToLatest(hasMessages, isAtBottom)');
    expect(code, 'nút cuộn phải còn nút bấm được gọi onScrollToBottom').toContain(
      'onClick={onScrollToBottom}',
    );
  });

  /**
   * ĐỎ khen: chứng minh lớp trên ĐANG nhìn đúng chỗ — không được tồn tại chỗ
   * nào trong JSX tự quyết hiện nút bằng cờ `isAtBottom` không.
   *
   * ĐỎ khen (mutation): đổi `{showJumpToLatest(...)` về `{!isAtBottom` thì
   * assert này đỏ, kể cả khi hàm vẫn còn nguyên.
   */
  it('không chỗ nào tự quyết hiện nút bằng cờ isAtBottom không', () => {
    expect(code, 'còn chỗ quyết hiện nút bằng cờ suông').not.toMatch(/\{!isAtBottom/);
  });
});
