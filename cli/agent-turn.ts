/**
 * Vòng lặp tool — hàm thuần, không đụng console, không đọc biến môi trường.
 *
 * ============ VÌ SAO TÁCH KHỎI `cli/index.ts` ============
 *
 * Vì test được. `cli/index.ts` gọi `process.exit`, đọc `process.env`, in ra
 * `console.error` — không import được trong test nào mà không phá. Chỗ dễ hỏng
 * nhất của CLI là đúng chỗ này: quên `maxSteps` thì tool call bị bỏ qua **âm
 * thầm**, không lỗi không cảnh báo, chỉ là model "không bao giờ làm được gì".
 * Không test được thì không canh được, và bản sửa cũng không có gì để đối chiếu.
 *
 * ============ VÌ SAO `maxSteps` LẠI LÀ TRỌNG TÂM ============
 *
 * `streamText` mặc định **một** lượt: model trả về tool call, ta nhận chữ rỗng,
 * và tool call bị vứt đi. Muốn "gọi tool → đọc kết quả → quyết định tiếp" thì
 * phải bật `maxSteps`. Test `calls.length === 2` là để canh đúng điều đó.
 */
import { streamText, type CoreMessage, type LanguageModelV1, type ToolSet } from 'ai';

/** Số mô tả tool mà AI SDK có thể đi tiếp trong một lượt gọi. */
const DEFAULT_MAX_STEPS = 12;

export interface AgentTurnOptions {
  model: LanguageModelV1;
  /** `undefined` = không có tool, chỉ chat. Không phải mảng rỗng. */
  tools?: ToolSet;
  /** Hướng dẫn cho model. Không phải phần của lịch sử hội thoại nên không lưu cùng transcript. */
  system?: string;
  /**
   * Toàn bộ lịch sử hội thoại, **không** phải một câu hỏi.
   *
   * ============ VÌ SAO KHÔNG PHẢI `prompt: string` ============
   *
   * Ban đầu hàm nhận `prompt: string` vì lúc đó CLI chỉ chạy một lượt. Nhưng một
   * lượt có tool không sinh ra **một** message — nó sinh ra một chuỗi: assistant
   * gọi tool, rồi tool trả kết quả, rồi assistant trả lời. Nếu chỉ nhận chuỗi
   * rồi lấy `text` thì lượt sau không có gì để nối vào, và mọi tool call mất
   * sạch khỏi bộ nhớ.
   *
   * Nên hàm trả về `messages` để người gọi nối vào lịch sử. Đó cũng chính là thứ
   * cần ghi xuống đĩa.
   */
  messages: CoreMessage[];
  maxTokens?: number;
  maxSteps?: number;
  /**
   * Bấm Esc để cắt lượt đang chạy.
   *
   * Cắt giữa chừng là chuỗi message **hở dở** (assistant đã gọi tool nhưng tool
   * chưa trả kết quả). Hàm này ném ra chứ KHÔNG trả về một `messages` nửa vời —
   * người gọi chỉ ghi `messages` khi lượt thành công, nên một lần Esc giữ được
   * transcript toàn vẹn.
   */
  signal?: AbortSignal;
  /** Gọi mỗi lần model định chạy tool — để người dùng thấy máy đang làm gì. */
  onToolCall?: (toolName: string) => void;
  onToolError?: (toolName: string, message: string) => void;
  /** Gọi mỗi lần chữ được sinh ra. */
  onText?: (delta: string) => void;
}

export interface AgentTurnResult {
  /** Toàn bộ chữ model sinh ra, đã ghép. */
  text: string;
  /**
   * Message do lượt này sinh ra, theo thứ tự — gồm assistant gọi tool, message
   * `tool` chứa kết quả, và assistant trả lời cuối.
   *
   * PHẢI ghi đủ cả khối này chứ không chỉ câu trả lời cuối. Thiếu message `tool`
   * là provider trả 400 ở mọi lượt sau ("tool_use không có tool_result").
   */
  messages: CoreMessage[];
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    /**
     * Lý do model dừng (`stop` | `length` | `tool-calls` | `content-filter` | …).
     *
     * ============ VÌ SAO ĐỌC TỪ `fullStream`, KHÔNG await `result.finishReason` ============
     *
     * `result.finishReason` là một Promise, và comment ở `cli/agent-turn.ts` đã ghi:
     * khi provider lỗi, stream kết thúc im lặng và `finishReason` **không bao giờ
     * settle** ⇒ await nó là **treo CLI**. Part `finish` trong `fullStream` thì tới
     * đúng lúc nó tới.
     *
     * Cần cho `evaluateUsageTrigger` (`lib/context-budget.ts`): hai ca nguy hiểm nhất
     * là “tràn ngầm” (`finishReason='stop'` nhưng `promptTokens > window`) và
     * “gateway cắt input” (`finishReason='length'` mà `completionTokens = 0`) — cả hai
     * **không** sinh lỗi nên provider không báo gì.
     */
    finishReason?: string;
  };
}

/**
 * Bọc mọi tool để lỗi thành **kết quả**, không thành ném.
 *
 * ============ VÌ SAO PHẢI BỌC ============
 *
 * Tool hỏng là chuyện THƯỜNG: file không tồn tại, người dùng bấm "không" ở cổng
 * duyệt, chạy lệnh hỏng. Đó là thông tin để model thử cách khác, không phải
 * thảm khoảng.
 *
 * `ai@4` **không có** part `tool-error` (đo thật 2026-10-18 — grep `ai/dist/
 * index.d.ts` không có chuỗi này). Nếu để `execute` ném, lỗi nổi lên và cả lượt
 * chết: agent dừng giữa chừng, không có câu trả lời, và người dùng chỉ thấy một
 * dòng lỗi. Nên bắt ở đây và trả `{ ok: false, error }` — model đọc được lỗi và
 * tự sửa.
 */
export function wrapTools(
  tools: ToolSet,
  onToolError?: (toolName: string, message: string) => void,
): ToolSet {
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(tools)) {
    const tool = def as {
      execute?: (args: unknown, options: unknown) => PromiseLike<unknown> | unknown;
    };
    if (typeof tool.execute !== 'function') {
      out[name] = def;
      continue;
    }
    const exec = tool.execute.bind(def);
    out[name] = {
      ...def,
      execute: async (args: unknown, options: unknown) => {
        try {
          return await exec(args, options);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          onToolError?.(name, msg);
          return { ok: false, error: msg };
        }
      },
    };
  }
  return out as ToolSet;
}

/* ============ PHẦN TOOL ĐÃ HOÀN THÀNH KHI LƯỢT HỎNG ============
 *
 * Đo 2026-10-20: lượt hỏng giữa chừng ⇒ `runAgentTurn` ném lỗi TRƯỚC khi đọc
 * `result.response` ⇒ mọi tool đã chạy xong biến mất khỏi transcript.
 *
 * Hậu quả thật: `fs_write` ĐÃ ghi file mà transcript không có dấu vết ⇒ `/compact`
 * không biết file nào vừa bị sửa, và đường `overflow` thử lại ⇒ model LÀM LẠI đúng
 * các tool call đó ⇒ `fs_write`/`git_commit` chạy hai lần.
 *
 * Đo thêm: `result.response.messages` resolve ra **undefined** khi stream lỗi ⇒
 * không khôi phục được từ đó. Nhưng `fullStream` CÓ phát part `tool-call` lẫn
 * `tool-result` (và `args` là object đã parse) ⇒ dựng lại được từ chính stream.
 *
 * Ràng buộc an toàn: chỉ ghi phần **ĐẦY ĐỦN** (tool-call có tool-result tương
 * ứng). Tool call chưa có kết quả thì không ghi — ghi nó là tạo chuỗi hở, mà chuỗi
 * hở làm provider từ chối MỌI lượt sau của phiên.
 */
type ToolEvent =
  | { kind: 'call'; toolCallId: string; toolName: string; args: unknown }
  | { kind: 'result'; toolCallId: string; toolName: string; result: unknown };

/** Lỗi lượt → phần message ĐÃ HOÀN THÀNH trước lúc hỏng. */
const messagesHoanThanh = new WeakMap<object, CoreMessage[]>();

/**
 * Phần message ĐÃ HOÀN THÀNH trước lúc lượt hỏng — lấy ra từ lỗi mà
 * `runAgentTurn` ném ra.
 *
 * Rỗng nếu lượt hỏng trước khi tool nào kịp chạy xong.
 */
export function messagesDaHoanThanh(e: unknown): CoreMessage[] {
  if (!e || typeof e !== 'object') return [];
  return messagesHoanThanh.get(e) ?? [];
}

/**
 * Gắn phần message ĐÃ HOÀN THÀNH vào lỗi — để `messagesDaHoanThanh` lấy ra được.
 *
 * Dùng bởi đường giả lập (`cli/emulated.ts`): vòng lặp giả lập giữ transcript
 * trong mảng cục bộ, nên lỗi ném ra không mang theo phần tool đã chạy xong.
 */
export function ganMessagesHoanThanh(e: unknown, msgs: CoreMessage[]): void {
  if (!e || typeof e !== 'object' || !msgs.length) return;
  messagesHoanThanh.set(e, msgs);
}

/**
 * Dựng lại message từ các part tool trong stream, chỉ giữ cặp ĐẦY ĐỦN.
 *
 * Hình dạng đúng như `response.messages` của AI SDK: một message assistant gộp
 * các tool-call của lượt, rồi một message tool gộp các tool-result tương ứng.
 */
function buildPartialMessages(events: ToolEvent[]): CoreMessage[] {
  const coKetQua = new Set(events.filter((e) => e.kind === 'result').map((e) => e.toolCallId));
  const out: CoreMessage[] = [];
  let assistant: { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }[] = [];
  let tool: { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown }[] = [];

  const flushAssistant = () => {
    const parts = assistant.filter((c) => coKetQua.has(c.toolCallId));
    assistant = [];
    if (parts.length) out.push({ role: 'assistant', content: parts } as never);
  };
  const flushTool = () => {
    const parts = tool.filter((r) => coKetQua.has(r.toolCallId));
    tool = [];
    if (parts.length) out.push({ role: 'tool', content: parts } as never);
  };

  for (const e of events) {
    if (e.kind === 'call') {
      flushTool();
      assistant.push({
        type: 'tool-call',
        toolCallId: e.toolCallId,
        toolName: e.toolName,
        args: e.args,
      });
    } else {
      flushAssistant();
      tool.push({
        type: 'tool-result',
        toolCallId: e.toolCallId,
        toolName: e.toolName,
        result: e.result,
      });
    }
  }
  flushAssistant();
  flushTool();
  return out;
}

export async function runAgentTurn(opts: AgentTurnOptions): Promise<AgentTurnResult> {
  const hasTools = Boolean(opts.tools && Object.keys(opts.tools).length > 0);

  /* `onError` là nơi DUY NHẤT lỗi provider lộ ra.
   *
   * Đo thật 2026-10-18 với key sai: `for await (… của result.textStream)` KHÔNG
   * ném — nó kết thúc im lặng sau 0 chunk, và `finishReason` không bao giờ
   * settle. Nuốt ở đây thì CLI in ra MỘT CÂU RỖNG rồi exit 0, tức báo thành công
   * cho một lần gọi thất bại — tệ hơn cả crash. Nên giữ lại rồi ném ra sau. */
  let streamError: unknown = null;
  const result = streamText({
    model: opts.model,
    messages: opts.messages,
    ...(opts.system ? { system: opts.system } : {}),
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    ...(hasTools
      ? {
          tools: wrapTools(opts.tools as ToolSet, opts.onToolError),
          maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
        }
      : {}),
    ...(opts.signal ? { abortSignal: opts.signal } : {}),
    onError: ({ error }) => {
      streamError ??= error;
    },
  });

  let text = '';
  /* Đọc `fullStream` ở CẢ HAI nhánh (có tool và không có tool).
   *
   * Lý do 1 — thấy tool: chỉ in `textStream` thì người dùng thấy màn hình đứng yên
   * rồi thành công trong khi máy đang sửa file — trông như treo, và cũng che mất việc
   * gì đã xảy ra.
   *
   * Lý do 2 — bắt `finishReason`: part `finish` chỉ có trong `fullStream`. Và KHÔNG
   * await `result.finishReason` (một Promise) — comment ở file này đã ghi: khi provider
   * lỗi, stream kết thúc im lặng và `finishReason` KHÔNG BAO GIỜ settle ⇒ await nó là
   * TREO CLI. Part `finish` thì tới đúng lúc nó tới.
   *
   * Cần cho `evaluateUsageTrigger` (`lib/context-budget.ts`): hai ca nguy hiểm nhất là
   * “tràn ngầm” (`finishReason='stop'` nhưng `promptTokens > window`) và “gateway cắt
   * input” (`finishReason='length'` mà `completionTokens = 0`) — cả hai KHÔNG sinh lỗi
   * nên provider không báo gì. */
  let finishReason: string | undefined;
  /** Part tool thấy trong stream — dùng để dựng lại phần ĐÃ HOÀN THÀNH khi lượt hỏng. */
  const toolEvents: ToolEvent[] = [];
  for await (const part of result.fullStream) {
    const p = part as {
      type?: string;
      /* `ai@4` dat ten truong la `textDelta`, KHONG phai `text`. Do that
       * 2026-10-18: dung `text` thi text-delta roi vao im lang va ket qua la
       * **CAU RONG** du model da tra loi — tuc bao thanh cong sai. */
      textDelta?: string;
      toolName?: string;
      finishReason?: string;
      toolCallId?: string;
      args?: unknown;
      result?: unknown;
    };
    switch (p.type) {
      case 'text-delta':
        if (p.textDelta) {
          text += p.textDelta;
          opts.onText?.(p.textDelta);
        }
        break;
      case 'tool-call':
        if (p.toolName) opts.onToolCall?.(p.toolName);
        if (p.toolCallId) {
          toolEvents.push({
            kind: 'call',
            toolCallId: p.toolCallId,
            toolName: p.toolName ?? 'tool',
            args: p.args,
          });
        }
        break;
      case 'tool-result':
        if (p.toolCallId) {
          toolEvents.push({
            kind: 'result',
            toolCallId: p.toolCallId,
            toolName: p.toolName ?? 'tool',
            result: p.result,
          });
        }
        break;
      case 'finish':
        if (p.finishReason) finishReason = p.finishReason;
        break;
      default:
        break;
    }
  }
  if (streamError) {
    /* Gắn phần ĐÃ HOÀN THÀNH vào chính lỗi ⇒ caller lấy ra được mà không
     * phải đổi kiểu lỗi (đổi kiểu thì `diagnoseUpstreamError` mất status code). */
    const partial = buildPartialMessages(toolEvents);
    if (partial.length && typeof streamError === 'object') messagesHoanThanh.set(streamError, partial);
    throw streamError;
  }

    /* KHÔNG TIN `abortSignal` LUÔN ĐÚNG LÚC.
   *
   * Đo 2026-10-19: khi stub (và nhiều provider/gateway) không nghe tín hiệu dừng,
   * `streamText` vẫn hoàn tất **bình thường** và trả về một bộ message nửa vời. Nếu
   * ta tin vào đó thì REPL ghi chuỗi hở xuống transcript — và một lần Esc sẽ làm mọi
   * lượt sau của phiên đó bị provider từ chối.
   *
   * Nên hỏi lại chính tín hiệu sau khi stream kết thúc, bất kể nó kết thúc thế nào.
   * Giá của kiểm tra này: một lượt chạy xong đúng khoảnh khắc bấm Esc thì bị coi là
   * đã hủy — chấp nhận được, vẫn tốt hơn transcript hỏng.
   */
  if (opts.signal?.aborted) {
    const e = new Error('LENH DA BI CAT');
    /* Tool đã chạy xong TRƯỚC lúc bị Esc thì vẫn phải ghi — nó đã thay đổi máy. */
    const partial = buildPartialMessages(toolEvents);
    if (partial.length) messagesHoanThanh.set(e, partial);
    throw e;
  }

const usage = await result.usage;
/* `response.messages` là thứ AI SDK sinh ra TRONG lượt này: assistant gọi tool,
 * message `tool` mang kết quả, assistant trả lời cuối. Đọc mã `ai@4` để chắc:
 * nó ghi rõ "The response messages that were generated during the call". */
const { messages: generated } = await result.response;
return {
  text,
  messages: generated as CoreMessage[],
  usage: {
    promptTokens: usage.promptTokens ?? null,
    completionTokens: usage.completionTokens ?? null,
    ...(finishReason ? { finishReason } : {}),
  },
};
}