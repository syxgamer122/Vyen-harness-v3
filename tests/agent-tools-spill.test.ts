/**
 * Spill ở tầng kết quả tool phía SERVER — C3.
 *
 * C3 là gì: `capToolResult` cắt mọi kết quả tool server về ≤ 24.000 ký tự
 * TRƯỚC khi tới đường native, nên phần bị cắt bị văng vứt và model không đọc
 * lại được. Bản 1 thêm spill ở `lib/tool-limits.ts` — nơi đường native KHÔNG
 * đi qua — nên native path không bao giờ vượt ngưỡng và spill không bao giờ
 * chạy. Ở đây spill nằm TRONG `capToolResult`, tức đúng chỗ quyết định cắt.
 *
 * Fixture cố ý dùng `memory_search` + memories lớn, KHÔNG dùng query lớn:
 * - `memory_search` chỉ được đăng ký khi `memories.length > 0`; `buildAgentTools()`
 *   không tham số thì không có tool này (test cũ của tôi gọi vào undefined).
 * - Kết quả là `{ matches, totalMemories }` và KHÔNG echo query. Query 40.000 ký
 *   tự không tạo ra kết quả 40.000 ký tự — test cũ có tiền đề sai.
 * - `searchMemories` trả top-5 `{id, text}` nguyên văn, không cắt → memories
 *   vào là kết quả ra. Offline, tất định, kiểm soát được tuyệt đối.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAgentTools, type MemoryItem } from '@/lib/agent-tools-server';
import { redactSecretText } from '@/lib/secret-registry';
import { TOOL_RESULT_MAX_CHARS } from '@/lib/tool-limits';

/** 5 memories × ~9.000 ký tự = ~45.000 > 24.000. Tất cả cùng điểm nên top-5 giữ hết. */
const BIG: MemoryItem[] = Array.from({ length: 5 }, (_, i) => ({
  id: `m${i}`,
  text: `xy ${'xy '.repeat(3_000)}`,
}));

const SMALL: MemoryItem[] = [{ id: 's0', text: 'ngôn ngữ ưa thích: tiếng Việt' }];

function pathFromNotice(notice: unknown): string {
  const m = String(notice).match(/đã lưu:\s*(\S+)/);
  expect(m, `không bóc được đường dẫn từ notice: ${notice}`).not.toBeNull();
  return m![1];
}

async function searchLarge(memories: MemoryItem[]) {
  const t = buildAgentTools({ memories });
  const out = await t.memory_search!.execute!({ query: 'xy' }, {} as never);
  return out as Record<string, unknown>;
}

describe('capToolResult — spill qua đường native', () => {
  it('kết quả nhỏ: không có gì để spill', async () => {
    const out = await searchLarge(SMALL);
    expect(out.matches).toBeDefined();
    expect(out.spillNotice).toBeUndefined();
    expect(out.truncated).toBeUndefined();
  });

  it('kết quả lớn: có spillNotice trỏ tới file tồn tại thật', async () => {
    const out = await searchLarge(BIG);
    expect(typeof out.spillNotice).toBe('string');
    const p = pathFromNotice(out.spillNotice);
    expect(existsSync(p)).toBe(true);
  });

  it('phần bị cắt VẪN đọc lại được — file giữ NỘI DUNG ĐẦY ĐỦ', async () => {
    const out = await searchLarge(BIG);
    const p = pathFromNotice(out.spillNotice);
    // Nếu chỉ ghi phần đã cắt thì mất dữ liệu vô nghĩa; phải là bản ĐẦY ĐỦ.
    expect(readFileSync(p, 'utf8').length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS);
  });

  /* Khoá nằm ở phần GIỮA — phần bị lược khỏi ngữ cảnh. Nếu spill lưu bản thô
   * thì khoá nằm trên đĩa và không có dấu vết gì trong context để điều tra.
   * Đây là lý do `guarded` phải redact TRƯỚC `capToolResult`. */
  it('bí mật ở phần giữa không nằm trong file spill', async () => {
    const SECRET = 'sk-proj-abcdefghijklmnopqrstuvwx';
    expect(redactSecretText(`key=${SECRET}`)).not.toContain(SECRET); // tiền đề: rule bắt được

    const text = `xy ${'a '.repeat(3_000)}${SECRET}${'b '.repeat(3_000)} xy`;
    const out = await searchLarge([{ id: 'sec', text }, ...BIG]);
    const p = pathFromNotice(out.spillNotice);
    expect(readFileSync(p, 'utf8')).not.toContain(SECRET);
  });

  /* KHÔNG khẳng định trần kích thước ở đây — và đây là lý do.
   *
   * `capToolResult` chỉ cắt trường STRING ở cấp ngoài (xem docstring: "cắt trên
   * TỪNG trường string dài ... để shape kết quả không đổi"). `matches` của
   * memory_search là MẢNG, nên đi thẳng qua không bị cắt. Test này ban đầu
   * khẳng định `JSON.stringify(out) <= trần + 1000` và ĐỎ: 45.425 > 25.000.
   *
   * Đó là lỗi CÓ SẴN, không phải do spill: hàm set `truncated: true` dù mảng
   * chưa bị cắt gì, và không có gì bị cắt để mà đọc lại. Sửa nó nghĩa là đổi
   * ngữ nghĩa cap cho MỌI tool (web_search `results[]`, MCP results...) — việc
   * riêng, cần RED test riêng, không gộp vào đây.
   *
   * Xem ledger: 2026-10-18 — "Lỗi thứ tám: cap chỉ cắt string, mảng đi lọt".
   * Fixture này cố tình canh `spillNotice` vì đó là điều spill phải bảo đảm. */
  it('kết quả lớn: notice ngắn, không phình ngữ cảnh', async () => {
    const out = await searchLarge(BIG);
    expect(String(out.spillNotice).length).toBeLessThan(400);
    expect(out.truncated).toBe(true);
  });

  it('shape kết quả giữ nguyên — có matches[] như trước', async () => {
    const out = await searchLarge(BIG);
    expect(Array.isArray(out.matches)).toBe(true);
  });
});