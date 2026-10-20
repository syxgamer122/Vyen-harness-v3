/**
 * Store của TUI — cầu nối giữa vòng lặp hội thoại (CJS, callback) và màn hình
 * (React, state).
 *
 * ============ VÌ SAO MỘT STORE, KHÔNG LÀM TRỰC TIẾP ============
 *
 * `runRepl` nói chuyện bằng callback (`ask`/`out`/`note`/`onToolCall`…), còn màn
 * hình nói chuyện bằng **state**. Store là chỗ dịch hai kiểu giao tiếp đó, và là
 * chỗ duy nhất biết "khối nào đang chạy, khối nào xong, hộp duyệt đang chờ".
 *
 * ============ STATE BẤT BIẾN ============
 *
 * Mỗi lần thay đổi sinh **object state mới**. React so sánh tham chiếu để biết
 * có cần vẽ lại không — trả về cùng object thì màn hình đứng yên trong khi
 * transcript đã dài thêm.
 */
import type { CoreMessage } from 'ai';
import { ketQuaLoi, messagesToBlocks, nhanTool, tomTatDoiSo, type Block } from './blocks.ts';
import { parseCommand } from '../commands.ts';
import type { ApprovalBroker, ApprovalRequest } from '../approval-broker.ts';
import type { NoteLevel } from '../repl.ts';
import type { ToolCallEvent, ToolResultEvent } from '../agent-turn.ts';

export interface TuiState {
  blocks: Block[];
  /** Có lượt đang chạy không. */
  running: boolean;
  /** Lời hỏi duyệt đang chờ. */
  approval: ApprovalRequest | undefined;
  /** Token đã dùng của lượt gần nhất. */
  tokens: number | null;
}

/** Đúng hình dạng `renderer.keyInput` của OpenTUI (chỉ phần ta dùng). */
export interface KeyInputLike {
  on(event: 'keypress', cb: (k: { name?: string }) => void): unknown;
  off(event: 'keypress', cb: (k: { name?: string }) => void): unknown;
}

/**
 * Kết quả tool có phải LỖI không? — xem `ketQuaLoi` trong `blocks.ts` (một
 * nguồn cho cả đường đang chạy lẫn đường nạp lại lịch sử).
 */

export interface TuiStoreOptions {
  /** Lịch sử nạp lại từ đĩa — dựng thành block ngay từ đầu. */
  messages: CoreMessage[];
  approval: ApprovalBroker;
  /** Ghi chú lúc khởi động (công cụ, cảnh báo, model…). */
  startupNotes: string[];
  keyInput: KeyInputLike;
}

export interface TuiStore {
  snapshot(): TuiState;
  subscribe(cb: () => void): () => void;
  /** Chờ người dùng gõ. `null` = đóng. */
  ask(): Promise<string | null>;
  /** Người dùng đã gõ xong một dòng. */
  submit(line: string): void;
  /** Chữ của model tới. */
  out(text: string): void;
  /** Dòng trạng thái. */
  note(text: string, level?: NoteLevel): void;
  onToolCall(call: ToolCallEvent): void;
  onToolResult(result: ToolResultEvent): void;
  onToolError(name: string, message: string): void;
  onUsage(usage: { promptTokens: number | null }): void;
  /** Bật lắng nghe phím dừng lượt. Trả về hàm dọn. */
  watchInterrupt(cancel: () => void): () => void;
  /** Đóng: lời hỏi đang chờ được trả lời `null` (không treo). */
  close(): void;
}

export function createTuiStore(opts: TuiStoreOptions): TuiStore {
  const listeners = new Set<() => void>();

  let state: TuiState = {
    blocks: [
      ...opts.startupNotes.map((text): Block => ({ kind: 'note', level: 'info', text })),
      ...messagesToBlocks(opts.messages),
    ],
    running: false,
    approval: undefined,
    tokens: null,
  };

  const capNhat = (partial: Partial<TuiState>): void => {
    state = { ...state, ...partial };
    for (const cb of [...listeners]) cb();
  };

  /* Lời hỏi đang chờ — chỉ có một lúc (REPL hỏi tuần tự). */
  let choHoi: ((dong: string | null) => void) | null = null;

  /* Đánh dấu "Esc vừa được dùng để trả lời hộp duyệt" — để đường cắt lượt biết
   * mà đừng cắt. Xem `xuLyPhimDuyet` bên dưới. */
  let vuaTraLoiDuyet = false;

  /* ============ PHÍM: MỘT NGƯỜI NGHE DUY NHẤT ============
   *
   * Cả "trả lời hộp duyệt" và "cắt lượt" đều nghe phím Esc, và cả hai đều trên
   * **cùng một** emitter. Nếu để hai listener riêng thì chúng chạy theo thứ tự
   * đăng ký: listener thứ nhất gỡ lời hỏi khỏi hàng đợi ⇒ listener thứ hai thấy
   * "không còn lời hỏi" ⇒ **cắt lượt**. Đo 2026-10-21 (review độc lập): Esc
   * trong hộp duyệt vừa từ chối tool vừa cắt lượt ⇒ mất câu trả lời của model
   * và transcript ghi dở.
   *
   * Nên: **một** listener, do store đăng ký lúc khởi tạo (trước cả lúc React
   * mount), xử lý cả hai việc. */
  const xuLyPhimDuyet = (k: { name?: string }): void => {
    const ten = k.name;
    if (
      ten !== 'y' &&
      ten !== 'c' &&
      ten !== 'n' &&
      ten !== 'return' &&
      ten !== 'enter' &&
      ten !== 'escape'
    ) {
      return;
    }
    const a = opts.approval.pending();
    if (!a) return;
    if (ten === 'escape') vuaTraLoiDuyet = true;
    opts.approval.traLoi(a.id, ten === 'y' || ten === 'c');
  };
  opts.keyInput.on('keypress', xuLyPhimDuyet);

  /* Hộp duyệt: theo dõi broker, không tự hỏi. */
  const boTheoDoi = opts.approval.onPending((req) => {
    capNhat({ approval: req });
  });

  const themBlock = (block: Block): void => {
    capNhat({ blocks: [...state.blocks, block] });
  };

  const store: TuiStore = {
    snapshot: () => state,

    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    ask(): Promise<string | null> {
      /* Lượt vừa xong ⇒ không còn "đang chạy". */
      capNhat({ running: false });
      return new Promise<string | null>((resolve) => {
        choHoi = resolve;
      });
    },

    submit(line: string): void {
      const traLoi = choHoi;
      choHoi = null;
      /* Cau nguoi dung phai co tren man hinh NGAY - lich su nap lai co no (no
       * nam trong CoreMessage[]), neu luc dang chat ma khong co thi mo lai
       * phien thay man hinh khac han. Do 2026-10-21 (review doc lap). */
      if (line) {
        capNhat({ blocks: [...state.blocks, { kind: 'user', text: line }] });
      }
      capNhat({ running: true });
      /* `/new` ⇒ phiên mới ⇒ transcript cũ không còn ý nghĩa ⇒ xoá màn hình.
         * Lệnh VẪN được đưa cho REPL (nó còn phải xoá lịch sử trên đĩa). */
      if (parseCommand(line)?.kind === 'new') {
        capNhat({ blocks: [] });
      }
      traLoi?.(line);
    },

    out(text: string): void {
      if (!text.trim()) return;
      const cuoi = state.blocks[state.blocks.length - 1];
      if (cuoi && cuoi.kind === 'assistant') {
        const blocks = [...state.blocks];
        blocks[blocks.length - 1] = { kind: 'assistant', text: cuoi.text + text };
        capNhat({ blocks });
        return;
      }
      themBlock({ kind: 'assistant', text });
    },

    note(text: string, level: NoteLevel = 'info'): void {
      themBlock({ kind: 'note', level, text });
    },

    onToolCall(call: ToolCallEvent): void {
      themBlock({
        kind: 'tool',
        id: call.id,
        name: call.name,
        /* Nhãn + chi tiết dựng **bằng đúng hàm** của lịch sử
         * (`nhanTool`/`tomTatDoiSo`) — để dòng tool lúc chạy và dòng tool lúc
         * nạp lại trông giống nhau. */
        label: nhanTool(call.name),
        detail: tomTatDoiSo(call.name, call.args),
        status: 'running',
      });
    },

    onToolResult(result: ToolResultEvent): void {
      /* Kết quả lỗi vẫn đi qua `tool-result` (wrapper đổi lỗi thành
       * `{ok:false,error}` để model đọc được lý do) ⇒ nếu cứ đánh 'ok' thì
       * dòng tool lỗi sẽ hiện dấu TICK. Bắt được nhờ test kịch bản
       * end-to-end: từ chối duyệt ⇒ dòng hiện ✓ trong khi thực tế tool đã
       * hỏng. */
      const loi = ketQuaLoi(result.result);
      const blocks = state.blocks.map((b) =>
        b.kind === 'tool' && b.id === result.id ? { ...b, status: loi ? ('error' as const) : ('ok' as const) } : b,
      );
      capNhat({ blocks });
    },

    onToolError(name: string, message: string): void {
      /* Không có id trong sự kiện lỗi ⇒ đánh dấu khối `running` gần nhất cùng
       * tên (đúng như lời gọi đó vừa hỏng); nếu không có (lỗi tới sau khi
       * kết quả đã về) thì lấy khối cùng tên gần nhất. */
      let viTri = -1;
      for (let i = state.blocks.length - 1; i >= 0; i--) {
        const b = state.blocks[i];
        if (b.kind === 'tool' && b.name === name && b.status === 'running') {
          viTri = i;
          break;
        }
      }
      if (viTri < 0) {
        for (let i = state.blocks.length - 1; i >= 0; i--) {
          const b = state.blocks[i];
          if (b.kind === 'tool' && b.name === name) {
            viTri = i;
            break;
          }
        }
      }
      const blocks = [...state.blocks];
      if (viTri >= 0) {
        const b = blocks[viTri];
        if (b.kind === 'tool') blocks[viTri] = { ...b, status: 'error' };
      }
      capNhat({ blocks });
      themBlock({ kind: 'note', level: 'error', text: `[tool that bai] ${name}: ${message}` });
    },

    onUsage(usage: { promptTokens: number | null }): void {
      capNhat({ tokens: usage.promptTokens });
    },

    watchInterrupt(cancel: () => void): () => void {
      const h = (k: { name?: string }): void => {
        if (k.name !== 'escape') return;
        /* Esc vừa trả lời hộp duyệt (xem `xuLyPhimDuyet`) ⇒ KHÔNG cắt lượt.
         * Cắt lượt lúc đó là mất câu trả lời của model và làm transcript ghi
         * dở — đúng lỗi review độc lập 2026-10-21 chỉ ra. */
        if (vuaTraLoiDuyet) {
          vuaTraLoiDuyet = false;
          return;
        }
        /* Đang có hộp duyệt thì Esc thuộc về hộp duyệt (trả lời "không"),
         * KHÔNG phải cắt lượt — cắt lượt lúc đang chờ duyệt là mất việc. */
        if (opts.approval.pending()) return;
        cancel();
      };
      opts.keyInput.on('keypress', h);
      return () => {
        opts.keyInput.off('keypress', h);
      };
    },

    close(): void {
      const traLoi = choHoi;
      choHoi = null;
      boTheoDoi();
      opts.keyInput.off('keypress', xuLyPhimDuyet);
      traLoi?.(null);
    },
  };

  return store;
}
