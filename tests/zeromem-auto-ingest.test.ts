/**
 * Đợt 17 (2026-10-16): ghi tự động hoạt động vào kho Zero-Mem.
 *
 * Đây là đường ghi MỚI — nó không nằm sau tool `zeromem_log` (model phải tự quyết
 * định gọi, thực tế hiếm khi gọi nên kho gần như luôn rỗng). Ở đây hook ghi thẳng
 * sau mỗi lượt, có cờ bật/tắt và tôn trọng quyền nhóm `memory`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVITY_LINE_MAX_CHARS,
  autoIngestTurn,
  formatActivityLine,
  normalizeActivityTarget,
  type ZeroMemActivity,
} from '@/lib/zeromem/auto-ingest';
import { __resetPersistState, persistedTraceCount } from '@/lib/zeromem/persistence';
import { ZeroMemStore } from '@/lib/zeromem/store';

function freshStore(): ZeroMemStore {
  __resetPersistState();
  return new ZeroMemStore('test-ws');
}

describe('formatActivityLine — dòng cô đọng có đủ thông tin tra lại được', () => {
  it('ghi tên tool, đích và kết quả', () => {
    const line = formatActivityLine({
      toolName: 'fs_read',
      target: 'lib/auth.ts',
      summary: '200 dòng',
    });

    expect(line).toContain('fs_read');
    expect(line).toContain('lib/auth.ts');
    expect(line).toContain('ok');
  });

  it('đánh dấu rõ khi tool thất bại', () => {
    const line = formatActivityLine({ toolName: 'shell_run', target: 'npm test', failed: true });
    expect(line).toContain('FAILED');
    expect(line).not.toContain(' ok');
  });

  it('KHÔNG lộ bí mật đã đăng ký trong kết quả tool', () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    const line = formatActivityLine({
      toolName: 'fs_read',
      target: '.env',
      summary: `OPENAI_API_KEY=${secret}`,
    });

    expect(line).not.toContain(secret);
    expect(line).toContain('[redacted]');
  });

  it('cắt trần độ dài để trace không phình', () => {
    const line = formatActivityLine({
      toolName: 'fs_read',
      target: 'big.ts',
      summary: 'x'.repeat(5000),
    });

    expect(line.length).toBeLessThanOrEqual(ACTIVITY_LINE_MAX_CHARS);
  });
});

describe('normalizeActivityTarget — đường dẫn dài giữ đuôi, lệnh dài giữ đầu', () => {
  it('đường dẫn dài giữ phần cuối (chứa tên file)', () => {
    const target = normalizeActivityTarget('a/'.repeat(60) + 'lib/auth.ts');
    expect(target).toContain('lib/auth.ts');
    expect(target!.length).toBeLessThanOrEqual(80);
  });

  it('lệnh dài giữ phần đầu (quyết định nó làm gì)', () => {
    const target = normalizeActivityTarget('npx vitest run --reporter=json ' + 'a'.repeat(100));
    expect(target!.startsWith('npx vitest run')).toBe(true);
  });

  it('rỗng hoặc undefined thì trả undefined', () => {
    expect(normalizeActivityTarget(undefined)).toBeUndefined();
    expect(normalizeActivityTarget('   ')).toBeUndefined();
  });
});

describe('autoIngestTurn — cờ bật/tắt và quyền nhóm memory', () => {
  beforeEach(() => {
    __resetPersistState();
  });

  const acts: ZeroMemActivity[] = [{ toolName: 'fs_edit', target: 'lib/auth.ts' }];

  it('mặc định KHÔNG ghi gì khi cờ tắt (lựa chọn bảo thủ)', () => {
    const store = freshStore();
    const written = autoIngestTurn(store, { enabled: false, sessionId: 's1', activities: acts });

    expect(written).toBe(0);
    expect(store.getTraces()).toHaveLength(0);
  });

  it('ghi khi bật', () => {
    const store = freshStore();
    const written = autoIngestTurn(store, { enabled: true, sessionId: 's1', activities: acts });

    expect(written).toBe(1);
    expect(store.getTraces()).toHaveLength(1);
    expect(store.getTraces()[0].content).toContain('fs_edit');
  });

  it('KHÔNG ghi khi nhóm memory bị chặn — ghi tự động không đi qua bảng quyền nên phải tự kiểm', () => {
    const store = freshStore();
    const written = autoIngestTurn(store, {
      enabled: true,
      memoryPermission: 'deny',
      sessionId: 's1',
      activities: acts,
    });

    expect(written).toBe(0);
    expect(store.getTraces()).toHaveLength(0);
  });

  it('vẫn ghi khi quyền là ask/auto/default (chỉ deny mới chặn)', () => {
    for (const perm of ['ask', 'auto', 'default', undefined]) {
      const store = freshStore();
      const written = autoIngestTurn(store, {
        enabled: true,
        memoryPermission: perm,
        sessionId: 's1',
        activities: acts,
      });
      expect(written, `quyền "${perm}" phải ghi`).toBe(1);
    }
  });

  it('lượt không có hoạt động nào thì không ghi gì', () => {
    const store = freshStore();
    const written = autoIngestTurn(store, { enabled: true, sessionId: 's1', activities: [] });

    expect(written).toBe(0);
    expect(persistedTraceCount()).toBe(0);
  });

  it('ghi nhiều hoạt động của một lượt thành nhiều trace', () => {
    const store = freshStore();
    const written = autoIngestTurn(store, {
      enabled: true,
      sessionId: 's1',
      activities: [
        { toolName: 'fs_read', target: 'a.ts' },
        { toolName: 'fs_edit', target: 'a.ts' },
        { toolName: 'shell_run', target: 'npm test', failed: true },
      ],
    });

    expect(written).toBe(3);
    expect(store.getTraces().map((t) => t.toolName)).toEqual(['fs_read', 'fs_edit', 'shell_run']);
  });

  it('ghi xong thì đánh dấu bẩn để lịch ghi theo lô chạy', () => {
    const store = freshStore();
    autoIngestTurn(store, { enabled: true, sessionId: 's1', activities: acts });
    // Chưa ghi xuống Dexie (không có Dexie trong test) nhưng trace đã vào store.
    expect(store.getTraces()).toHaveLength(1);
    expect(persistedTraceCount()).toBe(0);
  });
});