/**
 * Vòng đời terminal: đọc dòng lệnh, nghe phím, bắt `Esc` khi lượt đang chạy.
 *
 * ============ VÌ SAO TÁCH RA KHỎI `cli/index.ts` ============
 *
 * Ba lời hứa trong `cli/index.ts` **không có test nào canh** (review độc lập
 * 2026-10-19, bảng "Claims without coverage"):
 *
 *   1. `stdin.pause()` không được bao giờ gọi — gọi là treo cả REPL.
 *   2. `watchInterrupt` phải gỡ listener và trả lại raw mode.
 *   3. Listener `keypress` phải được gỡ sau mỗi lần chờ.
 *
 * Không tách thì không test được: `cli/index.ts` đọc `process.stdin` trực tiếp,
 * mà stdin thật thì không có trong test. Ở đây **stdin và readline đều là tham số**
 * ⇒ test dựng được đồ vật giả và kiểm từng lời hứa.
 *
 * ============ VÌ SAO `stdin.pause()` NGUY HIỂM ============
 *
 * `readline` chỉ gọi `input.resume()` lại trong `Interface.resume()`, mà hàm đó
 * thoát sớm nếu cờ `rl.paused` chưa bật — cờ đó CHỈ `Interface.pause()` mới bật.
 * Gọi `stdin.pause()` (dừng stream) không bật cờ ⇒ lượt sau `rl.question()` không
 * bao giờ khởi động lại stdin ⇒ prompt hiện rồi nuốt mọi phím.
 *
 * Đo 2026-10-19: `echo | npm run cli` **không** bắt được, vì dữ liệu đã nằm sẵn
 * trong bộ đệm. Chỉ terminal thật mới lộ — nên ở đây ta **không** đụng trạng thái
 * chảy của stdin: `readline` là bên sở hữu nó.
 */
// `createInterface` phải lấy từ bản **promises** — bản ở `node:readline` là
// callback, mà `question()` của nó trả `void`. `await rl.question('> ')` với kiểu
// đó hợp kiểu nhưng là `await undefined`: câu trả lời luôn rỗng, và TypeScript
// không báo gì. (Đã dính lỗi này một lần ở `cli/index.ts`.)
import { createInterface } from 'node:readline/promises';
import type { Interface } from 'node:readline/promises';
import { emitKeypressEvents, type Key } from 'node:readline';
import type { TaoLichSu } from './history';

/** Phần stdin mà module này dùng. */
export interface TerminalInput {
  on(event: 'keypress' | 'data', fn: (...a: never[]) => void): unknown;
  off(event: 'keypress' | 'data', fn: (...a: never[]) => void): unknown;
  setRawMode?(mode: boolean): unknown;
  isRaw?: boolean;
}

export interface TerminalOptions {
  stdin: TerminalInput;
  /** Nơi `readline` vẽ. Mặc định `process.stderr`. */
  output?: { write(s: string): unknown };
  /** Chỉ dùng cho test: thay thế `readline` bằng đồ vật giả. */
  taoInterface?: (stdin: TerminalInput, output: unknown) => Interface;
}

export interface Terminal {
  /**
   * Hỏi một câu bất kỳ (dùng cho cổng duyệt tool). `null` = EOF.
   *
   * Cùng cơ chế với `hoiDong` nhưng không có phím mũi tên — cổng duyệt hỏi
   * "y/N", mũi tên ở đó chỉ gây rối.
   */
  hoi(cauHoi: string): Promise<string | null>;
  /** Đợi một dòng lệnh. `null` = EOF. */
  hoiDong(lichSu: TaoLichSu): Promise<string | null>;
  /**
   * Bắt đầu lắng nghe yêu cầu dừng trong lúc lượt chạy. Trả về hàm dọn dẹp.
   */
  watchInterrupt(cancel: () => void): () => void;
  /** Đóng readline. */
  close(): void;
}

export function createTerminal(opts: TerminalOptions): Terminal {
  const { stdin } = opts;
  const output = opts.output ?? process.stderr;
  const taoInterface =
    opts.taoInterface ?? ((inp, out) => createInterface({ input: inp as never, output: out as never }));

  /* ============ READLINE TẠO LÚC HỎI, KHÔNG TẠO SỚM ============
   *
   * Đo 2026-10-20 (chạy CLI thật): `echo y | npm run cli -p "..."` ⇒ cổng duyệt
   * KHÔNG hỏi được và từ chối trong im lặng, dù "y" đã nằm sẵn trong pipe.
   *
   * Nguyên nhân đo được (probe trên `node:readline/promises`): interface tạo
   * **sớm** thì nó đọc và nuốt dòng "y" ngay khi dữ liệu tới — TRƯỚC khi có
   * câu hỏi nào ⇒ `question()` không còn gì để trả về (null). Tạo interface
   * **lúc hỏi** thì dòng đó vẫn nằm trong bộ đệm và được trả về đúng ("y").
   *
   * Nên: interface chỉ được tạo ở lần hỏi ĐẦU TIÊN, rồi dùng chung cho mọi
   * lần hỏi sau (giữ nguyên hành vi "readline giữ stdin mở" của bản cũ).
   */
  let rl: Interface | null = null;
  const layInterface = (): Interface => (rl ??= taoInterface(stdin, output));

  /**
   * Đang chờ người dùng trả lời câu hỏi duyệt.
   *
   * Cần để `Esc` trong lúc đó **không** bị hiểu là yêu cầu dừng lượt: người dùng
   * đang trả lời câu hỏi, Esc ở đây là "tôi không biết" chứ không phải "dừng lại".
   */
  let dangHoi = false;

  /**
   * Hỏi một câu bất kỳ. Dùng cho cổng duyệt tool.
   *
   * `rl.question` NÉM "readline was closed" khi hết dòng — đo thật 2026-10-19.
   * Không bắt thì `Ctrl+D` in một dòng lỗi rác thay vì thoát sạch.
   */
  async function hoi(cauHoi: string): Promise<string | null> {
    /* stdin ĐÃ KẾT THÚC (EOF) ⇒ không còn câu trả lời nào nữa.
     *
     * Đo 2026-10-20 (chạy CLI thật): `("y" | npm run cli -p "...")` ⇒ **npm** đọc
     * hết stdin rồi đóng ⇒ tới lúc cổng duyệt hỏi thì `stdin.readableEnded` đã
     * là `true`. Nếu cứ hỏi, `rl.question()` không bao giờ resolve ⇒ event loop
     * rỗng ⇒ **tiến trình thoát im lặng (code 0) giữa lượt** — báo thành công
     * cho một lượt chưa xong.
     *
     * ⇒ Trả null NGAY (không hỏi) để cổng duyệt từ chối CÓ LÝ DO.
     */
    const s = stdin as unknown as { readableEnded?: boolean; destroyed?: boolean };
    if (s.readableEnded === true || s.destroyed === true) {
      return null;
    }
    /* Cổng duyệt hỏi GIỮA lúc lượt đang chạy ⇒ `watchInterrupt` đã bật raw mode.
     * Tắt ra để người dùng gõ dòng bình thường (Enter = `\n`, có echo), rồi bật lại
     * sau khi hỏi xong — lượt vẫn đang chạy nên phải giữ raw cho phím Esc. */
    const truoc = stdin.isRaw;
    if (truoc) stdin.setRawMode?.(false);
    dangHoi = true;
    try {
      return (await layInterface().question(cauHoi)) ?? null;
    } catch {
      return null;
    } finally {
      dangHoi = false;
      if (truoc) stdin.setRawMode?.(true);
    }
  }

  /**
   * Đợi một dòng lệnh, có phím mũi tên gọi lại lịch sử.
   *
   * `readline` nuốt phím mũi tên để di chuyển con trỏ, nên ta dùng
   * `emitKeypressEvents` để nghe chúng theo **tên phím** (`up`/`down`) thay vì đoán
   * từ byte `0x1b[A`. Thay dòng thì dùng `ctrl+u` (xoá tới đầu dòng) rồi `write`
   * nội dung mới — đó là cách `readline` dành cho việc này, không phải tự vẽ ANSI.
   */
  async function hoiDong(lichSu: TaoLichSu): Promise<string | null> {
    emitKeypressEvents(stdin as never);
    const gocInterface = layInterface();
    const datLai = (noiDung: string) => {
      gocInterface.write(null, { ctrl: true, name: 'u' });
      if (noiDung) gocInterface.write(noiDung);
    };
    const onPhim = (_str: string | undefined, key: Key | undefined) => {
      if (!key) return;
      if (key.name === 'up') {
        const v = lichSu.lai();
        if (v !== undefined) datLai(v);
      } else if (key.name === 'down') {
        datLai(lichSu.di());
      }
    };
    stdin.on('keypress', onPhim as never);
    try {
      const traVe = await gocInterface.question('> ');
      return traVe ?? null;
    } catch {
      /* `rl.question` NÉM "readline was closed" khi hết dòng — đo thật 2026-10-19.
       * Không bắt thì `Ctrl+D` in một dòng lỗi rác thay vì thoát sạch. */
      return null;
    } finally {
      // Gỡ listener sau MỖI lần chờ. Giữ lại thì phím gõ lúc lượt sau đẩy vào
      // bộ đệm của lượt này.
      stdin.off('keypress', onPhim as never);
    }
  }

  /**
   * Bắt `Esc` trong lúc lượt chạy.
   *
   * ============ VÌ SAO `raw` MÀ KHÔNG `readline` ============
   *
   * Giữa hai lượt thì `readline` đang chờ trong `rl.question()`. Gắn thêm handler
   * vào cùng readline thì **không** bắt được phím: readline đã nuốt phím và chờ
   * một dòng hoàn chỉnh. Nên lúc lượt chạy, readline rảnh — bấm `Esc` lúc đó ra
   * `0x1b` thô trên stdin. Đó là lý do dùng `raw`.
   *
   * ============ VÌ SAO KHÔNG `resume()`/`pause()` stdin ============
   *
   * `resume()` thừa — gắn listener `'data'` đã tự khôi phục chế độ chảy.
   * `pause()` **phá** — xem ghi chú đầu file: nó treo cả REPL từ lượt thứ hai.
   */
  function watchInterrupt(cancel: () => void): () => void {
    const truoc = stdin.isRaw;
    stdin.setRawMode?.(true);
    const onData = (b: Buffer) => {
      /* Đang hỏi duyệt thì Esc là CÂU TRẢ LỜI, không phải yêu cầu dừng lượt. */
      if (dangHoi) return;
      // `0x1b` = Esc. Có `0x1b 0x5b` là chuỗi phím mũi tên — nuốt luôn để người
      // dùng bấm mũi tên giữa lúc chờ không bị cắt nhầm lượt.
      if (b[0] === 0x1b && b[1] === 0x5b) return;
      if (b[0] === 0x1b) cancel();
    };
    stdin.on('data', onData as never);
    return () => {
      stdin.off('data', onData as never);
      stdin.setRawMode?.(truoc ?? false);
      /* KHÔNG `stdin.pause()` — xem ghi chú đầu file. Gọi là treo REPL. */
    };
  }

  return {
    hoi,
    hoiDong,
    watchInterrupt,
    /* Chưa hỏi gì thì chưa có interface ⇒ không có gì để đóng. */
    close: () => rl?.close(),
  };
}
