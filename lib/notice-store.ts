'use client';

import { useSyncExternalStore } from 'react';

/**
 * Notice nằm ở leaf: component nào cần báo người dùng gọi showNotice() mà
 * KHÔNG kéo re-render ChatInterface (trước đây setState ở component 4.8k dòng
 * nghĩa là một toast = re-render toàn bộ cây, kể cả khi đang stream).
 *
 * HÀNG ĐỢI, không phải một ô duy nhất: trước đây `showNotice` ghi đè `message`,
 * nên hai lỗi liên tiếp thì lỗi thứ nhất bị xoá chưa kịp đọc. Ở đây lỗi
 * "khoá API hỏng" (8 giây, kênh thông báo DUY NHẤT) là ví dụ đau nhất: mất
 * trắng ngay khi lỗi ngay sau nó đến. Nay thông báo đang hiện giữ nguyên đủ
 * thời gian của nó rồi thông báo kế tiếp mới lên.
 */
interface Notice {
  text: string;
  duration: number;
}

/** Trần hàng chờ — một đợt ghi hàng loạt file (xem call site trong
 *  `applyStagedFiles`) có thể đẩy hàng chục thông báo lỗi cùng lúc; không có
 *  trần thì người dùng phải ngồi đọc nốt 40 giây toast cũ. */
const MAX_PENDING = 5;

let current: Notice | null = null;
let pending: Notice[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function stopTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Thông báo đang hiện hết giờ (hoặc bị đóng) → lấy kế tiếp trong hàng. */
function advance() {
  stopTimer();
  current = pending.shift() ?? null;
  emit();
  if (current) timer = setTimeout(advance, current.duration);
}

export function showNotice(text: string, duration = 4000) {
  /*
   * Cùng một câu lặp lại (một handler bị gọi nhiều lần trong một lượt) thì bỏ
   * qua: xếp thêm chỉ tạo ra backlog toàn bộ là bản sao của câu đang hiện.
   */
  if (current?.text === text || pending.some((n) => n.text === text)) return;

  if (current) {
    /* Hàng đầy thì BỎ bản mới, không bỏ bản cũ: hàng là FIFO, thứ tự đọc là
       thứ tong đến. */
    if (pending.length < MAX_PENDING) pending.push({ text, duration });
    return;
  }
  current = { text, duration };
  emit();
  timer = setTimeout(advance, duration);
}

/**
 * Đóng thông báo đang hiện. Hàng CHẠY TIẾP chứ không bị xoá — người dùng bấm
 * "Đóng" trên lỗi thứ nhất vẫn phải được đọc lỗi thứ hai.
 */
export function clearNotice() {
  if (!current) return;
  advance();
}

/**
 * Bỏ trắng hàng chờ — dùng khi host của toast unmount, tức kênh thông báo đã
 * đóng. `clearNotice` không làm được việc này vì giờ nó chạy tiếp hàng chứ
 * không xoá: để lỗi cũ nhảy lại ở phiên sau là sai.
 */
export function resetNotices() {
  stopTimer();
  pending = [];
  current = null;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useNotice(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current?.text ?? null,
    () => null,
  );
}