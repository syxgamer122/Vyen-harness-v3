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
import { evaluateUsageTrigger, isContextOverflowError } from '@/lib/context-budget';
import { CLI_DEFAULT_CONTEXT_WINDOW, createCompactionRunner, statusCodeOf } from './compaction';
import { runTurn } from './emulated';
import { runAgentTurn, messagesDaHoanThanh } from './agent-turn';
import type { ToolCallEvent, ToolResultEvent } from './agent-turn';
import type { SessionStore } from './session';
import type { TaoLichSu } from './history';

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

export interface ReplOptions {
  model: LanguageModelV1;
  /**
   * Instance model RIENG cho luot tom tat — dung `fetch: nonStreamingFetch`.
   *
   * KHONG dung chung voi model chat: `nonStreamingFetch` ghi de `stream: false` vo
   * dieu kien, ma ca hai SDK deu gui `stream: true` khi stream ⇒ dung chung se lam
   * MOI luot chat hong. Khong co instance rieng thi nen context biet loi am thanh.
   *
   * Khong co (undefined) ⇒ CLI khong nen duoc, van chat binh thuong.
   */
  modelNen?: LanguageModelV1;
  /** Context window cua model BYOK. Khong biet thi dung mac dinh cua CLI. */
  windowTokens?: number;
  /** Base URL cua provider — khoa cache "model nay che tools". */
  providerBase?: string;
  /** Id model — khoa cache "model nay che tools". */
  modelId?: string;
  /** Ep dung duong gia lap (`VYEN_EMULATED=1`). */
  forceEmulated?: boolean;
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
  /** Lịch sử dòng lệnh — cho phím mũi tên gọi lại câu đã gõ. */
  lichSu?: TaoLichSu;
  /** In ra màn hình (stdout trong bản thật). */
  out: (text: string) => void;
  /**
   * In ra phần trạng / cảnh báo (stderr trong bản thật).
   *
   * ============ VÌ SAO CÓ MỨC ĐỘ ============
   *
   * TUI cần tô đỏ lỗi, vàng cảnh báo, xám thông báo. Nếu không có mức độ thì
   * TUI phải **đoán** từ chuỗi ("LOI" trong text) — đúng kiể "so khớp chuỗi
   * ngầm" mà AGENTS.md §2 cảnh báo. Mức độ là **tuỳ chọn** ⇒ đường plain gọi
   * `note(text)` vẫn in y nguyên từng byte, không đổi gì.
   */
  note?: (text: string, level?: NoteLevel) => void;
  /**
   * Sự kiện tool — TUI vẽ dòng `*` khi đang chạy, `✓` khi xong.
   *
   * Không truyền thì REPL in `[goi tool] ...` như cũ (hành vi plain giữ nguyên).
   */
  onToolCall?: (call: ToolCallEvent) => void;
  /** Tool xong — đóng dòng đang chạy, ghép theo `id`. */
  onToolResult?: (result: ToolResultEvent) => void;
  /** Tool lỗi — TUI tô đỏ dòng đó. */
  onToolError?: (name: string, message: string) => void;
  /** Token đã dùng của lượt — TUI cập nhật header. */
  onUsage?: (usage: { promptTokens: number | null; completionTokens: number | null }) => void;
  system?: string;
  maxTokens?: number;
}

/**
 * Mức độ của một dòng trạng thái.
 *
 * `error` = có việc người dùng phải xử lý (lỗi, từ chối) · `warn` = cần chú ý
 * (nén context, lệnh bị cắt) · `info` = thông báo thường.
 */
export type NoteLevel = 'info' | 'warn' | 'error';

export async function runRepl(opts: ReplOptions): Promise<void> {
  const out = opts.out;
  const note = opts.note ?? out;

  /* Lich su nam trong `session` — KHONG co ban sao o day.
   *
   * Truoc day REPL giu `let messages = [...opts.session.messages]`. Hai mang do lech
   * nhau sau `/new` ⇒ khi nen, marker ghi sai ⇒ mo lai session la MAT hoac LAP lich
   * su. `session.messages` la getter tra dung mang hien hanh ⇒ mot nguon duy nhat.
   */
  const messages = () => opts.session.messages;

  const nen = opts.modelNen
    ? createCompactionRunner({
        session: opts.session,
        model: opts.modelNen,
        system: opts.system ?? '',
        ...(opts.windowTokens !== undefined ? { windowTokens: opts.windowTokens } : {}),
        note,
      })
    : undefined;

  if (messages().length > 0) {
    note(`> tiep tuc cua phien truoc (${messages().length} message). /new de bat dau moi.`);
  }

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
      opts.session.reset();
      /* `/new` = "quên đi" ⇒ bản tóm tắt của phiên cũ cũng phải đi. Giữ lại thì
       * phiên mới vẫn mang theo việc làm của phiên cũ. */
      nen?.reset();
      note('> da bat dau phien moi. Lich su cu con nguyen tren dia.');
      continue;
    }

    if (lenh?.kind === 'compact') {
      if (nen) await nen.nen('manual');
      else note('> khong nen duoc: CLI chua duoc cau hinh model tom tat.');
      continue;
    }

    if (lenh?.kind === 'unknown') {
      note(`> khong co lenh "/${lenh.name}". Giup: /exit, /new, /compact`);
      continue;
    }

    const cauHoi = dong.trim();
    if (!cauHoi) continue;
    // Ghi sau khi đã chắc là lệnh hợp lệ: dòng rỗng và lệnh `/...` không vào
    // lịch sử dòng lệnh (`/exit` thì không có ý nghĩa để `↑` lại).
    if (!parseCommand(dong)) opts.lichSu?.ghi(cauHoi);

    opts.session.append({ role: 'user', content: cauHoi });

    /* Nén TỰ ĐỘNG trước lượt: lịch sử vượt ngưỡng thì nén ngay, thay vì đợi
     * provider từ chối rồi mới cứu. */
    if (nen) await nen.nen('auto');

    /* Môi trường để tra cache "model này chê tools" (10 phút). */
    const envEmulated = {
      ...(opts.providerBase !== undefined ? { providerBase: opts.providerBase } : {}),
      ...(opts.modelId !== undefined ? { modelId: opts.modelId } : {}),
      ...(opts.forceEmulated ? { force: true } : {}),
    };

    /* Vòng trong: cho phép THỬ LẠI đúng một lần khi provider từ chối vì tràn
     * context. Mọi lỗi khác thì báo ra, không thử lại. */
    let daThuLai = false;
    for (;;) {
      const huy = new AbortController();
      let nghePhim: (() => void) | undefined;
      const system = nen ? nen.system() : (opts.system ?? '');
      try {
        if (opts.watchInterrupt) nghePhim = opts.watchInterrupt(() => huy.abort());
        const turn = await runTurn({
          model: opts.model,
          ...(opts.modelNen ? { modelNen: opts.modelNen } : {}),
          ...(opts.tools ? { tools: opts.tools } : {}),
          messages: messages(),
          ...(system ? { system } : {}),
          ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
          signal: huy.signal,
          env: envEmulated,
          onToolCall: (e) => {
            /* Có callback ⇒ TUI tự vẽ dòng tool ⇒ không in `[goi tool]`.
               Không có ⇒ in như cũ, **y nguyên từng byte** (đường plain). */
            if (opts.onToolCall) opts.onToolCall(e);
            else note(`[goi tool] ${e.name}`);
          },
          onToolResult: (e) => opts.onToolResult?.(e),
          onToolError: (name, msg) => {
            if (opts.onToolError) opts.onToolError(name, msg);
            else note(`[tool that bai] ${name}: ${msg}`, 'error');
          },
          onText: (delta) => out(delta),
          onChuyenDuong: (lyDo) => {
            if (lyDo === 'model-che-tools') {
              note('> model nay khong ho tro tool — chuyen sang duong gia lap.', 'warn');
            }
          },
        });
        // Ghi MỘT LẦN cho cả khối: tool-call và tool-result phải vào đĩa cùng nhau.
        // Ghi lệch pha là provider từ chối mọi lượt sau của phiên.
        opts.session.appendAll(turn.messages);
        /* Báo token NGAY sau khi ghi transcript: TUI cập nhật header theo usage
         * của lượt vừa xong, không phải đợi lượt sau. */
        opts.onUsage?.({
          promptTokens: turn.usage.promptTokens ?? null,
          completionTokens: turn.usage.completionTokens ?? null,
        });
        out('\n');
        /* TRÀN NGẦM — provider KHÔNG báo lỗi, nên không có gì để bắt qua
         * `isContextOverflowError`. Chỉ usage mới phản lộ:
         *   - `finishReason="stop"` nhưng `promptTokens > window` ⇒ gateway đã
         *     cắt bớt input mà vẫn trả 200;
         *   - `finishReason="length"` mà `completionTokens = 0` ⇒ input bị cắt
         *     tới mức model không sinh được token nào.
         * Cả hai đều KHÔNG sinh lỗi ⇒ không có đường nào khác để biết. */
        const quyetDinh = evaluateUsageTrigger({
          promptTokens: turn.usage.promptTokens ?? 0,
          completionTokens: turn.usage.completionTokens ?? 0,
          ...(turn.usage.finishReason ? { finishReason: turn.usage.finishReason } : {}),
          windowTokens: opts.windowTokens ?? CLI_DEFAULT_CONTEXT_WINDOW,
        });
        if (quyetDinh.kind !== 'skip') {
          note(`> ${quyetDinh.kind} — dang nen lai...`, 'warn');
          await nen?.nen('tran-ngam');
        }
      } catch (e) {
        /* Phần tool ĐÃ CHẠY XONG trước lúc lượt hỏng thì vẫn phải ghi lại.
         *
         * Không ghi thì `fs_write` đã ghi file mà transcript không có dấu vết ⇒ `/compact`
         * không biết file nào vừa bị sửa, và đường `overflow` thử lại ⇒ model LÀM LẠI
         * đúng các tool call đó ⇒ ghi file hai lần.
         *
         * Chỉ phần ĐẦY ĐỦN mới được ghi (tool-call có tool-result tương ứng) — ghi
         * chuỗi hở làm provider từ chối MỌI lượt sau của phiên. */
        const daHoanThanh = messagesDaHoanThanh(e);
        if (daHoanThanh.length > 0) {
          opts.session.appendAll(daHoanThanh);
          note(`> ${daHoanThanh.length} message da hoan thanh truoc khi luot hong — da ghi lai.`, 'warn');
        }
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
          /* Tràn context: provider TỪ CHỐI, không phải lỗi của ta. Nén lại rồi thử
           * đúng MỘT lần — không có lưới an toàn nào khác. */
          if (!daThuLai && nen && isContextOverflowError(statusCodeOf(e), msg)) {
            daThuLai = true;
            note('> het context, dang nen lai...', 'warn');
            if (await nen.nen('overflow')) continue;
          }
          note(`\n> LOI: ${msg}`, 'error');
          note('> lich su van con. Thu lai.');
        }
      } finally {
        // Dọn listener TRƯỚC khi sang lượt sau. Bỏ sót thì phím Esc của lượt sau
        // sẽ kích hoạt `cancel` của lượt đã xong.
        nghePhim?.();
      }
      opts.lichSu?.dung();
      break;
    }
  }
}
