/**
 * Cổng duyệt trên console — thứ đứng giữa "model muốn ghi file" và "file bị ghi".
 *
 * ============ VÌ SAO TÁCH RA, VÌ SAO NHẬN `io` ============
 *
 * CLI không có UI. `spec §7` nói tool nguy hiểm phải hỏi trước, và đây là chỗ
 * hỏi duy nhất. Nếu viết thẳng `readline` trong `cli/index.ts` thì **không test
 * nào chạm được** — mà đây đúng là chỗ hỏng thì mất dữ liệu. Nên hàm nhận một
 * `ask` bất đồng bộ: test truyền vào hàm trả lời giả, CLI thật truyền readline.
 *
 * ============ MẶC ĐỊNH LÀ "KHÔNG" ============
 *
 * Enter trống phải nghĩa là từ chối. Người dùng bấm Enter theo phản xạ rất
 * thường; nếu đó là "có" thì một lượt Enter có thể xoá file. Suy nghĩ mặc định
 * khiến tai nạn phải cần một chủ ý rõ ràng.
 */
import { redactSecretText } from '@/lib/secret-registry';

/** Trả lời của người dùng cho một câu hỏi. */
export type Ask = (question: string) => Promise<string>;

/** Số ký tự tối đa in ra cho một giá trị tham số. */
const MAX_VALUE_CHARS = 400;
/** Số lần hỏi lại tối đa trước khi từ chối. */
const MAX_ASKS = 3;

/**
 * Mô tả lời gọi tool để người dùng ĐỌC TRƯỚC KHI ĐỒNG Ý.
 *
 * Chỉ in tên tool thì người dùng không biết sắp làm gì, và bấm `y` theo phản
 * xạ — đúng cái làm cho cổng duyệt trở thành hình thức. Nên phải hiện đường dẫn
 * và nội dung.
 */
export function describeToolCall(tool: string, args: Record<string, unknown>): string {
  const lines: string[] = [`--- ${tool} ---`];
  for (const [k, v] of Object.entries(args ?? {})) {
    if (k === 'approvalToken') continue; // bí mật nội bộ, không hiện ra
    lines.push(`  ${k}: ${brief(v)}`);
  }
  return redactSecretText(lines.join('\n'));
}

/** Rút gọn một giá trị bất kỳ xuống dạng đọc được và có trần độ dài. */
function brief(v: unknown): string {
  let s: string;
  try {
    if (typeof v === 'string') s = v;
    else if (v === undefined) s = '(khong co)';
    else s = JSON.stringify(v) ?? String(v);
  } catch {
    // Vòng lặp tự tham chiếu, BigInt… — không được để việc trình bày làm hỏng
    // việc hỏi duyệt, vì hỏi hỏng thì mất dữ liệu.
    s = String(v);
  }
  s = redactSecretText(s);
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}… (còn ${s.length - MAX_VALUE_CHARS})` : s;
}

/** "y" hoặc "co" (tiếng Việt không dấu) là đồng ý. */
function isYes(answer: string): boolean {
  return /^(y|yes|co|c)$/i.test(answer.trim());
}

export function createConsoleApprover(ask: Ask): (tool: string, args: Record<string, unknown>) => Promise<boolean> {
  return async (tool, args) => {
    const shown = describeToolCall(tool, args);
    for (let lan = 0; lan <= MAX_ASKS; lan++) {
      const answer = await ask(`${shown}\nCho phep chay "${tool}" khong? [y/N] `);
      if (isYes(answer)) return true;
      if (lan === 0 && !answer.trim()) {
        // Enter trống ở lượt đầu: hỏi lại một lần cho chắc, chứ không tự coi là có.
        const again = await ask(`Enter trong = KHONG cho phep. Xac nhan "${tool}"? [y/N] `);
        if (isYes(again)) return true;
      }
    }
    return false;
  };
}

/**
 * Duyệt hết không hỏi. **Chỉ dùng khi người dùng tự bật `VYEN_YOLO=1`** — và
 * việc bật phải được in ra console, vì đây là lúc bỏ hết lớp bảo vệ.
 */
export function createAutoApprover(_on: boolean): (
  tool: string,
  args: Record<string, unknown>,
) => Promise<boolean> {
  return async () => true;
}
