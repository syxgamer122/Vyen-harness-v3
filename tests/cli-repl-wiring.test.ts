/**
 * Tầng nối của CLI: REPL có thực sự nhận phím Esc không.
 *
 * ============ VÌ SAO CẦN FILE NÀY ============
 *
 * Đo 2026-10-20 (reviewer độc lập): `cli/terminal.ts` có `watchInterrupt` viết đầy đủ
 * + test, `cli/repl.ts` có `AbortController` + `watchInterrupt` option + test — nhưng
 * `cli/index.ts` **không truyền** `watchInterrupt` cho `runRepl` ⇒
 * `AbortController` không bao giờ được `abort()` ⇒ **bấm Esc không làm gì cả**, dù
 * header của chính `cli/index.ts` quảng cáo:
 *
 *   Esc      cắt lượt đang chạy.
 *
 * Đó đúng là mẫu `AGENTS.md` §2.1: lời hứa ở comment + test ở tầng dưới, nhưng
 * **không có test ở tầng nối** — vì `cli/index.ts` gọi `main()` ở module scope nên
 * không import được.
 *
 * Nay `cli/index.ts` tách `buildReplOptions()` ra hàm export và chỉ chạy `main()` khi
 * được gọi trực tiếp ⇒ tầng nối test được.
 */
import { describe, expect, it } from 'vitest';
import { buildReplCore, buildReplOptions, docCauHinhGiaLap } from '@/cli/index';
import { TaoLichSu } from '@/cli/history';

function deps() {
  const terminal = {
    hoiDong: async () => null,
    hoi: async () => null,
    watchInterrupt: () => () => {},
    close: () => {},
  };
  return {
    model: {} as never,
    modelNen: {} as never,
    tools: undefined,
    session: {} as never,
    system: 'SYSTEM',
    maxTokens: 2048,
    terminal: terminal as never,
    lichSu: new TaoLichSu(),
  };
}

describe('buildReplOptions — tầng nối của CLI', () => {
  it('truyền watchInterrupt cho REPL — nếu không thì Esc không làm gì', () => {
    const opts = buildReplOptions(deps());
    expect(typeof opts.watchInterrupt, 'REPL phai nhan watchInterrupt de bat Esc').toBe('function');
  });

  /* TUI dùng CÙNG cấu hình lõi, chỉ khác adapter đọc/ghi. Nếu hai bên tự chép
   * danh sách option thì một bên quên một option là hành vi lệch mà không ai
   * thấy — nên phần lõi phải dựng ở MỘT hàm và test được. */
  it('buildReplCore không kéo adapter giao diện vào, và giữ đủ phần lõi', () => {
    /* Một lần `deps()` rồi so — gọi hai lần tạo hai object khác nhau nên `toBe`
     * (so tham chiếu) sẽ đỏ dù code đúng. */
    const d = deps();
    const core = buildReplCore(d);
    expect('ask' in core).toBe(false);
    expect('out' in core).toBe(false);
    expect('note' in core).toBe(false);
    expect('watchInterrupt' in core).toBe(false);
    expect('lichSu' in core).toBe(false);
    expect(core.modelNen).toBe(d.modelNen);
    expect(core.maxTokens).toBe(2048);
    expect(core.system).toBe('SYSTEM');
  });

  it('buildReplOptions = phần lõi + adapter terminal', () => {
    const d = deps();
    const opts = buildReplOptions(d);
    const core = buildReplCore(d);
    expect(opts.model).toBe(core.model);
    expect(opts.session).toBe(core.session);
    expect(typeof opts.ask).toBe('function');
    expect(typeof opts.out).toBe('function');
    expect(typeof opts.note).toBe('function');
  });

  it('truyền modelNen riêng cho lượt tóm tắt', () => {
    const d = deps();
    const opts = buildReplOptions(d);
    expect(opts.modelNen).toBe(d.modelNen);
    expect(opts.model).toBe(d.model);
  });

  it('truyền windowTokens khi có, và KHÔNG truyền khi không', () => {
    expect(buildReplOptions({ ...deps(), windowTokens: 32_000 }).windowTokens).toBe(32_000);
    expect('windowTokens' in buildReplOptions(deps())).toBe(false);
  });
});


/* ============ D: WIRING `VYEN_EMULATED` / providerBase / modelId ============
 *
 * Đo 2026-10-20 (reviewer độc lập): không test nào chạm tới 3 field này ⇒ một lỗi
 * gõ 1 ký tự (`'1'` → `'true'`) hoặc rơi `forceEmulated` trong `buildReplOptions`
 * làm tính năng chết âm thầm, mọi test vẫn xanh.
 */
describe('buildReplOptions — wiring đường giả lập', () => {
  it('truyền providerBase / modelId / forceEmulated xuống REPL nguyên vẹn', () => {
    const opts = buildReplOptions({
      ...deps(),
      providerBase: 'https://gw.test/v1',
      modelId: 'model-x',
      forceEmulated: true,
    });
    expect(opts.providerBase).toBe('https://gw.test/v1');
    expect(opts.modelId).toBe('model-x');
    expect(opts.forceEmulated).toBe(true);
  });

  it('KHÔNG truyền forceEmulated khi không ép (để REPL tự quyết định theo cache)', () => {
    const opts = buildReplOptions(deps());
    expect('forceEmulated' in opts).toBe(false);
  });
});

describe('docCauHinhGiaLap — đọc biến môi trường', () => {
  it('VYEN_EMULATED=1 thì ép đường giả lập; giá trị khác thì không', () => {
    expect(docCauHinhGiaLap({ VYEN_EMULATED: '1' }).forceEmulated).toBe(true);
    expect(docCauHinhGiaLap({ VYEN_EMULATED: 'true' }).forceEmulated).toBe(false);
    expect(docCauHinhGiaLap({}).forceEmulated).toBe(false);
  });

  it('lấy providerBase và modelId từ biến môi trường', () => {
    const cfg = docCauHinhGiaLap({
      VYEN_BASE_URL: 'https://gw.test/v1',
      VYEN_MODEL: 'model-x',
    });
    expect(cfg.providerBase).toBe('https://gw.test/v1');
    expect(cfg.modelId).toBe('model-x');
  });

  it('thiếu biến thì dùng chuỗi rỗng, không phải undefined (khoá cache cần chuỗi)', () => {
    const cfg = docCauHinhGiaLap({});
    expect(cfg.providerBase).toBe('');
    expect(cfg.modelId).toBe('');
  });
});
