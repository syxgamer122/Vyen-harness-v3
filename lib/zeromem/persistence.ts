/**
 * Persistence cho Zero-Mem — CHỈ chạy ở trình duyệt.
 *
 * Vì sao tách riêng khỏi `lib/zeromem/store.ts`: store phải giữ
 * RUNTIME-AGNOSTIC để còn dùng được ở nơi không có Dexie (tool chain headless
 * trong bridge, test node). Nhét Dexie thẳng vào store sẽ khóa store vào
 * trình duyệt. Đây là adapter mỏng, chỉ được import từ phía app.
 *
 * BA QUY TẮC ĐÃ SỬA (2026-10-16) — trước đây vi phạm cả ba:
 *
 * 1. **Ghi theo lô, không ghi mỗi lần thêm trace.** Bản cũ gọi
 *    `bulkPut(toàn bộ traces)` sau MỖI lần ghi ⇒ lượt thứ N ghi N trace, tổng
 *    O(N²). Nay chỉ ghi khi đã qua `PERSIST_MIN_INTERVAL_MS`, các lần ghi giữa
 *    đánh dấu bẩn và gộp lại. Repo KHÔNG có util debounce ghi chung dùng được
 *    (`use-debounced-value` chỉ trì hoãy giá trị React), nên bộ lịch nằm ở đây.
 *
 * 2. **Có trần.** Trace là append-only nên không có trần thì phình vô hạn và đụng
 *    trần quota của trình duyệt. Bản gốc ghi ra JSONL trên đĩa nên không cần;
 *    IndexedDB thì cần. Số 500 là LỰA CHỌN CỦA TÔI (không có căn cứ trong code) —
 *    mỗi trace của ta là một dòng cô đọng nên 500 trace chỉ vài trăm KB.
 *
 * 3. **Lần ghi bị trì hoãn PHẢI được hẹn lại.** Nếu chỉ "đánh dấu bẩn, thử ở
 *    lượt sau" thì lượt ghi rơi vào cửa sổ 2 giây sẽ không bao giờ chạy nếu
 *    người dùng đóng tab ⇒ mất trace. Nay có `scheduleZeroMemFlush` hẹn đuôi.
 */
import { db } from '@/lib/db';
import type { ZeroMemStore } from './store';

/** Số trace tối đa giữ lại; cái cũ hơn bị xoá khi ghi. */
export const ZEROMEM_TRACE_CAP = 500;

/** Khoảng nghỉ tối thiểu giữa hai lần ghi Dexie (ms). */
export const PERSIST_MIN_INTERVAL_MS = 2_000;

/** Số trace mới nhất đã ghi xuống Dexie — để biết lần ghi sau chỉ ghi phần mới. */
let persistedIds = new Set<string>();
/** Mốc thời gian lần ghi gần nhất (ms). */
let lastPersistAt = 0;
/** Đang có thay đổi chưa ghi. */
let dirty = false;
/** Hẹn đuôi cho lần ghi bị trì hoãn, để không mất khi đóng tab. */
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Chỉ dùng trong test và khi người dùng bấm "Xoá kho": về trạng thái ban đầu. */
export function __resetPersistState(): void {
  persistedIds = new Set<string>();
  lastPersistAt = 0;
  dirty = false;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/** Số trace mà bộ đệm cho rằng đã nằm trong Dexie (test + chẩn đoán). */
export function persistedTraceCount(): number {
  return persistedIds.size;
}

/** Đánh dấu có thay đổi; lần ghi thật sẽ xảy ra khi đủ khoảng nghỉ. */
export function markZeroMemDirty(): void {
  dirty = true;
}

/**
 * Hẹn một lần ghi bù sau khoảng nghỉ. Gọi sau khi `persistZeroMem` đã quyết
 * định hoãn — không có nó thì trace của lượt đó chỉ được ghi khi có lượt kế
 * tiếp, và mất trắng nếu người dùng đóng tab.
 */
export function scheduleZeroMemFlush(store: ZeroMemStore): void {
  if (flushTimer !== null) return; // đã có lần hẹn
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void persistZeroMem(store, { force: true });
  }, PERSIST_MIN_INTERVAL_MS);
  /* `setTimeout` giữ tiến trình Node sống trong test. Ở trình duyệt không sao,
     nhưng để `unref` khi có thì để test không treo. */
  if (typeof (flushTimer as { unref?: () => void }).unref === 'function') {
    (flushTimer as unknown as { unref: () => void }).unref();
  }
}

/**
 * Ghi nhật ký + đồ thị xuống Dexie nếu đã đủ khoảng nghỉ. Gọi sau mỗi lượt;
 * hàm tự quyết có ghi bây giờ hay không.
 *
 * - `force: true` bỏ qua khoảng nghỉ (dùng khi tab ẩn / người dùng bấm lưu).
 * - Ghi DELTA: chỉ `bulkPut` trace chưa có trong `persistedIds`, và xoá trace
 *   ngoài `ZEROMEM_TRACE_CAP`.
 * - Đồ thị chỉ ghi khi có trace MỚI (chỉ thêm trace mới làm đồ thị đổi), và
 *   xoá các dòng Dexie không còn trong đồ thị RAM — nếu không, bảng entity /
 *   relation phình vô hạn theo lịch sử đã bị cắt.
 */
export async function persistZeroMem(
  store: ZeroMemStore,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!dirty && !options.force) return;

  const now = Date.now();
  if (!options.force && now - lastPersistAt < PERSIST_MIN_INTERVAL_MS) {
    // Chưa đủ nghỉ — giữ cờ bẩn và HẸN LẠI, nếu không lượt ghi này rơi vào
    // cửa sổ nghỉ sẽ không bao giờ được ghi.
    scheduleZeroMemFlush(store);
    return;
  }

  const allTraces = [...store.getTraces()];
  // Trần: giữ N trace MỚI NHẤT. Cắt cả trong store (RAM) lẫn khi ghi (Dexie) —
  // nếu chỉ cắt lúc ghi thì store vẫn phình vô hạn trong RAM.
  const keptTraces = allTraces.slice(-ZEROMEM_TRACE_CAP);
  if (keptTraces.length < allTraces.length) {
    store.trimTracesTo(ZEROMEM_TRACE_CAP);
  }

  try {
    // Set id thay vì `Array.includes` (O(n²) khi kho lớn và so sánh tham chiếu).
    const keptIds = new Set(keptTraces.map((t) => t.id));
    const fresh = keptTraces.filter((t) => !persistedIds.has(t.id));
    const staleIds = allTraces.filter((t) => !keptIds.has(t.id)).map((t) => t.id);

    const { entities, relations } = store.getGraph().toJSON();
    // Đồ thị chỉ đổi khi có trace mới: chỉ khi đó mới đọc/ghi bảng entity.
    const graphChanged = fresh.length > 0;

    if (graphChanged) {
      const liveEntityIds = new Set(entities.map((e) => e.id));
      const liveRelationIds = new Set(relations.map((r) => r.id));
      const [deadEntities, deadRelations] = await Promise.all([
        db.zeromemEntities.toCollection().filter((e) => !liveEntityIds.has(e.id)).primaryKeys(),
        db.zeromemRelations.toCollection().filter((r) => !liveRelationIds.has(r.id)).primaryKeys(),
      ]);

      await db.transaction(
        'rw',
        db.zeromemTraces,
        db.zeromemEntities,
        db.zeromemRelations,
        async () => {
          if (fresh.length > 0) await db.zeromemTraces.bulkPut(fresh);
          if (staleIds.length > 0) await db.zeromemTraces.bulkDelete(staleIds);
          await db.zeromemEntities.bulkPut(entities);
          await db.zeromemRelations.bulkPut(relations);
          if (deadEntities.length > 0) await db.zeromemEntities.bulkDelete(deadEntities as string[]);
          if (deadRelations.length > 0) await db.zeromemRelations.bulkDelete(deadRelations as string[]);
        },
      );
    } else {
      await db.zeromemTraces.bulkPut(fresh);
      if (staleIds.length > 0) await db.zeromemTraces.bulkDelete(staleIds);
    }

    for (const t of keptTraces) persistedIds.add(t.id);
    for (const id of staleIds) persistedIds.delete(id);
    lastPersistAt = now;
    dirty = false;
  } catch {
    /* Persistence là tối ưu, không phải đường sống: lỗi ghi đĩa KHÔNG được làm
       hỏng lượt chạy của agent. Giữ cờ bẩn để thử lại ở lượt sau. */
  }
}

/**
 * Nạp lại bộ nhớ từ Dexie khi store đang rỗng (mở lại app, đổi tab).
 *
 * Chỉ REPLAY trace thay vì nạp thẳng đồ thị đã lưu: trích xuất thực thể là hàm
 * thuần deterministic từ nội dung trace, nên replay tái dựng đồ thị y hệt
 * nguồn — đồng thời tránh rủi ro đồ thị lưu bằng schema cũ không khớp code mới.
 */
export async function hydrateZeroMem(store: ZeroMemStore): Promise<void> {
  if (store.getTraces().length > 0) return;
  try {
    const traces = await db.zeromemTraces.orderBy('timestamp').toArray();
    if (traces.length === 0) return;
    for (const t of traces) {
      store.appendTrace({
        /* Giữ NGUYÊN id đã lưu. Không có dòng này, `appendTrace` sinh id mới
           ⇒ id trong RAM lệch id trong Dexie ⇒ lần ghi kế tiếp coi cả kho là
           "chưa ghi" và chép thêm hàng loạt bản trùng (tràn quota IndexedDB). */
        id: t.id,
        sessionId: t.sessionId,
        episodeId: t.episodeId,
        role: t.role,
        content: t.content,
        ...(t.toolName ? { toolName: t.toolName } : {}),
        ...(t.toolArgs ? { toolArgs: t.toolArgs } : {}),
        ...(t.toolResult !== undefined ? { toolResult: t.toolResult } : {}),
        now: t.timestamp,
      });
    }
    /* Dựng persistedIds từ id VỪA replay (giống id trong Dexie), không phải
       từ mảng row: nếu hai nguồn lệch nhau thì mọi lần ghi sau đều chép lại. */
    persistedIds = new Set(store.getTraces().map((t) => t.id));
  } catch {
    /* Hydrate lỗi: chạy tiếp với bộ nhớ rỗng, không chặn người dùng. */
  }
}