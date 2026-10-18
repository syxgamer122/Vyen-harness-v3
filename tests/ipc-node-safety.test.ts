/**
 * Test cho ba lỗi Critical mà reviewer độc lập tìm ra, cộng một bất biến an
 * toàn mà ledger tự dự đoán là nợ.
 *
 * ============ VÌ SAO CÁC LỖI NÀY NẶNG ============
 *
 * C1: `workspaceBlockReason` chỉ chạy ở channel `vyen:workspace-set`, KHÔNG chạy
 *     ở `workspaceOverride` mà lớp cầu dùng. Nên root quá rộng (gốc ổ đĩa, home)
 *     đi lọt — và root rộng làm mọi thứ "nằm trong workspace".
 * C2: `workspaceRoot` sai chính tả thì `register()` âm thầm lùi về workspace của
 *     phiên trước, không một dòng cảnh báo. Ghi nhầm cây còn tệ hơn báo lỗi.
 * C3: `toIpcPayload` chỉ dịch `path`→`relPath`. `start_line` bị zod strip nên
 *     `fs_read` trả lại đúng chunk cũ — mô tả tool hứa "gọi lại với start_line
 *     lớn hơn", model làm đúng theo hướng dẫn rồi nhận lại y hệt → lặp tới
 *     hết token. Đây là lặp **có tính phí**, không phải lỗi vô hại.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createNodeHost, toIpcPayload, IPC_TOOL_CHANNELS, NEEDS_APPROVAL, buildIpcTools } from '@/lib/tools/ipc-node';

function ud(): string {
  return mkdtempSync(path.join(tmpdir(), 'vyen-ud-'));
}

describe('C1 — workspace root phải qua đúng blocklist', () => {
  it('TỪ CHỐI gốc ổ đĩa', () => {
    const root = path.parse(process.cwd()).root;
    expect(() => createNodeHost({ workspaceRoot: root, userDataDir: ud() })).toThrow();
  });

  it('TỪ CHỐI thư mục home — root rộng làm mọi thứ "nằm trong workspace"', () => {
    expect(() => createNodeHost({ workspaceRoot: homedir(), userDataDir: ud() })).toThrow();
  });

  it('thư mục dự án thật thì vẫn nhận', () => {
    const ws = mkdtempSync(path.join(tmpdir(), 'vyen-ok-'));
    const u = ud();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: u });
    expect(host).toBeTruthy();
    host.dispose();
    rmSync(ws, { recursive: true, force: true });
    rmSync(u, { recursive: true, force: true });
  });
});

describe('C2 — workspaceRoot không tồn tại thì phải báo, không lùi im lặng', () => {
  it('NÉM khi thư mục không tồn tại', () => {
    // Không có lựa chọn im lặng: lùi về workspace phiên trước nghĩa là ghi file
    // nhầm cây, và người dùng không hề được báo.
    expect(() =>
      createNodeHost({ workspaceRoot: path.join(tmpdir(), 'vyen-khong-ton-tai-xyz'), userDataDir: ud() }),
    ).toThrow(/không tồn tại|khong ton tai/i);
  });
});

describe('C3 — dịch đủ tham số, không nuốt tham số', () => {
  it('`paths` của git_add → `relPaths`', () => {
    expect(toIpcPayload('git_add', { paths: ['a.txt'] })).toEqual({ relPaths: ['a.txt'] });
  });

  it('`job_id` của bg_* → `id`', () => {
    expect(toIpcPayload('bg_status', { job_id: 'j1' })).toEqual({ id: 'j1' });
  });

  it('`is_regex` → `isRegex`', () => {
    expect(toIpcPayload('fs_search', { query: 'x', is_regex: true })).toEqual({
      query: 'x',
      isRegex: true,
    });
  });

  it('`path` → `relPath`', () => {
    expect(toIpcPayload('fs_read', { path: 'a.txt' })).toEqual({ relPath: 'a.txt' });
  });

  /* Tham số lạ cố ý KHÔNG lọc ở đây: `ipc.cjs` tự bỏ bằng zod, còn lọc thì
   * đòi phải biết danh sách hợp lệ của từng channel — tức nguồn sự thật thứ hai,
   * lệch đi thì im lặng. Bảng `ARG_RENAMES` là danh sách **sai tên**, nên thêm
   * vào nó không thể hỏng. */
  it('tham số lạ đi thẳng tới ipc.cjs (nơi zod bỏ), không bị lọc sai ở đây', () => {
    const out = toIpcPayload('fs_read', { path: 'a.txt', tham_so_bia: 1 });
    expect(out).toHaveProperty('relPath', 'a.txt');
  });

  /* `fs_read` phải TÔN TRỌNG start_line — nếu không, model đọc lại đúng chunk cũ
   * và lặp tới hết token. Đây là hành vi, không chỉ là hình dạng payload.
   * Gọi qua `buildIpcTools` chứ không gọi `host.call` thẳng, vì cửa sổ dòng nằm
   * ở tầng tool — đó đúng là đường model đi. */
  it('fs_read trả đúng dòng đã yêu cầu', async () => {
    const ws = mkdtempSync(path.join(tmpdir(), 'vyen-c3-'));
    const u = ud();
    writeFileSync(
      path.join(ws, 'big.txt'),
      Array.from({ length: 50 }, (_, i) => `d${i + 1}`).join('\n'),
      'utf8',
    );
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: u });
    try {
      const tools = buildIpcTools(host, {
        approve: async () => true,
      }) as Record<string, { execute: (a: unknown) => Promise<{ content: string }> }>;
      const r = await tools.fs_read.execute({ path: 'big.txt', start_line: 10, line_count: 3 });
      const lines = r.content.split('\n');
      expect(lines[0]).toBe('d10');
      expect(lines).toHaveLength(3);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(u, { recursive: true, force: true });
    }
  });

  /* Trần ký tự: `ipc.cjs` cho tới 2 MB vào một lần đọc, đổ thẳng vào context
   * model. Bản web cắt ở 24.000 ký tự rồi báo `truncated` để model đọc tiếp. */
  it('fs_read cắt ở 24.000 ký tự và báo truncated', async () => {
    const ws = mkdtempSync(path.join(tmpdir(), 'vyen-cap-'));
    const u = ud();
    writeFileSync(path.join(ws, 'huge.txt'), 'x'.repeat(60_000), 'utf8');
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: u });
    try {
      const tools = buildIpcTools(host, {
        approve: async () => true,
      }) as Record<string, { execute: (a: unknown) => Promise<{ content: string; truncated: boolean }> }>;
      const r = await tools.fs_read.execute({ path: 'huge.txt' });
      expect(r.content.length).toBeLessThanOrEqual(24_000);
      expect(r.truncated).toBe(true);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(u, { recursive: true, force: true });
    }
  });
});

/* Bất biến an toàn: mọi tool GHI hoặc SPAWN trong map đều phải hỏi duyệt.
 * Ledger tự ghi nợ này: thêm `fs_edit` vào map mà quên duyệt thì không test nào
 * đỏ — trong khi spec §7 nói rõ phải hỏi. */
describe('I3 — mọi tool ghi/spawn đều phải nằm trong NEEDS_APPROVAL', () => {
  it('tool nào không chỉ đọc thì phải hỏi duyệt', () => {
    // Đọc thì không hỏi; tên chứa động từ thay đổi trạng thái thì phải hỏi.
    const CHI_DOC = new Set(['fs_read', 'fs_list', 'fs_search', 'git_status', 'git_diff', 'git_log', 'bg_status']);
    const chuaHoi = Object.keys(IPC_TOOL_CHANNELS).filter(
      (t) => !CHI_DOC.has(t) && !NEEDS_APPROVAL.has(t),
    );
    expect(chuaHoi, `tool ghi/spawn ma khong hoi duyet: ${chuaHoi.join(', ')}`).toEqual([]);
  });
});

/* `shell_run` bị `ipc.cjs` đòi approval token gắn với CHÍNH lệnh sắp chạy. Không
 * mint token thì mọi lần gọi đều chết với `approval_required` — tức tool có tồn
 * tại trong danh sách cho model nhưng không bao giờ chạy. */
describe('C3 — shell_run chạy được sau khi duyệt', () => {
  it('duyệt rồi thì lệnh thật chạy, không phải approval_required', async () => {
    const ws = mkdtempSync(path.join(tmpdir(), 'vyen-shell-'));
    const u = ud();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: u });
    try {
      const tools = buildIpcTools(host, { approve: async () => true }) as Record<
        string,
        { execute: (a: unknown) => Promise<{ stdout?: string }> }
      >;
      const r = await tools.shell_run.execute({ command: 'echo vyen-cli-token-ok' });
      expect(String(r?.stdout ?? '')).toContain('vyen-cli-token-ok');
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(u, { recursive: true, force: true });
    }
  });

  it('KHÔNG duyệt thì lệnh không chạy', async () => {
    const ws = mkdtempSync(path.join(tmpdir(), 'vyen-shell-'));
    const u = ud();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: u });
    try {
      const tools = buildIpcTools(host, { approve: async () => false }) as Record<
        string,
        { execute: (a: unknown) => Promise<unknown> }
      >;
      await expect(tools.shell_run.execute({ command: 'echo x' })).rejects.toThrow(/duyet|duyet phep/i);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(u, { recursive: true, force: true });
    }
  });
});

/* I1 — cổng duyệt phải nhìn THẤY đường dẫn và nội dung. `approve(toolName)`
 * không có args thì người dùng bị hỏi "chạy fs_write?" mà không thấy sắp ghi cái
 * gì — tức chỉ có thể bấm `có` theo phản xạ. */
describe('I1 — cổng duyệt nhận được args để hiện diff', () => {
  it('approve nhận đúng tool lẫn args', async () => {
    const ws = mkdtempSync(path.join(tmpdir(), 'vyen-args-'));
    const u = ud();
    writeFileSync(path.join(ws, 'x.txt'), 'cu', 'utf8');
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: u });
    try {
      const seen: { tool: string; path?: string; content?: string }[] = [];
      const tools = buildIpcTools(host, {
        approve: async (tool, args) => {
          seen.push({ tool, path: args.path as string, content: args.content as string });
          return true;
        },
      }) as Record<string, { execute: (a: unknown) => Promise<unknown> }>;
      await tools.fs_write.execute({ path: 'x.txt', content: 'moi' });
      expect(seen).toEqual([{ tool: 'fs_write', path: 'x.txt', content: 'moi' }]);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(u, { recursive: true, force: true });
    }
  });
});
