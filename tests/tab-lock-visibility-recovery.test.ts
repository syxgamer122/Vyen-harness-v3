/*
 * Tab quay lại foreground thì phải tự lấy lại quyền — không bắt người dùng
 * bấm nút.
 *
 * `TabLockCoordinator` phát hiện tab chính đóng băng: observer không nhận
 * HEARTBEAT quá 5s thì bật cờ frozen, và UI hiện băng "Tab chính bị đóng băng ở
 * nền" kèm nút "Chiếm quyền điều khiển" (components/chat-interface.tsx:94-100).
 * Nhưng không có gì tự giành lại: người dùng phải bấm. Tệ hơn, tình huống hay
 * gặp nhất KHÔNG kèm cờ frozen — họ chuyển tab, tab kia vẫn giữ lock bình
 * thường, quay lại thấy mình ở OBSERVER và không gõ được.
 *
 * Luật sửa: tab ĐANG HIỆN là tab người dùng đang nhìn, nên nó được quyền giành
 * lại. Nhưng chỉ khi tab chính đã đóng băng — hai tab cùng hiện (chia đôi màn
 * hình) thì cả hai đều còn heartbeat, và giành vô điều kiện sẽ ping-pong.
 *
 * Test chạy environment 'node' nên phải dựng `document`/`navigator.locks`/
 * `BroadcastChannel`. Đây là giả lập phần trình duyệt, KHÔNG mock mô-đun nội
 * bộ: coordinator, StorageFencing và mọi timer đều là mã thật.
 *
 * Mỗi `it` ghi rõ DÒNG nào đổi làm nó ĐỎ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TabLockCoordinator } from '@/core/agent-runtime/tab-lock';

const CHAT = 'chat-1';

/** BroadcastChannel tối thiểu: chỉ cần postMessage và onmessage. */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly posted: unknown[] = [];
  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  close(): void {}
}

/** Gửi HEARTBEAT tới coordinator như tab chính thật sẽ gửi. */
function receiveHeartbeat(chatId = CHAT): void {
  const ch = FakeBroadcastChannel.instances[0];
  ch?.onmessage?.({ data: { type: 'HEARTBEAT', chatId, tabId: 'leader', ts: Date.now() } });
}

let visibility: 'hidden' | 'visible' = 'hidden';
let visibilityListeners: Array<() => void> = [];
let lockGranted: boolean;
/** `steal: true` chỉ được cấp lock khi cờ này bật — dựng được lần cướp thất bại. */
let stealAllowed = true;
let lockRequests: Array<{ options: Record<string, unknown> }> = [];

/** Bật tab trở lại hiện và bắn `visibilitychange`. */
function tabBecomesVisible(): void {
  visibility = 'visible';
  const listeners = visibilityListeners;
  visibilityListeners = [];
  for (const fn of listeners) fn();
}

/** Tab đi ẩn: sự kiện bắn ra nhưng trạng thái là `hidden`. */
function tabBecomesHidden(): void {
  visibility = 'hidden';
  const listeners = visibilityListeners;
  visibilityListeners = [];
  for (const fn of listeners) fn();
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeBroadcastChannel.instances = [];
  visibility = 'hidden';
  visibilityListeners = [];
  lockGranted = false;
  stealAllowed = true;
  lockRequests = [];

  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'visibilitychange') visibilityListeners.push(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      if (type !== 'visibilitychange') return;
      visibilityListeners = visibilityListeners.filter((l) => l !== fn);
    },
  });
  vi.stubGlobal('navigator', {
    locks: {
      request: (
        _name: string,
        options: Record<string, unknown>,
        cb: (lock: unknown) => unknown,
      ) => {
        lockRequests.push({ options });
        const granted = options.steal ? stealAllowed : options.ifAvailable ? lockGranted : true;
        void cb(granted ? { held: true } : null);
        // Lock thật giữ promise này tới khi được giải phóng.
        return new Promise(() => {});
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('tab-lock — tab quay lại hiện thì tự lấy lại quyền', () => {
  it('giành lại lock khi tab chính đã đóng băng và tab này hiện lại', async () => {
    const coordinator = new TabLockCoordinator();
    const onLeader = vi.fn();
    const onLost = vi.fn();
    const frozen: boolean[] = [];
    coordinator.onLeaderFrozen((f) => frozen.push(f));

    // Tab khác đang giữ lock → tab này là OBSERVER.
    lockGranted = false;
    const mode = await coordinator.acquireRuntimeLock(CHAT, onLeader, onLost);
    expect(mode).toBe('OBSERVER');

    // Không tab nào heartbeat trong 5s → tab chính bị coi là đóng băng.
    await vi.advanceTimersByTimeAsync(6000);
    expect(frozen, 'phải phát hiện tab chính đóng băng').toContain(true);

    // Người dùng chuyển lại sang tab này.
    lockGranted = true;
    tabBecomesVisible();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      lockRequests.some((r) => r.options.steal === true),
      'phải xin lock với steal, không phải ifAvailable (lock kia vẫn còn)',
    ).toBe(true);
    expect(onLeader, 'phải báo đã lên LEADER').toHaveBeenCalled();
  });

  it('KHÔNG giành khi tab chính vẫn đang heartbeat — tránh ping-pong', async () => {
    const coordinator = new TabLockCoordinator();
    const onLeader = vi.fn();
    coordinator.onLeaderFrozen(() => {});

    lockGranted = false;
    await coordinator.acquireRuntimeLock(CHAT, onLeader, vi.fn());

    // Tab chính vẫn sống: heartbeat tới khi nãy, chưa quá 5s.
    receiveHeartbeat();
    await vi.advanceTimersByTimeAsync(3000);

    tabBecomesVisible();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      lockRequests.filter((r) => r.options.steal === true),
      'tab chính còn sống thì không được cưỡng',
    ).toHaveLength(0);
    expect(onLeader).not.toHaveBeenCalled();
  });

  it('nghe visibilitychange khi đang observer, và bỏ nghe khi thôi observer', async () => {
    const coordinator = new TabLockCoordinator();
    const onLeader = vi.fn();

    lockGranted = false;
    await coordinator.acquireRuntimeLock(CHAT, onLeader, vi.fn());
    expect(
      visibilityListeners.length,
      'phải đăng ký listener khi bắt đầu làm observer',
    ).toBe(1);

    await vi.advanceTimersByTimeAsync(6000);
    coordinator.release();
    expect(
      visibilityListeners.length,
      'release phải gỡ listener — không rò rỉ sang phiên sau',
    ).toBe(0);

    stealAllowed = true;
    tabBecomesVisible();
    await vi.advanceTimersByTimeAsync(0);
    expect(onLeader, 'đã release thì không được tự giành lại').not.toHaveBeenCalled();
  });

  it('tab ẩn thì không giành, kể cả khi tab chính đã đóng băng', async () => {
    const coordinator = new TabLockCoordinator();
    const onLeader = vi.fn();

    lockGranted = false;
    await coordinator.acquireRuntimeLock(CHAT, onLeader, vi.fn());
    await vi.advanceTimersByTimeAsync(6000);

    // Sự kiện có BẮN thật. Bản trước xoá danh sách listener rồi mới duyệt nó
    // ⇒ vòng lặp 0 lần, test xanh kể cả khi guard `hidden` ở tab-lock.ts bị xoá.
    tabBecomesHidden();
    stealAllowed = true;
    await vi.advanceTimersByTimeAsync(0);

    expect(
      lockRequests.filter((r) => r.options.steal === true),
      'tab đang ẩn thì không được giành — sẽ cướp ngay quyền của người đang dùng',
    ).toHaveLength(0);
  });

  it('tự giành dùng callback của lần cướp MỚI NHẤT, không dùng callback cũ', async () => {
    /*
     * `forceStealLock` phải cập nhật `leaderCallbacks`. Nếu không, sau một lần
     * bấm tay mà cướp thất bại, lần tự giành về sau gọi lại closure của lần
     * `acquireRuntimeLock` cũ. `reduceTabRuntimeState` (use-agent-runtime.ts:81-91)
     * bỏ kết quả có `requestId` cũ ⇒ tab GIỮ LOCK THẬT mà UI vẫn kẹt ở OBSERVER.
     */
    const coordinator = new TabLockCoordinator();
    const firstAcquire = vi.fn();
    const afterManualSteal = vi.fn();

    lockGranted = false;
    await coordinator.acquireRuntimeLock(CHAT, firstAcquire, vi.fn());

    // Người dùng bấm "Chiếm quyền điều khiển" nhưng lần cướp thất bại → vẫn observer.
    stealAllowed = false;
    await coordinator.forceStealLock(CHAT, afterManualSteal, vi.fn());
    expect(afterManualSteal, 'cướp thất bại thì không được báo LEADER').not.toHaveBeenCalled();

    // Tab chính đóng băng, người dùng quay lại tab này.
    await vi.advanceTimersByTimeAsync(6000);
    stealAllowed = true;
    lockGranted = true;
    tabBecomesVisible();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      afterManualSteal,
      'phải dùng callback của lần cướp tay, không phải của lần acquire đầu',
    ).toHaveBeenCalled();
    expect(
      firstAcquire,
      'gọi lại callback cũ là báo LEADER bằng requestId cũ — UI sẽ bỏ và kẹt OBSERVER',
    ).not.toHaveBeenCalled();
  });
  it('tab ĐANG HIỆN và tab chính đã đóng băng thì tự giành, không cần sự kiện nào', async () => {
    /*
     * Không chạm `visibilitychange` lần nào: tab hiện sẵn từ đầu, tab chính im
     * quá 5s. Trước khi sửa, vòng kiểm tra chỉ bật cờ + banner rồi bắt người
     * dùng bấm tay — đúng lỗ hổng của đợt trước.
     */
    const coordinator = new TabLockCoordinator();
    const onLeader = vi.fn();
    visibility = 'visible';
    lockGranted = false;

    await coordinator.acquireRuntimeLock(CHAT, onLeader, vi.fn());
    await vi.advanceTimersByTimeAsync(6000);

    expect(
      lockRequests.filter((r) => r.options.steal === true),
      'tab đang hiện + tab chính đóng băng thì phải tự giành',
    ).not.toHaveLength(0);
    expect(onLeader).toHaveBeenCalled();
  });

  it('mỗi lần đóng băng chỉ thử giành MỘT lần, heartbeat là lần đóng băng mới', async () => {
    /*
     * Không có cờ thì vòng 2s sẽ giành lặp lại mãi khi tab kia không nhận được
     * heartbeat — đúng cái ping-pong mà PLAN.md §11.1 cấm.
     */
    const coordinator = new TabLockCoordinator();
    const onLeader = vi.fn();
    visibility = 'visible';
    lockGranted = false;
    stealAllowed = false; // cướp thất bại, tab kia vẫn im

    await coordinator.acquireRuntimeLock(CHAT, onLeader, vi.fn());
    await vi.advanceTimersByTimeAsync(20000); // ~4 lần kiểm tra
    expect(
      lockRequests.filter((r) => r.options.steal === true).length,
      'cùng một lần đóng băng không được thử giành nhiều lần',
    ).toBe(1);

    // Tab chính sống lại rồi đóng băng lần nữa → được thử lại.
    receiveHeartbeat();
    stealAllowed = true;
    lockGranted = true;
    await vi.advanceTimersByTimeAsync(6000);

    expect(
      lockRequests.filter((r) => r.options.steal === true).length,
      'một lần đóng băng mới thì được thử lại',
    ).toBe(2);
    expect(onLeader).toHaveBeenCalled();
  });
});
