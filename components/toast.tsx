'use client';

/*
 * Toast thông báo. `chat-interface` vốn có state `notice` + `showNotice()` gọi
 * ở ~10 chỗ (tệp quá lớn, stream gián đoạn, lỗi chuyển nhánh…) nhưng chưa bao
 * giờ được render — mọi thông báo lỗi đều bị mất. Component này lấp chỗ đó.
 *
 * Nguồn notice giờ là lib/notice-store (leaf store): ToastHost tự subscribe, ChatInterface
 * chỉ import showNotice() để gọi — một toast không còn re-render cây chat.
 */
import { Z_CLASS } from '@/lib/ui-z';
import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { clearNotice, resetNotices, useNotice } from '@/lib/notice-store';

interface ToastProps {
  message: string | null;
  onClose: () => void;
}

export function Toast({ message, onClose }: ToastProps) {
  /*
   * Vùng live PHẢI có mặt trong DOM từ trước rồi mới đổi nội dung bên trong:
   * trình đọc màn hình chỉ thông báo cho THAY ĐỔI trong một vùng `aria-live`
   * đã tồn tại. `if (!message) return null` trước đây sinh node và xoá nó
   * CÙNG lúc với nội dung, nên không tồn tại thay đổi nào để thông báo — toast
   * im lặng với screen reader. Vì vậy chỉ thẻ bên trong là có điều kiện.
   */
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 bottom-[calc(7rem+env(safe-area-inset-bottom))] ${Z_CLASS.toast} flex justify-center px-4`}
    >
      {message && (
        <div className="pointer-events-auto flex max-w-md items-start gap-2.5 lift-lg rounded-xl border border-warning/40 bg-panel-bg p-3.5 text-xs font-sans text-text-primary animate-slide-up">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-status-warning" />
          <p className="min-w-0 flex-1">{message}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng thông báo"
            className="-mr-1 -mt-0.5 flex-shrink-0 rounded-lg p-1 text-status-warning transition-colors hover:bg-warning/10"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export function ToastHost() {
  const notice = useNotice();

  /*
   * Unmount = chủ mưu của kênh thông báo đã đóng; thả toàn bộ hàng chờ để vào
   * phiên sau nó không nhảy lại những lỗi cũ. `clearNotice` không làm được
   * việc này vì giờ nó chạy tiếp hàng chứ không xoá.
   */
  useEffect(() => {
    return () => resetNotices();
  }, []);

  return <Toast message={notice} onClose={clearNotice} />;
}
