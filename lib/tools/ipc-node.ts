/**
 * Cầu nối `lib/ipc.cjs` ra khỏi Electron.
 *
 * ============ VÌ SAO FILE NÀY TỒN TẠI ============
 *
 * Spec §5 ghi `lib/tools/fs-node.ts` MỚI — đọc/ghi file qua node:fs. Đo trước
 * khi viết (2026-10-18) cho thấy điều đó **sai**: `lib/ipc.cjs` đã có đủ toàn
 * bộ backend, và đã qua sử dụng thật:
 *
 *   - đọc/ghi/liệt kê/tìm kiếm/xoá/thống kê file, có trần byte
 *   - `path-guard.cjs` — chặn đường dẫn ra ngoài workspace và đường dẫn hệ
 *     thống (C:\, home)
 *   - chống TOCTOU: so sha256 nội dung lúc đọc với lúc ghi
 *   - `shell-policy.cjs`, `bg-jobs.cjs`, `approval-binding.cjs`
 *   - git, skills, memory, secure-store, audit log
 *
 * Viết `fs-node.ts` sẽ là **bản thứ hai** của những thứ đó, và bản mới sẽ
 * không có path-guard cũng không có chống TOCTOU — tức kém an toàn hơn. Đó
 * đúng là cái AGENTS.md §6 gọi là "chắt vá". Nên ở đây chỉ làm LỚP CẦU.
 *
 * ============ CÁCH NÓ HOẠT ĐỘNG ============
 *
 * `ipc.cjs` export `register(ipcMain, opts)`, trong đó `ipcMain` chỉ cần có
 * `handle(channel, fn)`. Electron truyền listener **hai** tham số
 * `(event, payload)`; wrapper `handler()` của ipc.cjs nhận đúng hai tham số
 * đó và chỉ dùng tham số thứ hai. Nên ta truyền một `ipcMain` giả gom handler
 * vào Map rồi gọi trực tiếp — không cần Electron, không cần bridge.
 *
 * JSDoc ngay trên `register` đã ghi kỹ thuật này dành cho test, nên đây là
 * cách dùng có chủ đích, không phải lách.
 */

import ipc from '../ipc.cjs';

export interface NodeHostOptions {
  /** Thư mục gốc dự án. Mọi đường dẫn tool đều tương đối với nó. */
  workspaceRoot: string;
  /** Nơi lưu state (bg-jobs, workspace đã chọn). Không dùng thư mục dự án. */
  userDataDir: string;
  /** Nhận từng dòng audit. Không có thì im lặng — không phải ghi file. */
  audit?: (line: string) => void;
}

type Handler = (event: unknown, payload: unknown) => unknown;

export interface NodeHost {
  /**
   * Gọi một channel của `ipc.cjs`.
   *
   * Tên tham số theo **schema của ipc.cjs** (`relPath`, không phải `path`) —
   * lớp ánh xạ tên sang channel và tên tham số là việc của tầng trên.
   */
  call<T = unknown>(channel: string, payload?: unknown): Promise<T>;
  /** Danh sách channel đã đăng ký. */
  channels(): string[];
  /** Dọn tiến trình nền còn sót. Gọi khi CLI kết thúc. */
  dispose(): void;
}

export function createNodeHost(opts: NodeHostOptions): NodeHost {
  const handlers = new Map<string, Handler>();
  const audit = opts.audit ?? (() => {});

  // Electron gọi listener với `(event, payload)`; `handler()` của ipc.cjs bỏ qua
  // tham số đầu. Truyền `null` cho event là đủ và trung thực — không có event.
  const fakeIpcMain = {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
  };

  ipc.register(fakeIpcMain as never, {
    audit,
    userDataDir: opts.userDataDir,
    workspaceOverride: opts.workspaceRoot,
  } as never);

  return {
    async call<T>(channel: string, payload?: unknown): Promise<T> {
      const fn = handlers.get(channel);
      if (!fn) {
        // Nêu rõ ngay thay vì để call site nhận undefined rồi tự giả định —
        // lỗi kiểu đó lộ ra muộn và khó truy.
        const known = [...handlers.keys()].slice(0, 5).join(', ');
        throw new Error(
          `Khong co channel "${channel}" trong ipc.cjs. Vi du cac channel: ${known} ...`,
        );
      }
      // `handler()` là async, nên trả Promise — gọi thẳng, không await trước.
      return (await fn(null, payload ?? {})) as T;
    },

    channels: () => [...handlers.keys()].sort(),

    dispose: () => {
      ipc.killAllRunning?.();
    },
  };
}

/**
 * Tên tool của model → channel của `ipc.cjs`.
 *
 * Khoá chỉ gồm tool **đã có** channel thật trong `ipc.cjs`. Tool chưa có
 * không được đưa vào đây rồi im lặng — thiếu thì phải nói ra, vì model tưởng
 * có tool rồi gọi xong nhận lỗi khó hiểm thì còn tệ hơn là không có tool.
 *
 * Danh sách này là điểm cần soi lại mỗi khi `ipc.cjs` đổi; test
 * `mọi tool ánh xạ đều có channel thật` sẽ đỏ nếu có entry hỏng.
 */
export const IPC_TOOL_CHANNELS: Record<string, string> = {
  // Nhóm fs_read / fs_write — spec §5 gọi đây là "đọc/ghi file qua node:fs".
  fs_list: 'vyen:fs-list',
  fs_read: 'vyen:fs-read',
  fs_search: 'vyen:fs-search',
  fs_write: 'vyen:fs-write',
  // KHÔNG có `fs_stat` ở đây dù ipc.cjs có channel `vyen:fs-stat`: catalog quy
  // định cái gì model được gọi, và `fs_stat` không nằm trong đó. Đưa vào đây là
  // tự phát minh một tool ngoài catalog — tức một lối thoát khỏi chính sách
  // quyền. Kênh đó vẫn dùng được qua `host.call('vyen:fs-stat', ...)` khi
  // code nội bộ cần.
  // Nhóm shell.
  shell_run: 'vyen:shell-run',
  bg_run: 'vyen:bg-run',
  bg_status: 'vyen:bg-status',
  bg_stop: 'vyen:bg-stop',
  // Nhóm git.
  git_status: 'vyen:git-status',
  git_diff: 'vyen:git-diff',
  git_log: 'vyen:git-log',
  git_add: 'vyen:git-add',
  git_commit: 'vyen:git-commit',
};

/** Bản tra cho một host cụ thể — dùng để test, không cần khi gọi tool. */
export function buildIpcToolMap(host: NodeHost): Record<string, string> {
  // `host` không dùng để tính bảng này, nhưng giữ tham số để call site không
  // phải nhớ là bảng này là hằng — và để tương lai có thể lọc theo channel mà
  // host thực sự đăng ký.
  void host;
  return { ...IPC_TOOL_CHANNELS };
}

/**
 * Dịch tham số theo tên tool của model sang tên `ipc.cjs` dùng.
 *
 * Khác biệt duy nhất quan sát được: `path` → `relPath`. Mọi tên khác giữ
 * nguyên. Dịch sai thì lỗi hiện ra ở tầng schema của `ipc.cjs` với câu
 * `expected string, received undefined` — không ai đoán ra nguyên nhân là
 * sai tên tham số.
 */
export function toIpcPayload(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k === 'path' ? 'relPath' : k] = v;
  }
  // `fs_search` của ipc.cjs dùng `isRegex` (camelCase), model gửi `is_regex`.
  if (toolName === 'fs_search' && 'is_regex' in out) {
    out.isRegex = out.is_regex;
    delete out.is_regex;
  }
  return out;
}
