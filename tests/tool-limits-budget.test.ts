/**
 * Bảo vệ các sửa lỗi kiểm toán kiến trúc tool:
 *  - ngân sách gọi tool sống XUYÊN request (chống vòng lặp qua resubmit fs_*)
 *  - manual sinh từ schema thật (chống drift 3-nguồn-sự-thật)
 *  - trần kết quả tool áp cho CẢ hai đường native/emulated
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildAgentTools,
  formatToolNameList,
  formatToolProtocolManual,
  ALL_TOOL_PROTOCOL_NAMES,
} from '@/lib/agent-tools-server';
import {
  __clearAllToolCallBudgets,
  getToolCallBudget,
  resetToolCallBudget,
  checkDoomLoop,
} from '@/lib/tool-call-budget';
import {
  DOOM_LOOP_THRESHOLD,
  TOOL_RESULT_MAX_CHARS,
  serializeToolResult,
  truncateToolResult,
} from '@/lib/tool-limits';
import { redactSecretText } from '@/lib/secret-registry';

describe('loadSpillSaver — không được làm hỏng bundle trình duyệt', () => {
  /* lib/tool-limits.ts được import bởi react/use-chat-orchestration.ts:57, tức
   * nằm trong bundle trình duyệt. Nếu loader chạm `require('../ipc.cjs')` ở đây
   * thì bundle sập; nếu ném lỗi thì hàm bị gọi ở trình duyệt sẽ vỡ.
   *
   * PHẢI nạp lại module ở mỗi case: loader cache kết quả ở module scope, nên
   * nếu case đầu đã gọi ở Node thì case sau nhận cache và `window` bị bỏ qua
   * — test xanh dù guard có hay không. */
  async function freshLoader(): Promise<() => unknown> {
    vi.resetModules();
    const mod = await import('@/lib/tool-limits');
    return mod.loadSpillSaver as () => unknown;
  }

  it('không ném khi môi trường không có Node', async () => {
    const load = await freshLoader();
    expect(() => load()).not.toThrow();
  });

  it('trong Node (không `window`): trả về hàm lưu spill', async () => {
    const load = await freshLoader();
    expect(typeof load()).toBe('function');
  });

  it('có `window` — tức trình duyệt: trả null', async () => {
    const load = await freshLoader();
    vi.stubGlobal('window', {});
    try {
      expect(load()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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
  });

  it('dưới ngưỡng: KHÔNG ghi file nào ra đĩa', () => {
    const spy = vi.spyOn(fs, 'writeFileSync');
    try {
      const out = serializeToolResult({ a: 'x'.repeat(1_000) }, NGUONG);
      expect(out).toContain('x');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
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
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: không đủ chỗ');
    });
    try {
      const raw = { a: 'x'.repeat(40_000) };
      expect(serializeToolResult(raw, NGUONG))
        .toBe(truncateToolResult(redactSecretText(JSON.stringify(raw)), NGUONG));
    } finally {
      spy.mockRestore();
    }
  });

  /* Review Focus #3 — nguy hiểm nhất: khoá bí mật nằm ở PHẦN GIỮA, phần bị
   * lược bỏ khỏi ngữ cảnh. Nếu spill lưu bản thô, khoá đó nằm trên đĩa và
   * không còn dấu vết. Ranh giới redact thứ hai: không chỉ "trước khi cắt"
   * (đã có test ở tests/secret-registry.test.ts:260) mà "trước khi ghi đĩa". */
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
});

beforeEach(() => __clearAllToolCallBudgets());
afterEach(() => {
  vi.unstubAllGlobals();
  __clearAllToolCallBudgets();
});

describe('ngân sách gọi tool sống xuyên request', () => {
  it('gọi trùng ở request sau VẪN chạy thật (không còn dedupe chặn)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<a class="result-link" href="https://e.com/a">T</a>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const first = await buildAgentTools({ conversationId: 'chat-1' }).web_search.execute!(
      { query: 'tin mới' },
      {} as never,
    );
    expect((first as any).results.length).toBeGreaterThan(0);

    /* Request 2 = resubmit sau khi client chạy fs_* → buildAgentTools() gọi LẠI.
       Trước đây bị dedupe từ chối; nay phải chạy thật, không kèm note chặn. */
    const second = await buildAgentTools({ conversationId: 'chat-1' }).web_search.execute!(
      { query: 'tin mới' },
      {} as never,
    );
    expect((second as any).note).toBeUndefined();
    expect((second as any).results.length).toBeGreaterThan(0);
  });

  it('hội thoại KHÁC nhau không ảnh hưởng ngân sách của nhau', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<a class="result-link" href="https://e.com/a">T</a>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    await buildAgentTools({ conversationId: 'A' }).web_search.execute!({ query: 'q' }, {} as never);
    const other = await buildAgentTools({ conversationId: 'B' }).web_search.execute!(
      { query: 'q' },
      {} as never,
    );
    expect((other as any).results.length).toBeGreaterThan(0);
  });

  /**
   * Bucket ngân sách theo hội thoại vẫn tồn tại và vẫn rò provenance host —
   * đây là thứ chống "gọi tool ở hội thoại khác để né trần", KHÔNG phải trần
   * lượt. Sau khi bỏ MAX_TOOL_CALLS_PER_TURN, bucket chỉ còn phần lịch sử +
   * provenance. Đảo điều kiện: xoá phần này là test ĐỎ.
   */
  it('bucket sống xuyên các request (cùng conversationId thấy cùng state)', () => {
    const a = getToolCallBudget('prov-1');
    a.recentSignatures.push('web_search:{}');
    // Lần gọi sau: đây là CÙNG object — đây mới là "sống xuyên request".
    const b = getToolCallBudget('prov-1');
    expect(b.recentSignatures).toContain('web_search:{}');
  });

  it('lượt người dùng MỚI reset trần nhưng GIỮ provenance host', () => {
    const bucket = getToolCallBudget('c1');
    bucket.recentSignatures.push('web_search:{}');
    bucket.knownHosts.add('example.com');

    resetToolCallBudget('c1');

    const after = getToolCallBudget('c1');
    // URL người dùng dán ở lượt trước vẫn hợp lệ cho web_fetch lượt sau.
    expect(after.knownHosts.has('example.com')).toBe(true);
    // Lịch sử doom-loop được dọn — lượt mới không bị oan từ lượt cũ.
    expect(after.recentSignatures.length).toBe(0);
  });

  it('không có conversationId → bucket dùng-một-lần (không rò rỉ trạng thái)', () => {
    const a = getToolCallBudget(undefined);
    a.knownHosts.add('leak.example');
    expect(getToolCallBudget(undefined).knownHosts.size).toBe(0);
  });
});

describe('provenance tích lũy qua các lượt', () => {
  it('host từ web_search lượt trước vẫn cho phép web_fetch ở request sau', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('duck') || String(url).includes('search')
          ? new Response('<a class="result-link" href="https://trusted.com/a">T</a>', {
              headers: { 'content-type': 'text/html' },
            })
          : new Response('<html><body><article>Nội dung trang đủ dài để trích xuất.</article></body></html>', {
              headers: { 'content-type': 'text/html' },
            }),
      ),
    );

    await buildAgentTools({ conversationId: 'prov' }).web_search.execute!(
      { query: 'x' },
      {} as never,
    );

    // Request MỚI: trước khi sửa, knownHosts rỗng → bị từ chối oan.
    const fetched = await buildAgentTools({ conversationId: 'prov' }).web_fetch.execute!(
      { url: 'https://trusted.com/a' },
      {} as never,
    );
    expect((fetched as any).blocked).toBeUndefined();
  });

  it('host lạ vẫn bị chặn (guard không bị nới lỏng)', async () => {
    const out = await buildAgentTools({ conversationId: 'prov2' }).web_fetch.execute!(
      { url: 'https://evil.example/page' },
      {} as never,
    );
    expect((out as any).blocked).toBe('provenance');
  });
});

describe('manual sinh từ schema thật — chống drift', () => {
  it('fs_read có start_line/line_count (bản viết tay cũ thiếu)', () => {
    const manual = formatToolProtocolManual(['fs_read']);
    expect(manual).toContain('start_line');
    expect(manual).toContain('line_count');
  });

  it('chữ ký args phản ánh optional bằng dấu ?', () => {
    const manual = formatToolProtocolManual(['fs_search']);
    expect(manual).toContain('"query": string');
    expect(manual).toContain('"is_regex"?: boolean');
  });

  it('ràng buộc provenance của web_fetch tới được model emulated', () => {
    expect(formatToolProtocolManual(['web_fetch'])).toMatch(/BỊ TỪ CHỐI/);
  });

  it('chỉ render tool được yêu cầu, không rò tool khác', () => {
    const manual = formatToolProtocolManual(['web_search']);
    expect(manual).toContain('web_search');
    expect(manual).not.toContain('fs_write');
    expect(manual).not.toContain('memory_save');
  });

  it('mọi tool trong ALL_TOOL_PROTOCOL_NAMES đều render được (không sót tên)', () => {
    const manual = formatToolProtocolManual(ALL_TOOL_PROTOCOL_NAMES);
    for (const name of ALL_TOOL_PROTOCOL_NAMES) {
      expect(manual).toContain(`- ${name}:`);
    }
  });

  it('danh sách ngắn cho native rẻ hơn manual đầy đủ nhiều lần', () => {
    const short = formatToolNameList(ALL_TOOL_PROTOCOL_NAMES);
    const full = formatToolProtocolManual(ALL_TOOL_PROTOCOL_NAMES);
    expect(short.length * 5).toBeLessThan(full.length);
    expect(short).toContain('fs_edit');
  });
});

describe('trần kết quả tool', () => {
  it('truncateToolResult giữ đầu và đuôi, bỏ ruột', () => {
    const raw = `${'A'.repeat(20_000)}${'B'.repeat(20_000)}`;
    const out = truncateToolResult(raw, 1_000);
    expect(out.length).toBeLessThan(raw.length);
    expect(out.startsWith('A')).toBe(true);
    expect(out.endsWith('B')).toBe(true);
    expect(out).toMatch(/đã cắt bớt/);
  });

  it('kết quả nhỏ đi qua nguyên vẹn', () => {
    expect(truncateToolResult('{"ok":true}', 1_000)).toBe('{"ok":true}');
  });

  it('serializeToolResult không ném với giá trị vòng tròn', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => serializeToolResult(circular)).not.toThrow();
  });

  it('web_fetch nội dung khổng lồ bị cắt nhưng GIỮ shape (url/title còn nguyên)', async () => {
    const huge = 'x'.repeat(TOOL_RESULT_MAX_CHARS * 2);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(`<html><body><article>${huge}</article></body></html>`, {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    const tools = buildAgentTools({
      conversationId: 'big',
      allowedHosts: ['https://ok.com/'],
    });
    const out = (await tools.web_fetch.execute!(
      { url: 'https://ok.com/page' },
      {} as never,
    )) as Record<string, unknown>;

    expect(JSON.stringify(out).length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS + 500);
    expect(typeof out.url).toBe('string');
  });
});

/**
 * Doom-loop detector (port doom_loop.rs của evot) — loop-guard DUY NHẤT còn
 * lại cho tool server: cùng một call lặp LIÊN TIẾP tới ngưỡng thì trả steering
 * message buộc model đổi hướng. Dedupe và trần call/lượt đã được gỡ.
 */
describe('doom-loop detector', () => {
  it('call đầu tiên → không trigger, signature được ghi', () => {
    const bucket = getToolCallBudget('dl-1');
    const result = checkDoomLoop(bucket, 'web_search:{"query":"a"}');
    expect(result.triggered).toBe(false);
    expect(result.counted).toBe(1);
    expect(bucket.recentSignatures).toEqual(['web_search:{"query":"a"}']);
  });

  it(`lặp ${DOOM_LOOP_THRESHOLD} lần liên tiếp → trigger`, () => {
    const bucket = getToolCallBudget('dl-2');
    const sig = 'web_search:{"query":"x"}';
    for (let i = 0; i < DOOM_LOOP_THRESHOLD - 1; i++) {
      const r = checkDoomLoop(bucket, sig);
      expect(r.triggered).toBe(false);
    }
    const triggered = checkDoomLoop(bucket, sig);
    expect(triggered.triggered).toBe(true);
    expect(triggered.counted).toBe(DOOM_LOOP_THRESHOLD);
  });

  it('trigger rồi KHÔNG push signature → detector giữ ở mép ngưỡng', () => {
    const bucket = getToolCallBudget('dl-3');
    const sig = 'weather:{"location":"Hanoi"}';
    for (let i = 0; i < DOOM_LOOP_THRESHOLD; i++) checkDoomLoop(bucket, sig);
    // Lần thứ 4 vẫn trigger, counted vẫn đúng ngưỡng
    const again = checkDoomLoop(bucket, sig);
    expect(again.triggered).toBe(true);
    expect(again.counted).toBe(DOOM_LOOP_THRESHOLD);
    // recentSignatures không phình vô hạn
    expect(bucket.recentSignatures.length).toBeLessThanOrEqual(DOOM_LOOP_THRESHOLD);
  });

  it('call KHÁC xen vào → reset chuỗi, không trigger', () => {
    const bucket = getToolCallBudget('dl-4');
    const a = 'web_search:{"query":"a"}';
    const b = 'web_search:{"query":"b"}';
    checkDoomLoop(bucket, a);
    checkDoomLoop(bucket, a);
    // B xen vào phá chuỗi
    checkDoomLoop(bucket, b);
    // A lại xuất hiện nhưng chỉ đếm từ sau B → counted=1
    const r = checkDoomLoop(bucket, a);
    expect(r.triggered).toBe(false);
    expect(r.counted).toBe(1);
  });

  it('resetToolCallBudget dọn lịch sử doom-loop', () => {
    const bucket = getToolCallBudget('dl-5');
    const sig = 'fs_read:{"path":"a.ts"}';
    checkDoomLoop(bucket, sig);
    checkDoomLoop(bucket, sig);
    resetToolCallBudget('dl-5');
    const after = getToolCallBudget('dl-5');
    expect(after.recentSignatures.length).toBe(0);
    // Sau reset, cùng signature lại bắt đầu từ 1
    const r = checkDoomLoop(after, sig);
    expect(r.triggered).toBe(false);
    expect(r.counted).toBe(1);
  });

  it('bucket dùng-một-lần (không conversationId) cũng hỗ trợ doom-loop', () => {
    const bucket = getToolCallBudget(undefined);
    const sig = 'test:{}';
    for (let i = 0; i < DOOM_LOOP_THRESHOLD - 1; i++) checkDoomLoop(bucket, sig);
    expect(checkDoomLoop(bucket, sig).triggered).toBe(true);
  });
});

describe('doom-loop qua guarded() — integration', () => {
  it(`lặp ${DOOM_LOOP_THRESHOLD} lần → nhận steering message thay vì kết quả`, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<a class="result-link" href="https://e.com/a">T</a>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const tools = () => buildAgentTools({ conversationId: 'dl-int' });

    // Lần 1-2: chạy thật (chưa tới ngưỡng doom-loop)
    const first = await tools().web_search.execute!({ query: 'doom-test' }, {} as never);
    expect((first as any).results.length).toBeGreaterThan(0);
    const second = await tools().web_search.execute!({ query: 'doom-test' }, {} as never);
    expect((second as any).note).toBeUndefined();

    // Lần 3+: doom-loop steering (mạnh)
    for (let i = 0; i < 3; i++) {
      const doom = await tools().web_search.execute!({ query: 'doom-test' }, {} as never);
      expect((doom as any).note).toMatch(/LIÊN TIẾP/i);
      expect((doom as any).note).toMatch(/đổi hướng|thử.*khác|vướng/i);
    }
  });

  it('call khác xen vào → doom-loop reset, call gốc chạy lại bình thường', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<a class="result-link" href="https://e.com/a">T</a>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const tools = () => buildAgentTools({ conversationId: 'dl-reset' });

    // Lặp 2 lần (chưa trigger)
    await tools().web_search.execute!({ query: 'q1' }, {} as never);
    await tools().web_search.execute!({ query: 'q1' }, {} as never);

    // Call khác xen vào
    await tools().web_search.execute!({ query: 'q2' }, {} as never);

    // q1 lại xuất hiện — counted reset về 1, chạy thật, KHÔNG phải doom-loop
    const after = await tools().web_search.execute!({ query: 'q1' }, {} as never);
    expect((after as any).note).toBeUndefined();
  });
});
