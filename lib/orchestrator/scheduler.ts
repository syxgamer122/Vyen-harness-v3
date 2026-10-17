/**
 * Pool giới hạn đồng thời — phần duy nhất của vectorbt chúng ta GIỮ NGUYÊN
 * hình dạng nhưng đổi engine.
 *
 * Ở vectorbt, "chạy tất cả cùng lúc" nghĩa là MỘT phép toán NumPy trên mọi
 * cột: không có khái niệm concurrency vì CPU làm hết trong một pass. Sang
 * Vyen, mỗi cột = MỘT request mạng đến LLM gateway, nên "một pass" dịch thành
 * **một pass có giới hạn đồng thời**:
 *   - Đủ rộng để tận dụng song song (mặc định 3).
 *   - Đủ hẹp để không đánh sập gateway free có ngân sách chung.
 *   - Huỷ được (AbortSignal) và KHÔNG BAO GIỜ mất kết quả đã xong.
 *
 * Hợp đồng quan trọng nhất: **thứ tự đầu ra khớp thứ tự đầu vào** (`results[i]`
 * tương ứng `items[i]`) — giống như mảng cột của vectorbt luôn giữ nguyên thứ
 * tự cấu hình bất kể thứ tự hoàn thành. Không có dependency nào ở đây.
 */

export type PoolOutcome<R> =
  | { ok: true; value: R }
  | { ok: false; error: string; aborted: boolean };

export interface PoolOptions<T, R> {
  items: readonly T[];
  /** Số worker chạy cùng lúc. Bị kẹp vào [1, items.length]. */
  limit: number;
  worker: (item: T, index: number) => Promise<R>;
  /** Huỷ: item CHƯA BẮT ĐẦU sẽ không chạy nữa. Item đang chạy tự dừng nếu
   *  `worker` tự truyền signal xuống fetch. */
  signal?: AbortSignal;
}

function messageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 300) : 'Lỗi không xác định';
}

/**
 * Chạy `worker` trên mọi item với tối đa `limit` lượt đồng thời.
 * KHÔNG reject — mọi lỗi bị gom vào `PoolOutcome` để caller quyết định
 * (đúng pattern của `Promise.allSettled`, nhưng có abort và có giới hạn).
 */
export async function runPool<T, R>({
  items,
  limit,
  worker,
  signal,
}: PoolOptions<T, R>): Promise<Array<PoolOutcome<R>>> {
  const total = items.length;
  const results = new Array<PoolOutcome<R>>(total);
  if (total === 0) return results;

  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, total));
  const aborted = () => signal?.aborted === true;

  let cursor = 0;

  async function lane(): Promise<void> {
    for (;;) {
      if (aborted()) return;
      const i = cursor++;
      if (i >= total) return;

      let outcome: PoolOutcome<R>;
      try {
        outcome = { ok: true, value: await worker(items[i], i) };
      } catch (err) {
        outcome = aborted()
          ? { ok: false, aborted: true, error: 'Đã huỷ' }
          : { ok: false, aborted: false, error: messageOf(err) };
      }

      results[i] = outcome;
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => lane()));

  /* Item chưa kịp chạy (bị huỷ, hoặc làn thoát sớm) vẫn phải có kết quả để
     index không bao giờ bị hổng — giữ bất biến results.length === total. */
  for (let i = 0; i < total; i++) {
    if (!results[i]) results[i] = { ok: false, aborted: true, error: 'Đã huỷ' };
  }

  return results;
}

