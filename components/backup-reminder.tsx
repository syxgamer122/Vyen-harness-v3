'use client';

import { useCallback, useEffect, useState } from 'react';
import { HardDriveDownload, X } from 'lucide-react';
import {
  backupNow,
  shouldShowReminder,
  snoozeBackupReminder,
  trySilentAutoBackup,
} from '@/lib/auto-backup';

/**
 * Số ngày "Để sau" giấu banner.
 *
 * Việc bỏ qua ĐÃ được ghi xuống localStorage (`vyen-backup-snoozed-at` qua
 * `snoozeBackupReminder`) và sống sót qua reload — nhưng khoản thời gian đó
 * trước đây chỉ nằm trong tham số mặc định của hàm, không ai đọc được. Nút
 * "Để sau" trông như tắt hẳn, thực tế là quay lại sau một ngày.
 *
 * Giữ nguyên 1 ngày: đây là cảnh báo mất dữ liệu thật, và chu kỳ sao lưu mặc
 * định là 7 ngày nên nhắc nhiều lần trước khi dữ liệu gặp rủi ro là đúng.
 * Sửa là CHỌN lại con số này và đồng bộ với dòng chữ bên dưới.
 */
const SNOOZE_DAYS = 1;

/**
 * Hiện banner nhắc sao lưu khi đến kỳ. Nếu người dùng đã cấu hình thư mục
 * tự động (desktop), việc ghi file chạy ngầm ngay khi mở app — banner chỉ
 * xuất hiện khi không ghi được.
 */
export function BackupReminder({ chatCount }: { chatCount: number }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setVisible(chatCount > 0 && shouldShowReminder());
  }, [chatCount]);

  useEffect(() => {
    let cancelled = false;
    // Cố gắng backup ngầm vào thư mục đã chọn trước khi quyết định hiện banner.
    void trySilentAutoBackup().then((done) => {
      if (cancelled) return;
      if (done) setVisible(false);
      else refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (!visible) return null;

  /** Ẩn banner và ghi mốc hết hạn — chỉ chạy khi người dùng BẤM, không chạy mỗi render. */
  const dismiss = () => {
    snoozeBackupReminder(SNOOZE_DAYS);
    setVisible(false);
  };

  const handleBackup = async () => {
    setBusy(true);
    try {
      const result = await backupNow('prefer-folder');
      if (result.ok) setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  /*
   * MỘT hàng, không phải khối 130px. Bản cũ chừa chỗ cho tiêu đề hai dòng, hai
   * nút chồng nhau rồi tới dòng giải thích hạn — bốn tầng thông tin cho MỘT
   * việc. Nay gộp: dòng đầu để chữ tự cắt ở mọi bề rộng, hạn của "Để sau" nằm
   * trong `title` (vẫn đọc được, không còn chiếm hàng vĩnh viễn).
   *
   * KHÔNG dùng recipe `notice-warn` nữa: nó tô nền cả khối, khiến một dòng cảnh
   * báo nặng hơn cả tiêu đề nhóm ngày. Cảnh báo này chỉ là gợi nhớ, nên đi
   * bằng màu chữ `warning` + icon trên nền trong, đúng vai "chữ đọc".
   *
   * Đường kẻ `border-t` là ranh giới giữa vùng điều khiển và vùng lịch sử:
   * nút "Cuộc trò chuyện mới", dòng cảnh báo này và ô tìm kiếm từng dính thành
   * MỘT mảng mờ vì cả ba đều nền trong trên nền `bg-sunken`. Một đường kẻ
   * tách chúng ra mà không thêm khối mới.
   */
  return (
    <div role="status" className="mx-2 mt-2 border-t border-subtle px-2 pb-2 pt-2">
      <div className="flex items-center gap-2">
        <HardDriveDownload
          size={14}
          aria-hidden="true"
          className="flex-shrink-0 text-status-warning"
        />
        <p
          className="min-w-0 flex-1 truncate text-meta text-secondary"
          title="Đã lâu chưa sao lưu dữ liệu. Chat đang lưu trên thiết bị này thôi."
        >
          Chưa sao lưu chat
        </p>
        <button
          type="button"
          onClick={handleBackup}
          disabled={busy}
          className="flex-shrink-0 rounded-md px-2 py-1 text-meta font-medium text-status-warning transition-colors duration-150 hover:bg-warning/10 disabled:opacity-50"
        >
          {busy ? 'Đang sao lưu…' : 'Sao lưu ngay'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          title={`Để sau chỉ ẩn thông báo này. Sau ${SNOOZE_DAYS} ngày chưa sao lưu thì nó hiện lại.`}
          className="flex-shrink-0 rounded-md px-2 py-1 text-meta text-tertiary transition-colors duration-150 hover:bg-raised hover:text-secondary"
        >
          Để sau
        </button>
        <button
          type="button"
          aria-label="Đóng nhắc nhở"
          onClick={dismiss}
          title={`Để sau chỉ ẩn thông báo này. Sau ${SNOOZE_DAYS} ngày chưa sao lưu thì nó hiện lại.`}
          className="-mr-1 flex-shrink-0 rounded-md p-1 text-tertiary transition-colors duration-150 hover:bg-raised hover:text-secondary"
        >
          <X size={13} />
        </button>
      </div>
      <p className="mt-1 pl-6 text-meta text-text-muted">
        Để sau chỉ ẩn thông báo này. Sau {SNOOZE_DAYS} ngày chưa sao lưu thì nó hiện lại.
      </p>
    </div>
  );
}
