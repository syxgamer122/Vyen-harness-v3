/**
 * Lượt GIẢ LẬP cho CLI — khi model không hỗ trợ function calling.
 *
 * ============ VÌ SAO CẦN ============
 *
 * Spec `docs/superpowers/specs/2026-10-18-cli-core-design.md` §7:
 * *"Model không hỗ trợ tool calling → rơi về `emulated-agent` (đã có, và là tài sản
 * lớn nhất cho BYOK)"*. CLI trước đây **không** có đường này: nó luôn gửi `tools` cho
 * provider ⇒ provider từ chối ⇒ lỗi ⇒ phiên dừng. Với BYOK + model local (đúng thứ
 * CLI nhắm tới) thì đó là **chết cả session**.
 *
 * ============ DÙNG LẠI, KHÔNG VIẾT BẢN THỨ HAI ============
 *
 * `lib/emulated-agent.ts` đã chạy ở server: schema tool → TEXT trong system prompt →
 * model trả khối `<tool_call>` thuần → parse → thực thi tool thật → nhét kết quả vào
 * transcript → gọi lại. Toàn bộ 5 lớp loop protection nằm ở đó.
 *
 * CLI khác web ở MỘT chỗ: mọi tool của CLI chạy **cục bộ** (cầu `lib/ipc.cjs`), nên
 * chúng là "server tool" của vòng lặp giả lập — không phải "client tool" như ở web.
 *
 * ============ BẮT BUỘC DÙNG INSTANCE MODEL KHÔNG STREAM ============
 *
 * Đường giả lập dùng `generateText` (buffered) ⇒ **không** gửi trường `stream`, mà
 * nhiều gateway bỏ qua trường đó và trả SSE ⇒ AI SDK ném "Invalid JSON response"
 * ⇒ đường giả lập chết âm thầm (`lib/non-streaming-fetch.ts:8-12`). Nên instance
 * model cho lượt này phải có `fetch: nonStreamingFetch`.
 */
import type { CoreMessage, LanguageModel, LanguageModelV1 } from 'ai';
import type { ToolSet } from 'ai';
import { runEmulatedLoop } from '@/lib/emulated-agent';
import type { AgentToolSet } from '@/lib/agent-tools-server';
import {
  isToolUnsupported,
  isToolsUnsupportedMessage,
  markToolsUnsupported,
} from '@/lib/tool-support-cache';

/** Môi trường để tra cache "model này chê tools". */
export interface EmulatedEnv {
  /** Base URL của provider — khoá cache. Rỗng = dùng khoá `default::model`. */
  providerBase?: string;
  /** Id model — khoá cache. */
  modelId?: string;
  /** Ép dùng đường giả lập (`VYEN_EMULATED=1`). */
  force?: boolean;
}

/**
 * true nếu lượt này nên đi đường giả lập.
 *
 * Có hai lý do: người dùng **ép** (`VYEN_EMULATED=1`), hoặc model này **đã từng chê**
 * tools trong 10 phút qua (negative cache — cùng cơ chế với web).
 */
export function shouldUseEmulated(env: EmulatedEnv): boolean {
  if (env.force) return true;
  if (!env.modelId) return false;
  return isToolUnsupported(env.providerBase ?? '', env.modelId);
}

/**
 * Ghi nhớ model vừa chê tools ⇒ 10 phút sau đó đi thẳng đường giả lập, khỏi tốn
 * một lượt native chết mỗi lượt.
 */
export function markEmulated(env: EmulatedEnv): void {
  if (!env.modelId) return;
  markToolsUnsupported(env.providerBase ?? '', env.modelId);
}

/**
 * true nếu lỗi này là do model/gateway **không hỗ trợ function calling**.
 *
 * Dùng mẫu đã đo (`TOOLS_UNSUPPORTED_RE`) — khớp **câu trả lời** "không hỗ trợ tools",
 * KHÔNG khớp chữ "tool" rơi vãi. Lý do: bản cũ `/tool|function/i` ăn vào lỗi tool của
 * CHÍNH app ("Error executing tool web_search: fetch failed") ⇒ tước agent của model đó
 * trong 10 phút, vĩnh viễn trong TTL, chỉ vì một lần tool hỏng mạng.
 */
export function isToolsUnsupportedError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { message?: unknown; data?: unknown; responseBody?: unknown };
  const chunks: string[] = [];
  if (typeof err.message === 'string') chunks.push(err.message);
  for (const value of [err.data, err.responseBody]) {
    if (typeof value === 'string') chunks.push(value);
    else if (value && typeof value === 'object') {
      try {
        chunks.push(JSON.stringify(value));
      } catch {
        /* Không serialize được ⇒ bỏ qua, không ném. */
      }
    }
  }
  return chunks.some((c) => isToolsUnsupportedMessage(c));
}

export interface EmulatedTurnOptions {
  /**
   * Instance model DỰNG RIÊNG cho lượt này — phải có `fetch: nonStreamingFetch`.
   */
  model: LanguageModelV1;
  tools: ToolSet;
  /** Transcript trước lượt này. */
  messages: readonly CoreMessage[];
  /** System prompt (chưa kèm protocol — protocol do vòng lặp tự thêm). */
  system: string;
  maxTokens?: number;
  signal?: AbortSignal;
  onText?: (text: string) => void;
  onToolCall?: (name: string) => void;
}

export interface EmulatedTurnResult {
  text: string;
  /** Message MỚI — caller ghi vào transcript. */
  messages: CoreMessage[];
  totalCalls: number;
  roundsUsed: number;
}

/**
 * Chạy một lượt giả lập với bộ tool của CLI.
 *
 * Mọi tool của CLI chạy cục bộ ⇒ chúng đi qua `tools` (server tool của vòng lặp),
 * KHÔNG qua `clientTools` (đường đó là để web yield turn về renderer).
 */
export async function runEmulatedTurn(opts: EmulatedTurnOptions): Promise<EmulatedTurnResult> {
  let text = '';
  const result = await runEmulatedLoop({
    model: opts.model as unknown as LanguageModel,
    messages: [...opts.messages],
    system: opts.system,
    tools: opts.tools as unknown as Partial<AgentToolSet>,
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.signal ? { abortSignal: opts.signal } : {}),
    onTextDelta: (delta) => {
      text += delta;
      opts.onText?.(delta);
    },
    onReasoningLine: () => {},
    onAnnotation: (payload) => {
      const tool = payload.tool as { name?: string; phase?: string } | undefined;
      if (tool?.phase === 'start' && tool.name) opts.onToolCall?.(tool.name);
    },
    onUsage: () => {},
  });

  return {
    text,
    messages: result.messages,
    totalCalls: result.totalCalls,
    roundsUsed: result.roundsUsed,
  };
}
