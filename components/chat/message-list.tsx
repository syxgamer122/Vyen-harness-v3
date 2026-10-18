/*
 * Danh sách tin nhắn virtualized + các chiến lược scroll/pin.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from 'ai/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import { ChatErrorBoundary } from '@/components/chat-error-boundary';
import { VyenLogo } from '@/components/vyen-logo';
import { MessageItem, type BranchInfo, type RunPosition } from './message-item';
import { TurnHeader } from './turn-header';
import { foldedRowIds, groupTurns, isFoldableTurn, turnRowsOf, type TurnSummary } from '@/lib/turns';

/**
 * Trường mà `toChatMessage` gắn thêm cho tầng hiển thị (lib/chat-tree-persistence.ts).
 * Đọc qua đúng một chỗ để không rải `as any` khắp file — và để khi thêm trường
 * mới thì chỉ phải sửa một khai báo.
 */
interface MessageExtras {
  turnId?: string;
  status?: string;
  finishReason?: string;
  createdAtMs?: number;
  toolInvocations?: Array<{ state?: string; args?: unknown }>;
}

const extrasOf = (message: Message): MessageExtras => message as unknown as MessageExtras;

/* ------------------------------------------------------------------ */
/* Subcomponent 2: Memoized MessageList with Virtualization           */
/* ------------------------------------------------------------------ */

/**
 * Bounded LRU cache cho chiều cao dòng theo `${chatId}:${messageId}:${widthBucket}`.
 * Tự động giới hạn trần 2.000 bản ghi, chống rò rỉ bộ nhớ qua các phiên dài.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly maxSize: number = 2000) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  get size(): number {
    return this.map.size;
  }
}

export function getWidthBucket(width?: number): number {
  if (!width || width <= 0) return 800;
  return Math.round(width / 50) * 50;
}

/**
 * Có hiện nút "cuộn xuống tin nhắn mới nhất" không.
 *
 * `isAtBottom` là cờ DÙNG CHUNG cho cả phiên: nó chỉ được set lại trong
 * `setStick` của `useStickToBottom`, mà mọi đường ghim đều cần có tin nhắn. Màn
 * trống không có gì để ghim nên không có scroll event nào set lại cờ — cuộn lên
 * giữa một chat dài rồi bấm sang chat mới là cờ `false` mang sang màn trống, và
 * nút hiện lên trên màn hình không có gì để cuộn tới.
 *
 * Vì vậy điều kiện phải hỏi TIN NHẮN, không hỏi cờ. Không reset cờ: grep xác
 * nhận nó chỉ có một chỗ tiêu thụ chính là chỗ render nút này, nên chặn ở đây
 * là hết.
 */
export function showJumpToLatest(hasMessages: boolean, isAtBottom: boolean): boolean {
  return hasMessages && !isAtBottom;
}

/** Cache chiều cao thật theo chatId:messageId:widthBucket — sống qua unmount/đổi chat. */
const HEIGHT_CACHE = new LruCache<string, number>(2000);
const cacheKey = (chatId: string, id: string, widthBucket: number) =>
  `${chatId}:${id}:${widthBucket}`;

/** Ước lượng sát thực tế cho hàng chưa từng render. */
function estimateMessageHeight(m: Message): number {  const text = m.content ?? '';
  const newlines = text.match(/\n/g)?.length ?? 0;
  const wrapped = Math.ceil(text.length / 68);
  let h = 64 + Math.max(newlines, wrapped) * 26;

  h += Math.floor((text.match(/```/g)?.length ?? 0) / 2) * 150;  // code block
  h += Math.floor((text.match(/\$\$/g)?.length ?? 0) / 2) * 58;  // math block
  h += (text.match(/\\\[/g)?.length ?? 0) * 58;                  // \[...\]
  h += (text.match(/^\|/gm)?.length ?? 0) * 14;                  // dòng bảng
  if (m.experimental_attachments?.length) h += 210;

  return Math.min(Math.max(h, 72), 8000);
}

/** Lỗi từ API về dạng JSON thô (`{"error":...}`) → rút ra câu thông báo. */
function friendlyErrorMessage(raw?: string): string {
  if (!raw) return 'Đã xảy ra lỗi.';
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const text = [parsed.error, parsed.message].find((v) => typeof v === 'string') as
      | string
      | undefined;
    return text || raw;
  } catch {
    return raw;
  }
}

/** Một trường hỏng, đã rút gọn thành hai mảnh để dựng dòng hiển thị. */
export interface ErrorIssue {
  /** Đường dẫn trong payload, ví dụ `messages.1.toolInvocations`. Rỗng = lỗi ở gốc. */
  path: string;
  /** Lý do, nguyên văn từ validator. */
  reason: string;
}

/**
 * Số issue tối đa hiện ra. Cùng trần với `formatRecipeIssues`
 * (`lib/recipes/schema.ts:221`) — bên ngoài số này người dùng không đọc nổi,
 * và một payload hỏng nặng có thể có hàng chục issue giống nhau.
 */
const MAX_ERROR_ISSUES = 5;

/** Đủ hình dạng để đọc `path`/`message` — không tin vào `details` của wire. */
interface WireIssue {
  path?: unknown;
  message?: unknown;
}

function isWireIssue(value: unknown): value is WireIssue {
  return typeof value === 'object' && value !== null;
}

/**
 * Rút trường hỏng từ payload lỗi của API.
 *
 * `jsonError` (`app/api/chat/route.ts:171`) trả `{ error, code, requestId, …extra }`;
 * với BAD_SCHEMA nó truyền thêm `details: parsed.error.issues` — mảng zod thô,
 * shape `{ code, message, path }`. Nhưng client nhận nguyên body dưới dạng CHUỖI
 * JSON trong `err.message` (`react/use-chat-orchestration.ts`), không phải object,
 * nên phải parse phòng thủ.
 *
 * Không có `details` (rate limit, 500, mạng rớt) thì trả mảng rỗng và banner vẫn
 * hiện câu chung như trước — hàm này chỉ bổ sung thông tin, không thay nó.
 */
export function parseErrorIssues(raw?: string): ErrorIssue[] {
  if (!raw) return [];
  let parsed: { details?: unknown };
  try {
    parsed = JSON.parse(raw) as { details?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.details)) return [];
  return parsed.details
    .filter(isWireIssue)
    .slice(0, MAX_ERROR_ISSUES)
    .map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : '',
      reason: typeof issue.message === 'string' ? issue.message : '',
    }))
    .filter((issue) => issue.reason !== '');
}

/**
 * Hàng "AI đang xử lý" — hiện giữa lúc chờ token đầu tiên (user vừa gửi,
 * hoặc regenerate chưa nhả chữ). Chấm nảy + số giây đã chờ để người dùng biết
 * hệ thống còn hoạt động, không phải treo.
 *
 * Tông màu theo độ chờ (mượn ý UI): <10s bình thường, 10-30s chờ
 * dài (vàng), >30s đỏ kèm chú thích. Model suy luận nặng từng đo TTFT tới
 * 60s nên đỏ không có nghĩa là lỗi, chỉ là "còn chờ hơi lâu".
 *
 * KHÔNG mở đầu bằng ký tự `$` (gỡ 2026-10-18). Sáu panel khác vẫn dùng `$`
 * làm nhãn mở đầu theo motif terminal (xem `tools-panel.tsx`,
 * `plan-panel.tsx`…), nhưng hàng này nằm trong `role="status"` — trình đọc
 * màn hình đọc thành *"dollar, đang soạn câu trả lời"*. Đó là văn bản KHÔNG
 * mang nghĩa lọt vào phần người dùng nghe bằng mắt: ký tự trang trí đứng
 * trong vùng được công bố. Số giây đã đủ để chứng minh "còn sống", thêm dấu
 * nhắc terminal chỉ làm rối.
 */
function ThinkingIndicator() {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    setElapsedSec(0);
    // 100ms cho số lẻ 12.3s: con số chạy thấy được tự nó là tín hiệu "còn sống".
    const timer = setInterval(() => {
      setElapsedSec((Date.now() - startedAt) / 1000);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const slowTone = elapsedSec >= 30;
  const tone = slowTone
    ? 'text-status-error'
    : elapsedSec >= 10
      ? 'text-status-warning'
      : 'text-text-muted';

  return (
    <div className="mx-auto flex max-w-thread items-start gap-3 py-3">
      <p className="flex min-w-0 items-baseline gap-2 py-1 font-sans text-xs" role="status">
        <span className="text-text-primary">đang soạn câu trả lời</span>
        <span className={`tabular-nums ${tone}`}>{elapsedSec >= 1 ? `${elapsedSec.toFixed(1)}s` : ''}</span>
        {slowTone && (
          <span className="text-status-error">model nặng có thể chờ 30-60s</span>
        )}
        <span className="terminal-cursor" aria-hidden="true" />
      </p>
    </div>
  );
}

interface MessageListProps {
  chatId: string;
  messages: Message[];

  branchInfoByMessageId: Map<
    string,
    BranchInfo
  >;

  isLoading: boolean;
  lastMessageId?: string;
  editingId: string | null;
  copiedId: string | null;
  draft: string;
  isTouchDevice: boolean;
  sendOnEnter: boolean;
  throttleMs: number;
  error?: Error;
  isAtBottom: boolean;
  isAtBottomRef: React.MutableRefObject<boolean>;
  pin: (durationMs?: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;

  onScroll: () => void;
  onScrollToBottom: () => void;
  onCopy: (m: Message) => void;
  onRegenerate: (id: string) => void;

  onSwitchBranch: (
    messageId: string,
    direction: 'previous' | 'next',
  ) => void;

  onStartEdit: (m: Message) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onDraftChange: (text: string) => void;
  onSelectSuggestion: (prompt: string) => void;
  /** Chưa có model nào để chạy (BYOK — không có catalog built-in). */
  hasModels: boolean;
  /** Mở Cài đặt → tab Model & Nhà cung cấp. */
  onAddProvider: () => void;
  onReload: () => void;
  onContinueGenerating?: () => void;

  /** Marker nén hội thoại — banner gắn vào tin ĐẦU TIÊN sau ranh giới. */
  compaction?: {
    upToId: string;
    summary: string;
    compactedCount: number;
  } | null;
}

export const MessageList = memo(function MessageList({
  chatId,
  messages,
  branchInfoByMessageId,
  isLoading,
  lastMessageId,
  editingId,
  copiedId,
  draft,
  isTouchDevice,
  sendOnEnter,
  throttleMs,
  error,
  isAtBottom,
  isAtBottomRef,
  pin,
  scrollRef,
  onScroll,
  onScrollToBottom,
  onCopy,
  onRegenerate,
  onSwitchBranch,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDraftChange,
  onSelectSuggestion,
  hasModels,
  onAddProvider,
  onReload,
  onContinueGenerating,
  compaction,
}: MessageListProps) {
  const lastMsg = messages[messages.length - 1];
  const lastRole = lastMsg?.role;
  const lastContentLen = lastMsg?.content?.length ?? 0;
  const hasToolInvocations = Boolean((lastMsg as any)?.toolInvocations && (lastMsg as any).toolInvocations.length > 0);

  /**
   * Đang chờ token đầu tiên mà tin nhắn assistant cuối vẫn rỗng: hàng rỗng
   * (avatar + caret nháy trên bong bóng trống) bị ẩn, ThinkingIndicator đại
   * diện — nếu không sẽ có 2 avatar Vyen cùng lúc cho 1 câu trả lời. Ký tự
   * đầu tiên tới → hàng hiện lại và indicator tự ẩn (caret tiếp quản).
   */
  const pendingEmptyAssistant =
    isLoading && lastRole === 'assistant' && lastContentLen === 0 && !(lastMsg as any)?.reasoning && !hasToolInvocations;

  /**
   * P2.1: Tin nhắn assistant đang stream (đã có nội dung hoặc reasoning)
   * được tách khỏi virtualizer để render ở sticky footer container bên dưới,
   * triệt tiêu hoàn toàn đo đạc giật lag (measurement thrashing) trên từng token.
   */
  const isStreamingAssistant =
    isLoading && lastRole === 'assistant' && (Boolean((lastMsg as any)?.reasoning) || lastContentLen > 0 || hasToolInvocations);

  const visibleMessages = useMemo(() => {
    if (pendingEmptyAssistant || isStreamingAssistant) {
      return messages.slice(0, -1);
    }
    return messages;
  }, [messages, pendingEmptyAssistant, isStreamingAssistant]);

  /*
   * LƯỢT CỦA TIN NHẮN — gom MỘT chỗ (§15.1 chốt trước), ở đây vì đây là nơi có đủ
   * danh sách đang đọc. Mọi màn hình khác cần biết lượt đều gọi `groupTurns` với
   * cùng dữ liệu, không tự gom lại.
   *
   * `messages` (không phải `visibleMessages`): tổng kết của lượt phải phản ánh cả
   * tin ĐANG STREAM nằm ngoài virtualizer — nếu tính trên `visibleMessages` thì đúng
   * lúc agent đang làm việc, header lại báo trạng thái cũ.
   */
  const turns = useMemo(() => {
    const createdAtById = new Map<string, number>();
    const toolArgsById = new Map<string, ReadonlyArray<unknown>>();

    for (const message of messages) {
      const extras = extrasOf(message);
      if (typeof extras.createdAtMs === 'number') createdAtById.set(message.id, extras.createdAtMs);
      if (extras.toolInvocations?.length) {
        toolArgsById.set(
          message.id,
          extras.toolInvocations.map((invocation) => invocation.args),
        );
      }
    }

    return groupTurns(
      /*
       * Row dựng bằng `turnRowsOf`, không tự ghép từng trường ở đây: bản đầu của
       * chỗ này tự map và bỏ sót `content`, làm MỌI header mất tên việc (rơi về
       * "Lượt chưa có yêu cầu") mà không có lỗi biên dịch nào.
       */
      turnRowsOf(messages, extrasOf),
      {
        createdAtOf: (id) => createdAtById.get(id) ?? null,
        toolArgsOf: (id) => toolArgsById.get(id) ?? [],
      },
    );
  }, [messages]);

  const turnStartByMessageId = useMemo(() => {
    const starts = new Map<string, TurnSummary>();
    for (const turn of turns) {
      const first = turn.messageIds[0];
      if (first) starts.set(first, turn);
    }
    return starts;
  }, [turns]);

  /*
   * GẬP THÂN LƯỢT — trạng thái ĐỌC, không phải dữ liệu của lượt (§15.1 điểm 3).
   *
   * Vì sao không ghi xuống DB: gập là cách đọc lịch sử, không phải thứ người dùng
   * giao cho agent. Ghi vào DB thì một lần bấm chuột của hôm nay sẽ ẩn nội dung ở
   * mọi phiên sau, trên mọi thiết bị — và không ai nhớ vì sao nó ẩn.
   */
  const [collapsedTurnIds, setCollapsedTurnIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const hiddenRowIds = useMemo(
    () => foldedRowIds(turns, collapsedTurnIds),
    [turns, collapsedTurnIds],
  );

  /*
   * `renderedMessages` — danh sách THẬT SỰ vẽ: đã bỏ tin của lượt đang gập, và đã
   * bỏ tin đang stream (nằm ngoài virtualizer). Mọi phép tính phục vụ vẽ (vị trí
   * trong khối, banner nén, virtualizer) đọc từ đây; đọc `visibleMessages` thì thứ
   * tự đang vẽ lệch với dữ liệu gom lượt ngay khi có lượt gập.
   */
  const renderedMessages = useMemo(
    () =>
      hiddenRowIds.size === 0
        ? visibleMessages
        : visibleMessages.filter((m) => !hiddenRowIds.has(m.id)),
    [visibleMessages, hiddenRowIds],
  );

  /** Theo dõi kích thước container để chọn width bucket cho HEIGHT_CACHE */
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateWidth = () => {
      const w = el.clientWidth;
      if (w > 0) {
        setContainerWidth((prev) => {
          const prevBucket = getWidthBucket(prev);
          const newBucket = getWidthBucket(w);
          return prevBucket !== newBucket ? w : prev;
        });
      }
    };
    updateWidth();
    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  /** Banner nén gắn vào tin ĐẦU TIÊN nằm sau ranh giới marker. */
  const compactionBannerBeforeId = useMemo(() => {
    if (!compaction) return null;
    const idx = renderedMessages.findIndex((m) => m.id === compaction.upToId);
    const next = idx >= 0 ? renderedMessages[idx + 1] : undefined;
    return next?.id ?? null;
  }, [compaction, renderedMessages]);

  // App không bật React Compiler; useVirtualizer của TanStack trả về hàm
  // mỗi render là hành vi chủ đích của thư viện — bỏ cảnh báo nhiễu.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: renderedMessages.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => renderedMessages[index]?.id ?? `row-${index}`,
    /*
     * KHÔNG flushSync (mặc định của thư viện là `true`).
     *
     * Đường sync đi qua `resizeItem → applyScrollAdjustment → notify(true)`,
     * và `resizeItem` được gọi từ `measureElement` — tức là từ REF CALLBACK
     * của hàng, tức là ngay trong commit của React. `flushSync` ở thời điểm đó
     * bị React 19 chặn và cảnh báo (log thật, xen kẽ từng lượt tool call):
     *   "flushSync was called from inside a lifecycle method. React cannot
     *    flush when React is already rendering."
     * Không phải cảnh báo nhiễu: `flushSync` bên trong commit KHÔNG flush được,
     * nên nó chỉ là một lần schedule thừa cộng thêm việc React phải báo lỗi.
     *
     * `useFlushSync: false` khiến thư viện gọi `rerender()` thay vì
     * `flushSync(rerender)` — đúng đường React 19 khuyên dùng. Mất gì? Bản
     * ghi vị trí hàng do chính React render (`transform: translateY`, xem JSX
     * hàng bên dưới; `directDomUpdates` không bật), và update được schedule
     * trong commit thì React flush ngay cuối commit, trước khi trình duyệt
     * vẽ — vẫn KIP cùng một frame với lần ghi `scrollTop` của virtualizer,
     * đúng thứ `notify(true)` định bảo vệ.
     */
    useFlushSync: false,
    overscan: 6,
    paddingStart: 16,
    paddingEnd: isStreamingAssistant ? 16 : 96,
    estimateSize: (index) => {
      const m = renderedMessages[index];
      if (!m) return 140;
      const bucket = getWidthBucket(containerWidth || scrollRef.current?.clientWidth);
      return HEIGHT_CACHE.get(cacheKey(chatId, m.id, bucket)) ?? estimateMessageHeight(m);
    },
    measureElement: (el) => {
      const h = el.getBoundingClientRect().height;
      const id = el.getAttribute('data-message-id');
      const bucket = getWidthBucket(
        containerWidth || scrollRef.current?.clientWidth || el.getBoundingClientRect().width,
      );
      if (id && h > 0) HEIGHT_CACHE.set(cacheKey(chatId, id, bucket), h);
      return h;
    },
  });

  const toggleTurnFold = useCallback(
    (turnId: string) => {
      setCollapsedTurnIds((prev) => {
        const next = new Set(prev);
        if (next.has(turnId)) next.delete(turnId);
        else next.add(turnId);
        return next;
      });
      /*
       * Chiều cao từng hàng còn lại không đổi, nhưng VỊ TRÍ của chúng đổi; đo lại
       * để vòng vẽ kế tiếp dùng bảng offset mới thay vì bảng cũ — không thì các
       * hàng dưới nhảy một nhịp.
       */
      rowVirtualizer.measure();
      if (isAtBottomRef.current) pin(300);
    },
    [isAtBottomRef, pin, rowVirtualizer],
  );

  /*
   * VỊ TRÍ TRONG KHỐI LIÊN TIẾP CÙNG VAI — tính MỘT chỗ cho cả danh sách.
   *
   * §15.1 chốt trước: ranh giới lượt phải là dữ liệu gắn theo sự kiện, không
   * suy đoán lúc vẽ, "nếu mỗi chỗ render tự gom lại thì hai màn hình sẽ gom
   * khác nhau". Quan hệ "tin liền trước / liền sau cùng vai" là dữ liệu có
   * thật của danh sách đang đọc (thứ tự thật của cây, không phân loại nội
   * dung), nên nó là nguồn duy nhất để vẽ nhịp khoảng cách và avatar.
   *
   * Không có tin nào bị bỏ vì việc này: đổi danh sách là map này tính lại,
   * chi phí O(n) trên mảng đã có trong bộ nhớ.
   */
  const runPositionById = useMemo(() => {
    const map = new Map<string, RunPosition>();
    for (let i = 0; i < renderedMessages.length; i += 1) {
      const m = renderedMessages[i];
      const sameBefore = renderedMessages[i - 1]?.role === m.role;
      /*
       * Tin CUỐI danh sách còn có thể được nối tiếp bởi tin ĐANG STREAM — tin
       * đó nằm ngoài virtualizer nên không có trong mảng này. Bỏ qua nó thì
       * ranh giới khối rơi vào giữa một lượt đang chạy: mắt thấy một khoảng
       * ngắt giữa hai câu của cùng một việc, đúng thứ §15.1 điểm 5 cấm.
       */
      const sameAfter =
        i + 1 < renderedMessages.length
          ? renderedMessages[i + 1].role === m.role
          : isStreamingAssistant && lastRole === m.role;
      map.set(m.id, sameBefore ? (sameAfter ? 'middle' : 'end') : 'start');
    }
    return map;
  }, [renderedMessages, isStreamingAssistant, lastRole]);

  /*
   * Tin ĐANG STREAM nằm ngoài virtualizer vì thế nó KHÔNG được mở header thứ
   * hai: nó là phần thân của lượt đang hiện, không mở lượt nào — cùng luật với
   * `runPositionById`. Header chỉ gắn vào tin ĐẦU của lượt (`messageIds[0]`), và
   * lượt nào cũng mở đầu bằng tin người dùng.
   */

  const branchLayoutSignature = useMemo(
    () =>
      messages
        .map((message) => {
          const info =
            branchInfoByMessageId.get(message.id);

          return [
            message.id,
            info?.currentIndex ?? -1,
            info?.total ?? 1,
          ].join(':');
        })
        .join('|'),
    [messages, branchInfoByMessageId],
  );

  /* 1. Đổi chat: nhảy đáy TỨC THÌ rồi ghim 1s để bù các lần đo lại.
     HEIGHT_CACHE là bounded LRU (2.000 phần tử) nên tự giới hạn trần bộ nhớ,
     giữ chiều cao các chat gần đây sống qua unmount/đổi chat để không bị giật layout. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    el.scrollTop = el.scrollHeight;
    pin(1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  /* 2. Có tin nhắn mới */
  useEffect(() => {
    if (messages.length === 0) return;
    if (lastRole === 'user') {
      pin(1500); // user vừa gửi → LUÔN về đáy
    } else if (isAtBottomRef.current) {
      pin(600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastRole, pin]);

  /* 3. Streaming: hook đã ghim vô hạn. Nhích thêm khi nội dung tăng */
  useEffect(() => {
    if (isLoading && isAtBottomRef.current) pin(200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastContentLen, isLoading, pin]);

  /* 3b. Kết thúc streaming (isLoading: true -> false):
     Tin nhắn chuyển từ sticky footer vào virtualizer list.
     Đảm bảo virtualizer đo lại và giữ vị trí đáy mượt mà nếu đang ở đáy. */
  const prevLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      rowVirtualizer.measure();
      if (isAtBottomRef.current) pin(400);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, pin, rowVirtualizer, isAtBottomRef]);

  /* 4. Font KaTeX/mono nạp xong */
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      HEIGHT_CACHE.clear();
      rowVirtualizer.measure();
      if (isAtBottomRef.current) pin(700);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowVirtualizer, pin]);

  /* 5. Ảnh trong markdown load xong */
  useEffect(() => {
    let raf = 0;
    const onImageLoaded = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (isAtBottomRef.current) pin(300);
      });
    };
    window.addEventListener('chat:image-loaded', onImageLoaded);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('chat:image-loaded', onImageLoaded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  /* 6. Đổi nhánh */
  useEffect(() => {
    rowVirtualizer.measure();
    if (isAtBottomRef.current) pin(700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchLayoutSignature]);

  /*
   * Gợi ý mở màn — viết bằng TÊN THẬT của thứ sản phẩm này làm, không phải
   * câu hỏi chung chung.
   *
   * Bản đầu gõ "máy tính lượng tử" và "script Python thu thập dữ liệu web" —
   * hai việc NGOÀI sản phẩm này, dạng câu hỏi chung của một trợ lý hội thoại
   * bất kỳ, nên màn hình đầu tiên dạy người dùng kỳ vọng sai: việc họ thật
   * sự làm với harness là đọc và SỬA trong workspace. Hai việc dưới đây bám
   * đúng nhóm tool có thật trong `lib/tool-catalog.ts` — `fs_list` /
   * `code_skeleton` / `code_symbols` / `fs_search` cho việc đầu, `shell_run` +
   * `code_verify` + `fs_edit` cho việc sau.
   *
   * Ngữ cảnh quan trọng khi CHỌN CHỮ: bấm thẻ chỉ ĐIỀN vào ô nhập
   * (`onSelectSuggestion` → `composerApiRef.setText`, không gửi). Nên câu phải
   * đọc như một yêu cầu người dùng tự gõ, không phải như mô tả tính năng —
   * "Quét lỗi typecheck" thay vì "Tính năng phân tích lỗi tsc/eslint".
   */
  const suggestions = useMemo(
    () => [
      'Đọc cấu trúc dự án này và chỉ tôi nên sửa chỗ nào trước',
      'Chạy typecheck rồi sửa hết lỗi nó báo',
    ],
    [],
  );

  const hasMessages = messages.length > 0;

  /*
   * Trường hỏng của lỗi hiện tại. Tính một lần ở đây thay vì gọi `parseErrorIssues`
   * trong JSX vì banner vẽ lại mỗi token khi đang stream; và vì danh sách rỗng
   * thì `<details>` không được dựng ra.
   */
  const errorIssues = useMemo(() => parseErrorIssues(error?.message), [error?.message]);

  return (
    /*
     * VỎ NGOÀI — chỉ để tách banner lỗi ra khỏi vùng định vị của nút cuộn;
     * không mang `relative` nên nó không đổi hành vi gì.
     */
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
       * VỎ TRONG — nơi duy nhất của `relative` cho hàng này, và nó kết thúc ở
       * mép dưới của VÙNG CUỘN chứ không phải mép dưới của cột.
       *
       * Trước đây fragment trả về nút "xuống tin nhắn mới nhất" mà không có
       * ancestor positioned nào trong file này, nên `absolute bottom-6` của nó
       * định vị theo CỘT ở `chat-interface.tsx` (`relative flex … flex-col`) —
       * cột có chứa luôn `<aside>` và `Composer` (`z-20`, đến sau trong DOM).
       * Hệ quả: nút rơi vào đúng vùng composer và bị vẽ DƯỚI nó. Đây là phím
       * tắt cần nhất lúc đang cuộn giữa transcript, và nó không thấy được.
       *
       * Vì sao chọn "tạo vỏ" thay vì "nâng z-index + lệch chiều cao": số phải
       * lệch là CHIỀU CAO COMPOSER, mà composer co giãn theo nội dung ô nhập và
       * các khối phụ phía trên — không có hằng nào trong repo biết trước nó.
       * Vỏ này kết thúc đúng ở mép dưới của vùng nhìn, nên `bottom-6` luôn là
       * "6px trên ô nhập" mà không cần đo gì. Nó cũng giữ nút NGOÀI `role="log"`
       * (vùng sống), trong khi dựng nút bên trong container cuộn sẽ khiến nó
       * thành tin nhắn của một vùng `aria-live`.
       *
       * Tách vỏ trong khỏi vỏ ngoài (banner lỗi nằm NGOÀI vỏ trong) là để nút
       * không còn đè lên banner: trước đây cả hai đều là con trực tiếp của một
       * shell `relative` chung, nên `bottom-6` của nút rơi vào đúng dải ~50px mà
       * banner chiếm, và không `z-*` nào cả nên nút vẽ đè lên chữ lỗi cùng nút
       * "Thử lại". Khi không có banner, vỏ trong trùng mép vỏ ngoài nên bố cục
       * y hệt trước.
       */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef as any}
          onScroll={onScroll}
          tabIndex={0}
          role="log"
          aria-label="Danh sách tin nhắn"
          style={{ overflowAnchor: 'none' }}
          className="chat-scroll min-h-0 flex-1 overflow-hidden overflow-y-auto px-5 md:px-8 [overflow-anchor:none]"
        >
          {!hasMessages ? (
            /*
             * Gutter ngang do CHÍNH container cuộn nắm (`px-5 md:px-8` ở trên),
             * nên trang trạng thái rỗng không thêm padding nữa — trước đây nó
             * cộng thêm `px-4` và lệch khỏi cột so với mọi tin nhắn thật.
             *
             * Căn GIỮA cả khối, và đây là lý do: `VyenLogo` bản `lg` tự căn
             * giữa mark + wordmark của nó (`items-center` nằm trong chính
             * component), nên đặt nó vào một cột trái-căn sẽ khiến tile 64px
             * lệch sang trái khỏi wordmark chứ không khớp mép chữ bên dưới.
             * Căn giữa là hình dạng logo đã được vẽ theo; cột vẫn là
             * `max-w-thread` nên mép cột không lệch so với chat thật.
             *
             * `py-8` thay cho `pb-20 pt-8` cũ: chênh lệch 80/32 đẩy khối
             * lệch 24px so với tâm khung nhìn, tức màn trống bị "treo" lên
             * trên trong khi chỗ trống dồn hết xuống dưới. Nó KHÔNG dành chỗ
             * cho composer: composer là anh em flex của khối này trong
             * `chat-interface.tsx`, nằm DƯỚI container cuộn chứ không đè lên
             * nó, nên không có gì để tránh. `py-8` đều hai phía để khối không
             * dính mép khi khung nhìn thấp.
             */
            <div className="mx-auto flex h-full max-w-thread flex-col items-center justify-center py-8">
              {/*
               * Logo CÓ SẴN thay cho `<h1>VYEN_</h1>` gõ tay. Trước đây màn
               * trống tự dựng một thương hiệu thứ hai (28px phẳng, không tile,
               * không pill) cạnh đúng thương hiệu mà sidebar đang dùng — hai
               * dấu hiệu khác nhau trong một app, và cái ở màn hình đầu tiên là
               * cái rẻ hơn. `VyenLogo` là nguồn duy nhất của dấu hiệu Vyen
               * (`components/vyen-logo.tsx`), nên màn trống phải lấy từ đó.
               * Bản `lg` là bản dành riêng cho empty state — xem chú thích prop
               * `size` trong file đó.
               */}
              <VyenLogo size="lg" />
              {/*
               * Mô tả ở bậc `read` (16px), không phải `meta`/`body` như trước.
               *
               * Đây là câu tự giới thiệu DUY NHẤT của màn hình — sau khi bỏ `h1`
               * gõ tay, nó là chữ nội dung chính, và bậc 12–13px khiến nó lạc
               * hẳn dưới wordmark 32px của logo (tỉ lệ 2.3:1 trở lại, tức là
               * đúng cái tỉ lệ cần sửa). 32 : 16 = 2:1 — vẫn là tiêu đề trên,
               * mô tả dưới, nhưng mắt không phải bò xuống để đọc.
               */}
              <p className="mt-6 max-w-prose text-center font-sans text-read text-text-muted">
                Agent harness tối giản: session tree, core tools, tự mở rộng theo workflow của bạn.
              </p>

              {/*
               * Thẻ gợi ý cũng ở bậc `read` (16px) — cùng cỡ với ô nhập
               * (`composer.tsx` cũng `text-read`). Bấm thẻ chỉ điền chứ đừng
               * gửi, nên câu trong thẻ CHÍNH LÀ thứ sẽ nằm trong ô nhập: cùng
               * cỡ ở cả hai nơi thì người dùng thấy đúng cái họ sắp gửi, thay
               * vì một dòng 12px biến thành 16px ngay khi bấm.
               */}
{/*
               * Lối vào cho người mới. App là BYOK: không có catalog model
               * built-in, nên "chưa có model" là trạng thái ĐẦU TIÊN của mọi
               * người dùng mới, không phải lỗi.
               *
               * Trước đây lối ra chỉ là một dòng chữ sau khi bấm gửi
               * (`use-chat-orchestration.ts:5474`) — không có nút, và người dùng
               * phải gõ một câu vô nghĩa với dự án chưa cấu hình trước khi
               * nghe thấy nó.
               */}
              {!hasModels && (
                <div className="mt-8 w-full max-w-lg">
                  <div className="rounded-xl border border-default bg-surface px-4 py-4 text-left">
                    <p className="font-sans text-read font-medium text-text-primary">
                      Thêm nhà cung cấp để bắt đầu
                    </p>
                    <p className="mt-1 font-sans text-body text-text-muted">
                      App dùng model của bạn: khai API key rồi chọn model. Chưa có
                      model thì chưa gửi được tin nhắn nào.
                    </p>
                    <button type="button" onClick={onAddProvider} className="btn-primary mt-3">
                      <span>Thêm nhà cung cấp</span>
                    </button>
                  </div>
                </div>
              )}

              {/*
               * Thẻ gợi ý chỉ hiện khi app GỬI ĐƯỢC.
               *
               * Bấm thẻ gọi `onSelectSuggestion(prompt)` — hành động đó chỉ điền
               * chữ vào ô nhập, không gửi. Mà ô nhập không gửi được khi chưa có
               * model, đúng như chính thẻ "Thêm nhà cung cấp" ngay trên nói:
               * *"Chưa có model thì chưa gửi được tin nhắn nào."* Trước đây khối
               * này nằm NGOÀI nhánh `!hasModels` nên vẫn hiện — hai thẻ mời bấm
               * vào mà không làm được gì, ở đúng màn hình mà người dùng mới
               * nhìn lâu nhất.
               */}
              {hasModels && (
                <div className="mt-8 flex w-full max-w-lg flex-col gap-3">
                  {suggestions.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => onSelectSuggestion(prompt)}
                      className="rounded-xl border border-subtle bg-surface px-4 py-3.5 text-left font-sans text-read text-text-primary transition-colors duration-150 hover:bg-raised"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  margin: '0 auto',
                  position: 'relative',
                }}
                className="max-w-thread"
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const m = renderedMessages[virtualRow.index];
                  if (!m) return null;
                  /* Header chỉ thuộc tin ĐẦU của lượt; `turn` undefined là bình thường. */
                  const turn = turnStartByMessageId.get(m.id);

                  return (
                    <div
                      key={m.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      data-message-id={m.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        paddingBottom: '1.5rem',
                      }}
                    >
                      {turn && (
                        <TurnHeader
                          turn={turn}
                          foldable={isFoldableTurn(turn.status)}
                          collapsed={collapsedTurnIds.has(turn.id)}
                          onToggleFold={toggleTurnFold}
                        />
                      )}
                      {compaction && compactionBannerBeforeId === m.id && (
                        <div className="mb-2">
                          {compaction.summary ? (
                            <details className="lift-sm rounded-lg border border-accent-dim bg-raised px-4 py-2.5 font-sans text-xs text-status-warning">
                              <summary className="cursor-pointer select-none font-medium text-accent-steel">
                                Đã nén {compaction.compactedCount} tin nhắn trước đó. Bấm để xem tóm tắt
                              </summary>
                              <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-meta leading-relaxed text-status-warning">
                                {compaction.summary}
                              </div>
                            </details>
                          ) : (
                            <div className="lift-sm rounded-lg border border-accent-dim bg-raised px-4 py-2.5 font-sans text-xs text-status-warning">
                              Đã lược bỏ {compaction.compactedCount} tin nhắn cũ
                            </div>
                          )}
                        </div>
                      )}
                      <ChatErrorBoundary
                        onReset={() => rowVirtualizer.measure()}
                        resetKey={`${m.id}:${m.content.length}`}
                      >
                        <MessageItem
                          m={m}
                          runPosition={runPositionById.get(m.id) ?? 'end'}
                          branchInfo={branchInfoByMessageId.get(m.id)}
                          isStreaming={isLoading && m.role === 'assistant' && m.id === lastMessageId}
                          isEditing={editingId === m.id}
                          isCopied={copiedId === m.id}
                          draft={editingId === m.id ? draft : ''}
                          isTouchDevice={isTouchDevice}
                          sendOnEnter={sendOnEnter}
                          throttleMs={throttleMs}
                          onCopy={onCopy}
                          onRegenerate={onRegenerate}
                          onSwitchBranch={onSwitchBranch}
                          onStartEdit={onStartEdit}
                          onSaveEdit={onSaveEdit}
                          onCancelEdit={onCancelEdit}
                          onDraftChange={onDraftChange}
                          onContinueGenerating={onContinueGenerating}
                          onContentResize={() => {
                            if (isAtBottomRef.current) pin(300);
                          }}
                        />
                      </ChatErrorBoundary>
                    </div>
                  );
                })}
              </div>

              {isLoading &&
                !hasToolInvocations &&
                !(
                  lastRole === 'assistant' &&
                  ((lastMsg as any)?.reasoning || lastContentLen > 0)
                ) &&
                <ThinkingIndicator />}

              {isStreamingAssistant && lastMsg && (
                <div className="mx-auto w-full max-w-thread pb-24">
                  <ChatErrorBoundary
                    onReset={() => rowVirtualizer.measure()}
                    resetKey={`${lastMsg.id}:${lastMsg.content.length}`}
                  >
                    <MessageItem
                      m={lastMsg}
                      /* Tin đang stream tiếp nối khối nếu tin liền trước cũng là
                         trợ lý — cùng luật với danh sách, chỉ khác nguồn: nó nằm
                         ngoài virtualizer nên không có trong `visibleMessages`. */
                      runPosition={
                        renderedMessages[renderedMessages.length - 1]?.role === 'assistant'
                          ? 'end'
                          : 'start'
                      }
                      branchInfo={branchInfoByMessageId.get(lastMsg.id)}
                      isStreaming={true}
                      isEditing={editingId === lastMsg.id}
                      isCopied={copiedId === lastMsg.id}
                      draft={editingId === lastMsg.id ? draft : ''}
                      isTouchDevice={isTouchDevice}
                      sendOnEnter={sendOnEnter}
                      throttleMs={throttleMs}
                      onCopy={onCopy}
                      onRegenerate={onRegenerate}
                      onSwitchBranch={onSwitchBranch}
                      onStartEdit={onStartEdit}
                      onSaveEdit={onSaveEdit}
                      onCancelEdit={onCancelEdit}
                      onDraftChange={onDraftChange}
                      onContinueGenerating={onContinueGenerating}
                      onContentResize={() => {
                        if (isAtBottomRef.current) pin(300);
                      }}
                    />
                  </ChatErrorBoundary>
                </div>
              )}
            </>
          )}
        </div>

        {showJumpToLatest(hasMessages, isAtBottom) && (
          <button
            type="button"
            onClick={onScrollToBottom}
            aria-label="Xuống tin nhắn mới nhất"
            className="absolute bottom-6 left-1/2 -translate-x-1/2 lift-md rounded-full border border-subtle bg-panel-bg p-2.5 text-accent-steel transition-colors hover:border-border-hover hover:bg-panel-soft hover:text-text-primary"
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      {/*
       * BANNER LỖI — ra KHỎI container cuộn, và ra KHỎI vỏ trong của nút cuộn.
       *
       * Nó nằm trong danh sách tin nhắn, nên với transcript dài nó bị chôn ở
       * đáy: người dùng đang đọc giữa lúc một lượt hỏng thì phải cuộn tới
       * cuối mới thấy lỗi — đúng lúc nhiều khả năng nhất là họ không thấy.
       * Đưa ra ngoài `role="log"` (một vùng `aria-live`) và ghim ngay TRÊN mép
       * dưới của vùng nhìn thì nó luôn ở đó, cạnh ô nhập.
       *
       * Chi phí: `flex-shrink-0` để nó không bị container co lại làm bóp dòng
       * thông báo; `mx-auto max-w-thread` giữ nguyên lề gutter mà gutter ngang
       * của container cuộn đang giữ.
       */}
      {error && (
        <div
          role="alert"
          className="notice-error mx-auto mb-2 flex w-full max-w-thread flex-none flex-col gap-2 px-3 py-2.5 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">{friendlyErrorMessage(error.message)}</span>
            <button
              type="button"
              onClick={onReload}
              className="flex-shrink-0 rounded-lg bg-danger px-3.5 py-1.5 font-sans text-xs font-medium text-on-fill transition-colors hover:bg-danger/85"
            >
              Thử lại
            </button>
          </div>
          {/*
           * TRƯỜNG HỎNG — ẩn sau disclosure, không đổ JSON thô lên màn hình.
           *
           * Với lỗi schema, câu chung ("Cấu trúc dữ liệu không hợp lệ.") nói
           * cho người dùng biết có lỗi nhưng không cho biết ĐÂU hỏng — nên lượt
           * đó không lặp lại được, và người ta chỉ còn cách đoán. Hiện `path` +
           * `message` của từng issue là đủ để tự hiểu, mà không phải ai cũng cần
           * đọc nó: dòng chính giữ câu cũ.
           *
           * `font-mono` CHỈ cho đường dẫn trường (đường dẫn là dữ liệu, không
           * phải chữ đọc) — lý do trong globals.css dòng 567.
           */}
          {errorIssues.length > 0 && (
            <details className="min-w-0">
              <summary className="cursor-pointer select-none font-sans text-xs text-danger">
                Chi tiết lỗi ({errorIssues.length})
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1 font-sans text-xs text-danger">
                {errorIssues.map((issue, i) => (
                  <li key={i} className="min-w-0 break-words">
                    {issue.path && (
                      <span className="font-mono text-meta text-danger">{issue.path}: </span>
                    )}
                    <span>{issue.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
});

