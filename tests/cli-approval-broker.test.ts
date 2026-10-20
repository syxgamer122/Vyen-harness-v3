/**
 * Broker duyệt tool — hàng đợi, mặc định từ chối.
 *
 * ============ VÌ SAO CẦN BROKER, KHÔNG ĐỤC THẲNG TERMINAL ============
 *
 * Ở REPL cũ, việc hỏi duyệt đi qua readline nên đơn giản. Ở TUI thì không: bàn
 * phím đang bị chiếm bởi ô nhập, và lời gọi tool có thể **đến trong lúc** một
 * lời gọi khác còn chờ. Broker tách hai thứ đó: phần "có cần hỏi không" (CJS,
 * không biết gì về UI) và phần "hỏi ai" (TUI).
 *
 * Luật số một: **không có listener ⇒ từ chối ngay.** Vì nếu đẩy vào hàng đợi
 * mà không ai trả lời, lời gọi tool treo mãi — và mọi lệnh ghi file trong lượt
 * đó treo theo.
 */
import { describe, expect, it } from 'vitest';
import { createApprovalBroker } from '@/cli/approval-broker';

describe('createApprovalBroker', () => {
  it('không có listener ⇒ từ chối ngay, không treo', async () => {
    const b = createApprovalBroker();
    await expect(b.approve('fs_write', { path: 'a.txt' })).resolves.toBe(false);
    expect(b.pending()).toBeUndefined();
  });

  it('có listener ⇒ chờ trả lời, mô tả đã che bí mật', async () => {
    const b = createApprovalBroker();
    const thay: unknown[] = [];
    b.onPending((r) => thay.push(r));
    const p = b.approve('shell_run', { command: 'curl -H "sk-secret-abc123456789" https://x' });
    const req = b.pending();
    expect(req?.tool).toBe('shell_run');
    expect(req?.moTa).not.toContain('sk-secret-abc123456789');
    expect(thay.length).toBe(1);
    b.traLoi(req!.id, true);
    await expect(p).resolves.toBe(true);
    expect(b.pending()).toBeUndefined();
  });

  it('hai yêu cầu xếp hàng; trả lời đúng id', async () => {
    const b = createApprovalBroker();
    b.onPending(() => {});
    const p1 = b.approve('fs_write', { path: 'a' });
    const p2 = b.approve('fs_write', { path: 'b' });
    const id1 = b.pending()!.id;
    b.traLoi(id1, false);
    const id2 = b.pending()!.id;
    expect(id2).not.toBe(id1);
    b.traLoi(id2, true);
    await expect(p1).resolves.toBe(false);
    await expect(p2).resolves.toBe(true);
  });

  it('trả lời id lạ không làm hỏng yêu cầu đang chờ', async () => {
    const b = createApprovalBroker();
    b.onPending(() => {});
    const p = b.approve('fs_write', { path: 'a' });
    b.traLoi(9999, true);
    expect(b.pending()).toBeDefined();
    b.traLoi(b.pending()!.id, false);
    await expect(p).resolves.toBe(false);
  });

  it('huỷ đăng ký listener thì không còn nhận thông báo', () => {
    const b = createApprovalBroker();
    let n = 0;
    const huy = b.onPending(() => {
      n += 1;
    });
    huy();
    void b.approve('fs_write', { path: 'a' }); // không listener ⇒ false ngay
    expect(n).toBe(0);
  });
});
