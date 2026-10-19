/**
 * Vòng lặp hội thoại — REPL của CLI.
 *
 * ============ CẤU TRÚC ============
 *
 *   mở session (đọc file nếu có) → in chào
 *   lặp:
 *     đọc một dòng từ người dùng
 *       null            → EOF, đóng terminal → thoát
 *       ""              → rỗng, bỏ qua
 *       /exit           → thoát
 *       /new            → xoá lịch sử trong RAM, bắt đầu phiên mới (file cũ giữ nguyên)
 *       còn lại         → thêm vào lịch sử → chạy lượt → ghi kết quả xuống đĩa
 *
 * ============ VÌ SAO GHI XUỐNG ĐĨA NGAY TỪNG LƯỢT ============
 *
 * Crash giữa chừng thì mất nhiều nhất **một** lượt, không phải cả phiên. Ghi khi
 * kết thúc phiên thì crash là mất trắng mọi thứ — và lúc đó thường là lúc bạn vừa
 * làm việc lâu nhất.
 *
 * ============ VÌ SAO `ask`/`out` LÀ THAM SỐ ============
 *
 * Đọc stdin và in console không test được. Truyền vào hàm thì test chạy được không
 * cần terminal — mà đây đúng là chỗ hỏng thì mất hết công việc của người dùng.
 */
import type { CoreMessage, LanguageModelV1, ToolSet } from 'ai';
import { runAgentTurn } from './agent-turn';
import type { SessionStore } from './session';

export type ReplCommand =
  | { kind: 'exit' }
  | { kind: 'new' }
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
  // `/exit ngay` có khoảng trắng → tên lệnh là "exit ngay", không phải lệnh nào.
  if (/\s/.test(ten)) return null;
  return { kind: 'unknown', name: ten };
}

export interface ReplOptions {
  model: LanguageModelV1;
  tools?: ToolSet;
  session: SessionStore;
  /**
   * Câu hỏi đầu tiên do người dùng gõ lúc khởi động (thư qua argv).
   *
   * Lấy kiểu `claude "cau hoi"`: câu đó chạy thành lượt đầu, rồi vẫn ở lại
   * trong REPL để nói tiếp. Nếu không có thì CLI chờ người dùng gõ.
   */
  initial?: string;
  /** Đọc một dòng. `null` = EOF. */
  ask: () => Promise<string | null>;
  /**
   * Bắt đầu lắng nghe yêu cầu dừng trong lúc lượt chạy. Trả về hàm dọn dẹp —
   * **phải** gọi sau mỗi lượt, không thì phím Esc của lượt sau kích hoạt
   * `cancel` của lượt đã xong và cắt nhầm.
   *
   * Tách ra thành tham số vì đây là phần gắn terminal: không test được nếu viết
   * thẳng `process.stdin.on(...)` vào trong vòng lặp.
   */
  watchInterrupt?: (cancel: () => void) => () => void;
  /** In ra màn hình (stdout trong bản thật). */
  out: (text: string) => void;
  /** In ra phần trạng / cảnh báo (stderr trong bản thật). */
  note?: (text: string) => void;
  system?: string;
  maxTokens?: number;
}

export async function runRepl(opts: ReplOptions): Promise<void> {
  const out = opts.out;
  const note = opts.note ?? out;
  // Lịch sử nằm ở đây chứ không nằm trong `session`, để `/new` xoá được mà không
  // đụng tới file trên đĩa.
  let messages: CoreMessage[] = [...opts.session.messages];

  if (messages.length > 0) {
    note(`> tiep tuc cua phien truoc (${messages.length} message). /new de bat dau moi.`);
  }

  /* Câu hỏi khởi động chạy trước vòng lặp thật, nếu không thì CLI bỏ qua nó và
   * vào chế độ chờ — lỗi dễ xảy ra: gõ `npm run cli "doc README"` mà chưa thấy
   * gì xảy ra vì nó đang in dòng "> " chờ. */
  let dauTien = opts.initial?.trim();
  for (;;) {
    const dong = dauTien ?? (await opts.ask());
    dauTien = undefined;
    if (dong === null) return; // EOF
    const lenh = parseCommand(dong);

    if (lenh?.kind === 'exit') return;

    if (lenh?.kind === 'new') {
      // File cũ GIỮ NGUYÊN. Xoá hẳn thì lịch sử cũ mất vĩnh viễn, và người dùng
      // không có cách nào lấy lại — `/new` là "quên đi", không phải "xoá đi".
      messages = [];
      note('> da bat dau phien moi. Lich su cu con nguyen tren dia.');
      continue;
    }

    if (lenh?.kind === 'unknown') {
      note(`> khong co lenh "/${lenh.name}". Giup: /exit, /new`);
      continue;
    }

    const cauHoi = dong.trim();
    if (!cauHoi) continue;

    messages.push({ role: 'user', content: cauHoi });
    opts.session.append({ role: 'user', content: cauHoi });

    /* Dừng lượt: `AbortController` + listener do CLI truyền vào. Lý do tách `signal`
   ra khỏi REPL là để test được: test truyền `watchInterrupt` giả và bấm "cắt"
   đúng lúc, không cần terminal thật. */
    const huy = new AbortController();
    let nghePhim: (() => void) | undefined;
    try {
      if (opts.watchInterrupt) nghePhim = opts.watchInterrupt(() => huy.abort());
      const turn = await runAgentTurn({
        model: opts.model,
        tools: opts.tools,
        messages,
        ...(opts.system ? { system: opts.system } : {}),
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
        signal: huy.signal,
        onToolCall: (name) => note(`[goi tool] ${name}`),
        onToolError: (name, msg) => note(`[tool that bai] ${name}: ${msg}`),
        onText: (delta) => out(delta),
      });
      // Ghi MỘT LẦN cho cả khối: tool-call và tool-result phải vào đĩa cùng nhau.
      // Ghi lệch pha là provider từ chối mọi lượt sau của phiên.
      messages.push(...turn.messages);
      opts.session.appendAll(turn.messages);
      out('\n');
    } catch (e) {
      /* Lượt hỏng KHÔNG được làm sập cả REPL — nếu ném ra ngoài thì chỉ một lần
       * lỗi 429 là mất trắng phiên làm việc, đúng lúc đang làm dở.
       *
       * Và tuyệt đối KHÔNG gì của lượt hỏng được ghi xuống đĩa ở đây: chuỗi
       * message bị hở (assistant đã gọi tool, tool chưa trả kết quả) thì mọi
       * lượt sau của phiên đều bị provider từ chối. Cắt một lượt không được phép
       * để lại hậu quả là chết cả phiên. */
      if (huy.signal.aborted) {
        note('\n> da cat lenh.');
        note('> phan tra loi chua xong khong duoc ghi vao lich su (truong hop khong dung).');
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        note(`\n> LOI: ${msg}`);
        note('> lich su van con. Thu lai.');
      }
    } finally {
      // Dọn listener TRƯỚC khi sang lượt sau. Bỏ sót thì phím Esc của lượt sau
      // sẽ kích hoạt `cancel` của lượt đã xong.
      nghePhim?.();
    }
  }
}