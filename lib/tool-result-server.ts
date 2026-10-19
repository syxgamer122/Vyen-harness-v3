/**
 * Serialize + cắt trần kết quả tool — dùng chung cho **hai** đường:
 *
 *   - **đường emulated ở server**: `serializeToolResult` (trả về chuỗi).
 *   - **đường CLI** (`lib/tools/ipc-node.ts`): `capToolValue` / `capToolResult` — cắt
 *     trần kết quả tool **trước khi** nó vào ngữ cảnh.
 *
 * ============ VÌ SAO TÁCH THEO RUNTIME ============
 *
 * Tách khỏi `lib/tool-limits.ts` theo RUNTIME (cùng nguyên tắc với
 * `lib/agent-tools-server.ts`). Lý do: file này ghi spill xuống đĩa nên cần
 * `lib/ipc.cjs` — mà `ipc.cjs` kéo `child_process` + `net`. `tool-limits.ts`
 * nằm trong bundle trình duyệt (qua `react/use-chat-orchestration.ts:57`), nên
 * không thể import tĩnh ở đó.
 *
 * Bản 1 lách bằng `eval('require')('./ipc.cjs')` ngay trong `tool-limits.ts`.
 * Cách đó qua được `tsc`, qua được `lint`, qua được cả `next build` — nhưng
 * trong sản phẩm `.next/server/chunks/` không có `ipc.cjs`, `require` ném
 * `MODULE_NOT_FOUND`, `try/catch` nuốt, và spill im lặng không bao giờ chạy.
 * Đây là lý do `tests/spill-wiring.test.ts` tồn tại: nó đọc artifact đã build.
 *
 * Ở đây import TĨNH. Turbopack đóng gói `ipc.cjs` đúng MỘT lần cho sản phẩm
 * server, nên đây là cùng instance mà `lib/bridge/server-bridge.ts:75` nạp —
 * cùng registry `savedShellOutputs` mà whitelist `fs_read` đọc.
 *
 * Quy tắc: file này import được `@/lib/tool-limits`. Chiều ngược lại thì không.
 */

import {
  TOOL_RESULT_HEAD_RATIO,
  TOOL_RESULT_MAX_CHARS,
  TOOL_RESULT_TAIL_RATIO,
  truncateToolResult,
} from '@/lib/tool-limits';
import { redactSecretText } from '@/lib/secret-registry';
import * as ipc from '@/lib/ipc.cjs';

const saveSpillText = (ipc as unknown as {
  saveSpillText?: (
    content: string,
    name: string,
  ) => { savedTo: string; bytes: number; notice: string } | null;
}).saveSpillText;

/**
 * Hàm ghi phần bị cắt ra file.
 *
 * `null` = ghi không được ⇒ caller rơi về cắt trần, KHÔNG ném.
 */
export type SpillSaver = (
  content: string,
  name: string,
) => { savedTo: string; bytes: number; notice: string } | null;

/**
 * Spill an toàn: **nội dung ghi xuống đĩa phải ĐÃ che bí mật**.
 *
 * Vì sao: đường server redact trước khi gọi `capToolResult` (xem `guarded`), nhưng
 * đường CLI thì **không** — CLI chỉ che lúc ghi transcript, còn lúc chạy thì model
 * cần đọc được khoá nó vừa đọc. Nếu spill nguyên văn thì một `.env` đọc được sẽ nằm
 * trọn trong file tạm, ngoài transcript mà đã che.
 *
 * `redactSecretText` trên **chuỗi đã serialize** — cùng cách `serializeToolResult`
 * làm (`redactSecretText(raw)`), nên bí mật nằm trong mọi field đều bị che.
 */
function spillRedacted(raw: string, name: string, saver?: SpillSaver): ReturnType<SpillSaver> {
  const ghi = saver ?? saveSpillText;
  return ghi?.(redactSecretText(raw), name) ?? null;
}

/** Độ dài JSON của một giá trị — dùng để cắt mảng mà không phá hình dạng. */
function jsonLengthOf(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}


/** Serialize + cắt trần trong một bước. Không bao giờ ném. */
export function serializeToolResult(
  result: unknown,
  maxChars: number = TOOL_RESULT_MAX_CHARS,
): string {
  let raw: string;
  try {
    raw = JSON.stringify(result) ?? 'null';
  } catch {
    raw = '"[kết quả không serialize được]"';
  }
  /* Redact TRƯỚC mọi thứ — kể cả trước khi ghi spill xuống đĩa. Nếu cắt trước
     rồi redact, một khoá nằm vắt qua ranh giới cắt sẽ chỉ còn nửa chuỗi và
     không khớp rule nào nữa → lọt bí mật vào ngữ cảnh. Nếu spill bản thô thì
     khoá ở phần GIỮA (phần hay chứa bí mật nhất) nằm hẳn trên đĩa.
     Đây là chốt chặn cuối của đường emulated (mọi kết quả tool đều đi qua đây)
     — xem lib/secret-registry.ts (SecretRegistry). */
  const redacted = redactSecretText(raw);
  if (redacted.length <= maxChars) return redacted;

  /* Spill: lưu phần bị cắt ra file app tự ghi để fs_read đọc lại được.
     Best-effort — lỗi lưu thì rơi về truncateToolResult y hệt cũ, KHÔNG ném:
     lỗi lưu không được biến một tool call thành công thành isError
     (docs/subsystems/spill.md:92 của deepseek-harness). */
  const spilled = saveSpillText?.(redacted, 'tool-result.txt') ?? null;
  if (spilled) {
    // Chừa sẵn chỗ cho marker và notice rồi mới chia phần còn lại cho đầu/đuôi,
    // để TỔNG không bao giờ vượt maxChars — đó là hợp đồng của TOOL_RESULT_MAX_CHARS.
    const markerLen = 64;
    const room = Math.max(0, maxChars - markerLen - spilled.notice.length - 2);
    const split = TOOL_RESULT_HEAD_RATIO / (TOOL_RESULT_HEAD_RATIO + TOOL_RESULT_TAIL_RATIO);
    const headLen = Math.floor(room * split);
    const tailLen = room - headLen;
    const head = redacted.slice(0, headLen);
    const tail = tailLen > 0 ? redacted.slice(-tailLen) : '';
    const marker = `\n...[đã cắt bớt ${Math.max(0, redacted.length - headLen - tailLen)} ký tự ở giữa]...\n`;
    return `${head}${marker}${tail}\n\n${spilled.notice}`;
  }
  return truncateToolResult(redacted, maxChars);
}

/* ------------------------------------------------------------------ */
/* Cắt trần kết quả tool — dùng chung cho server và CLI                */
/* ------------------------------------------------------------------ */

/**
 * Cắt trần kết quả tool dạng **object**.
 *
 * Chuyển từ `lib/agent-tools-server.ts` (ở đó nó là hàm riêng, không export) — để
 * đường CLI dùng **cùng một** cách cắt thay vì viết bản thứ hai (`AGENTS.md` §6).
 *
 * Hợp đồng:
 * - `JSON.stringify(result)` ≤ `TOOL_RESULT_MAX_CHARS` ⇒ trả **nguyên** `result`.
 * - Lớn hơn ⇒ spill trước, cắt các field chuỗi dài, thêm `truncated: true` và
 *   `spillNotice` (khi spill thành công).
 *
 * `saver` là tham số chứ không phải import bên trong: `lib/ipc.cjs` phải là **MỘT
 * instance**. `lib/tools/ipc-node.ts` nạp nó bằng `'../ipc.cjs'`, còn file này nạp bằng
 * `'@/lib/ipc.cjs'` — hai specifier khác nhau. Nếu mỗi bên tự import, một bên có thể
 * giữ instance khác ⇒ spill ghi vào registry của instance này còn `fs_read` đọc
 * registry của instance kia ⇒ **file spill không đọc được**. Truyền tay hàm của chính
 * instance đang dùng ⇒ không thể lệch.
 */
export function capToolResult(
  result: Record<string, unknown>,
  saver?: SpillSaver,
): Record<string, unknown> {
  let raw: string;
  try {
    raw = JSON.stringify(result) ?? '';
  } catch {
    return { note: 'Kết quả công cụ không đọc được.' };
  }
  if (raw.length <= TOOL_RESULT_MAX_CHARS) return result;

  const out: Record<string, unknown> = {};
  let remaining = TOOL_RESULT_MAX_CHARS;
  let daCat = false;

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      if (value.length > remaining) {
        out[key] = `${value.slice(0, Math.max(0, remaining))}\n…[đã cắt bớt vì quá dài]`;
        remaining = 0;
        daCat = true;
      } else {
        out[key] = value;
        remaining -= value.length;
      }
      continue;
    }
    if (Array.isArray(value)) {
      /* Field MẢNG cũng phải bị cắt — không chỉ field chuỗi.
       *
       * Vì sao: `git_status` trả `{branch, entries:[…]}` và `bg_status` trả
       * `{jobs:[…]}` — mảng nằm ở CẤP TRÊN. Nếu chỉ cắt field chuỗi thì kết quả
       * vẫn dài hơn trần, trong khi phép ước lượng (`estimateContextTokens`) luôn
       * cắt ở 24.000 ký tự ⇒ thiếu tới 3,7× ⇒ compaction không kích hoạt đúng
       * lúc. */
      const giu: unknown[] = [];
      let used = 0;
      for (const item of value) {
        const len = jsonLengthOf(item);
        if (used + len > remaining) break;
        giu.push(item);
        used += len;
      }
      const bo = value.length - giu.length;
      if (bo > 0) {
        giu.push({ truncated: true, note: `Đã cắt bớt ${bo} mục.` });
        daCat = true;
      }
      out[key] = giu;
      remaining -= used;
      continue;
    }
    out[key] = value;
    remaining -= jsonLengthOf(value);
  }

  /* KHÔNG cắt được gì mà kết quả vẫn dài hơn trần.
   *
   * Hai khả năng:
   * 1. Chênh lệch chỉ là overhead của chính JSON (ví dụ `fs_read` trả 24.000 ký tự
   *    nội dung + vài chữ khoá) ⇒ KHÔNG có gì bị mất ⇒ trả nguyên kết quả. Báo
   *    `truncated: true` ở đây khiến model đọc lại file ⇒ đúng cái lãng phí token
   *    mà `lib/tools/ipc-node.ts` đã ghi chú là bug.
   * 2. Phần dư nằm trong cấu trúc lồng (object con) mà vòng trên không đụng tới
   *    ⇒ phải thay bằng con trỏ tới bản spill, nếu không thì vẫn vượt trần. */
  const conLai = jsonLengthOf(out);
  if (!daCat && conLai <= TOOL_RESULT_MAX_CHARS + 500) return result;

  const spilled = spillRedacted(raw, 'tool-result', saver);

  if (!daCat) {
    for (const key of Object.keys(out)) {
      const v = out[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[key] = { truncated: true, note: 'Xem spillNotice để đọc phần đầy đủ.' };
      }
    }
    if (jsonLengthOf(out) > TOOL_RESULT_MAX_CHARS + 500) {
      return {
        truncated: true,
        ...(spilled ? { spillNotice: spilled.notice } : {}),
        note: 'Kết quả quá dài — đọc bản đầy đủ trong file spill.',
      };
    }
  }

  out.truncated = true;
  if (spilled) out.spillNotice = spilled.notice;
  return out;
}

/**
 * Cắt trần kết quả tool bất kỳ — **giữ nguyên hình dạng**.
 *
 * Tool của CLI trả ba kiểu khác nhau: `fs_list`/`fs_search` trả **mảng**, `fs_read`/
 * `fs_write` trả **object**, `git_diff`/`git_log` trả **chuỗi thô**. Đổi mảng thành
 * object thì model nhìn thấy thứ khác với lúc nó gọi tool — nên cắt theo từng kiểu:
 *
 * - **chuỗi** ⇒ cắt trần + chèn notice (vẫn là chuỗi).
 * - **mảng** ⇒ bỏ các mục cuối cho tới khi vừa ngân sách, rồi thêm MỘT mục đánh
 *   dấu đã cắt (vẫn là mảng).
 * - **object** ⇒ `capToolResult`.
 *
 * Vì sao cần: đo 2026-10-19, `git_diff` trả tới 400.000 ký tự (`lib/ipc.cjs:1041`)
 * — **không spill, không cắt** ⇒ ~100.000 token trong MỘT lần gọi tool, trong khi
 * phép ước lượng chỉ thấy 6.000 (cap 24.000) ⇒ thiếu 17× ⇒ compaction không kích
 * hoạt đúng lúc.
 */
export function capToolValue(value: unknown, saver?: SpillSaver): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.length <= TOOL_RESULT_MAX_CHARS) return value;
    const spilled = spillRedacted(value, 'tool-result.txt', saver);
    const cut = truncateToolResult(value, TOOL_RESULT_MAX_CHARS);
    return spilled ? `${cut}\n\n${spilled.notice}` : cut;
  }

  if (Array.isArray(value)) {
    if (serializedLength(value) <= TOOL_RESULT_MAX_CHARS) return value;
    const spilled = spillRedacted(JSON.stringify(value) ?? '', 'tool-result.txt', saver);
    /* Chừa chỗ cho dấu phẩy, ngoặc vuông và mục đánh dấu. */
    const room = Math.max(0, TOOL_RESULT_MAX_CHARS - 2_000);
    const out: unknown[] = [];
    let used = 0;
    for (const item of value) {
      const len = serializedLength(item);
      if (used + len > room) break;
      out.push(item);
      used += len;
    }
    const daCat = value.length - out.length;
    out.push({
      truncated: true,
      ...(spilled ? { spillNotice: spilled.notice } : {}),
      note: `Đã cắt bớt ${daCat} mục.`,
    });
    return out;
  }

  if (typeof value === 'object') {
    return capToolResult(value as Record<string, unknown>, saver);
  }

  return value;
}

/** Độ dài JSON của một giá trị — dùng để cắt mảng mà không phá hình dạng. */
function serializedLength(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}