/**
 * SPIKE — CLI tối thiểu để thử tầng provider với model THẬT. Không phải sản phẩm.
 *
 * ============ VÌ SAO FILE NÀY TỒN TẠI ============
 *
 * Mọi test của `lib/provider/` đều chạy với **server giả**. Chúng chứng minh
 * "adapter gửi đúng base URL, đúng header, đúng path" — điều đó là thật, nhưng
 * chưa có gì trong repo từng gọi **một model thật**. Câu hỏi "tầng provider có
 * chạy không ngoài giấy vẽ" vẫn chưa có câu trả lời.
 *
 * Làm đủ cả `lib/session/` + `lib/tools/fs-node.ts` + REPL + duyệt tool thì mất
 * nhiều ngày mà vẫn chưa chạy được một lần. File này trả lời câu hỏi đó trong
 * vài phút: dựng model từ adapter có sẵn, gọi `streamText`, in ra console.
 *
 * ============ CỐ Ý KHÔNG CÓ ============
 *
 * - Lịch sử hội thoại        → cần `lib/session/` (thay `db.ts`)
 * - Đọc/ghi file, shell      → cần `lib/tools/fs-node.ts`
 * - Duyệt tool nguy hiểm     → cần `emulated-agent` + `tool-permissions`
 * - `upstream-diagnosis`      → xem "VẤN ĐỀ ĐÃ GẶP" bên dưới
 *
 * ============ CÁCH CHẠY ============
 *
 *   # PowerShell
 *   $env:VYEN_API_KEY = "sk-..."
 *   $env:VYEN_MODEL   = "gpt-4o-mini"
 *   node cli/index.ts "xin chào"
 *
 *   # Anthropic-native
 *   $env:VYEN_API_KEY = "sk-ant-..."
 *   $env:VYEN_MODEL   = "claude-3-5-haiku-20241022"
 *   $env:VYEN_KIND    = "anthropic"
 *   node cli/index.ts "xin chào"
 *
 * Biến môi trường:
 *   VYEN_API_KEY   bắt buộc. Key được đọc TỪ BIẾN MÔI TRƯỜNG, không bao giờ
 *                  nhận qua argv — argv nằm trong lịch sử shell và trong
 *                  `Get-History`, biến môi trường thì không.
 *   VYEN_MODEL     bắt buộc. Id model theo quy ước của provider.
 *   VYEN_BASE_URL  tuỳ chọn. Bỏ trống thì adapter dùng base URL mặc định của
 *                  hãng. **Phải có `/v1`** — cả `@ai-sdk/openai` lẫn
 *                  `@ai-sdk/anthropic` đều mặc định `https://api.<host>/v1` rồi
 *                  chỉ nối phần endpoint. Thiếu `/v1` sẽ ra `/messages` thay vì
 *                  `/v1/messages`.
 *   VYEN_KIND      `anthropic` (SDK native) hoặc `openai-compatible` (mặc định).
 *
 * ============ VẤN ĐỀ ĐÃ GẶP, CHƯA GIẢI ============
 *
 * `lib/provider/upstream-diagnosis.ts` import bằng alias `@/lib/...`. Node chạy
 * file `.ts` thẳng KHÔNG đọc `paths` trong `tsconfig.json`, nên alias đó không
 * resolve được — đây là lý do file này chưa dùng tầng chẩn đoán, dù nó chạy
 * được và đã có test. Cần quyết định cách chạy CLI thật (loader nào, hay đổi
 * alias) trước khi làm bước kế tiếp. Ghi lại ở đây để không mất.
 */

import { streamText } from 'ai';
import type { AdapterKind } from '../lib/provider/adapter.ts';
import { resolveOpenAIModel } from '../lib/provider/openai-adapter.ts';
import { resolveAnthropicModel } from '../lib/provider/anthropic-adapter.ts';

const prompt = process.argv.slice(2).join(' ').trim();

if (!prompt) {
  console.error('Dung: node cli/index.ts "<noi dung can hoi>"');
  console.error('Bien bat buoc: VYEN_API_KEY, VYEN_MODEL');
  process.exit(2);
}

const apiKey = process.env.VYEN_API_KEY ?? '';
if (!apiKey) {
  // Chủ ý KHÔNG in gì cả giá trị biến — lỗi kiểu này hay in ra cả key.
  console.error('Thieu VYEN_API_KEY. Dat bien moi truoc khi chay.');
  process.exit(2);
}

const model = process.env.VYEN_MODEL ?? '';
if (!model) {
  console.error('Thieu VYEN_MODEL. Dat bien moi truoc khi chay.');
  process.exit(2);
}

// Kiểm tra thật, KHÔNG dựa vào `resolveAdapterKind`. Lý do: hàm đó trả thẳng
// `cfg.kind` (identity), nên `resolveAdapterKind({kind}) !== kind` **luôn false**
// — guard viết bằng cách đó không bao giờ bắt được gì. Chính lượt chạy thật đã
// lộ ra điều này: đặt VYEN_KIND sai mà không có gì được in.
const KINDS: readonly AdapterKind[] = ['anthropic', 'openai-compatible'];
const kind = (process.env.VYEN_KIND ?? 'openai-compatible') as AdapterKind;
if (!KINDS.includes(kind)) {
  console.error(`VYEN_KIND khong hop le: ${kind}`);
  console.error(`Gia tri dung: ${KINDS.join(' | ')}`);
  process.exit(2);
}
const cfg = {
  kind,
  apiKey,
  model,
  ...(process.env.VYEN_BASE_URL ? { baseUrl: process.env.VYEN_BASE_URL } : {}),
};

console.error(`> ${kind} / ${model}${cfg.baseUrl ? ` / ${cfg.baseUrl}` : ''}`);
console.error('> (ket qua se do la day)\n');

try {
  const lm = kind === 'anthropic' ? resolveAnthropicModel(cfg) : resolveOpenAIModel(cfg);

  /* BẮT LỖI QUA `onError`, KHÔNG DỰA VÀO try/catch QUANH VÒNG LẶP.
   *
   * Đo thật ngày 2026-10-18 với key sai: `result.textStream` **không ném** — nó
   * kết thúc im lặng sau 0 chunk. `result.finishReason` không bao giờ settle.
   * Nghĩa là `try { for await ... }` sẽ chạy trót và in ra MỘT CÂU RỖNG rồi
   * exit 0, tức báo thành công cho một lần gọi thất bại — tệ hơn cả crash.
   *
   * `onError` là nơi duy nhất lỗi stream lộ ra. Lỗi ở đây là `APICallError` —
   * đúng loại mà `lib/provider/upstream-diagnosis.ts` chẩn đoán được; chỉ là chưa
   * import được, xem "VẤN ĐỀ ĐÃ GẶP" ở đầu file.
   */
  let streamError: unknown = null;
  const result = streamText({
    model: lm,
    prompt,
    onError: ({ error }) => {
      streamError ??= error;
    },
  });

  // Stream từng chặng ra stdout. Không dùng `generateText` vì một số gateway
  // trả SSE khi request thiếu trường `stream`, khiến AI SDK ném
  // "Invalid JSON response" — xem `lib/non-streaming-fetch.ts`.
  let wrote = false;
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
    wrote = true;
  }
  // Chỉ xuống dòng khi thật sự có nội dung. Stream rỗng (lỗi 401, 429…) thì in
  // dòng trống sẽ trông như đã có câu trả lời rỗng — dễ đọc nhầm thành thành công.
  if (wrote) process.stdout.write('\n');

  if (streamError) {
    const msg = streamError instanceof Error ? streamError.message : String(streamError);
    const name = streamError instanceof Error ? streamError.name : 'Error';
    console.error(`\n> LOI (${name}): ${msg}`);
    process.exit(1);
  }

  const usage = await result.usage;
  console.error(
    `\n> xong. token: vao ${usage.promptTokens ?? '?'} / ra ${usage.completionTokens ?? '?'}`,
  );
  process.exit(0);
} catch (err) {
  // Chỉ bắt được lỗi CỐ Ý ném ra (ví dụ config sai lúc dựng model). Lỗi từ
  // provider đi qua `onError` ở trên, không đi qua đây.
  console.error(`\n> LOI: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
