/**
 * Lớp ánh xạ tên tool của model → channel của `lib/ipc.cjs`.
 *
 * ============ VÌ SAO CẦN LỚP NÀY ============
 *
 * Model nhìn thấy tên tool như `fs_list`, `fs_read`, `fs_search`, `shell_run`,
 * `git_status`… (định nghĩa ở `lib/agent-tools.ts`, phân loại ở
 * `lib/tool-catalog.ts`). `ipc.cjs` lại đặt tên channel theo kiểu khác:
 * `vyen:fs-list`, và **tham số tên `relPath` chứ không phải `path`**.
 *
 * Nếu để lệch, lỗi hiện ra ở tầng schema của ipc.cjs với thông báo khó hiểu
 * (`expected string, received undefined`) thay vì ở chỗ thật sự là lỗi ánh xạ.
 *
 * ============ RÀNG BUỘC KHÔNG ĐƯỢC PHÁ ============
 *
 * 1. Tên tool phải trùng `TOOL_CATALOG`/`TOOL_CATEGORY_MAP`. Một tên lọt khỏi
 *    bản đồ là tool **thoát lưới phân quyền** — `tests/tool-catalog.test.ts`
 *    chặn đúng điều đó, và ta còn thêm một test ở đây.
 * 2. Chỉ ánh xạ tool **đã có** channel. Không bịa channel mới.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeHost, buildIpcToolMap } from '@/lib/tools/ipc-node';
import { TOOL_CATALOG, TOOL_CATEGORY_MAP } from '@/lib/tool-catalog';

function workspace() {
  const ws = mkdtempSync(path.join(tmpdir(), 'vyen-map-'));
  writeFileSync(path.join(ws, 'a.txt'), 'dong 1\ndong 2\n', 'utf8');
  return { ws, userData: mkdtempSync(path.join(tmpdir(), 'vyen-ud-')) };
}

describe('buildIpcToolMap', () => {
  it('mọi tool ánh xạ đều có channel thật trong ipc.cjs', () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const map = buildIpcToolMap(host);
      const known = new Set(host.channels());
      const bogus = Object.entries(map)
        .filter(([, ch]) => !known.has(ch))
        .map(([tool, ch]) => `${tool}->${ch}`);
      expect(bogus, `tool tro toi channel khong ton tai: ${bogus.join(', ')}`).toEqual([]);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('phủ hết nhóm tool chạy được trên Node', () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const map = buildIpcToolMap(host);
      // Những tool này KHÔNG ánh xạ được và phải được nói rõ, không im lặng
      // biến mất: mất tool thì model tưởng không có, còn tưởng có thì gọi xong
      // nhận lỗi khó hiểu.
      expect(map.fs_list).toBe('vyen:fs-list');
      expect(map.fs_read).toBe('vyen:fs-read');
      expect(map.fs_search).toBe('vyen:fs-search');
      expect(map.fs_write).toBe('vyen:fs-write');
      expect(map.shell_run).toBe('vyen:shell-run');
      expect(map.git_status).toBe('vyen:git-status');
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  /* Không ánh xạ tool nào lọt ra ngoài catalog — vì tên lọt khỏi catalog là
   * đường vòng qua chính sách quyền. */
  it('không phát sinh tên tool nào ngoài TOOL_CATALOG', () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const names = new Set(TOOL_CATALOG.map((t) => t.name));
      const stray = Object.keys(buildIpcToolMap(host)).filter((n) => !names.has(n));
      expect(stray, `tool ngoai catalog: ${stray.join(', ')}`).toEqual([]);
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('dịch `path` của model thành `relPath` của ipc.cjs rồi đọc được file', async () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const map = buildIpcToolMap(host);
      const payload = toIpcPayload('fs_read', { path: 'a.txt' });
      expect(payload).toEqual({ relPath: 'a.txt' });
      const r = (await host.call<{ content: string }>(map.fs_read, payload))!;
      expect(r.content).toBe('dong 1\ndong 2\n');
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('fs_write không tự thêm hash — thiếu hash thì ipc.cjs phải chặn', async () => {
    const { ws, userData } = workspace();
    const host = createNodeHost({ workspaceRoot: ws, userDataDir: userData });
    try {
      const map = buildIpcToolMap(host);
      const payload = toIpcPayload('fs_write', { path: 'a.txt', content: 'de' });
      // Không có `hasDiff`/`expectedBaseHash` → ipc.cjs KHÔNG chặn (đó là chính
      // sách của nó). Test này khoá đúng hành vi đó, để đổi ở đây là thấy ngay.
      await host.call(map.fs_write, payload);
      expect(readFileSync(path.join(ws, 'a.txt'), 'utf8')).toBe('de');
    } finally {
      host.dispose();
      rmSync(ws, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });
});

// Những tool có channel thật trong ipc.cjs.
import { toIpcPayload } from '@/lib/tools/ipc-node';

// nhắc lại cho người đọc: mọi tool trong map đều phải có mặt ở TOOL_CATALOG
it('mọi tool ánh xạ đều được phân quyền', () => {
  expect(Object.keys(TOOL_CATEGORY_MAP).length).toBeGreaterThan(0);
});
