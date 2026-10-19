/**
 * Vòng đời terminal — ba lời hứa trước đây **không có test nào canh**.
 *
 * ============ VÌ SAO TEST ĐƯỢC ============
 *
 * `stdin` và `readline` đều là tham số, nên ở đây ta dựng đồ vật giả thay vì
 * cần terminal thật. Không có cách này thì ba lời hứa dưới đây chỉ là chữ.
 *
 * Ba lời hứa (review độc lập 2026-10-19, bảng "Claims without coverage"):
 *   1. `stdin.pause()` không được bao giờ gọi — gọi là treo cả REPL từ lượt 2.
 *   2. `watchInterrupt` phải gỡ listener `'data'` và trả lại raw mode.
 *   3. Listener `'keypress'` phải được gỡ sau mỗi lần chờ dòng.
 */
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createTerminal, type TerminalInput } from '@/cli/terminal';
import { TaoLichSu } from '@/cli/history';

/** stdin giả — ghi lại mọi lệnh để test kiểm. */
class FakeStdin extends EventEmitter {
  isRaw = false;
  soPause = 0;
  soResume = 0;
  rawModeCalls: boolean[] = [];
  setRawMode(m: boolean) {
    this.rawModeCalls.push(m);
    this.isRaw = m;
    return this;
  }
  pause() {
    this.soPause++;
    return this;
  }
  resume() {
    this.soResume++;
    return this;
  }
}

function fakeInterface() {
  const state = {
    question: [] as string[],
    dong: [] as string[],
    /** Câu trả lời cho lần hỏi tới; `null` = ném (readline đóng). */
    traVe: [] as (string | null)[],
    dongDaHoi: 0,
  };
  const rl = {
    question: async (q: string) => {
      state.dong.push(q);
      const i = state.dongDaHoi++;
      const a = state.traVe[i];
      if (a === null) throw new Error('readline was closed');
      return a;
    },
    write: () => true,
    close: () => undefined,
  };
  return { rl: rl as never, state };
}

describe('terminal — lời hứa 1: KHÔNG BAO GIỜ dừng stdin', () => {
  it('`stdin.pause()` không bao giờ được gọi', async () => {
    const stdin = new FakeStdin();
    const { rl, state } = fakeInterface();
    state.traVe = ['cau 1'];
    const t = createTerminal({ stdin: stdin as never, taoInterface: () => rl });

    await t.hoiDong(new TaoLichSu());
    t.watchInterrupt(() => {})();
    t.close();

    expect(stdin.soPause, 'stdin.pause() se lam REPL treo tu luot thu hai').toBe(0);
  });
});

describe('terminal — lời hứa 2: watchInterrupt dọn dẹp', () => {
  it('gỡ listener `data` khi dọn', () => {
    const stdin = new FakeStdin();
    const { rl } = fakeInterface();
    const t = createTerminal({ stdin: stdin as never, taoInterface: () => rl });

    const don = t.watchInterrupt(() => {});
    expect(stdin.listenerCount('data'), 'chua bat listener').toBe(1);
    don();
    expect(stdin.listenerCount('data'), 'listener con lai').toBe(0);
  });

  it('trả lại raw mode về trạng thái trước', () => {
    const stdin = new FakeStdin();
    stdin.isRaw = false;
    const { rl } = fakeInterface();
    const t = createTerminal({ stdin: stdin as never, taoInterface: () => rl });

    const don = t.watchInterrupt(() => {});
    expect(stdin.isRaw, 'phai bat raw mode khi lang nghe').toBe(true);
    don();
    expect(stdin.isRaw, 'phai tra lai raw mode cu').toBe(false);
  });

  it('bấm Esc thì gọi hàm hủy', () => {
    const stdin = new FakeStdin();
    const { rl } = fakeInterface();
    const t = createTerminal({ stdin: stdin as never, taoInterface: () => rl });

    let daHuy = 0;
    t.watchInterrupt(() => daHuy++);
    stdin.emit('data', Buffer.from([0x1b]));
    expect(daHuy, 'Esc phai huy luot').toBe(1);
  });

  it('phím mũi tên KHÔNG được coi là Esc', () => {
    const stdin = new FakeStdin();
    const { rl } = fakeInterface();
    const t = createTerminal({ stdin: stdin as never, taoInterface: () => rl });

    let daHuy = 0;
    t.watchInterrupt(() => daHuy++);
    stdin.emit('data', Buffer.from([0x1b, 0x5b])); // mũi tên lên
    expect(daHuy, 'mui ten khong phai Esc').toBe(0);
  });
});

describe('terminal — lời hứa 3: listener keypress gỡ sau mỗi lần chờ', () => {
  it('sau khi hỏi xong thì không còn listener keypress', async () => {
    const stdin = new FakeStdin();
    const { rl, state } = fakeInterface();
    state.traVe = ['cau 1', 'cau 2'];
    const t = createTerminal({ stdin: stdin as never, taoInterface: () => rl });

    await t.hoiDong(new TaoLichSu());
    expect(stdin.listenerCount('keypress'), 'listener keypress con lai').toBe(0);
    await t.hoiDong(new TaoLichSu());
    expect(stdin.listenerCount('keypress')).toBe(0);
  });

  it('EOF (readline đóng) thì trả null chứ không ném', async () => {
    const stdin = new FakeStdin();
    const { rl, state } = fakeInterface();
    state.traVe = [null];
    const t = createTerminal({ stdin: stdin as never, taoInterface: () => rl });
    await expect(t.hoiDong(new TaoLichSu())).resolves.toBeNull();
  });
});
