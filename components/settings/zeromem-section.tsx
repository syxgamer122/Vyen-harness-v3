'use client';

/**
 * Settings → Bộ nhớ → "Ghi nhớ hoạt động" (Zero-Mem)
 *
 * Đây là đường bộ nhớ THỨ BA trong tab Bộ nhớ, và nó khác hai đường kia ở chỗ:
 * không ai viết, không ai duyệt, không tốn token — nó ghi hoạt động của chính lượt
 * đó (tool nào, file nào, lỗi gì) vào kho cục bộ, rồi truy hồi lại ở lượt sau
 * khi câu hỏi chạm vào đúng thứ đó. Nên nhãn "ghi nhớ hoạt động" chứ không gọi
 * chung là "ghi nhớ".
 *
 * Mặc định TẮT: đây là lựa chọn bảo thủ (PLAN.md §17) — không ghi gì vào
 * IndexedDB của người dùng khi họ chưa bật.
 */

import { useCallback, useEffect, useState } from 'react';
import { Brain, Trash2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { db } from '@/lib/db';
import { ZEROMEM_TRACE_CAP, __resetPersistState } from '@/lib/zeromem/persistence';
import { clearZeroMemStores } from '@/lib/zeromem/tools';

export function ZeroMemSection() {
  const zeromemEnabled = useAppStore((s) => s.settings.zeromemEnabled ?? false);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [traceCount, setTraceCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshCount = useCallback(() => {
    void db.zeromemTraces.count().then(setTraceCount);
  }, []);

  useEffect(refreshCount, [refreshCount, zeromemEnabled]);

  const handleClear = async () => {
    setBusy(true);
    try {
      await db.transaction('rw', db.zeromemTraces, db.zeromemEntities, db.zeromemRelations, async () => {
        await db.zeromemTraces.clear();
        await db.zeromemEntities.clear();
        await db.zeromemRelations.clear();
      });
      /* Xoá TẦNG RAM nữa. Chỉ clear Dexie thì singleton vẫn giữ trace và
         `persistedIds` vẫn giữ id cũ ⇒ bộ nhớ đã "xoá" vẫn được truy hồi và
         chèn vào prompt cho tới khi F5. Đây là lỗi người dùng nhìn thấy được,
         nên phải xoá cả hai tầng cùng lúc. */
      clearZeroMemStores();
      __resetPersistState();
      refreshCount();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-card settings-card-body space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="field-label text-read">Ghi nhớ hoạt động</h4>
          <p className="mt-1 text-meta leading-relaxed text-tertiary">
            Ghi tự động tên công cụ, file và lỗi của mỗi lượt vào máy bạn, để lượt
            sau tra lại được mà <strong className="font-semibold text-primary">không tốn token</strong>{' '}
            nào. Chỉ chèn vào ngữ cảnh khi câu hỏi của bạn chạm vào đúng thứ đã
            từng gặp. Không lưu tin nhắn của bạn.
          </p>
        </div>
        <Brain size={15} aria-hidden="true" className="mt-0.5 flex-shrink-0 text-tertiary" />
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 border border-subtle bg-surface px-3 py-2">
        <span className="text-ui text-primary">
          {zeromemEnabled ? 'Đang bật' : 'Đang tắt'}
        </span>
        <input
          type="checkbox"
          checked={zeromemEnabled}
          onChange={(e) => updateSettings({ zeromemEnabled: e.target.checked })}
          aria-label="Bật ghi nhớ hoạt động"
        />
      </label>

      <div className="flex items-center justify-between gap-2">
        <p className="text-meta text-tertiary">
          {traceCount === null
            ? 'Đang đếm…'
            : `${traceCount} bản ghi · giữ tối đa ${ZEROMEM_TRACE_CAP}`}
        </p>
        <button
          type="button"
          onClick={() => void handleClear()}
          disabled={busy || traceCount === 0}
          className="flex items-center gap-1.5 px-2 py-1 text-ui text-tertiary transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
        >
          <Trash2 size={13} aria-hidden="true" />
          Xoá kho
        </button>
      </div>
    </div>
  );
}