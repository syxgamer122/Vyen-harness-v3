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
import { buildReplOptions } from '@/cli/index';
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
