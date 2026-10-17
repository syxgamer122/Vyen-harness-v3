'use client';

/**
 * StorageQuotaMeter — Giám sát dung lượng IndexedDB & trạng thái Storage Persistence.
 */

import { useState, useEffect } from 'react';
import { HardDrive, ShieldCheck, AlertCircle, RefreshCw, Database } from 'lucide-react';

export function StorageQuotaMeter() {
  const [usage, setUsage] = useState<number>(0);
  const [quota, setQuota] = useState<number>(0);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const checkStorage = async () => {
    if (typeof navigator === 'undefined' || !navigator.storage) return;

    setLoading(true);
    try {
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        setUsage(est.usage ?? 0);
        setQuota(est.quota ?? 0);
      }

      if (navigator.storage.persisted) {
        const isPersisted = await navigator.storage.persisted();
        setPersisted(isPersisted);
      }
    } catch (err) {
      console.error('Storage quota check failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPersist = async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    try {
      const granted = await navigator.storage.persist();
      setPersisted(granted);
    } catch (err) {
      console.error('Request storage persistence failed:', err);
    }
  };

  useEffect(() => {
    checkStorage();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    /* Kẹp chỉ số vào mảng: quota thật có thể vượt 1TB, khi đó `i = 4`
       làm `sizes[4]` là undefined và UI hiện chuỗi "1234.5 undefined". */
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const percentage = quota > 0 ? Math.min(100, Math.round((usage / quota) * 100)) : 0;
  const isHigh = percentage >= 70;
  const isCritical = percentage >= 90 || persisted === false;

  return (
    <div className="border border-subtle bg-raised p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <HardDrive size={14} className="text-info" />
          <h4 className="text-ui font-semibold text-primary">Dung Lượng Bộ Nhớ &amp; Độ Bền Vững (Storage Quota)</h4>
        </div>
        <button
          type="button"
          onClick={checkStorage}
          className="rounded p-1 text-tertiary transition-colors hover:bg-surface hover:text-primary"
          aria-label="Kiểm tra lại dung lượng"
          title="Kiểm tra lại dung lượng"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-2 mt-2">
        <div className="flex items-center justify-between text-meta">
          <span className="text-tertiary flex items-center gap-1.5">
            <Database size={12} aria-hidden="true" /> Đã dùng: {formatBytes(usage)} / {formatBytes(quota)}
          </span>
          <span className="font-sans text-primary">{percentage}%</span>
        </div>

        {/*
         * Thang đo — có `role="progressbar"` và bốn giá trị `aria-*`.
         *
         * Vì sao cần khi số liệu đã có sẵn bằng chữ ngay bên trên: con số
         * "12%" là CHỮ, còn thanh là HÌNH. Người đọc bằng mắt thấy thanh đầy
         * một phần tư là hiểu; trình đọc màn hình chỉ đọc được con số, và thanh
         * không nói gì về nó. `role="progressbar"` biến thanh thành một vùng có
         * nghĩa thay vì một ô trang trí.
         *
         * `aria-valuenow` là con số ĐÃ LÀM TRÒN mà mắt cũng thấy, nên hai đường
         * đọc không lệch nhau.
         */}
        <div
          role="progressbar"
          aria-label="Dung lượng đã dùng"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          className="w-full h-1.5 bg-surface rounded-full overflow-hidden border border-subtle"
        >
          <div
            className={`h-full transition-all duration-300 ${
              isCritical ? 'bg-danger' : isHigh ? 'bg-warning' : 'bg-success'
            }`}
            /*
             * 0% thì RỘNG 0, không phải 2%.
             *
             * Trước đây là `Math.max(2, percentage)`: khi `percentage === 0` —
             * hoặc vì chưa dùng gì, hoặc vì `navigator.storage.estimate()` không
             * trả quota (`percentage = 0` ở trên) — thanh vẫn hiện một vệt xanh
             * 2%. Nghĩa là thanh khẳng định có dữ liệu khi không có, và vệt đó là
             * đúng màu "bình thường" nên mắt không nghi ngờ gì.
             */
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Persistence Status */}
        <div className="flex items-center justify-between pt-1 text-meta">
          <div className="flex items-center gap-1.5">
            {persisted ? (
              <span className="text-success flex items-center gap-1">
                <ShieldCheck size={12} aria-hidden="true" /> Bảo vệ chống browser eviction: ĐÃ BẬT
              </span>
            ) : (
              <span className="text-warning flex items-center gap-1">
                <AlertCircle size={12} aria-hidden="true" /> Chưa được cấp quyền bảo vệ vĩnh viễn
              </span>
            )}
          </div>

          {!persisted && (
            <button
              type="button"
              onClick={handleRequestPersist}
              className="text-micro text-primary hover:underline font-medium"
            >
              Yêu cầu bảo vệ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
