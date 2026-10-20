/**
 * Lệnh dòng đầu của REPL — **thuần**, không import gì.
 *
 * ============ VÌ SAO TÁCH RIÊNG ============
 *
 * Hai bên cần biết "dòng này có phải lệnh không":
 *   - `cli/repl.ts` (CJS): chạy lệnh `/exit`, `/new`, `/compact`.
 *   - `cli/tui/bridge.ts` (đảo ESM): khi người dùng gõ `/new` thì **xoá màn
 *     hình** (phiên mới ⇒ transcript cũ không còn ý nghĩa).
 *
 * Nếu đảo ESM import runtime từ `cli/repl.ts` thì nó kéo theo cả chuỗi
 * `agent-turn` → AI SDK: nặng, và là cửa ngõ kéo lõi CJS vào bên ESM. Tách
 * ra thành module thuần thì cả hai cùng dùng **một** cách hiểu lệnh — không
 * có bản thứ hai để lệch nhau.
 *
 * `cli/repl.ts` **re-export** lại để không phá chỗ đang gọi cũ.
 */

export type ReplCommand =
  | { kind: 'exit' }
  | { kind: 'new' }
  | { kind: 'compact' }
  | { kind: 'unknown'; name: string };

/**
 * Nhận diện lệnh dòng đầu.
 *
 * ============ VÌ SAO KHỚP TRỌN TỪ ============
 *
 * Bản đầu tôi kiểm `"abc".startsWith('/exit')` — nghe có vẻ đúng, nhưng `/exit ngay`
 * và `/exitch` cũng khớp. Mà `/exit ngay` là người dùng muốn **gõ câu đó cho
 * model**. Thoát nhầm ở đây là **mất cả phiên làm việc** mà không có gì để khôi
 * phục. Nên phải so trọn từ sau dấu `/`.
 */
export function parseCommand(line: string): ReplCommand | null {
  const s = line.trim();
  if (!s.startsWith('/')) return null;
  const ten = s.slice(1);
  if (/^exit$/i.test(ten)) return { kind: 'exit' };
  if (/^new$/i.test(ten)) return { kind: 'new' };
  if (/^compact$/i.test(ten)) return { kind: 'compact' };
  // `/exit ngay` có khoảng trắng → tên lệnh là "exit ngay", không phải lệnh nào.
  if (/\s/.test(ten)) return null;
  return { kind: 'unknown', name: ten };
}
