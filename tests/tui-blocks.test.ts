/**
 * Block transcript: từ `CoreMessage[]` (lịch sử) và từ sự kiện (stream) ra cùng
 * một hình dạng để vẽ.
 *
 * ============ VÌ SAO CẦN "CÙNG MỘT HÌNH DẠNG" ============
 *
 * Lịch sử nạp lại từ đĩa và dòng chảy lúc chạy phải cho ra **cùng một loại
 * block**, nếu không thì mở lại phiên là thấy màn hình khác hẳn lúc đang chat —
 * và người dùng tưởng mất dữ liệu. Vì vậy có `messagesToBlocks` (lịch sử) và
 * `blocks.ts` dùng chung bộ nhãn/chi tiết cho cả hai.
 *
 * ============ GHÉP THEO ID, KHÔNG THEO THỨ TỰ ============
 *
 * `tool-result` về theo lúc từng lệnh xong ⇒ hai tool cùng tên có thể về ngược
 * thứ tự. Ghép theo tên là sai (hai lần gọi cùng tên là hai thứ khác nhau) ⇒
 * ghép theo `toolCallId`.
 */
import { describe, expect, it } from 'vitest';
import { messagesToBlocks, nhanTool, tomTatDoiSo } from '../cli/tui/blocks';

describe('messagesToBlocks', () => {
  it('user + assistant text', () => {
    const b = messagesToBlocks([
      { role: 'user', content: 'xin chao' },
      { role: 'assistant', content: [{ type: 'text', text: 'chao ban' }] },
    ]);
    expect(b).toEqual([
      { kind: 'user', text: 'xin chao' },
      { kind: 'assistant', text: 'chao ban' },
    ]);
  });

  it('nhiều phần text liên tiếp của assistant gộp làm một block', () => {
    const b = messagesToBlocks([
      { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ]);
    expect(b).toEqual([{ kind: 'assistant', text: 'ab' }]);
  });

  it('tool call + result ghép theo id, KHÔNG theo thứ tự về', () => {
    const b = messagesToBlocks([
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'a', toolName: 'fs_read', args: { path: 'a.txt' } },
          { type: 'tool-call', toolCallId: 'b', toolName: 'fs_read', args: { path: 'b.txt' } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'b', toolName: 'fs_read', result: {} },
          { type: 'tool-result', toolCallId: 'a', toolName: 'fs_read', result: {} },
        ],
      },
    ]);
    const tool = b.filter((x) => x.kind === 'tool') as Array<{ id: string; status: string }>;
    expect(tool.map((x) => [x.id, x.status])).toEqual([
      ['a', 'ok'],
      ['b', 'ok'],
    ]);
  });

  it('tool-result mồ côi không làm sập, cũng không tạo block', () => {
    const b = messagesToBlocks([
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'z', toolName: 'x', result: {} }] },
    ]);
    expect(b).toEqual([]);
  });

  it('tool chưa có kết quả thì đang chạy', () => {
    const b = messagesToBlocks([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'fs_read', args: { path: 'a.txt' } }],
      },
    ]);
    const tool = b[0] as { status: string };
    expect(tool.status).toBe('running');
  });

  it('tool lỗi (kết quả `{ok:false}`) ⇒ khối tool là LỖI, không phải xong', () => {
    /* Lỗi tool đi qua part `tool-result` (wrapper đổi thành `{ok:false,error}` để
     * model đọc được lý do) ⇒ nếu lúc nạp lại lịch sử cứ đánh 'ok' thì mở lại
     * phiên sẽ thấy dấu tick cho một tool đã hỏng. Đo 2026-10-21 (review độc
     * lập). */
    const b = messagesToBlocks([
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'fs_write', args: {} }],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'a', toolName: 'fs_write', result: { ok: false, error: 'tu choi' } },
        ],
      },
    ]);
    const tool = b.find((x) => x.kind === 'tool') as { status: string };
    expect(tool.status).toBe('error');
  });

  it('text rỗng thì không tạo block', () => {
    const b = messagesToBlocks([{ role: 'assistant', content: [{ type: 'text', text: '' }] }]);
    expect(b).toEqual([]);
  });
});

describe('nhãn tool', () => {
  it.each([
    ['fs_read', 'read'],
    ['fs_write', 'write'],
    ['fs_edit', 'edit'],
    ['shell_run', 'shell'],
    ['bg_run', 'bg'],
    ['git_diff', 'git diff'],
  ])('%s → %s', (vao, ra) => {
    expect(nhanTool(vao)).toBe(ra);
  });

  it('tool lạ giữ nguyên tên', () => {
    expect(nhanTool('mcp_x')).toBe('mcp_x');
  });
});

describe('tóm tắt tham số', () => {
  it('object → chuỗi một dòng, tối đa 60 ký tự', () => {
    const s = tomTatDoiSo('shell_run', { command: 'a'.repeat(500) });
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s).not.toContain('\n');
  });

  it('chuỗi (đường giả lập) dùng thẳng', () => {
    expect(tomTatDoiSo('fs_read', 'a.txt')).toBe('a.txt');
  });

  it('che bí mật — tham số tool là bề mặt MỚI để lộ bí mật', () => {
    const s = tomTatDoiSo('shell_run', { command: 'curl -H "sk-secret-abc123456789" https://x' });
    expect(s).not.toContain('sk-secret-abc123456789');
  });
});
