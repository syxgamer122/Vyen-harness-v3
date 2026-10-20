/** @jsxImportSource @opentui/react */
import React, { act, useSyncExternalStore } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LanguageModelV1, LanguageModelV1StreamPart } from 'ai';
import { z } from 'zod';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { runRepl } from '@/cli/repl';
import { openSession, sessionFileFor } from '@/cli/session';
import { createApprovalBroker } from '@/cli/approval-broker';
import { createTuiStore, type TuiStore } from '../cli/tui/bridge';
import { App } from '../cli/tui/app';

/**
 * KỊCH BẢN END-TO-END: model gọi tool cần duyệt → hộp duyệt hiện → người
 * dùng trả lời → tool chạy (hoặc bị từ chối) → model trả lời → **transcript
 * trên đĩa** phải chứa câu trả lời đó.
 *
 * ============ VÌ SAO TEST NÀY TỒN TẠI ============
 *
 * Đo 2026-10-20: feature "đường giả lập cho CLI" ship với 1 Critical — câu trả
 * lời của model **không bao giờ** được ghi vào transcript (người dùng thấy trên
 * màn hình nhưng transcript trên đĩa không có). Test tầng hàm không bắt được
 * lỗi tầng hệ thống đó — chỉ một kịch bản chạy thật mới bắt được.
 *
 * ============ VÌ SAO DỰNG LẠI RENDERER (KHÔNG DÙNG `testRender`) ============
 *
 * `testRender` gắn luôn node React vào renderer ⇒ không lấy được **bàn phím thật
 * của renderer** trước khi dựng store. Mà bàn phím thật là thứ duy nhất bắt
 * được lỗi "Esc trong hộp duyệt vừa từ chối tool vừa CẮT LƯỢT": dùng bản giả
 * thì đường cắt lượt của TUI không hề được kiểm.
 */
/** React chi can co coIS_REACT_ACT_ENVIRONMENT de ct hoat dong. */
const reactEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

const DONE = {
  type: 'finish' as const,
  finishReason: 'stop' as const,
  usage: { promptTokens: 1, completionTokens: 1 },
};

/** Model giả: lượt 1 gọi tool, lượt 2 trả lời chữ. */
function stubModel() {
  let i = 0;
  const kichBan: Array<Array<Record<string, unknown>>> = [
    [
      { type: 'tool-call', toolCallId: 't1', toolName: 'fs_write', args: '{"path":"a.txt"}' },
      { ...DONE, finishReason: 'tool-calls' },
    ],
    [{ type: 'text-delta', textDelta: 'da ghi xong' }, DONE],
  ];
  const model: LanguageModelV1 = {
    specificationVersion: 'v1',
    provider: 'stub',
    modelId: 'stub-1',
    defaultObjectGenerationMode: 'tool',
    doGenerate: async () => {
      throw new Error('stub khong ho tro doGenerate');
    },
    doStream: () => {
      const parts = kichBan[Math.min(i, kichBan.length - 1)];
      i++;
      return Promise.resolve({
        stream: new ReadableStream<LanguageModelV1StreamPart>({
          start(ctrl) {
            for (const p of parts) ctrl.enqueue(p as LanguageModelV1StreamPart);
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      });
    },
  };
  return model;
}

const PHIM = (name: string) =>
  ({
    name,
    sequence: name === 'return' ? '\r' : name,
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    eventType: 'press' as const,
    repeated: false,
  }) as never;

/** Màn hình **sống**: vẽ lại mỗi khi store đổi (giống `AppRoot` thật). */
function LiveApp({ store }: { store: TuiStore }): React.ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  return (
    <App
      workspace="du-an"
      modelLabel="stub"
      windowTokens={200000}
      tokens={state.tokens}
      blocks={state.blocks}
      running={state.running}
      {...(state.approval ? { approval: state.approval } : {})}
      onSubmit={(line) => store.submit(line)}
    />
  );
}

describe('kịch bản end-to-end: duyệt tool rồi trả lời', () => {
  const chay = async (traLoi: 'y' | 'return' | 'escape') => {
    const state = mkdtempSync(path.join(tmpdir(), 'vyen-tui-e2e-'));
    const dir = 'C:\\du-an';
    const actEnv = reactEnv.IS_REACT_ACT_ENVIRONMENT;
    reactEnv.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const broker = createApprovalBroker();
      const model = stubModel();
      const session = openSession(state, dir);

      const t = await createTestRenderer({ width: 90, height: 20 });
      const store = createTuiStore({
        messages: session.messages,
        approval: broker,
        /* Ghi chú khởi động phải hiện trong transcript — vào alternate screen thì
         * in ra stderr là mất, nên nó là một phần của màn hình, không phải log. */
        startupNotes: ['> cong cu: 3'],
        /* Bàn phím THẬT của renderer — xem ghi chú đầu file. */
        keyInput: t.renderer.keyInput,
      });
      const root = createRoot(t.renderer);
      await act(async () => {
        root.render(<LiveApp store={store} />);
      });

      /* Tool giả: xin duyệt thật qua broker, rồi chạy (hoặc ném lỗi nếu bị
       * từ chối) — mô phỏng đúng cái `lib/ipc.cjs` làm. */
      const tools = {
        fs_write: {
          description: 'ghi file',
          parameters: z.object({ path: z.string() }),
          execute: async (args: { path: string }) => {
            const ok = await broker.approve('fs_write', { path: args.path });
            if (!ok) throw new Error('nguoi dung tu choi');
            return { ok: true };
          },
        },
      } as unknown as Parameters<typeof runRepl>[0]['tools'];

      /* `ask` của REPL phải trả về câu người dùng gõ. Ta bọc `store.ask()` và
       * đánh dấu "đã hỏi" để test biết khi nào được gõ. */
      let daHoi = false;
      const loi = runRepl({
        model,
        tools,
        session,
        ask: () => {
          daHoi = true;
          return store.ask();
        },
        out: store.out,
        note: store.note,
        onToolCall: store.onToolCall,
        onToolResult: store.onToolResult,
        onToolError: store.onToolError,
        onUsage: store.onUsage,
      });

      await vi.waitFor(() => expect(daHoi).toBe(true));
      /* `act` là BẮT BUỘC: store đổi state **ngoài** React, nên React phải được
       * báo "có việc mới" trong act để nó vẽ lại. */
      await act(async () => {
        store.submit('ghi file a.txt');
      });

      /* Hộp duyệt phải xuất hiện. */
      await vi.waitFor(() => expect(store.snapshot().approval).toBeDefined());
      await act(async () => {
        await t.renderOnce();
      });
      const khungDuyet = t.captureCharFrame();
      expect(khungDuyet).toContain('duyệt tool');
      expect(khungDuyet).toContain('a.txt');
      expect(khungDuyet).toContain('[y/N]');
      expect(khungDuyet, 'ghi chu khoi dong phai hien tren man hinh').toContain('> cong cu: 3');
      /* Câu người dùng phải có trên màn hình — lịch sử nạp lại có nó, nên lúc
       * đang chat cũng phải có, nếu không thì mở lại phiên thấy màn hình khác. */
      expect(khungDuyet, 'cau nguoi dung phai hien tren man hinh').toContain('ghi file a.txt');

      /* Trả lời. */
      await act(async () => {
        t.renderer.keyInput.emit('keypress', PHIM(traLoi));
      });

      /* Chờ model trả lời xong — trừ khi lượt bị cắt. */
      await vi.waitFor(
        () =>
          expect(
            store.snapshot().blocks.some((b) => b.kind === 'assistant' && b.text.includes('da ghi xong')),
          ).toBe(true),
        { timeout: 5_000 },
      );

      /* REPL là vòng lặp **hỏi tiếp** ⇒ không tự kết thúc. Gửi `/exit` để nó
       * thoát, nếu không test treo tới hết giờ. */
      await act(async () => {
        store.submit('/exit');
      });
      await loi;
      await act(async () => {
        await t.renderOnce();
      });

      const khung = t.captureCharFrame();
      const jsonl = readFileSync(sessionFileFor(state, dir), 'utf8');
      await t.dispose();
      return { khung, jsonl };
    } finally {
      reactEnv.IS_REACT_ACT_ENVIRONMENT = actEnv;
      rmSync(state, { recursive: true, force: true });
    }
  };

  it('người dùng DUYỆT ⇒ tool chạy, model trả lời, và transcript ĐĨA có câu trả lời', async () => {
    const { khung, jsonl } = await chay('y');
    expect(khung, 'phai co dau tick cua tool xong').toContain('✓');
    expect(khung).toContain('da ghi xong');
    /* ĐÂY là ranh giới quan sát được: câu trả lời phải nằm trong file trên đĩa,
     * không chỉ trên màn hình. */
    expect(jsonl, 'cau tra loi phai duoc ghi xuong dia').toContain('da ghi xong');
  });

  it('người dùng TỪ CHỐI (Enter) ⇒ tool bị từ chối, dòng tool hiện dấu X', async () => {
    const { khung } = await chay('return');
    expect(khung, 'phai co dau X cua tool bi tu choi').toContain('✗');
  });

  /* C1: Esc trong hộp duyệt là câu trả lời "KHÔNG" — KHÔNG phải cắt lượt. Cắt lượt
   * lúc đó là mất câu trả lời của model (và lượt bị ghi dở ⇒ transcript hỏng). */
  it('Esc trong hộp duyệt ⇒ từ chối tool, KHÔNG cắt lượt', async () => {
    const { khung, jsonl } = await chay('escape');
    expect(khung, 'tool phai bi tu choi').toContain('✗');
    expect(khung, 'luot phai tiep tuc, model van tra loi').toContain('da ghi xong');
    expect(jsonl, 'cau tra loi phai duoc ghi xuong dia').toContain('da ghi xong');
  });
});
