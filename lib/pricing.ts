/**
 * Bảng giá công khai USD/1M token (input/output) — ước lượng chi phí BYOK.
 *
 * Match theo FRAGMENT DÀI NHẤT trong model id (pattern ReidX `runtime/cost.py`
 * + OmniRoute): "gpt-4o-mini" phải khớp entry của nó trước "gpt-4o". Model
 * không nhận diện được → null (hiển thị "—", KHÔNG bịa tiền — model local/
 * gateway free phải hiện 0$ đúng nghĩa).
 *
 * Giá là THAM KHẢO tại thời điểm viết; gateway riêng của user có thể khác.
 *
 * ĐỒNG BỘ VỚI `lib/model-contracts.ts`: model nào contract có giá (và id khớp
 * một fragment ở đây) thì HAI bảng phải ra cùng số, nếu không HUD và dòng chi
 * phí dưới tin nhắn sẽ in hai số khác nhau cho cùng một lượt. Bộ kiểm trong
 * tests/pricing.test.ts đọc chính file này và file contract để bắt lệch.
 */

export interface PriceEntry {
  fragment: string;
  /** USD / 1M input tokens. */
  in: number;
  /** USD / 1M output tokens. */
  out: number;
}

/** Sắp xếp giảm dần theo độ dài fragment lúc khởi tạo — match dài nhất thắng. */
const TABLE: readonly PriceEntry[] = [
  // OpenAI
  /* Các dòng gpt-5-* dưới đây được THÊM để khớp lib/model-contracts.ts: contract
     đã có giá nhưng bảng này thiếu fragment, nên cùng một lượt gọi mà HUD
     (calculateModelCost) hiện số còn dòng dưới tin nhắn / tab Data lại hiện "—".
     Số lấy NGUYÊN từ contract (nguồn duy nhất có trích dẫn) chứ không ước lại. */
  { fragment: 'gpt-5-6-sol', in: 3.5, out: 14.0 },
  { fragment: 'gpt-5-6-luna', in: 1.2, out: 4.8 },
  { fragment: 'gpt-5-4-mini', in: 0.25, out: 1.0 },
  { fragment: 'gpt-4.1-nano', in: 0.1, out: 0.4 },
  { fragment: 'gpt-4.1-mini', in: 0.4, out: 1.6 },
  { fragment: 'gpt-4.1', in: 2.0, out: 8.0 },
  { fragment: 'gpt-4o-mini', in: 0.15, out: 0.6 },
  { fragment: 'gpt-4o', in: 2.5, out: 10.0 },
  { fragment: 'o4-mini', in: 1.1, out: 4.4 },
  { fragment: 'o3-mini', in: 1.1, out: 4.4 },
  { fragment: 'o3', in: 2.0, out: 8.0 },
  { fragment: 'o1-mini', in: 3.0, out: 12.0 },
  /* 'o1' là fragment 2 ký tự — ngắn nhất bảng. Bắt buộc phải có để id 'o1'
     (có giá trong contract: 15/60) không rơi về null, nhưng vì match là
     SUBSTRING nên nó cũng nuốt mọi id chứa 'o1'. An toàn ở hiện tại: 'o1-mini'
     dài hơn (7) nên vẫn thắng cho id đó, và không contract/model nào khác
     trong repo chứa 'o1'. Thêm model mới có 'o1' trong tên thì phải soát lại. */
  { fragment: 'o1', in: 15.0, out: 60.0 },
  // Anthropic
  /* 'claude-opus-5' / 'claude-sonnet-5' là id CỤ THỂ chứ không phải họ model:
     'claude-opus-' chưa có trong bảng, nên nếu để fragment chung thì mọi bản
     Claude Opus sau này bị gán giá của bản 5. Khi thêm họ mới (vd 'claude-opus-6')
     thì thêm dòng riêng, đừng nới fragment này ra. */
  { fragment: 'claude-opus-5', in: 15.0, out: 75.0 },
  { fragment: 'claude-sonnet-5', in: 3.0, out: 15.0 },
  { fragment: 'claude-opus-4', in: 15.0, out: 75.0 },
  { fragment: 'claude-sonnet-4', in: 3.0, out: 15.0 },
  { fragment: 'claude-haiku-4', in: 0.8, out: 4.0 },
  { fragment: 'claude-3-5-haiku', in: 0.8, out: 4.0 },
  { fragment: 'claude-3-5-sonnet', in: 3.0, out: 15.0 },
  { fragment: 'claude-3-haiku', in: 0.25, out: 1.25 },
  // DeepSeek
  /* V4 Pro chạy qua backend đại lý và tính theo giá đỉnh của
     DeepSeek ($0.435 in / $0.87 out). Trước đây id này rơi vào fragment
     'deepseek' chung nên bị báo rẻ hơn 3 lần so với thực tế.

     CHƯA KHỚP model-contracts.ts: contract cùng id ghi 0.8/3.2 (nguồn
     api-docs.deepseek.com/pricing, đọc 2026-02-10) — gấp ~1.8 lần input và
     ~3.7 lần output. Giữ số của bảng này vì không kiểm chứng được bằng chứng
     của bên nào (môi trường soạn không ra được mạng), và contract đang được
     một agent khác sửa nên chưa chốt được bên nào đúng. Đây là ĐIỂM LỆCH ĐÃ
     BIẾT, KHÔNG phải trạng thái bình thường: bộ kiểm trong
     tests/pricing.test.ts liệt nó vào danh sách miễn trừ có tên, nên sửa id
     này ở bảng kia mà quên bảng này sẽ làm test đỏ. Muốn dứt điểm thì phải
     chốt một trong hai số (có nguồn) rồi đồng bộ CẢ HAI bảng và xoá dòng khỏi
     danh sách miễn trừ đó. */
  { fragment: 'deepseek-v4-pro', in: 0.435, out: 0.87 },
  { fragment: 'deepseek-v4', in: 0.435, out: 0.87 },
  { fragment: 'deepseek-reasoner', in: 0.55, out: 2.19 },
  { fragment: 'deepseek-r1', in: 0.55, out: 2.19 },
  { fragment: 'deepseek-chat', in: 0.14, out: 0.28 },
  { fragment: 'deepseek-v3', in: 0.14, out: 0.28 },
  { fragment: 'deepseek', in: 0.14, out: 0.28 },
  // Google
  /* Dòng gemini-3-* thêm để khớp contract. Hai fragment 'gemini-3-flash' và
     'gemini-3-1-pro' DÀI BẰNG NHAU (15) — sort trong JS ổn định nên thứ tự
     khai báo quyết định ai thắng khi id khớp cả hai. Không id nào trong repo
     khớp cả hai, nhưng khai báo theo thứ tự cố định để kết quả không phụ thuộc
     may rủi. */
  { fragment: 'gemini-3-flash', in: 0.15, out: 0.6 },
  { fragment: 'gemini-3-1-pro', in: 1.25, out: 5.0 },
  { fragment: 'gemini-2.0-flash', in: 0.1, out: 0.4 },
  { fragment: 'gemini-flash-lite', in: 0.075, out: 0.3 },
  { fragment: 'gemini-1.5-pro', in: 1.25, out: 5.0 },
  { fragment: 'gemini-flash', in: 0.15, out: 0.6 },
  { fragment: 'gemini-pro', in: 1.25, out: 5.0 },
  // Qwen / GLM / Kimi (giá API public phổ biến)
  /* Hai dòng qwen dưới đây khớp contract. Lưu ý 'qwen3.8-max' /
     'qwen3-coder-plus' có dấu CHẤM: id 'qwen3-8-max' (gạch) không khớp
     fragment, nên cần thì thêm dòng riêng chứ đừng nới thành 'qwen3' —
     'qwen3' (5 ký tự) sẽ đứng sau 'qwen-turbo'/'qwen-plus'/'qwen-max' và nuốt
     mọi qwen3.x khác. */
  { fragment: 'qwen3.8-max', in: 1.6, out: 6.4 },
  { fragment: 'qwen3-coder-plus', in: 0.8, out: 3.2 },
  { fragment: 'qwen-max', in: 1.6, out: 6.4 },
  { fragment: 'qwen-plus', in: 0.4, out: 1.2 },
  { fragment: 'qwen-turbo', in: 0.05, out: 0.2 },
  /* Provider đã gỡ GLM/ChatGLM khỏi danh mục, nhưng GIỮ bảng giá: người dùng
     BYOK vẫn có thể trỏ tới gateway khác còn phục vụ các model này. Bảng giá
     là tra cứu theo tên, không phải danh mục model khả dụng. */
  { fragment: 'glm-4-plus', in: 1.4, out: 1.4 },
  { fragment: 'glm-4', in: 0.14, out: 0.14 },
  /* 'kimi-k3' phải đứng TRƯỚC 'kimi' (dài hơn nên sort tự đưa lên, nhưng khai
     báo cạnh nhau để đọc là thấy quan hệ): contract Kimi K3 là 1.0/3.0, còn
     fragment 'kimi' chung giữ giá cũ 0.6/2.5 cho các bản Kimi khác chưa có
     contract. Trước đây K3 rơi vào 'kimi' nên HUD (1.0/3.0) và dòng tin nhắn
     (0.6/2.5) lệch nhau. */
  { fragment: 'kimi-k3', in: 1.0, out: 3.0 },
  { fragment: 'kimi', in: 0.6, out: 2.5 },
  /* MiniMax đặt sau cùng vì contract dùng id có GẠCH DƯỚI ('minimax_m3'):
     fragment phải giữ đúng gạch dưới mới khớp, và 'minimax-m3' (gạch ngang)
     nếu có gateway phục vụ thì phải thêm dòng riêng. */
  { fragment: 'minimax_m3', in: 0.3, out: 1.2 },
].sort((a, b) => b.fragment.length - a.fragment.length);

export interface ModelPrice {
  in: number;
  out: number;
}

/** Tìm giá theo fragment dài nhất khớp model id (lowercase). */
export function findModelPrice(modelId: string): ModelPrice | null {
  const id = (modelId ?? '').toLowerCase();
  if (!id) return null;
  for (const entry of TABLE) {
    if (id.includes(entry.fragment)) return { in: entry.in, out: entry.out };
  }
  return null;
}

/** Chi phí USD cho một lượt gọi; model không có giá → null (không bịa số). */
export function estimateCallCostUsd(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const price = findModelPrice(modelId);
  if (!price) return null;
  return (
    (promptTokens / 1_000_000) * price.in +
    (completionTokens / 1_000_000) * price.out
  );
}
