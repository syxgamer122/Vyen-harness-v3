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
