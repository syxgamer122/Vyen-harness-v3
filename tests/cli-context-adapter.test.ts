/**
 * Adapter `CoreMessage[]` → `BudgetMessageLike[]` cho CLI.
 *
 * ============ VÌ SAO CẦN FILE NÀY ============
 *
 * `lib/context-budget.ts` đo token theo hình dạng **UI message** (`ai/react`):
 * nó đếm `part.text` và `message.toolInvocations`. Còn `CoreMessage` của AI SDK v4
 * (`ai@4.3.19`, `node_modules/ai/dist/index.d.ts:832`) thì:
 *
 *   - `ToolCallPart` / `ToolResultPart` (`index.d.ts:677,705`) **không có field `text`**;
 *   - `CoreMessage` **không có field `toolInvocations`**.
 *
 * Nên đưa thẳng `CoreMessage[]` vào `estimateContextTokens` là **mọi tool result biến
 * mất khỏi phép đo**. Đo thật 2026-10-19 (script tạm, đã xoá): lịch sử gồm 1 user +
 * 1 assistant(tool-call) + 1 tool(tool-result 24.000 ký tự) + 1 assistant ⇒ ước lượng
 * **5** token, thực tế **~6.000**. Thiếu **1.200×**.
 *
 * Hệ quả nếu không có adapter: compaction **không bao giờ kích hoạt** — và số "0" ấy
 * trông rất hợp lý nên dễ tin (`AGENTS.md` §2.4).
 *
 * ============ BẤT BIẾN 1:1 ============
 *
 * `splitForCompaction` trả `firstKept` là **chỉ số** vào mảng được truyền vào. Nếu
 * adapter làm rơi message nào (ví dụ message `role:'tool'`), chỉ số lệch ⇒ điểm cắt rơi
 * nhầm ⇒ phần giữ lại có thể bắt đầu bằng một `tool-result` mồ côi ⇒ provider từ chối
 * **mọi** lượt sau của phiên. Nên: **mỗi `CoreMessage` ra đúng một entry**.
 */
import { describe, expect, it } from 'vitest';
import type { CoreMessage } from 'ai';
import { estimateContextTokens } from '@/lib/context-budget';
import { toBudgetMessages } from '@/cli/context-adapter';

describe('toBudgetMessages — 1:1 với CoreMessage[]', () => {
  it('giữ nguyên số phần tử và thứ tự, kể cả message tool', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'xin chao' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'a.txt' } }],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c1', toolName: 'fs_read', result: { content: 'x'.repeat(100) } },
        ],
      },
    ];
    const out = toBudgetMessages(msgs);
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('tool-call và tool-result gộp thàNH MỘT invocation, state "result"', () => {
    const msgs: CoreMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'a.txt' } }],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c1', toolName: 'fs_read', result: { content: 'noi dung' } },
        ],
      },
    ];
    const invs = toBudgetMessages(msgs).flatMap((m) => m.toolInvocations ?? []);
    expect(invs).toHaveLength(1);
    expect(invs[0]).toMatchObject({ toolName: 'fs_read', state: 'result' });
    expect(invs[0].args).toEqual({ path: 'a.txt' });
  });

  it('ước lượng phải thấy tool result — đây là lý do adapter tồn tại', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'doc README.md' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'README.md' } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'fs_read',
            result: { content: 'x'.repeat(24_000) },
          },
        ],
      },
    ];
    // 24.000 ký tự tool result ⇒ ít nhất 6.000 token. Không có adapter thì ra ~0.
    expect(estimateContextTokens(toBudgetMessages(msgs))).toBeGreaterThan(5_000);
  });

  it('tool-call CHƯA có tool-result vẫn ra một invocation, state "call"', () => {
    const msgs: CoreMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', args: { path: 'a.txt' } }],
      },
    ];
    const invs = toBudgetMessages(msgs).flatMap((m) => m.toolInvocations ?? []);
    expect(invs).toHaveLength(1);
    expect(invs[0].state).toBe('call');
    expect(invs[0].args).toEqual({ path: 'a.txt' });
  });

  it('nội dung dạng mảng parts lấy phần text', () => {
    const msgs: CoreMessage[] = [{ role: 'assistant', content: [{ type: 'text', text: 'xin chao ban' }] }];
    expect(toBudgetMessages(msgs)[0].content).toBe('xin chao ban');
  });
});
