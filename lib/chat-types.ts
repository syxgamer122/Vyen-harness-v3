/**
 * Domain types dùng chung cho UI layer.
 * Schema persist thật (ChatSession, StoredMessage...) nằm ở lib/db.ts —
 * đây chỉ là loại trạng thái của tầng hiển thị.
 */

export type MessageStatus =
  | "pending"
  | "streaming"
  | "complete"
  | "aborted"
  | "error";
