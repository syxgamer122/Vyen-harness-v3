/**
 * Đảo ESM của CLI — entry point của TUI.
 *
 * ============ VÌ SAO MỘT THƯ MỤC RIÊNG CÓ `package.json` ============
 *
 * `@opentui/core` chỉ nạp được bằng **ESM** (`require` vào thì
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`; và "Top-level await is currently not supported
 * with the cjs output format"). Mà cả repo này là CommonJS. Nên thư mục này có
 * `package.json` riêng với `{"type":"module"}` — đó là ranh giới duy nhất giữa
 * hai thế giới. Từ CJS, ta gọi vào đây bằng `await import('./tui/entry.tsx')`
 * (chạy động, không phải lúc nạp).
 */
/** @jsxImportSource @opentui/react */
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { runRepl } from '../repl.ts';
import type { ReplOptions } from '../repl.ts';
import type { ApprovalBroker } from '../approval-broker.ts';
import { createTuiStore, type TuiStore } from './bridge.ts';
import { App } from './app.tsx';

export interface TuiCreateOptions {
  /** Tên thư mục làm việc (đã rút gọn). */
  workspace: string;
  /** Tên model, hiện ở dòng trạng thái. */
  modelLabel: string;
  /** Cửa sổ ngữ cảnh — header hiện phần trăm còn lại. */
  windowTokens: number;
  /** Cổng duyệt tool. */
  approval: ApprovalBroker;
}

/** Cấu hình lõi của vòng lặp + ghi chú khởi động. */
export type TuiRunOptions = Omit<
  ReplOptions,
  'ask' | 'out' | 'note' | 'watchInterrupt' | 'lichSu'
> & {
  startupNotes: string[];
};

export interface TuiSession {
  /** Chạy vòng lặp hội thoại trên màn hình này. */
  run(opts: TuiRunOptions): Promise<void>;
  /**
   * Dựng màn hình **tĩnh** (không chạy vòng lặp) và chờ Esc.
   *
   * Dùng để soi giao diện mà **không cần API key** — lúc đó mới kiểm được
   * "màu có đúng brand không, layout có vỡ không" mà không tốn một lượt gọi
   * provider nào.
   */
  preview(): Promise<void>;
  /** Đóng renderer và trả terminal về trạng thái cũ. */
  close(): void;
}

/**
 * Dựng renderer + mount React root.
 *
 * `createCliRenderer` là bước duy nhất cần FFI (Node ≥ 26.4.0) — vì vậy cổng
 * vào của TUI kiểm tra phiên bản Node trước khi gọi tới đây.
 */
export async function createTui(opts: TuiCreateOptions): Promise<TuiSession> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  let daDong = false;

  const close = (): void => {
    if (daDong) return;
    daDong = true;
    renderer.destroy();
  };

  const mount = (store: TuiStore): void => {
    const root = createRoot(renderer);
    root.render(
      <AppRoot
        store={store}
        workspace={opts.workspace}
        modelLabel={opts.modelLabel}
        windowTokens={opts.windowTokens}
        approval={opts.approval}
      />,
    );
  };

  return {
    async run(core: TuiRunOptions): Promise<void> {
      const store = createTuiStore({
        messages: core.session.messages,
        approval: opts.approval,
        startupNotes: core.startupNotes,
        keyInput: renderer.keyInput,
      });
      mount(store);

      try {
        await runRepl({
          ...core,
          ask: store.ask,
          out: store.out,
          note: store.note,
          watchInterrupt: store.watchInterrupt,
          onToolCall: store.onToolCall,
          onToolResult: store.onToolResult,
          onToolError: store.onToolError,
          onUsage: store.onUsage,
        });
      } finally {
        store.close();
      }
    },

    async preview(): Promise<void> {
      const store = createTuiStore({
        messages: [],
        approval: opts.approval,
        startupNotes: ['> day la ban xem truoc (khong co API key)'],
        keyInput: renderer.keyInput,
      });
      mount(store);
      await new Promise<void>((resolve) => {
        const h = (k: { name?: string }): void => {
          if (k.name !== 'escape') return;
          renderer.keyInput.off('keypress', h);
          resolve();
        };
        renderer.keyInput.on('keypress', h);
      });
      store.close();
    },

    close,
  };
}

/**
 * Gốc React: đọc state của store và vẽ lại khi nó đổi.
 *
 * `useSyncExternalStore` là đúng ở đây vì store là nguồn sự thật **bên ngoài**
 * React (vòng lặp hội thoại ghi vào nó từ lúc này), không phải state của
 * component.
 */
function AppRoot({
  store,
  workspace,
  modelLabel,
  windowTokens,
  approval,
}: {
  store: TuiStore;
  workspace: string;
  modelLabel: string;
  windowTokens: number;
  approval: ApprovalBroker;
}): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  return (
    <App
      workspace={workspace}
      modelLabel={modelLabel}
      windowTokens={windowTokens}
      tokens={state.tokens}
      blocks={state.blocks}
      running={state.running}
      {...(state.approval ? { approval: state.approval } : {})}
      onSubmit={(line) => store.submit(line)}
      onApproval={(id, dongY) => approval.traLoi(id, dongY)}
    />
  );
}
