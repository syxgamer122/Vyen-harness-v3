/**
 * Store của TUI: cầu nối giữa vòng lặp hội thoại (CJS) và màn hình (React).
 *
 * ============ VÌ SAO CẦN MỘT STORE, KHÔNG LÀM TRỰC TIẾP ============
 *
 * `runRepl` nói chuyện bằng callback (`ask`/`out`/`note`/`onToolCall`…), còn màn
 * hình nói chuyện bằng **state**. Store là chỗ dịch giữa hai kiểu giao tiếp đó,
 * và là chỗ duy nhất biết "khối nào đang chạy, khối nào xong, hộp duyệt đang
 * chờ".
 *
 * ============ BẤT BIẾN ============
 *
 * `snapshot()` trả về một object **mới** mỗi lần có thay đổi, vì React so
 * sánh tham chiếu để biết có cần vẽ lại không. Trả về cùng một object sẽ khiến
 * màn hình đứng yên trong khi transcript đã dài thêm.
 */
import { describe, expect, it, vi } from 'vitest';
import { createApprovalBroker } from '@/cli/approval-broker';
import { createTuiStore } from '../cli/tui/bridge';

/** Bàn phím giả — cùng hình dạng với `renderer.keyInput` của OpenTUI. */
const keyInputGia = () => {
  const hs = new Set<(k: { name?: string }) => void>();
  return {
    on: (_: 'keypress', h: (k: { name?: string }) => void) => {
      hs.add(h);
    },
    off: (_: 'keypress', h: (k: { name?: string }) => void) => {
      hs.delete(h);
    },
    emit: (k: { name?: string }) => {
      for (const h of [...hs]) h(k);
    },
  };
};

const storeGia = (over: Partial<Parameters<typeof createTuiStore>[0]> = {}) =>
  createTuiStore({
    messages: [],
    approval: createApprovalBroker(),
    startupNotes: [],
    keyInput: keyInputGia(),
    ...over,
  });

describe('store TUI', () => {
  it('ask chờ tới khi có dòng; submit đẩy dòng và bật trạng thái running', async () => {
    const s = storeGia();
    const p = s.ask();
    expect(s.snapshot().running).toBe(false);
    s.submit('xin chao');
    await expect(p).resolves.toBe('xin chao');
    expect(s.snapshot().running).toBe(true);
  });

  it('out gộp delta; tool call đóng khối chữ; chữ sau tool thành khối mới', () => {
    const s = storeGia();
    s.out('a');
    s.out('b');
    s.onToolCall({ id: 't1', name: 'fs_read', args: { path: 'a.txt' } });
    s.out('c');
    const b = s.snapshot().blocks;
    expect(b.map((x) => x.kind)).toEqual(['assistant', 'tool', 'assistant']);
    expect((b[0] as { text: string }).text).toBe('ab');
    expect((b[2] as { text: string }).text).toBe('c');
  });

  it('tool result ghép theo id, dù về ngược thứ tự', () => {
    const s = storeGia();
    s.onToolCall({ id: 'a', name: 'fs_read', args: {} });
    s.onToolCall({ id: 'b', name: 'fs_read', args: {} });
    s.onToolResult({ id: 'b', name: 'fs_read', result: {} });
    s.onToolResult({ id: 'a', name: 'fs_read', result: {} });
    const tool = s.snapshot().blocks.filter((x) => x.kind === 'tool') as Array<{
      id: string;
      status: string;
    }>;
    expect(tool.map((x) => [x.id, x.status])).toEqual([
      ['a', 'ok'],
      ['b', 'ok'],
    ]);
  });

  it('một kết quả chỉ đóng ĐÚNG khối của nó, khối kia vẫn đang chạy', () => {
    const s = storeGia();
    s.onToolCall({ id: 'a', name: 'fs_read', args: {} });
    s.onToolCall({ id: 'b', name: 'fs_read', args: {} });
    /* Chỉ kết quả của `b` về. Nếu ghép theo TÊN thì cả hai khối cùng tên đều
     * bị đóng ⇒ người dùng thấy lệnh `a` "xong" trong khi nó còn đang chạy. */
    s.onToolResult({ id: 'b', name: 'fs_read', result: {} });
    const tool = s.snapshot().blocks.filter((x) => x.kind === 'tool') as Array<{
      id: string;
      status: string;
    }>;
    expect(tool.map((x) => [x.id, x.status])).toEqual([
      ['a', 'running'],
      ['b', 'ok'],
    ]);
  });

  it('kết quả lỗi (`{ok:false}`) ⇒ khối tool là LỖI, không phải xong', () => {
    const s = storeGia();
    s.onToolCall({ id: 'a', name: 'fs_write', args: {} });
    /* Lỗi tool vẫn đi qua part `tool-result` (wrapper đổi thành `{ok:false}`),
     * nên nếu cứ đánh 'ok' thì dòng lỗi sẽ hiện dấu tick. */
    s.onToolResult({ id: 'a', name: 'fs_write', result: { ok: false, error: 'tu choi' } });
    const tool = s.snapshot().blocks.find((x) => x.kind === 'tool') as { status: string };
    expect(tool.status).toBe('error');
  });

  it('tool lỗi ⇒ khối đang chạy thành lỗi, kèm note mức "error"', () => {
    const s = storeGia();
    s.onToolCall({ id: 'a', name: 'fs_read', args: {} });
    s.onToolError('fs_read', 'hong roi');
    const b = s.snapshot().blocks;
    const tool = b.find((x) => x.kind === 'tool') as { status: string };
    expect(tool.status).toBe('error');
    const note = b.find((x) => x.kind === 'note') as { level: string; text: string };
    expect(note.level).toBe('error');
    expect(note.text).toContain('hong roi');
  });

  it('note giữ đúng mức độ', () => {
    const s = storeGia();
    s.note('canh bao', 'warn');
    const b = s.snapshot().blocks;
    expect(b[0]).toEqual({ kind: 'note', level: 'warn', text: 'canh bao' });
  });

  it('ghi chú khởi động nằm ở đầu transcript', () => {
    const s = storeGia({ startupNotes: ['> co cong cu'] });
    const b = s.snapshot().blocks;
    expect(b[0]).toEqual({ kind: 'note', level: 'info', text: '> co cong cu' });
  });

  it('onUsage cập nhật token hiển thị', () => {
    const s = storeGia();
    s.onUsage({ promptTokens: 1234 });
    expect(s.snapshot().tokens).toBe(1234);
  });

  it('duyệt: có lời hỏi thì hiện trong state; trả lời xong thì mất', () => {
    const approval = createApprovalBroker();
    const s = storeGia({ approval });
    const p = approval.approve('fs_write', { path: 'a.txt' });
    expect(s.snapshot().approval?.tool).toBe('fs_write');
    approval.traLoi(s.snapshot().approval!.id, true);
    expect(s.snapshot().approval).toBeUndefined();
    return p;
  });

  it('Esc không cắt lượt khi đang có hộp duyệt', () => {
    const approval = createApprovalBroker();
    const ki = keyInputGia();
    const s = storeGia({ approval, keyInput: ki });
    const huy = vi.fn();
    s.watchInterrupt(huy);
    void approval.approve('fs_write', { path: 'a' });
    ki.emit({ name: 'escape' });
    expect(huy).not.toHaveBeenCalled();
    approval.traLoi(s.snapshot().approval!.id, false);
    ki.emit({ name: 'escape' });
    expect(huy).toHaveBeenCalledTimes(1);
  });

  it('submit "/new" xoá màn hình, nhưng dòng đó VẪN được đưa cho runRepl', async () => {
    const s = storeGia();
    s.out('cu');
    expect(s.snapshot().blocks.length).toBeGreaterThan(0);
    const p = s.ask();
    s.submit('/new');
    expect(s.snapshot().blocks).toEqual([]);
    await expect(p).resolves.toBe('/new');
  });

  it('lịch sử nạp lại từ đĩa dựng thành block ngay từ đầu', () => {
    const s = storeGia({
      messages: [
        { role: 'user', content: 'cau hoi cu' },
        { role: 'assistant', content: [{ type: 'text', text: 'tra loi cu' }] },
      ],
    });
    const b = s.snapshot().blocks;
    expect(b.map((x) => x.kind)).toEqual(['user', 'assistant']);
  });

  it('đóng store thì lời hỏi đang chờ được trả lời null (không treo)', async () => {
    const s = storeGia();
    const p = s.ask();
    s.close();
    await expect(p).resolves.toBeNull();
  });
});
