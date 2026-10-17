/**
 * Lỗi thật 2026-10-16: `tokenizeForBM25` (`lib/zeromem/retriever.ts`) chỉ
 * `toLowerCase()` + tách theo `[^\p{L}\d_]+`, KHÔNG bỏ dấu. Hậu quả trong app
 * tiếng Việt: hỏi "hoa hau" không bao giờ khớp trace lưu "Hoa Hậu" — cùng lỗi
 * mà `chat_recall` đã tránh được nhờ `foldText` của `lib/search-utils.ts`.
 *
 * Test ở đây khoá HÀNH VI (khớp cả hai chiều), không khoá câu chữ:
 * đổi hằng số BM25 hay đổi thứ tự lấy evidence thì test này vẫn xanh;
 * bỏ fold dấu đi thì ĐỎ.
 */
import { describe, expect, it } from 'vitest';
import { tokenizeForBM25, ZeroMemRetriever } from '@/lib/zeromem/retriever';
import { EntityContextGraph } from '@/lib/zeromem/graph';
import { TemporalHierarchy } from '@/lib/zeromem/temporal';
import type { ZeroMemTrace } from '@/lib/zeromem/types';
import { foldText } from '@/lib/search-utils';

describe('tokenizeForBM25 — tiếng Việt có dấu và không dấu phải ra cùng một token', () => {
  it('bỏ dấu trước khi tách token', () => {
    expect(tokenizeForBM25('Hoa Hậu')).toEqual(tokenizeForBM25('hoa hau'));
  });

  it('giữ nguyên cả ký tự đặc biệt tiếng Việt (đ, ă, ơ, ư)', () => {
    // foldChar đã map sẵn: đ→d, và bỏ dấu cho ă/ơ/ư.
    expect(tokenizeForBM25('Đường phố')).toContain('duong');
    expect(tokenizeForBM25('đường phố')).toContain(tokenizeForBM25('Đường phố')[0]);
  });

  it('không sinh token rỗng và vẫn loại từ dừng', () => {
    const tokens = tokenizeForBM25('sửa lỗi cho hồ sơ đăng nhập');
    expect(tokens.every((t) => t.length > 0)).toBe(true);
    expect(tokens).not.toContain('cho');
  });

  it('tương thích với foldText của app (không tự chế quy tắc khác)', () => {
    // Nếu sau này đổi cách fold, test này bắt được sự lệch đó ngay.
    const sample = 'Nguyễn Văn A — lỗi đăng nhập';
    const expected = foldText(sample).split(/[^a-z0-9]+/i).filter(Boolean);
    expect(tokenizeForBM25(sample)).toEqual(expect.arrayContaining(expected.filter((t) => t.length >= 2)));
  });
});

/** Trace tối thiểu đúng kiểu ZeroMemStore.appendTrace nhận. */
function trace(id: string, content: string, at: number): ZeroMemTrace {
  return {
    id,
    sessionId: 's1',
    episodeId: 'e1',
    role: 'tool',
    content,
    timestamp: at,
    turnIndex: at,
    entityIds: [],
  } as unknown as ZeroMemTrace;
}

describe('ZeroMemRetriever — truy hồi tiếng Việt không dấu với trace có dấu', () => {
  it('tìm được trace vì câu hỏi gõ không dấu', () => {
    const graph = new EntityContextGraph();
    const temporal = new TemporalHierarchy();
    const retriever = new ZeroMemRetriever(graph, temporal);
    const traces = [trace('t1', 'Đã sửa lỗi đăng nhập trong auth.ts, test chạy xanh', 1)];

    const pack = retriever.retrieve(traces, { query: 'sua loi dang nhap auth.ts' });

    expect(pack.evidences.length).toBeGreaterThan(0);
    expect(pack.evidences[0].text).toContain('đăng nhập');
  });

  it('không tìm thấy gì khi câu hỏi không liên quan (đường lùi để chứng minh test trên không xanh vì lý do khác)', () => {
    const graph = new EntityContextGraph();
    const temporal = new TemporalHierarchy();
    const retriever = new ZeroMemRetriever(graph, temporal);
    const traces = [trace('t1', 'Đã sửa lỗi đăng nhập trong auth.ts', 1)];

    const pack = retriever.retrieve(traces, { query: 'trien khai ha tang' });

    expect(pack.evidences).toHaveLength(0);
  });
});

/**
 * Lỗi thật 2026-10-16 #2: vòng đóng gói ngân sách trong `retrieve()` — điều kiện
 * `&& packedEvidences.length > 0` nghĩa là **evidence ĐẦU TIÊN được phép vượt
 * trần**. Một trace dài (kết quả tool có thể dài vài nghìn ký tự) với
 * `maxTokens` nhỏ làm `tokensUsed` vượt ngân sách mà không có tín hiệu nào báo.
 */
describe('ZeroMemRetriever — trần ngân sách phải được giữ kể cả evidence đầu tiên', () => {
  // Fixture PHẢI là nhiều token thật, không phải một chuỗi ký tự dài: BM25 khớp
  // theo token, nên 'x'.repeat(4000) là MỘT token 4000 ký tự và không token nào
  // khớp query — test như vậy xanh vì 0 candidate, tức xanh giả. Đây chính là lý do
  // bản test đầu tiên của tôi pass giả trước khi sửa code.
  const bigText = 'sua loi dang nhap '.repeat(340); // ~5.6k ký tự, ~2 token/lần

  it('fixture thật sự sinh candidate (chặn test xanh giả)', () => {
    const retriever = new ZeroMemRetriever(new EntityContextGraph(), new TemporalHierarchy());
    const pack = retriever.retrieve([trace('t1', bigText, 1)], { query: 'sua loi' });

    expect(pack.evidences.length).toBeGreaterThan(0);
  });

  it('không bao giờ vượt trần khi trace đầu tiên đã quá dài', () => {
    const retriever = new ZeroMemRetriever(new EntityContextGraph(), new TemporalHierarchy());
    const pack = retriever.retrieve([trace('t1', bigText, 1)], { query: 'sua loi', maxTokens: 100 });

    expect(pack.tokensUsed).toBeLessThanOrEqual(pack.tokenBudget);
  });

  it('cắt cứng phần text để vẫn nhét được trong trần (ưu tiên có dữ liệu)', () => {
    const retriever = new ZeroMemRetriever(new EntityContextGraph(), new TemporalHierarchy());
    const pack = retriever.retrieve([trace('t1', bigText, 1)], { query: 'sua loi', maxTokens: 400 });

    expect(pack.evidences.length).toBe(1);
    expect(pack.tokensUsed).toBeLessThanOrEqual(pack.tokenBudget);
    expect(pack.evidences[0].text.length).toBeLessThan(bigText.length);
  });

  it('không nhét evidence sau khi hết trần', () => {
    const retriever = new ZeroMemRetriever(new EntityContextGraph(), new TemporalHierarchy());
    const traces = [
      trace('t1', 'sua loi dang nhap '.repeat(60), 1),
      trace('t2', 'sua loi dang nhap '.repeat(60), 2),
      trace('t3', 'sua loi dang nhap '.repeat(60), 3),
    ];

    const pack = retriever.retrieve(traces, { query: 'sua loi dang nhap', maxTokens: 120 });

    expect(pack.tokensUsed).toBeLessThanOrEqual(pack.tokenBudget);
  });
});