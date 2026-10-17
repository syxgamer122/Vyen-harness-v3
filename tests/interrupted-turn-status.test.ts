/**
 * Lỗi F5 làm lượt đang CHỜ QUYẾT ĐỊNH đọc thành "xong".
 *
 * Đo được 2026-10-07 (`docs/design-qa/2026-10-07-turns/README.md` mục "Phát
 * hiện kèm theo" + `DESIGN.md` §15.5): dump store `messages` trước/sau một lần
 * nạp cho thấy
 *
 * ```
 * a3: status 'streaming', tools 1  →  sau khi nạp: status 'complete', tools 0
 * ```
 *
 * Hai chuyện xảy ra cùng lúc, và cả hai đều cần thiết để lỗ hiện ra:
 *
 *  1. `sanitizeToolInvocations` (`lib/db.ts`) chỉ giữ invocation đã có `result`
 *     — cố ý, để không gửi một tool-call không kết quả lên model. Nhưng nhờ đó
 *     bằng chứng "đang chờ" bị xoá sạch khỏi DB.
 *  2. Row assistant `streaming` được ghi lại thành `complete`
 *     (`lib/chat-tree-persistence.ts` `isStreamingAssistant`).
 *
 * Hệ quả: `turnStatusOf` không còn thấy tool nào chưa trả kết quả nên KHÔNG vào
 * được nhánh `waiting_approval`, rơi xuống `completed` → UI nói "xong" trong khi
 * người dùng chưa hề quyết định gì. §15.5 chốt "xong" nghĩa là agent đã dừng và
 * báo hoàn tất; đây là hai chuyện khác hẳn, và người dùng tin một trạng thái
 * không có thật.
 *
 * Sửa: GIỮ pending (`state: 'call'`) thay vì xoá, rồi để `turnStatusOf` đọc
 * `status` của row để phân biệt hai chuyện:
 *   - còn row `streaming` → phiên sống, tool đang chờ → `waiting_approval`;
 *   - hết row sống        → phiên bị ngắt       → `cancelled`.
 *
 * Cần có test đường GỬI MODEL: pending còn trong DB thì mọi đường gửi phải
 * loại nó, nếu không model nhận một tool-call không kết quả.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeToolInvocations, type StoredToolInvocation } from '@/lib/db';
import { turnStatusOf, isFoldableTurn, TURN_STATUS_LABEL } from '@/lib/turns';

const ROOT = path.resolve(__dirname, '..');

/**
 * Đọc + chuẩn hoá EOL, cùng lý do với `evidence-badge.test.ts`: `core.autocrlf`
 * làm regex `\n` lệch giữa các máy (chạy xanh ở máy này, đỏ ở CI).
 */
function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** Row assistant tối thiểu cho `turnStatusOf`. */
function assistantRow(
  toolInvocations?: Array<{ state?: string }>,
  status = 'complete',
): Parameters<typeof turnStatusOf>[0][number] {
  return { id: 'a1', role: 'assistant', status, finishReason: 'stop', toolInvocations };
}

describe('lượt bị F5 giữa lúc chờ quyết — đừng nói "xong"', () => {
  /**
   * ĐỎ khi: `sanitizeToolInvocations` xoá sạch invocation pending. Khi đó đường
   * đọc chỉ thấy row assistant đã complete và kết luận lượt "xong" — đúng lỗi
   * trong báo cáo QA.
   *
   * Giữ nguyên `state: 'call'`: đổi nó thành `'result'` là nói dối đường gửi
   * model (tool-call không kết quả), còn thêm cờ riêng thì phải sửa mọi chỗ
   * đọc. `state: 'call'` đã là sự thật đúng nhất.
   */
  it('invocation pending được GIỮ nguyên, không bị xoá', () => {
    const pending: StoredToolInvocation = {
      toolCallId: 't1',
      toolName: 'shell_run',
      args: { command: 'npm run deploy' },
      state: 'call',
    };

    const out = sanitizeToolInvocations([pending]);

    expect(out, 'phải còn phần tử — không được là undefined').toBeDefined();
    expect(out).toHaveLength(1);
    expect(out![0].toolName).toBe('shell_run');
    expect(out![0].args).toEqual({ command: 'npm run deploy' });
    /* state GIỮ NGUYÊN 'call' — không đổi thành 'result'. */
    expect(out![0].state).toBe('call');
    /* Không bịa kết quả cho một lệnh chưa chạy xong. */
    expect(out![0].result).toBeUndefined();
  });

  /**
   * ĐỎ khi: invocation ĐÃ có kết quả bị đổi mất kết quả hay nhãn. Một tool đã
   * chạy xong thì kết quả là thứ người dùng và model cần đọc lại.
   */
  it('invocation đã có kết quả thì giữ nguyên kết quả', () => {
    const done: StoredToolInvocation = {
      toolCallId: 't1',
      toolName: 'fs_read',
      args: { path: 'lib/auth.ts' },
      state: 'result',
      result: { content: 'export const x = 1;' },
    };

    const out = sanitizeToolInvocations([done])!;

    expect(out).toHaveLength(1);
    expect(out[0].state).toBe('result');
    expect(out[0].result).toEqual({ content: 'export const x = 1;' });
  });

  /**
   * ĐỎ khi: một tool bị ngắt làm mất sạch dấu vết của các tool ĐÃ chạy xong
   * trong cùng lượt. Lịch sử vẫn phải đọc được đã làm những gì.
   */
  it('tool đã xong vẫn được giữ cạnh tool còn treo', () => {
    const rows: StoredToolInvocation[] = [
      { toolCallId: 't1', toolName: 'fs_read', state: 'result', result: { ok: true } },
      { toolCallId: 't2', toolName: 'shell_run', state: 'call' },
    ];

    const out = sanitizeToolInvocations(rows)!;

    expect(out).toHaveLength(2);
    expect(out[0].state).toBe('result');
    expect(out[1].state).toBe('call');
  });

  /**
   * ĐỎ khi: `turnStatusOf` trả `completed` cho lượt có tool còn treo mà phiên
   * đã hết sống — đó là đúng lỗi trong báo cáo QA, và nhãn "xong" là nói dối
   * người dùng.
   *
   * Chốt bằng CHỮ của bảng §15.5 chứ không chỉ "khác xong". Ba trạng thái đều
   * khác "xong" và cả ba đều sai ở đây:
   *   - `waiting_approval` → UI hứa một nút Duyệt không tồn tại (phiên đã chết).
   *   - `stopping`         → §15.5 cấm đúng ca này ("không dùng khi đã chắc chắn
   *     mọi tool đã ngừng"), và nó hứa người dùng chờ một tiến trình đã chết.
   *   - `cancelled`        → dòng khớp điều kiện dương của bảng: mọi tool đã
   *     ngừng, lượt đóng ở đây. Đây là nhãn đang chốt.
   */
  it('tool treo + phiên hết sống → "đã hủy", không phải "xong"', () => {
    /* Sau F5: row assistant đã `complete` nhưng tool vẫn 'call'. */
    const rows = [assistantRow([{ state: 'call' }], 'complete')];

    const status = turnStatusOf(rows);
    expect(status).toBe('cancelled');
    expect(TURN_STATUS_LABEL[status]).toBe('đã hủy');
  });

  /**
   * ĐỎ khi: `cancelled` ở nhánh trên làm lượt BỊ HỦY bị coi là lượt không có
   * gì để xem — `isFoldableTurn` quyết định header có gập được không, và một
   * lượt gập lại là giấu đúng thứ người dùng cần đọc (tool nào bị bỏ dở).
   *
   * Đồng thời chặn đường lùi về `stopping`: `stopping` là trạng thái ĐANG chạy
   * nên không gập được — test này đứng thay cho lập luận bằng lời.
   */
  it('lượt bị ngắt thì gập được — và không phải "đang dừng"', () => {
    const status = turnStatusOf([assistantRow([{ state: 'call' }], 'complete')]);
    expect(isFoldableTurn(status)).toBe(true);
    expect(isFoldableTurn('stopping')).toBe(false);
  });

  /**
   * ĐỎ khi: nhánh sống đổi mất. Tool còn treo mà phiên còn `streaming` là
   * "chờ bạn quyết định" — dialog duyệt CÓ THẬT và người dùng bấm được ngay.
   * Đưa vào nhánh trạng thái cuối là nói dối theo chiều ngược lại.
   *
   * `streaming` ở đây là dữ kiện ĐO ĐƯỢC cho ca sống, không phải giả định:
   * lúc lượt chờ duyềt, row trợ lý vẫn ghi `status:'streaming'`
   * (`docs/design-qa/2026-10-07-turns/README.md`). Đổi điều kiện này thì ca
   * thật rơi vào nhánh "đã hủy" và test này đỏ.
   */
  it('tool treo + phiên còn sống → vẫn "chờ bạn quyết định"', () => {
    expect(turnStatusOf([assistantRow([{ state: 'call' }], 'streaming')])).toBe('waiting_approval');
  });

  /**
   * ĐỎ khi: bộ lọc trong `attachToolResultParts` (`route.ts`) ngừng loại
   * invocation chưa có kết quả. Đó là ràng buộc SỐNG CÒN của thay đổi ở trên:
   * pending giờ nằm lại trong DB, nên nếu đường gửi model không lọc thì model
   * nhận một tool-call `state:'result'` KHÔNG có `result` — nói dối rằng lệnh
   * đã chạy xong, và provider từ chối part thiếu output.
   *
   * Soi source chứ không gọi hàm: `attachToolResultParts` là hàm private trong
   * `route.ts`, không export được. Đổi tên hàm là test ĐỎ ngay — đó là mốc
   * phải sửa test kèm, đúng thói quen của repo (`observer-banner-affordance`).
   */
  it('đường gửi model vẫn loại invocation chưa có kết quả', () => {
    const src = read('app/api/chat/route.ts');
    const i = src.indexOf('function attachToolResultParts(');
    expect(i, 'không tìm thấy attachToolResultParts — đổi tên hàm thì sửa test kèm').toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf('\n}\n', i));
    expect(
      body,
      "attachToolResultParts ngừng lọc state result — model nhận tool-call rỗng",
    ).toContain("filter((inv) => inv.state === 'result')");
  });

  /**
   * ĐỎ khi: `sanitizeToolInvocations` ngừng giữ pending — quay lại xoá là lỗ
   * F5 quay lại, lượt "chờ bạn quyết định" đọc thành "xong".
   *
   * Soi source để khoá ĐIỀU KIỆN, không chỉ kết quả: đổi `state: 'call'` thành
   * `'result'` là nói dối model, còn bỏ hẳn nhánh này là mất dấu vết. Cả hai
   * đều phải đỏ.
   */
  it('sanitize giữ pending với state call — không đổi, không bỏ', () => {
    const src = read('lib/db.ts');
    const i = src.indexOf('export function sanitizeToolInvocations(');
    expect(i, 'không tìm thấy sanitizeToolInvocations — đổi tên hàm thì sửa test kèm').toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf('\n}\n', i));
    expect(body, 'sanitize không còn giữ pending').toContain("if (inv.state !== 'result')");
    expect(body, 'sanitize đổi state thành result — nói dối model').toContain("state: 'call'");
    /* Không được bịa kết quả cho một lệnh chưa chạy xong. */
    expect(body, 'sanitize bịa result cho pending').not.toMatch(/state: 'call'[\s\S]{0,120}result:/);
  });
});
