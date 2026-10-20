/**
 * Tài liệu trong code phải khớp với code.
 *
 * ============ LỖI ĐÃ KIỂM CHỨNG ============
 *
 * Khối "CỐ Ý KHÔNG CÓ" ở đầu `cli/index.ts` liệt kê "Rút gọn context: …
 * **Không có compaction**". Nhưng `cli/compaction.ts` tồn tại và
 * `createCompactionRunner` được dùng (`cli/index.ts` + `cli/repl.ts`) — CLI **có**
 * nén khi tràn context.
 *
 * Người đọc tài liệu sẽ đánh giá sai giới hạn của CLI (và tin rằng một phiên
 * dài sẽ chết vì tràn context, trong khi thực tế nó được nén lại).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CLI_INDEX = path.join(process.cwd(), 'cli', 'index.ts');
const CLI_COMPACTION = path.join(process.cwd(), 'cli', 'compaction.ts');

describe('tài liệu CLI khớp với code', () => {
  it('CLI có compaction thì tài liệu không được nói "không có compaction"', () => {
    expect(
      existsSync(CLI_COMPACTION),
      'giả định của test: cli/compaction.ts tồn tại',
    ).toBe(true);
    const noiDung = readFileSync(CLI_INDEX, 'utf8');
    expect(
      noiDung,
      'tài liệu CLI vẫn khẳng định không có compaction',
    ).not.toContain('Không có compaction');
  });

  it('tài liệu phải nói tới compaction (không im lặng bỏ mất mục)', () => {
    const noiDung = readFileSync(CLI_INDEX, 'utf8');
    expect(noiDung).toContain('compaction');
  });
});
