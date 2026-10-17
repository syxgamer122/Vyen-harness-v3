/**
 * Persist settings của store thật (zustand persist middleware).
 *
 * Bug gốc: partialize thiếu agentTools + forceEmulatedTools — hai toggle user
 * bấm trong composer và gửi kèm mỗi request, F5 là mất.
 *
 * Lưu ý môi trường: zustand 5 gắn api.persist SAU khi kiểm storage; trong
 * node không có window.localStorage nên nó return sớm và store KHÔNG có
 * .persist. Phải dựng stub window trước rồi mới import store (dynamic import
 * vì import tĩnh bị hoist lên trước phần setup).
 */

import { beforeAll, describe, expect, it } from 'vitest';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

type StoreModule = typeof import('@/lib/store');
let useAppStore: StoreModule['useAppStore'];

beforeAll(async () => {
  (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
  ({ useAppStore } = await import('@/lib/store'));
});

type PersistedShape = {
  activeProviderId?: unknown;
  theme?: unknown;
  settings?: Record<string, unknown>;
};

type PersistOptions = {
  partialize?: (s: unknown) => PersistedShape;
  merge?: (persisted: unknown, current: unknown) => { settings?: Record<string, unknown> };
  version?: number;
};

/** Mọi khoá settings mà partialize phải giữ qua reload. */
const REQUIRED_SETTING_KEYS = [
  'model',
  'visionModel',
  'temperature',
  'thinkingLevel',
  'systemPrompt',
  'perf',
  'sendOnEnter',
  'autoCompact',
  'webSearch',
  'agentTools',
  'forceEmulatedTools',
  'agentMode',
  'stagingSandbox',
  'autoPilot',
  'approvalPolicy',
  'toolPermissions',
  'modelFavorites',
  'recentModels',
] as const;

describe('partialize — đủ khoá settings sống qua reload', () => {
  it('chứa toàn bộ khoá yêu cầu, kể cả agentTools + forceEmulatedTools', () => {
    const { partialize } = useAppStore.persist.getOptions() as PersistOptions;
    expect(partialize).toBeTypeOf('function');
    const persisted = partialize!(useAppStore.getState());
    const keys = Object.keys(persisted.settings ?? {});
    for (const k of REQUIRED_SETTING_KEYS) {
      // Đảo điều kiện: thiếu khoá nào (đúng bug cũ thiếu agentTools) → đỏ ở khoá đó.
      expect(keys, `partialize thiếu khoá settings.${k}`).toContain(k);
    }
  });

  it('phản ánh giá trị user vừa đổi, không phải mặc định cứng', () => {
    useAppStore.getState().updateSettings({ agentTools: false, forceEmulatedTools: true });
    const { partialize } = useAppStore.persist.getOptions() as PersistOptions;
    const persisted = partialize!(useAppStore.getState());
    expect(persisted.settings?.agentTools).toBe(false);
    expect(persisted.settings?.forceEmulatedTools).toBe(true);
  });
});

describe('updateSettings — approvalPolicy là nguồn sự thật duy nhất', () => {
  /*
   * `agentTools` và `autoPilot` là GIÁ TRỊ SUY RA, không phải setting độc lập:
   * `store.ts:355-357` tính cả hai từ `approvalPolicy` rồi ghi đè lên bất kỳ thứ
   * gì caller truyền vào. Gọi chỉ với `approvalPolicy` phải cho ra đủ ba khoá —
   * đây là hợp đồng mà nhánh `/mode` dựa vào.
   */
  it('set approvalPolicy tự suy ra autoPilot + agentTools', () => {
    const set = useAppStore.getState().updateSettings;

    set({ approvalPolicy: 'never' });
    expect(useAppStore.getState().settings.approvalPolicy).toBe('never');
    expect(useAppStore.getState().settings.autoPilot).toBe(true);
    expect(useAppStore.getState().settings.agentTools).toBe(true);

    set({ approvalPolicy: 'chat_only' });
    expect(useAppStore.getState().settings.autoPilot).toBe(false);
    expect(useAppStore.getState().settings.agentTools).toBe(false);

    set({ approvalPolicy: 'smart' });
    expect(useAppStore.getState().settings.autoPilot).toBe(true);
    expect(useAppStore.getState().settings.agentTools).toBe(true);

    set({ approvalPolicy: 'always' });
    expect(useAppStore.getState().settings.autoPilot).toBe(false);
    expect(useAppStore.getState().settings.agentTools).toBe(true);
  });

  it('autoPilot truyền vào bị ghi đè, không phải cửa thứ hai để bật YOLO', () => {
    // Đột biến bị chặn: đổi `next.autoPilot = ...` thành chỉ đọc `partial.autoPilot`
    // thì caller bật được YOLO khi policy đang Manual — hai đường vào một trạng thái.
    useAppStore.getState().updateSettings({ approvalPolicy: 'always', autoPilot: true });
    expect(useAppStore.getState().settings.approvalPolicy).toBe('always');
    expect(useAppStore.getState().settings.autoPilot).toBe(false);
  });
});

describe('modelChains (Mixture-of-Models) đã bị gỡ khỏi Settings', () => {
  /*
   * Tính năng này CẦN bị gỡ và test này canh việc gỡ đó.
   *
   * UI từng cấu hình đầy đủ chuỗi fallback theo 8 hạng mục, nhưng
   * `chatRequestBody` không gửi `customChains` lên server, nên nó không bao giờ
   * có tác dụng. Giữ UI là bắt người dùng nhập công sức rồi tưởng đã áp dụng.
   *
   * `modelRouting` (Lead/Worker) thì đã nối đúng vào body nên PHẢI còn — đây
   * là test bảo vệ ranh giới, không phải test chỉ "mọi thứ biến mất".
   */
  it('không còn field modelChains trong Settings', () => {
    // Ép kiểu qua `unknown`: `Settings`/`AppState` là interface nên không có
    // index signature, `as Record<string, unknown>` trực tiếp là TS2352.
    const s = useAppStore.getState().settings as unknown as Record<string, unknown>;
    expect('modelChains' in s, 'modelChains phải bị gỡ khỏi Settings').toBe(false);
  });

  it('không còn ghi modelChains vào persist', () => {
    const { partialize } = useAppStore.persist.getOptions() as PersistOptions;
    const persisted = partialize!(useAppStore.getState());
    expect(Object.keys(persisted.settings ?? {})).not.toContain('modelChains');
  });

  it('GIỮ modelRouting — Lead/Worker đã nối đúng vào body, không được gỡ theo', () => {
    // Ép kiểu qua `unknown`: `Settings`/`AppState` là interface nên không có
    // index signature, `as Record<string, unknown>` trực tiếp là TS2352.
    const s = useAppStore.getState().settings as unknown as Record<string, unknown>;
    expect(s).toHaveProperty('modelRouting');
    const { partialize } = useAppStore.persist.getOptions() as PersistOptions;
    const persisted = partialize!(useAppStore.getState());
    expect(Object.keys(persisted.settings ?? {})).toContain('modelRouting');
  });
});

describe('dead state theme đã bị gỡ (app light-only)', () => {
  /*
   * `theme` và `setTheme` chết từ đầu: không nơi nào gọi `setTheme`, và theme
   * không được áp dụng ở đâu (không `data-theme`, không `<html class="dark">`).
   *
   * Test này canh việc GỠ. App cố ý chỉ có một theme sáng — `DESIGN.md` §7 và
   * ràng buộc cứng #6; `tests/design-system.test.ts:1746-1754` cùng
   * `tests/tool-trace.test.ts:772-774` đã cấm `dark:`. Thêm nút đổi theme là
   * nút bấm không đổi màu, nên phải gỡ chứ không phải thêm UI.
   */
  it('không còn state theme trong store', () => {
    const s = useAppStore.getState() as unknown as Record<string, unknown>;
    expect('theme' in s, 'state theme phải bị gỡ').toBe(false);
  });

  it('không còn action setTheme', () => {
    const s = useAppStore.getState() as unknown as Record<string, unknown>;
    expect('setTheme' in s, 'action setTheme phải bị gỡ').toBe(false);
  });

  it('không ghi theme vào persist', () => {
    const { partialize } = useAppStore.persist.getOptions() as PersistOptions;
    const persisted = partialize!(useAppStore.getState());
    expect(Object.keys(persisted)).not.toContain('theme');
  });

  it('storage cũ có khoá theme vẫn nạp được, không hỏng phiên', () => {
    // Review Focus #5: user đang có `theme` trong localStorage từ phiên trước.
    // `merge` spread `...p` nên khoá lạ lọt vào object — phải bị bỏ qua chứ
    // không được ném lỗi làm hỏng cả phiên.
    const { merge } = useAppStore.persist.getOptions() as PersistOptions;
    expect(() =>
      merge!({ theme: 'dark', settings: {} } as never, useAppStore.getState()),
    ).not.toThrow();
  });
});

describe('merge — khôi phục persisted không cần tăng version', () => {
  it('agentTools + forceEmulatedTools từ storage đè lên default', () => {
    const { merge } = useAppStore.persist.getOptions() as PersistOptions;
    expect(merge).toBeTypeOf('function');
    const merged = merge!(
      { settings: { agentTools: false, forceEmulatedTools: true } },
      useAppStore.getState(),
    );
    expect(merged.settings?.agentTools).toBe(false);
    expect(merged.settings?.forceEmulatedTools).toBe(true);
  });

  it('storage cũ không có khoá mới thì giữ default hiện tại', () => {
    const { merge } = useAppStore.persist.getOptions() as PersistOptions;
    const merged = merge!({ settings: {} }, useAppStore.getState());
    expect(typeof merged.settings?.agentTools).toBe('boolean');
    expect(typeof merged.settings?.forceEmulatedTools).toBe('boolean');
  });

  it('perf.throttleMs user từng đặt vẫn thắng mặc định mới', () => {
    const { merge } = useAppStore.persist.getOptions() as PersistOptions;
    const merged = merge!(
      { settings: { perf: { throttleMs: 250 } } },
      useAppStore.getState(),
    );
    expect(merged.settings?.perf).toMatchObject({ throttleMs: 250 });
  });

  it('modelFavorites + recentModels từ storage đè lên default rỗng', () => {
    const { merge } = useAppStore.persist.getOptions() as PersistOptions;
    const merged = merge!(
      {
        settings: {
          modelFavorites: [{ id: 'gpt-5-6-sol', providerId: '__server__' }],
          recentModels: [{ id: 'kimi-k3', providerId: '__server__', ts: 123 }],
        },
      },
      useAppStore.getState(),
    );
    expect(merged.settings?.modelFavorites).toEqual([
      { id: 'gpt-5-6-sol', providerId: '__server__' },
    ]);
    expect(merged.settings?.recentModels).toEqual([
      { id: 'kimi-k3', providerId: '__server__', ts: 123 },
    ]);
  });

  it('entry rác trong favorites/recents bị vứt, entry tốt sống sót (không throw)', () => {
    const { merge } = useAppStore.persist.getOptions() as PersistOptions;
    const merged = merge!(
      {
        settings: {
          modelFavorites: [
            { id: 'ok', providerId: 'p1' },
            { id: '', providerId: 'p1' },
            null,
            'junk',
          ],
          recentModels: [
            { id: 'ok', providerId: 'p1', ts: 5 },
            { id: 'bad-ts', providerId: 'p1', ts: 'x' as unknown as number },
            { id: 'no-ts', providerId: 'p1' },
          ],
        },
      },
      useAppStore.getState(),
    );
    expect(merged.settings?.modelFavorites).toEqual([{ id: 'ok', providerId: 'p1' }]);
    expect(merged.settings?.recentModels).toEqual([{ id: 'ok', providerId: 'p1', ts: 5 }]);
  });

  it('storage không có hai field mới (bản cũ) → default mảng rỗng, không undefined', () => {
    const { merge } = useAppStore.persist.getOptions() as PersistOptions;
    const merged = merge!({ settings: {} }, useAppStore.getState());
    expect(Array.isArray(merged.settings?.modelFavorites)).toBe(true);
    expect(Array.isArray(merged.settings?.recentModels)).toBe(true);
    expect(merged.settings?.modelFavorites).toEqual([]);
    expect(merged.settings?.recentModels).toEqual([]);
  });
});

describe('default throttleMs', () => {
  it('phiên mới (chưa có storage) bắt đầu ở 50ms để token lên sớm hơn', () => {
    expect(useAppStore.getState().settings.perf.throttleMs).toBe(50);
  });

  it('version persist vẫn là 2 — thêm field optional không cần migrate', () => {
    const { version } = useAppStore.persist.getOptions() as PersistOptions;
    expect(version).toBe(2);
  });
});
