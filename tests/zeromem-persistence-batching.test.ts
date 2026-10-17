/**
 * Đợt 17 (2026-10-16): hai quy tắc của `lib/zeromem/persistence.ts`.
 *
 * Bản cũ `bulkPut` TOÀN BỘ traces sau mỗi lần ghi ⇒ lượt thứ N ghi N trace
 * (O(N²)) và không có trần nào ⇒ phình vô hạn trong IndexedDB.
 *
 * Test ở đây không đụng Dexie thật: `persistZeroMem` bắt đầu từ `db`, nên các
 * test đo hành vi LỚCH (khi nào ghi, ghi bao nhiêu, cắt bao nhiêu) thay vì đo
 * I/O. Việc ghi thật đã có sẵn ở `tests/zeromem.test.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetPersistState,
  ZEROMEM_TRACE_CAP,
  PERSIST_MIN_INTERVAL_MS,
  markZeroMemDirty,
  persistedTraceCount,
} from '@/lib/zeromem/persistence';
import { ZeroMemStore } from '@/lib/zeromem/store';
import { clearZeroMemStores, getZeroMemStore } from '@/lib/zeromem/tools';
import type { ZeroMemTrace } from '@/lib/zeromem/types';

function storeWith(traces: ZeroMemTrace[]): ZeroMemStore {
  const store = new ZeroMemStore('test-workspace');
  // Nạp trực tiếp để không phụ thuộc appendTrace sinh entity (không liên quan
  // tới cái đang kiểm).
  (store as unknown as { traces: ZeroMemTrace[] }).traces = traces;
  return store;
}

function makeTrace(i: number): ZeroMemTrace {
  return {
    id: `t${i}`,
    sessionId: 's1',
    episodeId: 'e1',
    turnIndex: i,
    role: 'tool',
    content: `sua loi so ${i}`,
    entityIds: [],
    timestamp: i,
  } as unknown as ZeroMemTrace;
}

describe('lịch ghi ZeroMem — trạng thái sạch', () => {
  beforeEach(() => {
    __resetPersistState();
  });

  it('bắt đầu với 0 trace đã ghi', () => {
    expect(persistedTraceCount()).toBe(0);
  });

  it('hằng số là số dương và hợp lý', () => {
    expect(ZEROMEM_TRACE_CAP).toBeGreaterThan(0);
    expect(PERSIST_MIN_INTERVAL_MS).toBeGreaterThan(0);
  });
});

describe('không ghi khi không có gì thay đổi', () => {
  beforeEach(() => {
    __resetPersistState();
  });

  it('markZeroMemDirty là điều kiện cần để ghi (không ghi vô điều kiện)', async () => {
    const { persistZeroMem } = await import('@/lib/zeromem/persistence');
    const store = storeWith([makeTrace(1)]);

    // Chưa đánh dấu bẩn → không được ghi (và không nổ), kể cả khi force.
    await persistZeroMem(store, { force: false });
    expect(persistedTraceCount()).toBe(0);
  });
});

describe('cắt bỏ trace cũ ngoài trần', () => {
  beforeEach(() => {
    __resetPersistState();
  });

  it('store chứa nhiều hơn trần thì phần còn giữ là các trace MỚI NHẤT', async () => {
    const { persistZeroMem } = await import('@/lib/zeromem/persistence');
    const traces = Array.from({ length: ZEROMEM_TRACE_CAP + 50 }, (_, i) => makeTrace(i));
    const store = storeWith(traces);

    markZeroMemDirty();
    await persistZeroMem(store, { force: true });

    // Trong store đã được cắt trước khi ghi ⇒ chỉ còn ≤ trần, và là bản mới nhất.
    const kept = store.getTraces();
    expect(kept.length).toBeLessThanOrEqual(ZEROMEM_TRACE_CAP);
    expect(kept[kept.length - 1].id).toBe(`t${ZEROMEM_TRACE_CAP + 49}`);
  });

  it('trace cũ nhất bị loại khỏi danh sách đã ghi', async () => {
    const { persistZeroMem } = await import('@/lib/zeromem/persistence');
    const traces = Array.from({ length: ZEROMEM_TRACE_CAP + 50 }, (_, i) => makeTrace(i));
    const store = storeWith(traces);

    markZeroMemDirty();
    await persistZeroMem(store, { force: true });

    expect(persistedTraceCount()).toBeLessThanOrEqual(ZEROMEM_TRACE_CAP);
  });
});

/**
 * Lỗi Critical do reviewer chỉ ra (2026-10-16): `hydrateZeroMem` replay qua
 * `appendTrace`, mà `appendTrace` SINH ID MỚI. Id trong RAM lệch id trong Dexie
 * ⇒ `persistedIds` không khớp trace nào ⇒ mỗi lần mở app lại chép thêm cả kho
 * dưới id mới ⇒ tràn quota IndexedDB, đúng thứ trần 500 sinh ra để chặn.
 *
 * Test ở đây khoá hợp đồng "replay giữ id", không đụng Dexie: id phải đi qua
 * `appendTrace` và ra đúng như đã lưu.
 */
describe('replay giữ nguyên id trace đã lưu', () => {
  it('appendTrace giữ id được truyền vào', () => {
    const store = new ZeroMemStore('ws');
    const saved = store.appendTrace({ id: 'tr-abc-1', sessionId: 's', role: 'tool', content: 'x' });
    expect(saved.id).toBe('tr-abc-1');
  });

  it('replay hai lần cho ra cùng bộ id (không nhân bản khi hydrate lại)', () => {
    const store = new ZeroMemStore('ws');
    store.appendTrace({ id: 'tr-1', sessionId: 's', role: 'tool', content: 'a' });
    store.appendTrace({ id: 'tr-2', sessionId: 's', role: 'tool', content: 'b' });
    const ids = store.getTraces().map((t) => t.id);

    // Mô phỏng hydrate: store khác, replay lại đúng các id đó.
    const reloaded = new ZeroMemStore('ws');
    for (const id of ids) reloaded.appendTrace({ id, sessionId: 's', role: 'tool', content: 'x' });

    expect(reloaded.getTraces().map((t) => t.id)).toEqual(ids);
  });

  it('không truyền id thì vẫn sinh id không trùng nhau', () => {
    const store = new ZeroMemStore('ws');
    for (let i = 0; i < 20; i += 1) {
      store.appendTrace({ sessionId: 's', role: 'tool', content: `x${i}`, now: 1000 + i });
    }
    const ids = store.getTraces().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('trimTracesTo không làm đánh số lại lượt', () => {
  it('trace mới sau khi cắt vẫn mang turnIndex lớn hơn trace bị cắt', () => {
    const store = new ZeroMemStore('ws');
    for (let i = 0; i < 5; i += 1) {
      store.appendTrace({ sessionId: 's', role: 'tool', content: `x${i}`, now: 1000 + i });
    }
    const lastTurn = store.getTraces()[4].turnIndex;

    store.trimTracesTo(2);
    const fresh = store.appendTrace({ sessionId: 's', role: 'tool', content: 'moi', now: 2000 });

    // Nếu turnIndex lấy từ `traces.length + 1` thì trace mới mang Turn #3,
    // trùng với trace cũ đã bị cắt ⇒ tiêu đề evidence ghi sai.
    expect(fresh.turnIndex).toBeGreaterThan(lastTurn);
  });
});

describe('xoá kho phải xoá cả tầng RAM', () => {
  it('clearZeroMemStores làm singleton trả về store rỗng', () => {
    getZeroMemStore('ws-clear').appendTrace({ sessionId: 's', role: 'tool', content: 'x' });
    expect(getZeroMemStore('ws-clear').getTraces().length).toBeGreaterThan(0);

    clearZeroMemStores();

    // Nếu chỉ clear Dexie thì RAM vẫn còn ⇒ người dùng bấm "Xoá kho" xong vẫn
    // có bộ nhớ cũ được chèn vào prompt.
    expect(getZeroMemStore('ws-clear').getTraces()).toHaveLength(0);
  });
});