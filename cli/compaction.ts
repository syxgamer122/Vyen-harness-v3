/**
 * Nén ngữ cảnh cho CLI — chọn ranh giới và tạo bản tóm tắt.
 *
 * ============ DÙNG LẠI ĐƯỢC GÌ ============
 *
 * `lib/context-budget.ts` (ước lượng, ngưỡng, cắt) và `lib/context-compaction.ts`
 * (state tích lũy, đóng gói phần cũ, tóm tắt tất định, prompt tóm tắt) — đường web
 * đã dùng đúng những thứ này. File này chỉ làm phần **còn thiếu của CLI**:
 * adapter đo được, chọn ranh giới, và gọi model tóm tắt.
 *
 * ============ RANH GIỚI LUÔN NẰM TRƯỚC MESSAGE `user` ============
 *
 * `CoreMessage` tách tool-call (assistant) và tool-result (message `tool`) thành hai
 * message — khác hình dạng UI message của web (gộp chúng). Nên:
 *
 *   1. Cắt giữa hai message đó ⇒ phần giữ lại bắt đầu bằng `tool-result` **mồ côi**
 *      ⇒ provider trả 400 ở **mọi** lượt sau của phiên ⇒ phiên chết vĩnh viễn.
 *   2. Phần giữ lại bắt đầu bằng `assistant` ⇒ Anthropic Messages API trả 400
 *      (message đầu tiên phải là `user`).
 *
 * ⇒ Ranh giới luôn nằm ngay trước một message `role:'user'`. Cắt **tiến** tới message
 * `user` kế tiếp (bỏ nhiều hơn, phần giữ lại chắc vừa ngân sách); nếu không có
 * message `user` nào ở phía sau thì lùi về message `user` gần nhất ở phía trước.
 *
 * ============ KHÔNG NÉN ĐƯỢC LỊCH SỬ CHỈ CÓ MỘT LƯỢT ============
 *
 * Không có chỗ cắt nào mà phần giữ lại vẫn hợp lệ ⇒ trả `null` (không nén). Đây là
 * giới hạn thật, ghi rõ chứ không giấu.
 */
import { generateText, type CoreMessage, type LanguageModelV1 } from 'ai';
import {
  RESERVE_TOKENS,
  estimateContextTokens,
  estimatePromptTokens,
  shouldCompact,
  splitForCompaction,
} from '@/lib/context-budget';
import {
  COMPACT_SUMMARY_MAX_CHARS,
  COMPACT_SUMMARY_SYSTEM,
  buildCompactPrompt,
  buildEmergencySummary,
  buildReadFilesReminder,
  extractFileOps,
  extractUserRequests,
  formatCompactContextBlock,
  mergeCompactionState,
  readReminderBudget,
  serializeForCompaction,
  type CompactionState,
} from '@/lib/context-compaction';
import { toBudgetMessages } from './context-adapter';

/**
 * Context window mặc định khi model BYOK không khai cửa sổ.
 *
 * ============ VÌ SAO KHÁC `FALLBACK_CONTEXT_WINDOW` (32.000) CỦA ĐƯỜNG WEB ============
 *
 * Đường web là chat thuần; CLI là **agent coding**, mỗi kết quả tool tới 24.000 ký tự
 * (= 6.000 token) ⇒ 32.000 token chỉ chứa nổi **~5** kết quả tool. Một lượt đọc 10
 * file là đã tràn, mà lịch sử chỉ có MỘT lượt thì không nén được (§ trên) ⇒ phiên
 * chết. Đó là lý do 32.000 là mặc định **quá nhỏ** cho CLI.
 *
 * opencode dùng đúng 200.000 cho model không khai context window
 * (`packages/schema/src/model.ts:142`) ⇒ lấy cùng giá trị đó.
 *
 * Người dùng khai đúng cửa sổ thật qua biến môi trường `VYEN_CONTEXT_WINDOW`.
 */
export const CLI_DEFAULT_CONTEXT_WINDOW = 200_000;

export interface CutChoice {
  /** Chỉ số trong `messages` của message ĐẦU TIÊN được giữ. */
  firstKept: number;
  older: CoreMessage[];
  keep: CoreMessage[];
}

export interface CompactInput {
  messages: readonly CoreMessage[];
  /**
   * Instance model dựng **riêng** cho `generateText` (có `fetch: nonStreamingFetch`).
   *
   * Vì sao phải riêng: `generateText` không gửi trường `stream`, mà nhiều gateway
   * bỏ qua trường đó và trả SSE ⇒ AI SDK ném "Invalid JSON response"
   * (`lib/non-streaming-fetch.ts:8-12`). Mà `streamText` của lượt chat thì **không**
   * được dùng hàm đó (`lib/non-streaming-fetch.ts:18`) ⇒ phải có hai instance.
   */
  model: LanguageModelV1;
  /** System prompt hiện tại (chưa kèm bản tóm tắt). */
  system: string;
  windowTokens?: number | null;
  reserveTokens?: number;
  /** Bản tóm tắt của lần nén trước — đưa vào prompt để lần này HỢP NHẤT. */
  previousSummary?: string;
  /** State tích lũy của lần nén trước. */
  previousState?: CompactionState;
  signal?: AbortSignal;
  /**
   * Ép nén dù chưa vượt ngưỡng — dùng cho đường `overflow` (provider vừa từ chối).
   */
  force?: boolean;
}

export type CompactOutcome =
  | { kind: 'skipped'; reason: 'chua-du-lich-su' | 'chua-vuot-nguong' }
  | {
      kind: 'ok';
      summary: string;
      state: CompactionState;
      firstKept: number;
      olderCount: number;
      keptCount: number;
      keptTokens: number;
    }
  | { kind: 'failed'; error: string };

/**
 * Chọn ranh giới nén.
 *
 * @param options.force Bỏ qua sàn "số tin tối thiểu" của `splitForCompaction` — đường
 *   `overflow` cần nén được dù lịch sử ngắn.
 */
export function chooseCut(
  messages: readonly CoreMessage[],
  budget: { windowTokens?: number | null; reserveTokens?: number },
  options?: { force?: boolean },
): CutChoice | null {
  const split = splitForCompaction(
    toBudgetMessages(messages),
    budget.windowTokens,
    budget.reserveTokens,
    options?.force ? 0 : undefined,
  );
  if (!split) return null;

  const laUser = (i: number) => messages[i]?.role === 'user';

  // 1. TIẾN tới message `user` kế tiếp — bỏ nhiều hơn, phần giữ lại chắc vừa ngân sách.
  //    Khi ép nén thì bắt đầu từ 1, vì cắt ở 0 là không bỏ gì cả.
  let u = -1;
  const batDau = options?.force ? Math.max(split.firstKept, 1) : split.firstKept;
  for (let i = batDau; i < messages.length; i += 1) {
    if (laUser(i)) {
      u = i;
      break;
    }
  }
  // 2. Không có message `user` ở phía sau ⇒ lùi về message `user` gần nhất ở phía trước.
  if (u < 0) {
    for (let i = split.firstKept - 1; i >= 0; i -= 1) {
      if (laUser(i)) {
        u = i;
        break;
      }
    }
  }
  // 3. Không có message `user` nào, hoặc cắt ở 0 (không bỏ được gì) ⇒ không nén được.
  if (u <= 0) return null;

  return { firstKept: u, older: messages.slice(0, u), keep: messages.slice(u) };
}

/**
 * Ghép bản tóm tắt vào system prompt.
 *
 * Bản tóm tắt nằm trong SYSTEM chứ không phải là một message: chuỗi message là thứ
 * provider nhận, và một message `role:'user'` chèn giữa chuỗi sẽ phá vai trò của các
 * message tool. Web làm y hệt (`app/api/chat/route.ts:1617-1619`).
 */
export function withSummary(system: string, summary: string | undefined): string {
  if (!summary || !summary.trim()) return system;
  return `${system}\n\n[Tóm tắt phần hội thoại đã nén trước đó]\n${summary}`;
}

/**
 * Nén một hội thoại: cắt phần cũ, gọi model tóm tắt, kiểm chứng rồi trả về.
 *
 * ============ VÌ SAO PHẢI KIỂM CHỨNG SAU KHI NÉN ============
 *
 * "Nén thành công" có thể là nói dối: nếu bản tóm tắt dài hơn phần đã bỏ thì payload
 * **lớn hơn** trước khi nén. Nên phải ước lượng lại sau khi cắt và báo thất bại nếu
 * không giảm — không báo thành công trong khi thực tế vẫn gửi lịch sử cũ.
 */
export async function compactConversation(input: CompactInput): Promise<CompactOutcome> {
  const windowTokens = input.windowTokens ?? CLI_DEFAULT_CONTEXT_WINDOW;
  const reserveTokens = input.reserveTokens ?? RESERVE_TOKENS;

  const budget = toBudgetMessages(input.messages);
  const estTruoc = estimatePromptTokens(budget, [input.system, input.previousSummary]);

  if (!input.force && !shouldCompact(estTruoc, windowTokens, reserveTokens)) {
    return { kind: 'skipped', reason: 'chua-vuot-nguong' };
  }

  const cut = chooseCut(input.messages, { windowTokens, reserveTokens }, { force: input.force });
  if (!cut) return { kind: 'skipped', reason: 'chua-du-lich-su' };

  const budgetOlder = toBudgetMessages(cut.older);
  const transcript = serializeForCompaction(budgetOlder)
    .map((m) => `${m.role === 'assistant' ? 'Trợ lý' : m.role === 'user' ? 'Người dùng' : 'Hệ thống'}: ${m.content.trim()}`)
    .join('\n\n');
  const context = formatCompactContextBlock(
    extractFileOps(budgetOlder),
    extractUserRequests(budgetOlder),
    undefined,
    input.previousState,
  );
  const prompt = buildCompactPrompt({
    transcript,
    ...(context ? { context } : {}),
    ...(input.previousSummary ? { previousSummary: input.previousSummary } : {}),
  });

  let summary = '';
  try {
    const r = await generateText({
      model: input.model,
      system: COMPACT_SUMMARY_SYSTEM,
      prompt,
      maxTokens: 1024,
      ...(input.signal ? { abortSignal: input.signal } : {}),
    });
    summary = r.text.trim();
  } catch {
    /* Model hỏng ⇒ rơi về tóm tắt tất định bên dưới. KHÔNG ném: lỗi tóm tắt không
       được biến thành lỗi của lượt chat. */
    summary = '';
  }

  if (!summary) {
    /* Tóm tắt TẤT ĐỊNH — không cần LLM, không tốn request, không bao giờ thất bại.
       Trích được bằng thuật toán: yêu cầu đã nêu, file đã sửa/ghi/đọc, kết luận
       cuối. Không có nó thì nén xong là MẤT SẠCH dấu vết công việc. */
    summary = buildEmergencySummary({
      messages: budgetOlder,
      ...(input.previousSummary ? { previousSummary: input.previousSummary } : {}),
    });
  }
  if (!summary) {
    return { kind: 'failed', error: 'Khong tao duoc ban tom tat' };
  }
  summary = summary.slice(0, COMPACT_SUMMARY_MAX_CHARS);

  /* Nhắc lại NỘI DUNG file đã đọc — sau nén model chỉ còn đường dẫn, muốn trích
     dẫn hay sửa tiếp thì phải tốn lượt `fs_read` lại. */
  const reminder = buildReadFilesReminder(budgetOlder, {
    maxTotalChars: readReminderBudget(summary.length),
  });
  if (reminder) summary = `${summary}\n\n${reminder}`;

  const estSau = estimatePromptTokens(toBudgetMessages(cut.keep), [input.system, summary]);
  if (estSau >= estTruoc) {
    return {
      kind: 'failed',
      error: `Nen xong ma payload khong giam (${estTruoc} -> ${estSau} token)`,
    };
  }

  return {
    kind: 'ok',
    summary,
    state: mergeCompactionState(
      input.previousState,
      extractFileOps(budgetOlder),
      extractUserRequests(budgetOlder),
    ),
    firstKept: cut.firstKept,
    olderCount: cut.older.length,
    keptCount: cut.keep.length,
    keptTokens: estimateContextTokens(toBudgetMessages(cut.keep)),
  };
}
