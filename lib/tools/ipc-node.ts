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

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ipc from '../ipc.cjs';
import { parseEditBlocks, replaceMostSimilarChunk } from '../edit-blocks';
import { CLIENT_TOOL_DEFS } from '../agent-tools';

/**
 * `approval-binding.cjs` phải nạp bằng `require` neo tại chính `ipc.cjs`, KHÔNG
 * dùng `import`.
 *
 * Lý do (đo thật 2026-10-18): module giữ token trong Map cấp module
 * (`issuedTokens`). `ipc.cjs` nạp nó bằng `require('./approval-binding.cjs')`
 * của Node, còn `import` đi qua tầng chuyển đổi của bundler/test runner — mỗi
 * bên **một instance riêng**, tức **hai Map tách rời**. Đo thật:
 *
 *   - token mint bằng `import` → `consume` bằng `require`: `approval_unknown`
 *   - token mint bằng `require` → `consume` bằng `require`: `ok`
 *
 * Nên mọi `shell_run` đều chết với `approval_required` dù đã duyệt — lỗi rất
 * khó đoán vì cổng duyệt báo "đã duyệt" trong khi lệnh vẫn không chạy.
 */
const requireFromIpc = createRequire(new URL('../ipc.cjs', import.meta.url));
const approvalBinding = requireFromIpc('./approval-binding.cjs') as {
  createApprovalToken: (b: unknown) => { fingerprint: string } | null;
};

export interface NodeHostOptions {
  /** Thư mục gốc dự án. Mọi đường dẫn tool đều tương đối với nó. */
  workspaceRoot: string;
  /** Nơi lưu state (bg-jobs, workspace đã chọn). Không dùng thư mục dự án. */
  userDataDir: string;
  /**
   * Nhận từng dòng audit. **Mặc định ghi ra đĩa** trong `userDataDir` — không
   * ghi thì CLI có quyền ghi file và chạy lệnh mà không để lại dấu vết gì, tức
   * không truy được là ai đã làm gì. Desktop có sẵn đường audit; CLI không có UI
   * nên phải tự ghi.
   *
   * Truyền hàm riêng thì ghi đè hành vi này (ví dụ test muốn giữ trong RAM).
   */
  audit?: (line: string) => void;
  /**
   * Cho phép gọi thẳng một channel NGUY HIỂM, bỏ qua cổng duyệt của tầng tool.
   *
   * Chỉ dành cho code nội bộ thật sự cần (ví dụ đọc hash file để dựng diff).
   * Mặc định **không có** — tức mọi đường gọi thẳng vào channel nguy hiểm đều bị
   * chặn. Xem `DANGEROUS_CHANNELS`.
   */
  allowChannel?: (channel: string, payload: unknown) => boolean;
}

/**
 * Channel thay đổi trạng thái máy hoặc chạy lệnh — mặc định bị chặn khi gọi
 * thẳng `host.call`.
 *
 * Chọn theo **channel của `ipc.cjs`**, không suy từ nhóm quyền: đây là lớp phòng
 * thủ thứ hai bên dưới `NEEDS_APPROVAL`, và nó phải độc lập với bảng kia —
 * nếu lấy từ cùng một nguồn thì hỏng một chỗ là hỏng cả hai.
 */
const DANGEROUS_CHANNELS: ReadonlySet<string> = new Set([
  'vyen:fs-write',
  'vyen:fs-append',
  'vyen:fs-delete',
  'vyen:shell-run',
  'vyen:bg-run',
  'vyen:bg-stop',
  'vyen:git-add',
  'vyen:git-commit',
  'vyen:secure-set',
  'vyen:secure-delete',
  'vyen:home-memory-write',
]);

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

/**
 * Nơi lưu nhật ký audit của một host.
 *
 * Tách ra thành hàm để **test và code cùng chỉ một đường dẫn** — nếu test tự
 * chế đường dẫn khác thì test xanh mà sản phẩm ghi chỗ khác, tức test bảo vệ
 * nhầm chỗ.
 */
export function hostAuditLogPath(userDataDir: string): string {
  return path.join(userDataDir, 'vyen-audit.log');
}

export function createNodeHost(opts: NodeHostOptions): NodeHost {
  /* ---- C1 + C2: kiểm workspaceRoot TRƯỚC khi đưa vào `workspaceOverride` ----
   *
   * `register()` chỉ chạy `workspaceBlockReason` ở channel `vyen:workspace-set`,
   * KHÔNG chạy ở `workspaceOverride` — mà đây đúng là đường ta dùng. Bỏ qua thì:
   *
   *   - C1: root là gốc ổ đĩa (`C:\`) hoặc home thì MỌI thứ đều "nằm trong
   *     workspace", tức path-guard vô hiệm. Blocklist sinh ra đúng để chặn
   *     trường hợp này mà bản web gọi qua `workspace-set` nên không lộ.
   *   - C2: root sai chính tả thì `register()` âm thầm lùi về workspace của phiên
   *     trước (`userDataDir/vyen-workspace.json`), không một dòng cảnh báo.
   *     Với CLI có quyền ghi file, "ghi nhầm cây" tệ hơn "báo lỗi".
   *
   * Dùng lại đúng hàm blocklist của `ipc.cjs` chứ không viết lại — viết lại là
   * tạo nguồn sự thật thứ hai (AGENTS.md §6). */
  const root = path.resolve(opts.workspaceRoot);
  if (!fs.existsSync(root)) {
    throw new Error(
      `workspaceRoot khong ton tai: ${root}. ` +
        'Tra ve thu muc sai thi moi thay doi file o cay khac — dung bo qua loi nay.',
    );
  }
  const blocked = ipc.workspaceBlockReason(root, opts.userDataDir);
  if (blocked) {
    throw new Error(
      `workspaceRoot khong hop le (${blocked}): ${root}. ` +
        'Root qua rong se vo hieu hoa path-guard — moi thu tren may deu coi la "trong workspace".',
    );
  }

  const handlers = new Map<string, Handler>();
  // Ghi append, không ghi đè: audit là dấu vết, mất dòng cũ thì mất ý nghĩa.
  const auditFile = hostAuditLogPath(opts.userDataDir);
  const audit =
    opts.audit ??
    ((line: string) => {
      try {
        fs.mkdirSync(path.dirname(auditFile), { recursive: true });
        fs.appendFileSync(auditFile, `${new Date().toISOString()} ${line}\n`, 'utf8');
      } catch {
        // Không được để việc ghi audit làm hỏng thao tác người dùng đang yêu cầu.
        // Mất một dòng log tệ hơn là ghi file thất bại.
      }
    });
  // Chạm file một lần lúc khởi tạo để `có file audit` là đúng ngay từ đầu, không
  // phải đợi hành động đầu tiên mới có.
  try {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    fs.writeFileSync(auditFile, '', { flag: 'a' });
  } catch {
    /* xem ghi chú bên trên */
  }

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
    workspaceOverride: root,
  } as never);

  /** Gọi thẳng handler, KHÔNG qua cổng chặn của `call`. */
  const raw = async (channel: string, payload: unknown): Promise<unknown> => {
    const fn = handlers.get(channel);
    if (!fn) {
      throw new Error(`Khong co channel "${channel}" trong ipc.cjs.`);
    }
    return fn(null, payload);
  };

  const host: NodeHost = {
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
      /* I2 — MẶC ĐỊNH TỪ CHỐI ở đây, không chỉ ở `buildIpcTools`.
       *
       * `call()` là đường vào thô, và cổng duyệt chỉ nằm ở tầng tool thì bất kỳ
       * tầng nào sau này cầm `host` là đi thẳng qua. Repo đã có sẵn
       * `delegate`/subagent, và `lib/agent-tools-server.ts` cũng đã nằm trong
       * đồ thị lõi — tức đường vòng là có thật, không phải giả định.
       *
       * Danh sách channel NGUY HIỂM allow ở đây: mặc định chặn thì thêm channel
       * mới không tự động lọt; cho phép thì phải khai tên, tức có dấu vết khi ai
       * đó mở đường. */
      if (DANGEROUS_CHANNELS.has(channel) && !opts.allowChannel?.(channel, payload)) {
        throw new Error(
          `Channel "${channel}" bi chan mac dinh: no thay doi file hoac chay lenh tren may. ` +
            'Phai duyet qua buildIpcTools (hoac truyen allowChannel) — khong goi thang.',
        );
      }
      // `handler()` là async, nên trả Promise — gọi thẳng, không await trước.
      return (await raw(channel, payload ?? {})) as T;
    },

    channels: () => [...handlers.keys()].sort(),

    dispose: () => {
      ipc.killAllRunning?.();
    },
  };

  // `buildIpcTools` nằm cùng module nên lấy `raw` qua WeakMap — KHÔNG expose lên
  // object. Nếu để thành method, mọi tầng sau cầm `host` đều lách được, tức
  // cổng mặc định-từ-chối chỉ là hình thức.
  RAW.set(host, raw);
  return host;
}

/** Đường thô theo host, chỉ module này dùng. Xem chỗ `RAW.set`. */
const RAW = new WeakMap<NodeHost, (channel: string, payload: unknown) => Promise<unknown>>();

/** Lấy đường thô. Chỉ `buildIpcTools` gọi, và chỉ SAU khi cổng duyệt đã chạy. */
function rawFor(host: NodeHost): (channel: string, payload: unknown) => Promise<unknown> {
  const raw = RAW.get(host);
  if (!raw) {
    throw new Error(
      'Host nay khong phai do createNodeHost tao ra — khong co duong thao noi bo.',
    );
  }
  return raw;
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
  // `fs_edit` KHÔNG có channel riêng trong `ipc.cjs` — nó nhận khối
  // SEARCH/REPLACE, phải áp vào nội dung rồi mới ghi. Xem `applyEditBlocks`.
  fs_edit: 'vyen:fs-write',
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
/**
 * Tên tham số model gửi → tên `ipc.cjs` nhận.
 *
 * ============ VÌ SAO BẢNG NÀY PHẢI ĐÚNG TUYỆT ĐỐI ============
 *
 * `ipc.cjs` kiểm bằng **zod**, và zod **bỏ âm thầm** khoá không có trong schema.
 * Sai tên ở đây không phải "lỗi đẹp" — nó là:
 *
 *   - `fs_read` nhận `start_line`/`line_count`, schema `FsReadPayload` chỉ có
 *     `relPath` → hai tham số bị **bỏ im lặng**. Mô tả tool hứa *"đọc tiếp bằng
 *     cách gọi lại với start_line lớn hơn"*; model làm đúng hướng dẫn, nhận lại
 *     đúng chunk cũ, lại tăng `start_line`, lặp tới khi hết token. **Lặp có
 *     tính phí** — đây là lý do phải sửa gấp, không phải sổ bút.
 *   - `bg_status` nhận `job_id`, schema lại là `id` → `id` undefined → `ipc.cjs`
 *     trả về **toàn bộ** danh sách job thay vì job được hỏi. Sai âm thầm.
 *   - `git_add` nhận `paths`, schema là `relPaths` → lỗi zod.
 */
const ARG_RENAMES: Record<string, string> = {
  // Đường dẫn.
  path: 'relPath',
  paths: 'relPaths',
  // Job nền.
  job_id: 'id',
  // Tìm kiếm.
  is_regex: 'isRegex',
  // Shell.
  timeout_secs: 'timeoutMs',
};

/**
 * Dịch tham số theo tên tool của model sang tên `ipc.cjs` dùng.
 *
 * Tham số lạ vẫn gửi đi: `ipc.cjs` tự bỏ bằng zod, và lọc ở đây đòi phải biết
 * danh sách hợp lệ của từng channel — tức một nguồn sự thật thứ hai, và lệch
 * thì im lặng (AGENTS.md §6). Bảng `ARG_RENAMES` là danh sách **sai tên**, nên
 * thêm vào nó không thể hỏng.
 */
export function toIpcPayload(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[ARG_RENAMES[k] ?? k] = v;
  }
  return out;
}

/** Trần ký tự cho một lần đọc file. Khớp `MAX_READ_CHARS` của `lib/fs-access.ts`. */
const MAX_READ_CHARS = 24_000;

/**
 * Cắt cửa sổ dòng mà `ipc.cjs` **không** làm được.
 *
 * `FsReadPayload` của `ipc.cjs` chỉ có `relPath` — `start_line`/`line_count`
 * thuộc về tầng client ở bản web. Ta gọi thẳng channel nên phải tự cắt, nếu
 * không thì đúng cái vòng lặp tốn tiền ở trên sẽ quay lại.
 */
function applyReadWindow(
  raw: string,
  startLine?: number,
  lineCount?: number,
): { content: string; truncated: boolean } {
  const lines = raw.split('\n');
  const start = Math.max(1, startLine ?? 1);
  const end = lineCount ? start + lineCount - 1 : lines.length;
  const selected = lines.slice(start - 1, end);
  // `truncated` = còn dòng chưa trả, HOẶC bị cắt vì vượt trần ký tự.
  let truncated = end < lines.length;
  let content = selected.join('\n');
  if (content.length > MAX_READ_CHARS) {
    content = content.slice(0, MAX_READ_CHARS);
    truncated = true;
  }
  return { content, truncated };
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Nội dung file đã đọc trong phiên này + hash của nó.
 *
 * ============ VÌ SAO CẦN ============
 *
 * `ipc.cjs` CÓ máy chống TOCTOU: so sha256 nội dung lúc đọc với lúc ghi, lệch
 * thì từ chối. Nhưng máy chỉ chạy khi caller **tự gửi** `expectedBaseHash` —
 * không gửi thì máy không bao giờ chạy, tức lớp bảo vệ có sẵn bị bỏ không.
 *
 * Bản web nhớ hash qua approval-binding; CLI chưa có `lib/session/` nên giữ
 * trong RAM cho tới lúc đó. Hết phiên là mất — chấp nhận được, vì sai sót chỉ
 * xảy ra khi file đổi **giữa hai lệnh trong cùng một phiên**, còn ghi đè mất dữ
 * liệu thì đã bị chặn.
 */
const READ_HASHES = new WeakMap<NodeHost, Map<string, string>>();

/** Lấy kho hash của host. Chỉ module này dùng. */
function readHashes(host: NodeHost): Map<string, string> {
  let m = READ_HASHES.get(host);
  if (!m) {
    m = new Map();
    READ_HASHES.set(host, m);
  }
  return m;
}

/**
 * Nhóm quyền phải hỏi trước, theo spec §7: "tool nguy hiểm … hỏi xác nhận
 * trước. Đây là thứ người dùng tin CLI nhất — bỏ thì mất niềm tin".
 *
 * Danh sách này **cố ý không suy ra từ nhóm `fs_write`/`shell`** một cách tự
 * động: `fs_write` viết file, còn `shell_run` chạy lệnh — mức nguy hiểm khác
 * nhau, và người duyệt phải thấy danh sách cụ thể chứ không phải tên nhóm.
 * Lấy từ `TOOL_CATEGORY_MAP` sẽ kéo cả `git_add`/`git_commit` vào, tức hỏi
 * cả thao tác git vốn đã được người dùng cho phép.
 */
export const NEEDS_APPROVAL: ReadonlySet<string> = new Set([
  'fs_write',
  'fs_edit',
  'shell_run',
  'bg_run',
  'bg_stop',
  // `git_commit` không nhận path nên commit **toàn bộ index**. Model stage bằng
  // `git_add` rồi commit bằng một lệnh nữa là thay đổi lịch sử mà không ai
  // thấy gì. `git_add` chỉ đưa vào index nên nhẹ hơn, nhưng nó là bước đầu của
  // việc đó và người duyệt thấy "git" thì không phải nghĩ.
  //
  // Danh sách này CỐ Ý viết tay, không suy ra từ `TOOL_CATEGORY_MAP`: nhóm `git`
  // chứa cả `git_status`/`git_diff`/`git_log` — hỏi cả ba thì biến "duyệt" thành
  // thói quen bấm `có` mà không đọc, tức mất đúng thứ spec §7 muốn giữ.
  'git_add',
  'git_commit',
]);

export interface BuildToolsOptions {
  /**
   * Hỏi người dùng có cho chạy tool này không. Trả false = từ chối, và tool
   * **không** được thực thi.
   *
   * Nhận `args` để người duyệt **thấy được** đường dẫn và nội dung sắp ghi.
   * Hỏi mà không hiện gì tức là hỏi cho có — người dùng bấm `có` theo phản xạ,
   * và spec §7 gọi đó là mất niềm tin.
   *
   * Hàm bất đồng bộ vì bản web phải chờ người dùng bấm.
   */
  approve: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}

/** Tool `ipc.cjs` đòi approval token gắn với chính lệnh sắp chạy. */
const TOKEN_TOOLS: ReadonlySet<string> = new Set(['shell_run', 'bg_run']);

/**
 * Dựng bộ tool cho AI SDK: schema mượn từ `CLIENT_TOOL_DEFS`, thực thi đi qua
 * `ipc.cjs`.
 *
 * ============ VÌ SAO MƯỢN SCHEMA, KHÔNG VIẾT LẠI ============
 *
 * `CLIENT_TOOL_DEFS` đã có `description` và `parameters` — viết và kiểm thử.
 * Model cũng đã quen đúng những câu mô tả đó. Viết schema thứ hai ở đây là tạo
 * nơi lệch âm thầm: sửa một bên thì bên kia cũ, và không ai biết bên nào đúng.
 * Nên chỉ mượn schema rồi thêm `execute` mà `ipc.cjs` thực sự làm được.
 *
 * ============ CỔNG DUYỆT ============
 *
 * Ở web, việc hỏi xác nhận do UI đảm nhiệm. CLI không có UI, nên cổng phải ở
 * đây — và nó là **tham số truyền vào**, không import Dexie. Nhờ vậy module này
 * không phụ thuộc `db.ts`, xây được trước cả khi thay `db.ts`.
 */
export function buildIpcTools(
  host: NodeHost,
  opts: BuildToolsOptions,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const toolName of Object.keys(IPC_TOOL_CHANNELS)) {
    const def = (CLIENT_TOOL_DEFS as Record<string, unknown>)[toolName] as
      | { description?: string; parameters?: unknown }
      | undefined;
    if (!def) continue; // không có schema ở web → không dựng tool giả
    out[toolName] = {
      description: def.description,
      parameters: def.parameters,
      execute: async (args: Record<string, unknown>) => {
        const a = args ?? {};
        if (NEEDS_APPROVAL.has(toolName)) {
          // Truyền `args` để người duyệt THẤY đường dẫn và nội dung. Hỏi mà
          // không hiện gì thì người dùng chỉ có thể bấm `có` theo phản xạ.
          const ok = await opts.approve(toolName, a);
          if (!ok) {
            // Ném, KHÔNG trả về giá trị rỗng: nếu trả rỗng, model coi như
            // tool chạy xong và đi tiếp — tức lệnh bị từ chối mà vẫn tiếp tục.
            throw new Error(
              `Nguoi dung KHONG duyet phep chay tool "${toolName}". dung lenh nay khong duoc thuc hien.`,
            );
          }
          // `shell_run`/`bg_run` còn bị `ipc.cjs` đòi approval token gắn với
          // CHÍNH lệnh sắp chạy (`ipc.cjs:874-882`). Không có token thì mọi lần
          // gọi đều chết với `approval_required`. Mint bằng đúng cơ chế web đang
          // dùng (`lib/approval-binding.cjs`) chứ không tự chế token.
          if (TOKEN_TOOLS.has(toolName)) {
            const minted = approvalBinding.createApprovalToken({
              kind: 'shell',
              payload: { command: a.command, cwd: a.cwd },
            });
            // `consumeApprovalToken(fingerprint, …)` — tham số đầu TÊN là
            // `fingerprint`, nên giá trị phải gửi đi là `fingerprint`, không phải
            // cả object token. Gửi object sẽ không khớp và mọi lệnh đều bị từ chối.
            if (!minted?.fingerprint) {
              throw new Error(
                `Khong mint duoc approval token cho "${toolName}" — lenh khong chay.`,
              );
            }
            a.approvalToken = minted.fingerprint;
          }
        }
        const channel = IPC_TOOL_CHANNELS[toolName];
        const hashes = readHashes(host);
        try {
          /* ---- fs_edit: ghép khối SEARCH/REPLACE rồi ghi như fs_write ----
           *
           * `ipc.cjs` không có channel `fs-edit`; parser khối đã có sẵn và thuần Node
           * ở `lib/edit-blocks.ts` — dùng lại chứ không tự viết parser thứ hai. */
          let content = a.content as string | undefined;
          if (toolName === 'fs_edit') {
            /* `parseEditBlocks` BẮT BUỘC dòng tên file ngay trên `<<<<<<< SEARCH`
             * (bản web vẫn vậy — nó truyền `blocksText` thẳng). Nhưng `fs_edit` đã
             * có tham số `path` riêng, nên bắt model gõ tên file thêm lần nữa là
             * chỗ sai sót không cần thiết — mô tả tool cũng không nhắc tới nó.
             * Thử parse thẳng trước; chỉ khi parser báo thiếu tên file mới thử
             * lại với `path` đứng đầu. Không đụng `parseEditBlocks` vì bản web
             * đang dùng đúng như nó là. */
            const rawBlocks = a.blocks as string;
            let parsed = parseEditBlocks(rawBlocks);
            if (parsed.error && /tên file/i.test(parsed.error)) {
              parsed = parseEditBlocks(`${a.path}\n${rawBlocks}`);
            }
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.blocks.length === 0) {
              throw new Error('Khong parse duoc khoi edit nao.');
            }
            /* Đọc TOÀN BỘ file, KHÔNG đi qua `applyReadWindow`. `fs_edit` ghi đè
             * cả file, nên đọc bản cắt 24.000 ký tự sẽ cắt mất đuôi file — mất
             * dữ liệu. Bản web ghi chú đúng việc này ở `use-chat-orchestration.ts`. */
            const full = (await rawFor(host)('vyen:fs-read', { relPath: a.path })) as {
              content?: string;
            };
            let whole = full?.content ?? '';
            /* CHỈ GHI HASH KHI CHƯA CÓ — đây là điểm mấu chốt.
             *
             * Bản đầu tôi ghi vô điều kiện (`hashes.set(...)` luôn). Sai, và sai theo
             * cách tệ nhất: nó **ghi đè H0 bằng H1**, rồi phép so thành H1 với H1 ⇒
             * qua. Lớp bảo vệ có vẻ mà không chặn đúng ca nó sinh ra để chặn.
             *
             * ============ VÌ SAO H0 LẠI LÀ THỨ PHẢI GIỮ ============
             *
             * H0 = nội dung mà **người dùng đã đọc và duyệt**. Nếu file đã đổi
             * thành H1 mà ta vẫn ghi, thứ bị ghi đè là chính phần họ duyệt — dù
             * dữ liệu của người khác thì không mất (vì `fs_edit` áp khối lên nội
             * dung hiện tại, đo thật 2026-10-19). Cổng duyệt sinh ra để chặn đúng
             * điều đó.
             *
             * File CHƯA từng đọc thì chưa có H0 — lúc đó ghi hash mới vào, vì đó là
             * cách duy nhất để biết file vừa ở trạng thái nào ngay trước lúc ghi.
             */
            if (!hashes.has(a.path as string)) {
              hashes.set(a.path as string, sha256(whole));
            }
            for (const b of parsed.blocks) {
              const applied = replaceMostSimilarChunk(whole, b.search, b.replace);
              if (!applied.ok) {
                // Ném chứ không ghi nửa vời: khối không khớp mà vẫn ghi là mất dữ
                // liệu kinh điển. `hint` là gợi ý để model tự sửa lại lượt sau.
                throw new Error(
                  `Khong ap duoc khoi SEARCH trong "${b.filename ?? a.path}": ` +
                    `${applied.hint ?? 'khong tim thay doan can thay'}`,
                );
              }
              whole = applied.text ?? whole;
            }
            content = whole;
            a.content = whole;
          }

          /* ---- TOCTOU: ghi đè file ĐÃ ĐỌC thì phải kèm hash lúc đọc ----
           *
           * File CHƯA từng đọc thì không có hash để đối chiếu, nên không gửi
           * `hasDiff` — `ipc.cjs` cho qua, và đó là đúng: không có gì để so. */
          if ((toolName === 'fs_write' || toolName === 'fs_edit') && hashes.has(a.path as string)) {
            a.hasDiff = true;
            a.expectedBaseHash = hashes.get(a.path as string);
          }

          const payload = toIpcPayload(toolName, a);
          const r = await rawFor(host)(channel, payload);

          // `fs_read`: cửa sổ dòng và trần ký tự phải làm ở đây — schema
          // `FsReadPayload` của `ipc.cjs` chỉ có `relPath`, còn `start_line` và
          // `line_count` thuộc tầng client ở bản web. Không cắt thì model đọc
          // lại đúng chunk cũ rồi lặp, tốn token vô ích.
          if (toolName === 'fs_read') {
            const full = (r as { content?: string } | undefined)?.content ?? '';
            // Hash phải tính trên TOÀN BỘ file, không phải phần cửa sổ — nếu tính
            // trên cửa sổ thì đọc tiếp rồi ghi sẽ luôn lệch và chặn oan.
            if (a.path) hashes.set(a.path as string, sha256(full));
            const { content, truncated } = applyReadWindow(
              full,
              a.start_line as number,
              a.line_count as number,
            );
            return { ...(r as object), content, truncated };
          }
          // Ghi xong thì hash cũ hết ý nghĩa — file đã là nội dung mới.
          if ((toolName === 'fs_write' || toolName === 'fs_edit') && a.path) {
            hashes.set(a.path as string, sha256(content ?? ''));
          }
          return r;
        } catch (e) {
          // Bọc lại để lỗi nêu đúng TÊN TOOL, không chỉ câu chữ của ipc.cjs —
          // khi model nhận lỗi, nó cần biết tool nào hỏng để thử cách khác.
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Tool "${toolName}" that bai: ${msg}`);
        }
      },
    };
  }
  return out;
}
