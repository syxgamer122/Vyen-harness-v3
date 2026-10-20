/**
 * Cổng vào: TUI hay REPL cũ.
 *
 * ============ VÌ SAO SO SỐ, KHÔNG SO CHUỖI ============
 *
 * `'26.10.0' < '26.4.0'` nếu so chuỗi — vì '1' < '4'. Node 26.10 (mới hơn 26.4)
 * sẽ bị coi là quá cũ ⇒ mất TUI trên máy có Node mới. Vì vậy tách từng bậc
 * ra số rồi so số.
 *
 * Mốc 26.4.0 là do OpenTUI yêu cầu: tạo renderer gốc trên Node cần FFI, mà FFI
 * chỉ có từ Node 26.4.0. Cốc ở đây để đổi một chỗ, không rải khắp nơi.
 */

/** Node tối thiểu để chạy TUI (OpenTUI cần FFI). */
export const NODE_TOI_THIEU_TUI = '26.4.0';

export type FrontendReason = 'not-tty' | 'forced' | 'node-too-old';

export type FrontendDecision =
  | { kind: 'print' }
  | { kind: 'plain'; reason: FrontendReason }
  | { kind: 'tui' };

/** `26.12.0` ≥ `26.4.0`? So từng bậc số, chấp nhận tiền tố `v`. */
export function nodeAtLeast(version: string, minimum: string = NODE_TOI_THIEU_TUI): boolean {
  const tach = (s: string): number[] =>
    s
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((n) => {
        const x = Number.parseInt(n, 10);
        return Number.isFinite(x) ? x : 0;
      });
  const a = tach(version);
  const b = tach(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Chọn frontend. Dừng ở điều kiện **đầu tiên** đúng.
 *
 * Thứ tự này là thứ tự của *mức độ quyết định*: `-p` là ý người dùng rõ ràng
 * (một lượt rồi thoát) nên phải thắng; sau đó mới tới điều kiện kỹ thuật.
 */
export function chooseFrontend(input: {
  print: boolean;
  stdinIsTTY: boolean | undefined;
  stdoutIsTTY: boolean | undefined;
  env: { VYEN_PLAIN?: string };
  nodeVersion: string;
}): FrontendDecision {
  if (input.print) return { kind: 'print' };
  if (!input.stdinIsTTY || !input.stdoutIsTTY) return { kind: 'plain', reason: 'not-tty' };
  if (input.env.VYEN_PLAIN === '1') return { kind: 'plain', reason: 'forced' };
  if (!nodeAtLeast(input.nodeVersion)) return { kind: 'plain', reason: 'node-too-old' };
  return { kind: 'tui' };
}
