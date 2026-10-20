/**
 * Đảo ESM của CLI — entry point của TUI.
 *
 * ============ VÌ SAO MỘT THƯ MỤC RIÊNG CÓ `package.json` ============
 *
 * `@opentui/core` chỉ nạp được bằng **ESM** (đo 2026-10-20: `require` vào thì
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`; và "Top-level await is currently not supported
 * with the cjs output format"). Mà cả repo này là CommonJS. Nên thư mục này có
 * `package.json` riêng với `{"type":"module"}` — đó là ranh giới duy nhất giữa
 * hai thế giới. Từ CJS, ta gọi vào đây bằng `await import('./tui/entry.tsx')`
 * (chạy động, không phải lúc nạp).
 *
 * ============ TẠI SAO CHỈ CÓ PLACEHOLDER ============
 *
 * Task 2 của plan chỉ cần một cái **thật** để kiểm cổng: TUI mở full-screen
 * trên Windows Terminal thật, bấm Esc thì thoát sạch. Nội dung thật (vòng lặp
 * hội thoại, transcript, cổng duyệt) thay ở Task 8 — và placeholder này sẽ bị
 * xoá hẳn, không giữ lại làm "phần dùng được một phần".
 */
/** @jsxImportSource @opentui/react */
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { theme } from './theme.ts';

declare global {
  interface ImportMeta {
    /**
     * Node ≥ 24.2: `true` khi module này là **điểm vào của tiến trình**.
     *
     * `@types/node` của repo là bản 20 nên chưa khai báo thuộc tính này, mà
     * runtime là Node 26 ⇒ khai báo tại chỗ, thay vì ép kiểu ở nơi dùng.
     */
    readonly main?: boolean;
  }
}

export interface TuiCreateOptions {
  workspace: string;
  modelLabel: string;
  windowTokens: number;
}

export interface TuiSession {
  run(): Promise<void>;
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
  const root = createRoot(renderer);
  root.render(
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg} padding={2}>
      <text fg={theme.text}>Vyen TUI — {opts.workspace}</text>
      <text fg={theme.muted}>esc de thoat</text>
    </box>,
  );

  let daDong = false;
  const close = (): void => {
    if (daDong) return;
    daDong = true;
    renderer.destroy();
  };

  return {
    /* PLACEHOLDER: chờ Esc rồi thoát. Task 8 thay bằng vòng lặp hội thoại thật. */
    run: () =>
      new Promise<void>((resolve) => {
        const h = (k: { name?: string }): void => {
          if (k.name === 'escape') {
            renderer.keyInput.off('keypress', h);
            resolve();
          }
        };
        renderer.keyInput.on('keypress', h);
      }),
    close,
  };
}

/* Chạy trực tiếp để kiểm cổng: `npx tsx cli/tui/entry.tsx` */
if (import.meta.main) {
  void (async () => {
    const t = await createTui({ workspace: 'dev', modelLabel: 'dev', windowTokens: 200_000 });
    await t.run();
    t.close();
  })();
}
