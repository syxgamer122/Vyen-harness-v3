/**
 * CLI của Vyen — chạy thật trên provider thật, dùng bộ tool thật.
 *
 * ============ CÁC FILE NÀY CHIA VIỆC GÌ ============
 *
 *   `cli/index.ts`      nối vào console: đọc biến môi trường, dựng host, hỏi
 *                       duyệt, in ra, chẩn đoán lỗi provider. **Không có logic
 *                       test được** — cứ thêm vào đây là thêm thứ không test nào
 *                       chạm được.
 *   `cli/agent-turn.ts` vòng lặp tool (`maxSteps`, stream, bắt lỗi tool). Hàm
 *                       thuần, test được bằng model giả — xem `tests/cli-agent-
 *                       turn.test.ts`.
 *   `cli/approve.ts`    cổng duyệt trên console, có test.
 *   `lib/tools/ipc-node.ts` lớp cầu tới `lib/ipc.cjs`: đọc/ghi file, shell, git,
 *                       có path-guard, chống TOCTOU và audit.
 *
 * ============ CỐ Ý KHÔNG CÓ (trạng thái 2026-10-20) ============
 *
 * - Tìm kiếm hội thoại: transcript là JSONL, không có chỉ mục. Đủ dùng một buổi;
 *   cần tìm thì phải đổi sang SQLite.
 * - Rút gọn context: **ĐÃ CÓ** (xem `cli/compaction.ts`) — khi ngân sách cửa sổ
 *   sắp tràn, CLI nén phần cũ thành tóm tắt rồi thử lại đúng một lần; phần đã
 *   nén được ghi thành marker trong transcript nên lượt sau nối tiếp được.
 *   Claude Code mất nhiều phiên bản mới chịu được vùng "resume × compaction" —
 *   xem CHANGELOG của họ, có ít nhất 9 mục lỗi.
 * - Agent nhớ sở thích bạn qua các phiên (`agentMemories`) — cần kho riêng.
 *
 * ============ CÁCH CHẠY ============
 *
 *   # Mở hội thoại — mở terminal, nói chuyện tiếp nhiều lượt (giống Claude Code)
 *   $env:VYEN_API_KEY = "sk-..."
 *   $env:VYEN_MODEL   = "gpt-4o-mini"
 *   $env:VYEN_WORKSPACE = "C:\duong\dan\du-an"
 *   npm run cli
 *   > doc README.md
 *   > them vao staging
 *   > /exit
 *
 *   # Hỏi một câu rồi thoát luôn (đường cũ)
 *   npm run cli -- -p "xin chao"
 *
 *   ⚠ `-p` phải nằm SAU `--`. Đo 2026-10-19: `npm run cli -p -- "xin chao"`
 *   chạy ra argv là `["xin chao"]` — **npm nuốt mất `-p`**, nên lệnh đó âm thầm
 *   vào REPL chứ không chạy một lượt. Và nếu ghi `--print -- "x"` thì dấu `--`
 *   trần lọt vào argv; `parseArgs` đã loại nó.
 *
 *   # Câu hỏi truyền qua argv là LƯỢT ĐẦU, rồi CLI vẫn ở lại để nói tiếp
 *   npm run cli -- "doc README.md"
 *
 *   # Anthropic-native
 *   $env:VYEN_API_KEY = "sk-ant-..."
 *   $env:VYEN_MODEL   = "claude-3-5-haiku-20241022"
 *   $env:VYEN_KIND    = "anthropic"
 *
 * ============ BA GIAO DIỆN ============
 *
 *   1. `-p`            — một lượt rồi thoát (đường cũ, không đổi).
 *   2. **TUI**         — màn hình đồ họa full-screen (`cli/tui/`), mở khi có TTY.
 *   3. REPL cũ (plain) — mọi trường hợp còn lại.
 *
 *   Cổng vào là hàm thuần `chooseFrontend` (`cli/tui-gate.ts`, có test): `-p`,
 *   pipe (không có TTY), `VYEN_PLAIN=1`, và Node < 26.4.0 đều rơi về REPL cũ,
 *   **y nguyên** — không nhánh nào của REPL cũ bị đổi hành vi.
 *
 *   `VYEN_PLAIN=1` là van thoát luôn có: khi TUI hỏng trên terminal lạ, người
 *   dùng vẫn làm việc được ngay.
 *
 *   TUI cần Node ≥ 26.4.0 vì OpenTUI tạo renderer gốc qua FFI. Đảo TUI nằm ở
 *   `cli/tui/` — thư mục có `package.json` riêng (`{"type":"module"}`) vì
 *   `@opentui/core` chỉ nạp được bằng ESM, còn repo này là CommonJS. Từ CJS ta
 *   gọi vào đó bằng `await import('./tui/entry.tsx')` (chạy động).
 *
 * ============ LỆNH TRONG PHIÊN ============
 *
 *   /exit    thoát. Mọi thứ đã ghi xuống đĩa, mở lại là đọc tiếp.
 *   /new     bắt đầu phiên mới (lịch sử cũ vẫn còn trên đĩa, không bị xoá).
 *   /compact nén ngữ cảnh: gọi model tóm tắt phần hội thoại cũ, giữ lại phần gần
 *            đây. Bản tóm tắt nằm trong system prompt và **được ghi xuống đĩa**, nên
 *            mở lại phiên vẫn còn. Dùng khi hội thoại dài và bắt đầu tràn context.
 *
 *   ↑ / ↓     gọi lại lệnh đã gõ trong phiên này. Không có nó thì sửa câu lệnh
 *             phải tự gõ lại từ đầu — và tự gõ lại dễ là **khác** câu cũ, mà với
 *             câu ghi file thì khác một đối số là khác hẳn.
 *
 * ============ PHÍM TẮT KHI LƯỢT ĐANG CHẠY ============
 *
 *   Esc      cắt lượt đang chạy. Phần trả lời dở **không** được ghi vào lịch sử —
 *            ghi chuỗi hở sẽ làm provider từ chối mọi lượt sau của phiên.
 *   Ctrl+C   thoát hẳn CLI (do terminal xử lý).
 *
 * ============ HƯỚNG DẪN DỰ ÁN ============
 *
 * CLI nạp `AGENTS.md` (và `CLAUDE.md`) ở gốc workspace vào system prompt, in ra
 * lúc khởi động để bạn biết có nạp không. Không nạp file trong thư mục con.
 *
 * ============ NHỚ LÀ GÌ ============
 *
 * Transcript lưu ở `~/.vyen/cli/sessions/<hash-thu-muc>.jsonl`, **một file cho mỗi
 * thư mục dự án**. Đóng terminal rồi mở lại `npm run cli` trong cùng thư mục là đọc
 * tiếp — không phải chọn lại. Chuyển sang thư mục khác thì là dòng hội thoại khác,
 * không bị lẫn.
 *
 * ============ CÁCH CHẠY — LUÔN DÙNG `npm run cli` ============
 *
 * KHÔNG chạy `node cli/index.ts` thẳng. File này import `@/lib/provider/
 * upstream-diagnosis`, mà Node không đọc `paths` trong `tsconfig.json` — nên
 * cách đó chết ngay với `Cannot find package '@/lib'`. `npm run cli` đi qua
 * `tsx` nên resolve được. Đây là lý do `tsx` nằm trong devDependencies.
 *
 * Biến môi trường:
 *   VYEN_API_KEY   bắt buộc. Key được đọc TỪ BIẾN MÔI TRƯỜNG, không bao giờ
 *                  nhận qua argv — argv nằm trong lịch sử shell và trong
 *                  `Get-History`, biến môi trường thì không.
 *   VYEN_MODEL     bắt buộc. Id model theo quy ước của provider.
 *   VYEN_BASE_URL  tuỳ chọn. Bỏ trống thì adapter dùng base URL mặc định của
 *                  hãng. **Phải có `/v1`** — cả `@ai-sdk/openai` lẫn
 *                  `@ai-sdk/anthropic` đều mặc định `https://api.<host>/v1` rồi
 *                  chỉ nối phần endpoint. Thiếu `/v1` sẽ ra `/messages` thay vì
 *                  `/v1/messages`.
 *   VYEN_KIND      `anthropic` (SDK native) hoặc `openai-compatible` (mặc định).
 *   VYEN_MAX_TOKENS trần token đầu ra, mặc định 2048. **Đừng bỏ trống** — xem
 *                  ghi chú cạnh chỗ dùng: gateway tính credit sẽ từ chối vì
 *                  trần mặc định của provider quá lớn.
 *   VYEN_CONTEXT_WINDOW cửa sổ ngữ cảnh của model (số token), dùng để tính lúc
 *                  nén ngữ cảnh. Bỏ trống thì dùng 200.000 — cùng giá trị opencode
 *                  dùng cho model không khai cửa sổ. Model của bạn có cửa sổ nhỏ
 *                  hơn (ví dụ 32.000) thì khai đúng, nếu không CLI nén muộn.
 *   VYEN_EMULATED    đặt `1` để **ép** dùng đường giả lập: tool được mô tả bằng
 *                  văn bản trong system prompt, model gọi tool bằng khối
 *                  `<tool_call>` thuần. Dùng khi model/gateway của bạn không hỗ
 *                  trợ function calling. CLI tự chuyển sang đường này khi gặp lỗi
 *                  "không hỗ trợ tools" — biến này chỉ để ép từ đầu.
 *   VYEN_WORKSPACE thư mục dự án mà tool được phép chạm vào. Bỏ trống thì dùng
 *                  thư mục hiện tại. `createNodeHost` TỪ CHỐI thư mục rộng (gốc
 *                  ổ đĩa, home) và thư mục không tồn tại — nếu bị từ chối thì CLI
 *                  vẫn chat được, chỉ không có tool, và có in lý do.
 *   VYEN_STATE_DIR nơi ghi `vyen-audit.log` — vết của những gì **agent** làm:
 *                  ghi file (`fs_write`/`fs_edit`), chạy lệnh, và mọi lỗi.
 *                  Mặc định `~/.vyen/cli`. Xoá file này là xoá được vết.
 *                  Lưu ý: `ipc.cjs` có sẵn 12 chỗ audit cho lỗi/shell/git/bg-run;
 *                  phần **ghi file** là tầng CLI bổ sung, vì `ipc.cjs` dùng chung
 *                  với web và không ghi lại thao tác ghi file.
 *   VYEN_YOLO      đặt `1` để **tự động duyệt mọi lệnh ghi/xoá**. Mặc định là
 *                  hỏi từng lần trên console. Chỉ bật trong thư mục tạm.
 *   VYEN_DEBUG     đặt `1` để in thêm `devLog` (req id, host, body upstream).
 *                  Mặc định KHÔNG in — người dùng chỉ cần thông báo sạch.
 *
 * ============ VẤN ĐỀ ĐÃ GẶP ============
 *
 * VẤN ĐỀ ĐÃ GIẢI — alias `@/lib/...`: Node chạy file `.ts` thẳng KHÔNG đọc
 * `paths` trong `tsconfig.json`, nên `lib/provider/upstream-diagnosis.ts` không
 * import được. Đã giải bằng `tsx` (devDependency) — `npm run cli` đi qua nó.
 * Vì vậy **phải** dùng `npm run cli`, không `node cli/index.ts`.
 */

import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
// `createInterface` lấy từ bản **promises** (còn `node:readline` trả bản
// callback, mà `question()` của nó trả `void` chứ không phải Promise).
import { createInterface } from 'node:readline/promises';
// Interface PHẢI lấy từ `readline/promises` — bản ở `readline` là callback, mà
// `question()` của nó trả `void`, nên `await rl.question(...)` hợp kiểu nhưng là
// `await undefined`: câu trả lời luôn rỗng mà TypeScript không báo gì.
import type { Interface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import type { Key } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { type ToolSet } from 'ai';
import type { AdapterKind } from '../lib/provider/adapter.ts';
import { resolveOpenAIModel } from '../lib/provider/openai-adapter.ts';
import { resolveAnthropicModel } from '../lib/provider/anthropic-adapter.ts';
// Hai dòng dưới ĐỂ ĐÚNG alias `@/` để chứng minh lý do phải có `tsx`: chạy
// `node cli/index.ts` thẳng thì hai import này hỏng. Chạy `npm run cli` thì
// được. Nếu sau này đổi alias, sửa cả hai chỗ cùng lúc.
import { diagnoseUpstreamError } from '@/lib/provider/upstream-diagnosis';
import { isContextOverflowError } from '@/lib/context-budget';
import { getKeyLabel } from '@/lib/api-keys';
import { createNodeHost, buildIpcTools } from '@/lib/tools/ipc-node';
import { createConsoleApprover, createAutoApprover } from './approve';
import {
  buildModelConfigs,
  createCompactionRunner,
  statusCodeOf,
  CLI_DEFAULT_CONTEXT_WINDOW,
} from './compaction';
import { runAgentTurn, messagesDaHoanThanh } from './agent-turn';
import { runTurn } from './emulated';
import { runRepl, type ReplOptions } from './repl';
import { openSession } from './session';
import { buildSystemPrompt, INSTRUCTION_FILES } from './instructions';
import { TaoLichSu } from './history';
import { createTerminal } from './terminal';
import { chooseFrontend } from './tui-gate';
import { createApprovalBroker } from './approval-broker';
import type { ApprovalBroker } from './approval-broker';
/* Kiểu của đảo ESM — chỉ để **type**, nên bị xoá lúc build; không phải import
 * runtime (đảo ESM chỉ nạp được bằng `import()` động). */
import type { TuiSession } from './tui/entry.tsx';

/**
 * Bọc trong hàm async thay vì dùng top-level `await`.
 *
 * Lý do: repo KHÔNG có `"type": "module"` trong package.json (thêm vào sẽ phá
 * Next.js), nên `tsx` dịch file này thành **CJS** — mà CJS không có top-level
 * await. Đo thật 2026-10-18: `Top-level await is currently not supported with the
 * "cjs" output format`. Cách này giữ file chạy được dưới CẨ `node` lẫn `tsx`.
 */
/**
 * Phân tích argv.
 *
 * `-p` / `--print` = chạy một lượt rồi thoát, giữ hành vi cũ của
 * `npm run cli -- "..."`. Không có thì vào REPL và nói tiếp.
 *
 * Câu hỏi truyền qua argv dùng làm **lượt đầu tiên** của REPL, giống
 * `claude "cau hoi"` — không phải chạy rồi chết. Nếu bạn muốn chạy rồi chết thì
 * thêm `-p`. */
function parseArgs(argv: string[]): { question?: string; print: boolean } {
  const goc = argv.filter((a) => !/^-p$|^--print$/.test(a));
  const print = goc.length !== argv.length;
  // Bỏ dấu `--` trần. Đo 2026-10-19: `npm run cli -- --print -- "x"` đưa vào
  // argv là `["--print","--","x"]`, nên không bỏ thì câu hỏi thành `"-- x"` và
  // model nhận nhầm dấu gạch dọi.
  const question = goc
    .filter((a) => a !== '--')
    .join(' ')
    .trim() || undefined;
  return { question, print };
}

/** Chạy một lượt rồi thoát — đường dùng khi có `-p`. */
export async function chayMotLuot(opts: {
  lm: Parameters<typeof runAgentTurn>[0]['model'];
  /** Instance model RIENG cho luot tom tat. */
  lmNen: Parameters<typeof runAgentTurn>[0]['model'];
  session: ReturnType<typeof openSession>;
  question: string;
  tools: ToolSet | undefined;
  maxTokens: number;
  apiKey: string;
  model: string;
  system: string;
  windowTokens?: number;
  /** Ghi ra stdout (mặc định `process.stdout.write`) — để test bắt được. */
  out?: (s: string) => void;
  /** Ghi ra stderr (mặc định `console.error`) — để test bắt được. */
  note?: (s: string) => void;
}): Promise<void> {
  const { lm, lmNen, session, question, tools, maxTokens, apiKey, model, system } = opts;
  const ghiChu = opts.note ?? ((s: string) => console.error(s));
  const ghiRa = opts.out ?? ((s: string) => process.stdout.write(s));
  const cauHinhGiaLap = docCauHinhGiaLap();
  const nen = createCompactionRunner({
    session,
    model: lmNen,
    system,
    ...(opts.windowTokens !== undefined ? { windowTokens: opts.windowTokens } : {}),
    note: (s) => ghiChu(s),
  });
  session.append({ role: 'user', content: question });
  let wroteAny = false;
  let daThuLai = false;
  for (;;) {
    try {
      if (!daThuLai) await nen.nen('auto');
      const turn = await runTurn({
        model: lm,
        modelNen: lmNen,
        ...(tools ? { tools } : {}),
        messages: [...session.messages],
        system: nen.system(),
        maxTokens,
        env: {
          providerBase: cauHinhGiaLap.providerBase,
          modelId: cauHinhGiaLap.modelId,
        },
        onText: (delta) => {
          ghiRa(delta);
          wroteAny = true;
        },
        onToolCall: (e) => ghiChu(`\n[goi tool] ${e.name}`),
        onToolError: (name, msg) => ghiChu(`[tool that bai] ${name}: ${msg}`),
        onChuyenDuong: (lyDo) => {
          if (lyDo === 'model-che-tools') {
            ghiChu('> model nay khong ho tro tool — chuyen sang duong gia lap.');
          }
        },
      });
      session.appendAll(turn.messages);
      if (wroteAny) ghiRa('\n');
      ghiChu(
        `\n> xong. token: vao ${turn.usage.promptTokens ?? '?'} / ra ${turn.usage.completionTokens ?? '?'}`,
      );
      return;
    } catch (e) {
      /* Phần ĐÃ HOÀN THÀNH trước khi lượt hỏng vẫn phải ghi lại — Y HỆT đường
       * REPL (`cli/repl.ts`): ghi TRƯỚC, rồi mới xử lý nhánh tràn context.
       *
       * Thứ tự này quan trọng: nhánh tràn context `continue` để thử lại ⇒ nếu
       * ghi SAU thì lượt thử lại chạy với lịch sử KHÔNG có kết quả tool ⇒ model
       * phát lại đúng tool call đó ⇒ **ghi file hai lần**. Và transcript mất
       * dấu vết file nào vừa bị sửa ⇒ `/compact` không biết.
       *
       * Không gì thì `fs_write` đã ghi file mà transcript không có dấu vết ⇒
       * `/compact` không biết file nào vừa bị sửa, và đường `overflow` thử lại
       * ⇒ model LÀM LẠI đúng các tool call đó ⇒ ghi file hai lần.
       *
       * Chỉ phần ĐẦY ĐỦN mới được ghi (tool-call có tool-result tương ứng) —
       * ghi chuỗi hở làm provider từ chối MỌI lượt sau của phiên.
       */
      /* Phần ĐÃ HOÀN THÀNH trước khi lượt hỏng vẫn phải ghi lại — Y HỆT đường
       * REPL (`cli/repl.ts`): ghi TRƯỚC, rồi mới xử lý nhánh tràn context.
       *
       * Thứ tự này quan trọng: nhánh tràn context `continue` để thử lại ⇒ nếu
       * ghi SAU thì lượt thử lại chạy với lịch sử KHÔNG có kết quả tool ⇒ model
       * phát lại đúng tool call đó ⇒ **ghi file hai lần**. Và transcript mất
       * dấu vết file nào vừa bị sửa ⇒ `/compact` không biết.
       *
       * Chỉ phần ĐẦY ĐỦN mới được ghi (tool-call có tool-result tương ứng) —
       * ghi chuỗi hở làm provider từ chối MỌI lượt sau của phiên.
       */
      const daHoanThanh = messagesDaHoanThanh(e);
      if (daHoanThanh.length > 0) {
        session.appendAll(daHoanThanh);
        ghiChu(`> ${daHoanThanh.length} message da hoan thanh truoc khi luot hong — da ghi lai.`);
      }

      /* Tràn context: provider TỪ CHỐI, không phải lỗi của ta. Nén lại rồi thử
       * đúng MỘT lần — không có lưới an toàn nào khác. */
      const msg = e instanceof Error ? e.message : String(e);
      if (!daThuLai && isContextOverflowError(statusCodeOf(e), msg)) {
        daThuLai = true;
        ghiChu('> het context, dang nen lai...');
        if (await nen.nen('overflow')) continue;
      }

      /* Chuyển lỗi thô thành chẩn đoán có nghĩa (spec §7).
       *
       * Không in `e.message` thẳng: message của provider là tiếng Anh dài dòng, và
       * quan trọng hơn là **không phân biệt được lỗi mạng với lỗi key** — người
       * dùng CLI không biết nên bật lại Wi-Fi hay đổi key.
       *
       * Mọi dòng chẩn đoán đi qua `ghiChu` (tức `opts.note`) — không in thẳng ra
       * `console.error`, để người gọi (và test) bắt được hết. */
      const diag = diagnoseUpstreamError(e, {
        requestId: randomUUID().slice(0, 8),
        model,
        keyLabel: getKeyLabel(apiKey),
        providerBase: process.env.VYEN_BASE_URL,
      });
      ghiChu(`\n> ${diag.code}  (${diag.scope})`);
      ghiChu(`> ${diag.userMessage}`);
      ghiChu(
        `> phai doi key: ${diag.blameKey ? 'co' : 'khong'} | dung thu key khac: ${diag.stopFailover ? 'dung roi' : 'chua'}`,
      );
      if (process.env.VYEN_DEBUG === '1') ghiChu(`> dev: ${diag.devLog}`);
      process.exitCode = 1;
      return;
    }
  }
}

/** Thứ REPL cần để chạy — phần KHÔNG phụ thuộc terminal. */
export interface ReplCoreDeps {
  model: Parameters<typeof runAgentTurn>[0]['model'];
  /** Instance model RIÊNG cho lượt tóm tắt. */
  modelNen: Parameters<typeof runAgentTurn>[0]['model'];
  tools: ToolSet | undefined;
  session: ReturnType<typeof openSession>;
  system: string;
  maxTokens: number;
  windowTokens?: number;
  initial?: string;
  /** Base URL cua provider — khoa cache "model nay che tools". */
  providerBase?: string;
  /** Id model — khoa cache "model nay che tools". */
  modelId?: string;
  /** Ep dung duong gia lap. */
  forceEmulated?: boolean;
}

/**
 * Options **lõi** của REPL — không có adapter giao diện nào.
 *
 * ============ VÌ SAO TÁCH ============
 *
 * TUI dùng **cùng** cấu hình này, chỉ khác ở chỗ đọc/ghi (ô nhập thay cho
 * readline, màn hình thay cho stdout). Nếu không có hàm dựng lõi thì mỗi bên
 * sẽ tự chép danh sách option — và một bên quên một option là hành vi lệch mà
 * không ai thấy.
 *
 * ============ VÌ SAO KHÔNG DÙNG `Omit<ReplOptions, ...>` ============
 *
 * `Omit` làm `modelNen` thành **tuỳ chọn**, mà `modelNen` là model riêng cho
 * lượt tóm tắt: thiếu nó thì không nén được context mà **không ai báo lỗi**.
 * Khai tường minh ở đây giữ được yêu cầu "bắt buộc có".
 */
export type ReplCore = {
  model: Parameters<typeof runAgentTurn>[0]['model'];
  modelNen: Parameters<typeof runAgentTurn>[0]['model'];
  tools: ToolSet | undefined;
  session: ReturnType<typeof openSession>;
  system: string;
  maxTokens: number;
  windowTokens?: number;
  initial?: string;
  providerBase?: string;
  modelId?: string;
  forceEmulated?: boolean;
};

export function buildReplCore(deps: ReplCoreDeps): ReplCore {
  return {
    model: deps.model,
    modelNen: deps.modelNen,
    tools: deps.tools,
    session: deps.session,
    system: deps.system,
    maxTokens: deps.maxTokens,
    ...(deps.windowTokens !== undefined ? { windowTokens: deps.windowTokens } : {}),
    ...(deps.initial ? { initial: deps.initial } : {}),
    ...(deps.providerBase !== undefined ? { providerBase: deps.providerBase } : {}),
    ...(deps.modelId !== undefined ? { modelId: deps.modelId } : {}),
    ...(deps.forceEmulated ? { forceEmulated: true } : {}),
  };
}

/** Thứ REPL cần để chạy — thêm phần gắn terminal. */
export interface ReplDeps extends ReplCoreDeps {
  terminal: ReturnType<typeof createTerminal>;
  lichSu: TaoLichSu;
}

/**
 * Cấu hình đường giả lập đọc từ biến môi trường.
 *
 * ============ VÌ SAO TÁCH RA HÀM ============
 *
 * Đo 2026-10-20 (reviewer độc lập): không test nào chạm tới `VYEN_EMULATED` ⇒
 * một lỗi gõ 1 ký tự (`'1'` → `'true'`) làm tính năng chết âm thầm, mọi test vẫn
 * xanh. Đọc thẳng trong `main()` thì không test được ⇒ tách ra đây.
 *
 * `providerBase`/`modelId` là KHOÁ cache "model này chê tools" ⇒ thiếu thì dùng
 * chuỗi rỗng (khoá `default::model`), KHÔNG dùng `undefined`.
 */
export function docCauHinhGiaLap(
  env: Record<string, string | undefined> = process.env,
): {
  providerBase: string;
  modelId: string;
  forceEmulated: boolean;
  
}
  
{
  return {
    providerBase: env.VYEN_BASE_URL ?? '',
    modelId: env.VYEN_MODEL ?? '',
    forceEmulated: env.VYEN_EMULATED === '1',
  };
}

/**
 * Dựng options cho REPL — TÁCH RA HÀM EXPORT để tầng nối test được.
 *
 * ============ VÌ SAO PHẢI TÁCH ============
 *
 * `cli/index.ts` gọi `main()` ở module scope ⇒ **không import được trong test**.
 * Mà mọi lời hứa ở tầng nối (như "Esc cắt lượt đang chạy") nằm đúng ở tầng nối.
 * Đo 2026-10-20 (reviewer độc lập): `cli/index.ts` KHÔNG truyền `watchInterrupt` cho
 * `runRepl` ⇒ `AbortController` không bao giờ được `abort()` ⇒ **bấm Esc không làm gì
 * cả**, dù header của chính file quảng cáo Esc hoạt động.
 */
export function buildReplOptions(deps: ReplDeps): ReplOptions {
  return {
    ...buildReplCore(deps),
    ask: async () => deps.terminal.hoiDong(deps.lichSu),
    /* Nối phím Esc. Thiếu mối nối này thì Esc chỉ là lời hứa trong header. */
    watchInterrupt: deps.terminal.watchInterrupt,
    lichSu: deps.lichSu,
    out: (s) => process.stdout.write(s),
    note: (s) => console.error(s),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prompt = args.question;

  /* KHÔNG đòi phải có câu hỏi. `npm run cli` không có đối số **chính là** cách
   * dùng chính — mở hội thoại rồi gõ. Bản đầu tôi in hướng dẫn rồi `exit(2)`
   * khi thiếu câu hỏi, tức là khoá ngay chính cách dùng mà tính năng này sinh ra.
   *
   * Chỉ `-p` mới đòi câu hỏi, vì `-p` nghĩa là "chạy một lượt rồi thoát" — không có
   * câu hỏi thì không có việc gì để chạy. */
  if (args.print && !prompt) {
    console.error('-p nhung khong co cau hoi: npm run cli -- -p "cau hoi"');
    process.exit(2);
  }

  const apiKey = process.env.VYEN_API_KEY ?? '';
  if (!apiKey) {
    // Chủ ý KHÔNG in gì cả giá trị biến — lỗi kiểu này hay in ra cả key.
    console.error('Thieu VYEN_API_KEY. Dat bien moi truoc khi chay.');
    process.exit(2);
  }

  const model = process.env.VYEN_MODEL ?? '';
  if (!model) {
    console.error('Thieu VYEN_MODEL. Dat bien moi truoc khi chay.');
    process.exit(2);
  }

  // Kiểm tra thật, KHÔNG dựa vào `resolveAdapterKind`. Lý do: hàm đó trả thẳng
  // `cfg.kind` (identity), nên `resolveAdapterKind({kind}) !== kind` **luôn false**
  // — guard viết bằng cách đó không bao giờ bắt được gì. Chính lượt chạy thật đã
  // lộ ra điều này: đặt VYEN_KIND sai mà không có gì được in.
  const KINDS: readonly AdapterKind[] = ['anthropic', 'openai-compatible'];
  const kind = (process.env.VYEN_KIND ?? 'openai-compatible') as AdapterKind;
  if (!KINDS.includes(kind)) {
    console.error(`VYEN_KIND khong hop le: ${kind}`);
    console.error(`Gia tri dung: ${KINDS.join(' | ')}`);
    process.exit(2);
  }

  // Trần số token đầu ra. KHÔNG để mặc định của provider: OpenRouter từ chối
  // bằng lỗi kiểu "you requested up to 16384 tokens but can only afford 13228"
  // — đo thật 2026-10-18. Với gateway tính tiền theo credit, để provider tự
  // chọn trần nghĩa là một câu hỏi ngắn cũng có thể bị từ chối vì lý do không
  // liên quan gì tới nội dung.
  const rawMax = process.env.VYEN_MAX_TOKENS ?? '2048';
  const maxTokens = Number(rawMax);
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    console.error(`VYEN_MAX_TOKENS khong hop le: ${rawMax} (can la so nguyen duong)`);
    process.exit(2);
  }

  const cfg = {
    kind,
    apiKey,
    model,
    ...(process.env.VYEN_BASE_URL ? { baseUrl: process.env.VYEN_BASE_URL } : {}),
  };

  /* ---- Tool: chỉ bật khi có workspace ----
   *
   * `createNodeHost` từ chối workspace rộng (gốc ổ đĩa, home) và từ chối thư mục
   * không tồn tại — đó là lớp bảo vệ thật, không phải kiểm tra hình thức.
   *
   * Không có `VYEN_WORKSPACE` thì CLI chỉ chat, không đụng đĩa. Đây là mặc định
   * an toàn: một CLI ghi file mà không cần người dùng chỉ định thư mục là một
   * CLI không có ranh giới. */
  const yolo = process.env.VYEN_YOLO === '1';
  let tools: ToolSet | undefined;
  let disposeHost: (() => void) | undefined;
  const workspace = process.env.VYEN_WORKSPACE ?? process.cwd();
  // KHAI TRƯỚC `try` vì REPL dùng `userDataDir` — khai trong thì phạm vi khối che
  // mất, TypeScript đúng ra báo "không tìm thấy tên" dù runtime có giá trị.
  const userDataDir =
    process.env.VYEN_STATE_DIR ??
    path.join(os.homedir(), '.vyen', 'cli');

  /* `readline` DỰNG NGOÀI `try` — và đây là lý do reviewer bắt được.
   *
   * Bản đầu đặt nó SAU `createNodeHost` trong cùng một `try`. Nên khi workspace
   * không hợp lệ (thư mục không tồn tại, gốc ổ đĩa, home) thì `createNodeHost`
   * ném trước khi `rl` kịp tạo ⇒ `ask` trả `null` ⇒ REPL **thoát ngay**. Nhưng
   * dòng thông báo vừa in lại nói *"van chat binh thuong, chi khong dung duoc
   * cong cu"* — nói một đằng làm một nẻo.
   *
   * Đọc dòng không cần workspace, nên tách nó ra khỏi phần dựng tool. Vì thế
   * `rl`, `docDong`, `closeStdin` đều **không còn `| undefined`** và không còn
   * guard `if (!rl) return null` — bản đầu giữ chúng là guard chết, và comment
   * của guard ("không có `rl` thì trả `null`") mô tả tình huống đã không còn
   * tồn tại: kiểu tài liệu chết theo AGENTS.md §4.
   */
  /* ---- Context window: đọc Ở ĐÂY, trước khi dựng TUI ----
   *
   * Header TUI hiện phần trăm ngữ cảnh còn lại ⇒ số này phải có **trước** khi
   * TUI mount. Đọc sau thì TUI đã lên rồi mới biết ⇒ phải dựng lại cả màn hình.
   *
   * Sai số thì thoát ngay (exit 2) — và lúc này terminal còn sạch, chưa vào
   * alternate screen, nên thông báo lỗi nhìn thấy được bình thường. */
  const rawWindow = process.env.VYEN_CONTEXT_WINDOW;
  let windowTokens: number | undefined;
  if (rawWindow) {
    const n = Number(rawWindow);
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`VYEN_CONTEXT_WINDOW khong hop le: ${rawWindow} (can la so nguyen duong)`);
      process.exit(2);
    }
    windowTokens = n;
  }

  /* ---- Chọn giao diện: TUI hay REPL cũ ----
   *
   * `chooseFrontend` là hàm thuần (test được ở `tests/tui-gate.test.ts`): `-p`,
   * pipe, `VYEN_PLAIN=1` và Node quá cũ đều rơi về REPL cũ, y nguyên.
   */
  const mode = chooseFrontend({
    print: args.print,
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
    env: { VYEN_PLAIN: process.env.VYEN_PLAIN },
    nodeVersion: process.versions.node,
  });

  /* Ghi chú lúc khởi động. Ở TUI, chúng hiện **trong transcript** (vào
   * alternate screen thì in ra stderr sẽ bị nuốt, và người dùng sẽ không biết
   * vì sao tool không bật được); ở REPL cũ thì in ra stderr như cũ. */
  const startupNotes: string[] = [];

  let tui: TuiSession | undefined;
  let broker: ApprovalBroker | undefined;
  if (mode.kind === 'tui') {
    broker = createApprovalBroker();
    try {
      /* Import ĐỘNG — vì `@opentui/core` chỉ nạp được bằng ESM, mà repo này là
       * CommonJS. Đảo ESM nằm ở `cli/tui/` (có `package.json` riêng). */
      const mod = await import('./tui/entry.tsx');
      tui = await mod.createTui({
        workspace: path.basename(workspace),
        modelLabel: model,
        windowTokens: windowTokens ?? CLI_DEFAULT_CONTEXT_WINDOW,
        approval: broker,
      });
    } catch (e) {
      /* Chưa dựng tool ⇒ rơi về REPL cũ được trọn vẹn. */
      console.error(
        `> khong mo duoc TUI: ${e instanceof Error ? e.message : String(e)} — dung REPL thuong.`,
      );
      tui = undefined;
      broker = undefined;
    }
  }
  const dungTui = tui !== undefined;

  const ghiChu = (s: string): void => {
    if (dungTui) startupNotes.push(s);
    else console.error(s);
  };

  /* Terminal readline chỉ tồn tại ở đường PLAIN. Ở TUI, OpenTUI đang giữ stdin
   * — hai bên cùng đọc stdin là hai bên cùng tranh, và `ask` của REPL sẽ nuốt
   * phím của TUI. */
  let terminal: ReturnType<typeof createTerminal> | undefined;
  let lichSu: TaoLichSu | undefined;
  if (!dungTui) {
    terminal = createTerminal({ stdin: process.stdin as never });
    lichSu = new TaoLichSu();
  }
  // Readline giữ stdin mở, nên nếu không đóng thì tiến trình không thoát dù đã
  // in xong. Đóng quá sớm thì lượt hỏi duyệt sau sẽ treo — nên đóng ở `finally`.
  const closeStdin = (): void => {
    terminal?.close();
  };
  try {
    const host = createNodeHost({ workspaceRoot: workspace, userDataDir });
    disposeHost = host.dispose;

    // Cổng duyệt: ở TUI thì hỏi qua hộp duyệt (broker), ở REPL cũ thì hỏi
    // trên console — trừ khi người dùng tự bật YOLO, và khi bật thì PHẢI in ra,
    // vì đó là lúc bỏ hết lớp bảo vệ giữa người và máy.
    let approve: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
    if (yolo) {
      ghiChu('\n!!! VYEN_YOLO=1 — TU DONG DUYET MOI LENH GHI/XOA, KHONG HOI !!!');
      approve = createAutoApprover(true);
    } else if (broker) {
      approve = (tool, args) => broker.approve(tool, args);
    } else if (terminal) {
      const t = terminal;
      approve = createConsoleApprover((q) => t.hoi(q), {
        /* Lý do từ chối phải ra cho người dùng thấy — đặc biệt khi CLI chạy
         * headless (stdin là pipe): lúc đó không đọc được câu trả lời, và báo
         * "người dùng không duyệt" là đổ lỗi oan. */
        note: (s) => ghiChu(s),
      });
    } else {
      /* Không có terminal để hỏi ⇒ mặc định KHÔNG (an toàn), không phải "cho
       * phép" — cùng luật với broker khi không có listener. */
      approve = async () => false;
    }
    const built = buildIpcTools(host, { approve });
    // `buildIpcTools` trả `Record<string, unknown>` vì hình dạng tool của AI SDK
    // rộng hơn thứ lớp cầu biết. Ép kiểu ở đây là ranh giới duy nhất; nếu để
    // rò vào trong thì mọi call site lại phải tự ép, và lệch kiểu là im lặng.
    tools = built as ToolSet;
    ghiChu(`> cong cu: ${Object.keys(built).length} (workspace: ${workspace})`);
    if (yolo) ghiChu('> YOLO BAT — moi thay doi deu khong hoi xac nhan');
  } catch (e) {
    ghiChu(`> KHONG bat cong cu: ${e instanceof Error ? e.message : String(e)}`);
    ghiChu('> van chat binh thuong, chi khong dung duoc cong cu.');
  }

  /* ---- System prompt: dựng SAU khi biết đã bật được tool nào ----
   *
   * Thứ tự này là bắt buộc: hướng dẫn tool chỉ chèn cho tool **thật sự có**, nên
   * dựng prompt trước khi `createNodeHost` chạy thì luôn phải giả định là có đủ
   * tool — tức bảo model dùng `fs_write` trong khi `fs_write` không tồn tại. Đó
   * chính là lỗi của bản prompt liệt kê cứng.
   *
   * File hướng dẫn dự án (`AGENTS.md`…) nằm trong phần này — đo mã opencode cho
   * thấy prompt của họ chỉ ~10 dòng, còn bối cảnh dự án đến từ file. Repo này có
   * sẵn `AGENTS.md` chi tiết mà bản cũ bỏ qua. */
  const systemPrompt = buildSystemPrompt(
    tools ? Object.keys(tools) : undefined,
    workspace,
  );
  const coHuongDan = INSTRUCTION_FILES.filter((f) => {
    try {
      return statSync(path.join(workspace, f)).isFile();
    } catch {
      return false;
    }
  });
  if (coHuongDan.length > 0) {
    ghiChu(`> huong dan du an: ${coHuongDan.join(', ')}`);
  }

  /* ---- Session transcript: thứ làm "đóng terminal rồi mở lại còn nhớ" ----
   *
   * Session gắn với **thư mục**, không gắn với người — đúng cách opencode dùng cột
   * `directory` trong `session_v2`. Hỏi trong `C:\du-an` là một dòng transcript;
   * chuyển sang `C:\du-an-khac` là dòng khác, không bị lẫn.
   *
   * File cũ GIỮ NGUYÊN — mở lại là đọc tiếp, không phải chọn lại. */
  let session: ReturnType<typeof openSession> | undefined;
  try {
    session = openSession(userDataDir, workspace);
    const soMessage = session.messages.length;
    if (soMessage > 0) {
      ghiChu(`> lich su: ${soMessage} message o "${session.header.directory}"`);
      ghiChu('> gõ /new neu muon bat dau moi. /exit de thoat.');
    }
  } catch (e) {
    console.error(`> KHONG doc duoc transcript: ${e instanceof Error ? e.message : String(e)}`);
    console.error('> chay tiep, chi khong nho duoc.');
  }

  ghiChu(`> ${kind} / ${model}${cfg.baseUrl ? ` / ${cfg.baseUrl}` : ''}`);
  ghiChu(`> toi da ${maxTokens} token`);
  ghiChu('> (ket qua se do la day)\n');

  /* HAI instance model: chat khong dung `fetch` ep `stream:false`, con luot tom
   * tat co. Dung chung mot instance se lam MOI luot chat hong — xem
   * `buildModelConfigs`. */
  const { chat: cfgChat, nen: cfgNen } = buildModelConfigs(cfg);

  /* Context window đã đọc ở trên (trước khi dựng TUI) — xem chỗ đó. */

  try {
    const lm = kind === 'anthropic' ? resolveAnthropicModel(cfgChat) : resolveOpenAIModel(cfgChat);
    const lmNen = kind === 'anthropic' ? resolveAnthropicModel(cfgNen) : resolveOpenAIModel(cfgNen);

    /* Đo 2026-10-18 với key sai: stream lỗi **không** ném ra `for await` — nó kết
     * thúc im lặng sau 0 chunk, và `finishReason` không bao giờ settle. Nếu nuốt,
     * CLI in ra CÂU RỖNG rồi exit 0, tức báo thành công cho một lần gọi thất bại —
     * tệ hơn cả crash. `runAgentTurn` vì thế ném lại lỗi provider ra đây. */
    if (!session) {
      console.error('> khong co session, thoat. Van xong lich su? khong.');
      process.exitCode = 1;
      return;
    }

    /* `-p` = chạy MỘT lượt rồi thoát, giữ hành vi cũ của `npm run cli -- "..."`.
     * Không có `-p` thì vào REPL: đóng terminal là mất session, mở lại là đọc
     * tiếp. Câu hỏi truyền qua argv là **lượt đầu tiên**, rồi CLI tiếp tục. */
    if (args.print) {
      // `prompt` chắc chắn có: `main()` đã kiểm và thoát nếu `-p` mà thiếu.
      await chayMotLuot({
        lm,
        lmNen,
        session,
        question: prompt as string,
        tools,
        maxTokens,
        apiKey,
        model,
        system: systemPrompt,
        ...(windowTokens !== undefined ? { windowTokens } : {}),
      });
      return;
    }

    /* Cấu hình LÕI của vòng lặp — dùng chung cho cả hai giao diện, khác nhau
     * ở chỗ đọc/ghi. Không chép tay danh sách option ở hai nơi. */
    const core = buildReplCore({
      model: lm,
      modelNen: lmNen,
      tools,
      session,
      system: systemPrompt,
      maxTokens,
      ...(windowTokens !== undefined ? { windowTokens } : {}),
      ...(prompt ? { initial: prompt } : {}),
      ...docCauHinhGiaLap(),
    });

    if (dungTui && tui) {
      /* TUI: chạy CÙNG vòng lặp, chỉ khác adapter đọc/ghi. */
      await tui.run({ ...core, startupNotes });
    } else if (terminal && lichSu) {
      await runRepl(buildReplOptions({ ...core, terminal, lichSu }));
    } else {
      /* Không có TUI mà cũng không có terminal ⇒ không chạy được gì. */
      console.error('> khong co terminal de chay REPL. Thoat.');
      process.exitCode = 1;
    }
  } catch (err) {
    /* Chỉ bắt được lỗi CỐ Ý ném ra (ví dụ config sai lúc dựng model). Lỗi từ
     * provider đã được bắt và chẩn đoán ở `catch` bên trên. */
    console.error(`\n> LOI: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    /* Đóng TUI TRƯỚC: nó phải trả terminal về trạng thái cũ (thoát alternate
     * screen, bàn phím) — nếu đóng sau thì thông báo lỗi ở trên sẽ bị in
     * trong màn hình đang chiếm. */
    tui?.close();
    // `process.exit()` sẽ bỏ qua `finally` và cắt cụt stdout khi đang stream —
    // nên dùng `process.exitCode` và để tiến trình tự thoát sau khi dọn xong.
    closeStdin?.();
    disposeHost?.();
  }
}

/*
 * Chỉ chạy khi file này được gọi TRỰC TIẾP (`npm run cli` ⇒ `tsx cli/index.ts`),
 * KHÔNG chạy khi được import.
 *
 * Không có guard này thì `cli/index.ts` không import được trong test ⇒ mọi lời hứa ở
 * tầng nối (như "Esc cắt lượt đang chạy") không test được.
 */
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main();
}
