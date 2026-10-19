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
  usage: { promptTokens: number | null; completionTokens: number | null };
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
function wrapTools(
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
    onError: ({ error }) => {
      streamError ??= error;
    },
  });

  let text = '';
  /* Có tool thì đọc `fullStream` để THẤY hoạt động tool. Chỉ in `textStream` là
   * người dùng thấy màn hình đứng yên rồi thành công trong khi máy đang sửa
   * file — trông như treo, và cũng che mất việc gì đã xảy ra. */
  if (hasTools) {
    for await (const part of result.fullStream) {
      const p = part as {
        type?: string;
        /* `ai@4` đặt tên trường là `textDelta`, KHÔNG phải `text`. Đo thật
         * 2026-10-18: dùng `text` thì text-delta rơi vào im lặng và kết quả là
         * CÂU RỖNG dù model đã trả lời — tức báo thành công sai. */
        textDelta?: string;
        toolName?: string;
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
          break;
        default:
          break;
      }
    }
  } else {
    for await (const chunk of result.textStream) {
      text += chunk;
      opts.onText?.(chunk);
    }
  }

  if (streamError) throw streamError;

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
    },
  };
}