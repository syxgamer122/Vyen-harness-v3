/**
 * Spill ở ĐƯỜNG EMULATED — `lib/tool-result-server.ts`.
 *
 * Chuyển từ `tests/tool-limits-budget.test.ts` sang đây khi phần spill tách khỏi
 * `tool-limits.ts`. Bốn test này khoá hành vi CÒN GIỮ, nên chuyển chứ không
 * xoá. Riêng describe `loadSpillSaver` thì bị xoá: hàm đó không còn tồn tại,
 * và `tests/spill-wiring.test.ts` canh mối lo âu đó (bundle trình duyệt) theo
 * cách mạnh hơn — nó đọc artifact đã build thay vì đoán qua `typeof window`.
 *
 * Vì sao phải tách: `tool-limits.ts` nằm trong bundle trình duyệt, không được
 * import `lib/ipc.cjs`. Bản 1 lách bằng `eval('require')('./ipc.cjs')` và chết
 * trong bản build — `.next/server/chunks/` không có `ipc.cjs`, `try/catch`
 * nuốt `MODULE_NOT_FOUND`, và test ở đây VẪN XANH vì vitest nạp `ipc.cjs`
 * theo đường dẫn thật. Test trên đồ thị module không soi được lỗi build.
 */
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeToolResult } from '@/lib/tool-result-server';
import { TOOL_RESULT_MAX_CHARS, truncateToolResult } from '@/lib/tool-limits';
import { redactSecretText } from '@/lib/secret-registry';

describe('serializeToolResult — spill phần bị cắt để fs_read đọc lại', () => {
  const NGUONG = 24_000;
  const spillFiles: string[] = [];

  /** Bóc đường dẫn file spill từ dòng thông báo cho model. */
  function duongDanSpill(trong: string): string {
    const m = trong.match(/đã lưu:\s*(\S+)/);
    expect(m, `không tìm thấy dòng thông báo spill trong: ${trong.slice(-200)}`).not.toBeNull();
    return m![1];
  }

  afterEach(() => {
    for (const f of spillFiles) { try { fs.unlinkSync(f); } catch { /* đã bị dọn */ } }
    spillFiles.length = 0;
    vi.restoreAllMocks();
  });

  it('dưới ngưỡng: KHÔNG ghi file nào ra đĩa', () => {
    const spy = vi.spyOn(fs, 'writeFileSync');
    const out = serializeToolResult({ a: 'x'.repeat(1_000) }, NGUONG);
    expect(out).toContain('x');
    expect(spy).not.toHaveBeenCalled();
  });

  it('vượt ngưỡng: cho đường dẫn đọc lại, tổng ký tự vẫn ≤ ngưỡng', () => {
    const out = serializeToolResult({ a: 'x'.repeat(40_000) }, NGUONG);
    const p = duongDanSpill(out);
    spillFiles.push(p);
    expect(out).toContain('fs_read');
    expect(out).toContain('đã cắt bớt');
    expect(out.length).toBeLessThanOrEqual(NGUONG);
    expect(fs.existsSync(p)).toBe(true);
  });

  it('ghi lỗi: rơi về ĐÚNG truncateToolResult cũ, không thành lỗi', () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: không đủ chỗ');
    });
    const raw = { a: 'x'.repeat(40_000) };
    expect(serializeToolResult(raw, NGUONG))
      .toBe(truncateToolResult(redactSecretText(JSON.stringify(raw)), NGUONG));
  });

  /* Ranh giới redact thứ hai: không chỉ "trước khi cắt" (đã có test ở
   * tests/secret-registry.test.ts:260) mà "trước khi ghi đĩa". Khoá nằm ở phần
   * GIỮA — phần bị lược khỏi ngữ cảnh. Spill lưu bản thô thì khoá nằm trên đĩa
   * và không còn dấu vết gì để điều tra. */
  it('bí mật ở phần giữa không được nằm trong file spill', () => {
    const SECRET = 'sk-proj-abcdefghijklmnopqrstuvwx';
    /* Filler PHẢI có dấu cách: class [A-Za-z0-9_-]{8,} của rule sk- sẽ nuốt
     * luôn chuỗi x liền, không còn gì để redact (xem tests/secret-registry.test.ts:265).
     * 30.000 cặp = 60.000 ký tự, đủ rộng để khoá nằm chắc trong đoạn BỊ LƯỢC
     * (head ~17k, tail ~6k), không trôi vào phần đầu/đuôi vẫn giữ lại. */
    const body = 'x '.repeat(30_000) + SECRET + 'y '.repeat(30_000);
    const out = serializeToolResult({ body }, NGUONG);
    const p = duongDanSpill(out);
    spillFiles.push(p);
    // File trên đĩa không chứa khoá.
    expect(fs.readFileSync(p, 'utf8')).not.toContain(SECRET);
    // Và ngữ cảnh gửi model cũng không — khoá đã bị redact trước khi ghi.
    expect(out).not.toContain(SECRET);
    // Đuôi vẫn còn, tức phần đã lược KHÔNG bị nuốt hẳn.
    expect(out).toContain('y ');
  });

  it('hợp đồng trần: TỔNG bao gồm cả notice không bao giờ vượt ngưỡng', () => {
    // Đây là điều làm cho `room` phải trừ sẵn markerLen + notice.length. Nếu
    // một ngày ai đó chỉ chừa chỗ cho marker, notice sẽ đẩy TỔNG vượt trần và
    // hợp đồng của TOOL_RESULT_MAX_CHARS thành lời hứa rỗng.
    for (const nguong of [24_000, 8_000, 1_000]) {
      const out = serializeToolResult({ a: 'x '.repeat(20_000) }, nguong);
      expect(out.length, `ngưỡng ${nguong}`).toBeLessThanOrEqual(nguong);
    }
  });

  it('không ném với giá trị vòng tròn', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => serializeToolResult(circular)).not.toThrow();
  });

  it('ngưỡng mặc định lấy từ TOOL_RESULT_MAX_CHARS — hai đường cùng một con số', () => {
    const out = serializeToolResult({ a: 'x '.repeat(20_000) });
    expect(out.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
  });
});