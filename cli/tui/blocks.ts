/**
 * Block transcript: hình dạng để vẽ, dùng chung cho lịch sử nạp lại và cho
 * dòng chảy lúc chạy.
 *
 * ============ VÌ SAO CÓ "BLOCK" ============
 *
 * Transcript trên đĩa là `CoreMessage[]` — hình dạng của AI SDK, không phải hình
 * dạng để vẽ. TUI cần một hình dạng **phẳng**: mỗi dòng màn hình là một block
 * có loại (`user` / `assistant` / `tool` / `note`) và đã có sẵn nhãn + chi tiết.
 *
 * Nếu lịch sử và stream dùng hai hình dạng khác nhau thì mở lại phiên là thấy
 * màn hình khác hẳn lúc đang chat ⇒ người dùng tưởng mất dữ liệu. Vì vậy cả
 * hai đường đều đi qua đây.
 */
import type { CoreMessage } from 'ai';
import { summarizeToolArgs } from '@/lib/agent-tools';
import { redactSecretText } from '@/lib/secret-registry';
import type { NoteLevel } from '../repl.ts';

export type ToolStatus = 'running' | 'ok' | 'error';

export type Block =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | {
      kind: 'tool';
      /** `toolCallId` — khoá ghép call↔result. */
      id: string;
      name: string;
      /** Tên rút gọn để đọc (`read`, `shell`…). */
      label: string;
      /** Tham số rút gọn, một dòng, đã che bí mật. */
      detail: string;
      status: ToolStatus;
    }
  | { kind: 'note'; level: NoteLevel; text: string };

/** Tên rút gọn cho tool — ngắn để dòng gọn, dễ đọc lướt. */
const NHAN_TOOL: Record<string, string> = {
  fs_read: 'read',
  fs_write: 'write',
  fs_edit: 'edit',
  shell_run: 'shell',
  bg_run: 'bg',
  git_diff: 'git diff',
  git_status: 'git status',
  git_log: 'git log',
};

/** Dài tối đa của phần chi tiết — dòng phải vừa màn hình, không xuống dòng. */
const DO_DAI_CHI_TIET = 60;

export function nhanTool(name: string): string {
  return NHAN_TOOL[name] ?? name;
}

/**
 * Tóm tắt tham số tool thành **một dòng**, tối đa 60 ký tự, đã che bí mật.
 *
 * ============ VÌ SAO PHẢI CHE ============
 *
 * Tool line là bề mặt **mới** để lộ bí mật: `shell_run` mang bearer token,
 * `fs_read` mang đường dẫn tới file khoá. `cli/session.ts` đã che khi ghi đĩa,
 * `describeToolCall` đã che khi hỏi duyệt — TUI không được là lỗ hổng thứ ba.
 *
 * ============ VÌ SAO DÙNG LẠI `summarizeToolArgs` ============
 *
 * Nó đã có sẵn ở `lib/agent-tools.ts` và dùng cho annotation của đường giả lập.
 * Viết bản thứ hai là chắt vá (AGENTS.md §6) và hai bản sẽ lệch nhau.
 */
export function tomTatDoiSo(name: string, args: unknown): string {
  /* Đường giả lập truyền **chuỗi tóm tắt** sẵn; đường native truyền object. */
  const s = typeof args === 'string' ? args : summarizeToolArgs(name, args);
  const dong = redactSecretText(String(s ?? '')).replace(/\s+/g, ' ').trim();
  return dong.length > DO_DAI_CHI_TIET ? `${dong.slice(0, DO_DAI_CHI_TIET - 1)}…` : dong;
}

/* Part của AI SDK — khai báo lỏng, ép ở một chỗ duy nhất.
 *
 * Mọi trường đều **tuỳ chọn** vì `CoreMessage` có nhiều thể content; phần nào
 * không đúng loại thì bị bỏ qua bằng điều kiện, không bằng ép kiểu. */
type Part = {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
};

function partsOf(content: unknown): Part[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content as Part[];
}

/**
 * Kết quả tool có phải LỖI không?
 *
 * Wrapper của CLI đổi lỗi thành `{ok:false,error}` để **model** đọc được lý do
 * ⇒ lỗi vẫn đi qua part `tool-result` như thành công. Không kiểm `ok` thì dòng
 * tool lỗi sẽ hiện dấu tick — người dùng tưởng đã ghi được file.
 *
 * Dùng **chung** cho cả hai đường (lúc đang chạy và lúc nạp lại lịch sử), nếu
 * không thì một đường hiện ✗ còn đường kia hiện ✓ — cùng một sự việc mà hai
 * màn hình khác nhau. Đo 2026-10-21 (review độc lập).
 */
export function ketQuaLoi(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { ok?: unknown }).ok === false
  );
}

/**
 * Dựng block từ lịch sử.
 *
 * ============ GHÉP THEO ID, KHÔNG THEO THỨ TỰ ============
 *
 * `tool-result` về theo lúc **từng lệnh xong** ⇒ hai tool cùng tên có thể về
 * ngược thứ tự. Ghép theo tên là sai (hai lần gọi cùng tên là hai thứ khác
 * nhau) ⇒ ghép theo `toolCallId`.
 */
export function messagesToBlocks(messages: CoreMessage[]): Block[] {
  const blocks: Block[] = [];
  /** `toolCallId` → vị trí block tool trong `blocks`. */
  const viTriTool = new Map<string, number>();
  let chuongDong = '';

  const dongChuong = (): void => {
    if (chuongDong) {
      blocks.push({ kind: 'assistant', text: chuongDong });
      chuongDong = '';
    }
  };

  for (const m of messages) {
    if (m.role === 'user') {
      dongChuong();
      const text = partsOf(m.content)
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text ?? '')
        .join('');
      if (text) blocks.push({ kind: 'user', text });
      continue;
    }

    if (m.role === 'assistant') {
      for (const p of partsOf(m.content)) {
        if (p.type === 'text') {
          chuongDong += p.text ?? '';
          continue;
        }
        if (p.type === 'tool-call' && p.toolCallId && p.toolName) {
          /* Tool nằm GIỮA các đoạn chữ ⇒ chữ trước phải xong trước. */
          dongChuong();
          blocks.push({
            kind: 'tool',
            id: p.toolCallId,
            name: p.toolName,
            label: nhanTool(p.toolName),
            detail: tomTatDoiSo(p.toolName, p.args),
            status: 'running',
          });
          viTriTool.set(p.toolCallId, blocks.length - 1);
        }
      }
      continue;
    }

    if (m.role === 'tool') {
      dongChuong();
      for (const p of partsOf(m.content)) {
        if (p.type !== 'tool-result' || !p.toolCallId) continue;
        const viTri = viTriTool.get(p.toolCallId);
        /* Kết quả mồ côi (không có lời gọi tương ứng) ⇒ bỏ qua, không đoán. */
        if (viTri === undefined) continue;
        const blk = blocks[viTri];
        if (blk.kind === 'tool') {
          blk.status = ketQuaLoi(p.result) ? 'error' : 'ok';
        }
      }
    }
  }
  dongChuong();
  return blocks;
}
