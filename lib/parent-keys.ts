/**
 * Khoá parent của cây hội thoại — hằng thuần và hai hàm chuẩn hoá.
 *
 * Vì sao tách khỏi `lib/db.ts`: cả ba thứ này **không chạm IndexedDB**, nhưng
 * nằm trong file import Dexie ở dòng 1. Bất kỳ file nào chỉ cần `ROOT_KEY` để
 * kiểm tra cây hội thoại cũng bị kéo cả Dexie vào — tức không chạy được trên
 * Node, dù nó **hoàn toàn** không I/O. Đó là phụ thuộc oan, và cùng dạng với
 * lỗi C1 mà review độc lập bắt ở tầng quét API: đồ thị trông đúng nhưng
 * sai về thực tế chạy.
 *
 * `lib/db.ts` KHÔNG re-export từ đây. Re-export trông tiện hơn nhưng giữ nguyên
 * cái bẫy: import từ `@/lib/db` vẫn kéo Dexie, chỉ là che đi chỗ nó xuất hiện.
 *
 * Xem bảng kiểm kê: docs/cli-migration-inventory.md
 */

/**
 * IndexedDB KHÔNG index được `null`. Message gốc phải mang sentinel này,
 * nếu không sẽ biến mất khỏi [chatId+parentId] và làm sập cấp phát branchOrder.
 * `null` chỉ tồn tại ở tầng domain; DB luôn thấy string.
 */
export const ROOT_KEY = '__ROOT__';

export function toParentKey(parentId: string | null | undefined): string {
  return parentId == null || parentId === ROOT_KEY ? ROOT_KEY : parentId;
}

export function fromParentKey(key: string | null | undefined): string | null {
  return key == null || key === ROOT_KEY ? null : key;
}
