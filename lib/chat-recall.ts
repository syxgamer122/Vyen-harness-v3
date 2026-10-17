/**
 * ChatRecall — Tra cứu full-text trên toàn bộ lịch sử trò chuyện (P2-8).
 *
 * Tái sử dụng engine tokenize và foldText (chuẩn tiếng Việt không dấu/có dấu)
 * từ lib/search-utils.ts và searchChats từ lib/chat-search.ts. Pure in-memory
 * matcher (`recallFromMemoryList`) đã bị xoá — không có call site production.
 */

import { searchChats, type ChatSearchResult } from '@/lib/chat-search';

export interface ChatRecallItem {
  sessionId: string;
  title: string;
  snippet: string;
  matchedAt: string;
  score: number;
  workspacePath?: string;
}

export interface ChatRecallOptions {
  limit?: number;
  signal?: AbortSignal;
  searchFn?: (query: string, opts?: { signal?: AbortSignal }) => Promise<ChatSearchResult[]>;
}

/**
 * Tra cứu lịch sử hội thoại từ Dexie qua searchChats.
 * Trả về danh sách tối đa `limit` kết quả phù hợp nhất.
 */
export async function recallChatSessions(
  query: string,
  limit: number = 5,
  options: ChatRecallOptions = {},
): Promise<ChatRecallItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const maxResults = Math.max(1, Math.min(limit, 20));
  const search = options.searchFn ?? searchChats;

  const rawResults = await search(trimmed, { signal: options.signal });
  if (!rawResults || !rawResults.length) return [];

  const items: ChatRecallItem[] = [];

  for (const res of rawResults.slice(0, maxResults)) {
    let snippet = '';
    if (res.snippets && res.snippets.length > 0) {
      snippet = res.snippets[0].map((seg) => seg.text).join('').trim();
    }
    if (!snippet) {
      snippet = res.chat.title;
    }

    const dateMs = res.chat.updatedAt || res.chat.createdAt;
    const matchedAt = new Date(dateMs).toISOString();

    items.push({
      sessionId: res.chat.id,
      title: res.chat.title,
      snippet,
      matchedAt,
      score: res.score,
      ...(res.chat.workspacePath ? { workspacePath: res.chat.workspacePath } : {}),
    });
  }

  return items;
}

