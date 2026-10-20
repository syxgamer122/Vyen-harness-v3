/**
 * Broker duyệt tool.
 *
 * ============ VÌ SAO TÁCH RIÊNG, KHÔNG HỎI THẲNG TỪ `cli/index.ts` ============
 *
 * `cli/index.ts` không biết gì về UI: nó chỉ biết "lệnh này cần người dùng
 * đồng ý". Ở REPL cũ, việc hỏi đi qua readline nên tự nhiên. Ở TUI thì bàn phím
 * đang bị ô nhập chiếm, và lời gọi tool có thể **đến trong lúc** một lời gọi
 * khác còn chờ trả lời. Broker là chỗ duy nhất biết cả hai phía:
 *
 *   - phía CJS (gọi tool): `approve(tool, args)` → Promise\<boolean\>;
 *   - phía UI (TUI): `pending()` + `onPending()` + `traLoi(id, dongY)`.
 *
 * ============ LUẬT SỐ MỘT: KHÔNG CÓ LISTENER ⇒ TỪ CHỐI NGAY ============
 *
 * Nếu đẩy vào hàng đợi mà không ai trả lời thì lời gọi tool treo mãi, và mọi
 * lệnh ghi file trong lượt đó treo theo — người dùng chỉ thấy TUI đứng yên.
 * Tệ hơn: treo là trông như treo, còn từ chối là hành vi an toàn (AGENTS.md §2).
 *
 * Vì vậy hàng đợi chỉ dùng khi **có** listener. Điều này cũng đảm bảo thứ tự:
 * `cli/index.ts` dựng broker **trước** khi TUI mount, nên không có khoảng trống
 * mà một lời gọi tool lọt vào hàng đợi không ai nghe.
 */
import { describeToolCall } from './approve';

export interface ApprovalRequest {
  /** Định danh của lần hỏi — UI trả lời theo id, không theo vị trí. */
  id: number;
  tool: string;
  /** Mô tả lời gọi để người dùng ĐỌC TRƯỚC KHI ĐỒNG Ý (đã che bí mật). */
  moTa: string;
}

export interface ApprovalBroker {
  /** Hỏi người dùng. Trả `true` = được phép, `false` = từ chối. */
  approve(tool: string, args: Record<string, unknown>): Promise<boolean>;
  /** Lời hỏi đang chờ (đầu hàng đợi), nếu có. */
  pending(): ApprovalRequest | undefined;
  /** Trả lời lời hỏi theo id. Id lạ ⇒ bỏ qua. */
  traLoi(id: number, dongY: boolean): void;
  /** Theo dõi lời hỏi đang chờ. Trả về hàm hủy đăng ký. */
  onPending(cb: (r: ApprovalRequest | undefined) => void): () => void;
}

export function createApprovalBroker(): ApprovalBroker {
  let idKe = 1;
  const hang: Array<{ req: ApprovalRequest; xong: (dongY: boolean) => void }> = [];
  const listeners = new Set<(r: ApprovalRequest | undefined) => void>();

  const thongBao = (): void => {
    const req = hang[0]?.req;
    for (const cb of [...listeners]) cb(req);
  };

  return {
    approve(tool: string, args: Record<string, unknown>): Promise<boolean> {
      /* Không ai nghe ⇒ từ chối ngay, KHÔNG xếp hàng. Xếp hàng lúc này là
         treo mãi — xem luật số một ở đầu file. */
      if (listeners.size === 0) return Promise.resolve(false);
      const req: ApprovalRequest = {
        id: idKe++,
        tool,
        moTa: describeToolCall(tool, args),
      };
      return new Promise<boolean>((resolve) => {
        hang.push({ req, xong: resolve });
        thongBao();
      });
    },

    pending(): ApprovalRequest | undefined {
      return hang[0]?.req;
    },

    traLoi(id: number, dongY: boolean): void {
      const viTri = hang.findIndex((h) => h.req.id === id);
      if (viTri < 0) return; // id lạ (đã trả lời, hoặc không thuộc broker này)
      const [xong] = hang.splice(viTri, 1);
      xong.xong(dongY);
      thongBao();
    },

    onPending(cb: (r: ApprovalRequest | undefined) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
