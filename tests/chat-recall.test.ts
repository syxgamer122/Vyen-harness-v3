import { describe, expect, it, vi } from 'vitest';
import { recallChatSessions } from '@/lib/chat-recall';
import { shouldAutoApprove } from '@/lib/auto-pilot';
import { isToolDenied } from '@/lib/tool-catalog';
import type { ChatSearchResult } from '@/lib/chat-search';
import type { ChatSession } from '@/lib/db';

describe('chat_recall — recallChatSessions integration', () => {
  it('định dạng kết quả và chuyển đổi ngày sang ISO string', async () => {
    const mockSearchResults: ChatSearchResult[] = [
      {
        chat: {
          id: 'session-123',
          title: 'Hội thoại kiểm thử',
          pinned: 0,
          createdAt: 1700000000000,
          updatedAt: 1700000005000,
          workspacePath: '/home/user/app',
        } as ChatSession,
        score: 15,
        snippets: [
          [{ text: 'Đoạn trích ', match: false }, { text: 'khớp từ khoá', match: true }],
        ],
      },
    ];

    const mockSearchFn = vi.fn().mockResolvedValue(mockSearchResults);

    const results = await recallChatSessions('từ khoá', 5, { searchFn: mockSearchFn });

    expect(mockSearchFn).toHaveBeenCalledWith('từ khoá', { signal: undefined });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      sessionId: 'session-123',
      title: 'Hội thoại kiểm thử',
      snippet: 'Đoạn trích khớp từ khoá',
      matchedAt: new Date(1700000005000).toISOString(),
      score: 15,
      workspacePath: '/home/user/app',
    });
  });

  it('fallback snippet về tiêu đề nếu không có snippets trong kết quả', async () => {
    const mockSearchResults: ChatSearchResult[] = [
      {
        chat: {
          id: 'session-no-snippet',
          title: 'Tiêu đề dự phòng',
          pinned: 0,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        } as ChatSession,
        score: 5,
        snippets: [],
      },
    ];

    const results = await recallChatSessions('tiêu đề', 5, {
      searchFn: async () => mockSearchResults,
    });

    expect(results[0].snippet).toBe('Tiêu đề dự phòng');
  });
});

describe('chat_recall — Quyền & Auto-pilot classification', () => {
  it('chat_recall được phân loại là READ_ONLY và tự động duyệt trong smart mode', () => {
    const approved = shouldAutoApprove({
      toolName: 'chat_recall',
      args: { query: 'React' },
      policy: 'smart',
      autoPilotEnabled: true,
    });
    expect(approved).toBe(true);
  });

  it('chat_recall bị chặn khi quyền per-tool là deny', () => {
    const denied = isToolDenied('chat_recall', {
      chat_recall: 'deny',
    });
    expect(denied).toBe(true);
  });

  it('chat_recall bị chặn khi category memory bị deny', () => {
    const denied = isToolDenied('chat_recall', {
      memory: 'deny',
    });
    expect(denied).toBe(true);
  });
});
