/**
 * BAD_SCHEMA `toolInvocations` vượt trần 64 — giết lượt agent im lặng.
 *
 * Bằng chứng thật, log trình duyệt (workspace "Neurobics Dashboard Design (10)",
 * model oc/space-bunny-free):
 *
 *   [req:1b30297b] native xong (finish=tool-calls, calls=2)
 *   [req:deef6911] native xong (finish=tool-calls, calls=4)
 *   [req:9e947a95] native xong (finish=tool-calls, calls=5)
 *   [req:91c61f7a] native xong (finish=tool-calls, calls=8)
 *   [req:73b98041] native xong (finish=tool-calls, calls=13)
 *   [req:887ad51b] native xong (finish=tool-calls, calls=12)
 *   [req:65d97cf8] native xong (finish=tool-calls, calls=9)
 *   [req:6d126375] native xong (finish=tool-calls, calls=8)
 *   [req:8cc2ff2a] native xong (finish=tool-calls, calls=26)
 *    POST /api/chat 400
 *   [browser] [useChat] Error: {... "code":"BAD_SCHEMA", "details":[{
 *     "code":"too_big","maximum":64,"type":"array",
 *     "message":"Array must contain at most 64 element(s)",
 *     "path":["messages",1,"toolInvocations"]}]}
 *
 * 2+4+5+8+13+12+9+8 = 61 invocation TRƯỚC vòng cuối (26). Con số đó dồn vào
 * MỘT message assistant: `useChat` không tạo message mới mỗi vòng tool —
 * `appendResponseMessages` (ai@4) nối invocation mới vào `lastMessage`:
 *   lastMessage.toolInvocations = [...lastMessage.toolInvocations, ...mới]
 * với `maxStep` tăng 1 mỗi vòng. Nên payload PHÌNH theo số vòng của lượt, và
 * đó là lý do nâng trần 12 → 64 không giải quyết được gì: nó chỉ đẩy bức tường
 * lùi xa hơn, lượt agent dài vẫn vỡ. Sửa gốc là CẮT ở phía client.
 *
 * `path: ["messages", 1, ...]` cũng khớp: message assistant đó là phần tử 1
 * (sau tin user), tức lỗi nằm ở message của CHÍNH lượt đang chạy — không
 * phải lịch sử cũ bị gửi lại.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { appendResponseMessages } from 'ai';
import {
  MAX_TOOL_INVOCATIONS_PER_MESSAGE,
  RECENT_TOOL_INVOCATIONS_KEPT,
  trimToolInvocations,
  type ToolInvocationLike,
} from '@/lib/tool-limits';

/* Trần phía server là hằng số KHÔNG export (`const` trong route.ts). Đọc thẳng
   từ source thay vì export thêm chỉ để test — đúng convention của
   tests/chat-route-fixes.test.ts. CRLF → LF một lần: file trên đĩa là CRLF
   (core.autocrlf) và regex bám `\n` sẽ đỏ trên máy khác. */
const routeSource = fs
  .readFileSync(path.resolve(__dirname, '../app/api/chat/route.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

/** Đúng hình dạng AI SDK đẩy vào `message.toolInvocations` mỗi vòng tool. */
function invocation(step: number, index: number): ToolInvocationLike {
  return {
    state: 'result',
    step,
    toolCallId: `call_${step}_${index}`,
    toolName: 'fs_read',
    args: { path: `src/a${index}.ts` },
    result: `nội dung file ${index} ở vòng ${step}`,
  };
}

/** Dựng lại đúng lượt agent đã giết phiên trong log. */
const REAL_TURN_STEPS = [2, 4, 5, 8, 13, 12, 9, 8, 26];

function realTurn(): ToolInvocationLike[] {
  const out: ToolInvocationLike[] = [];
  REAL_TURN_STEPS.forEach((count, step) => {
    for (let i = 0; i < count; i += 1) out.push(invocation(step, i));
  });
  return out;
}

/* Trần của route là hằng số riêng, không export; đọc từ source để client lệch
   nhau là ĐỎ thay vì chỉ lệch âm thầm. Điều kiện đảo: đổi trần server →
   case "trần client không được RỘNG hơn trần server" ĐỎ. */
const SERVER_CAP = Number(
  /MAX_TOOL_INVOCATIONS_PER_REQUEST = (\d+)/.exec(routeSource)?.[1],
);

describe('số invocation của lượt agent trong log thật vượt trần server', () => {
  it('lượt trong log mang 87 invocation — vượt 64, đó là nguyên nhân 400', () => {
    expect(realTurn()).toHaveLength(87);
    expect(realTurn().length).toBeGreaterThan(SERVER_CAP);
  });

  /**
   * Cùng kịch bản đó nhưng dựng bằng HÀM THẬT của SDK (`appendResponseMessages`)
   * thay vì cộng tay — để cái đồng kiến "mọi vòng dồn vào MỘT message" là
   * điều đo được, không phải giả định. Nếu SDK đổi cách gom, test này đỏ
   * thay vì im lặng hỏng.
   */
  it('SDK thật gom đúng 87 invocation vào MỘT message assistant', () => {
    let messages: unknown[] = [{ role: 'user', content: 'làm dashboard' }];
    REAL_TURN_STEPS.forEach((count, step) => {
      messages = appendResponseMessages({
        messages: messages as never,
        responseMessages: [
          {
            role: 'assistant',
            id: `a${step}`,
            /* SDK đọc tool-call từ `content` dạng parts (không phải `parts`). */
            content: Array.from({ length: count }, (_, i) => ({
              type: 'tool-call' as const,
              toolCallId: `c${step}_${i}`,
              toolName: 'fs_read',
              args: { path: `a${i}.ts` },
            })),
          },
        ],
      });
    });

    /* Tin assistant cuối mang TOÀN BỘ 87 invocation của cả lượt — đây là
       `messages[1].toolInvocations` mà log server trỏ tới. */
    const last = messages[messages.length - 1] as {
      role: string;
      parts: Array<{ type: string; toolInvocation?: ToolInvocationLike }>;
    };
    expect(last.role).toBe('assistant');
    const gathered = last.parts
      .filter((p) => p.type === 'tool-invocation' && p.toolInvocation)
      .map((p) => p.toolInvocation as ToolInvocationLike);
    expect(gathered).toHaveLength(87);
    expect(gathered.length).toBeGreaterThan(SERVER_CAP);

    /* Cắt → hết vượt, và vòng CUỐI của lượt vẫn nguyên vẹn. */
    const trimmed = trimToolInvocations(gathered);
    expect(trimmed.length).toBeLessThanOrEqual(SERVER_CAP);
    expect(trimmed.filter((inv) => inv.step === REAL_TURN_STEPS.length - 1)).toHaveLength(26);
  });
});

describe('trimToolInvocations — cắt đúng thứ gây vượt trần', () => {
  it('lượt 87 invocation xuống dưới trần server (trước đây: 87 → BAD_SCHEMA)', () => {
    const trimmed = trimToolInvocations(realTurn());
    expect(trimmed.length).toBeLessThanOrEqual(SERVER_CAP);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_TOOL_INVOCATIONS_PER_MESSAGE);
  });

  it('GIỮ phần MỚI (đuôi) — model phải thấy kết quả của vòng nó vừa làm', () => {
    const trimmed = trimToolInvocations(realTurn());
    const last = trimmed[trimmed.length - 1];
    /* Vòng cuối của lượt trong log là vòng step 8 (26 call). Giữ nó là bắt
       buộc: bỏ nó thì model mất ngay kết quả vừa trả về. */
    expect(last.step).toBe(8);
    expect(trimmed.filter((inv) => inv.step === 8)).toHaveLength(26);
  });

  it('bỏ phần CŨ, và phần bỏ đi là các vòng ĐẦU (đã nằm trong content)', () => {
    const trimmed = trimToolInvocations(realTurn());
    const steps = new Set(trimmed.map((inv) => inv.step));
    /* Giữ `RECENT_TOOL_INVOCATIONS_KEPT` cái cuối nên các vòng sớm nhất rơi
       khỏi mảng — đó là chỗ payload ngừng phình. */
    expect(trimmed).toHaveLength(RECENT_TOOL_INVOCATIONS_KEPT);
    expect(steps.has(0)).toBe(false);
    expect(steps.has(8)).toBe(true);
  });

  it('đủ tròn cho một lượt agent dài (không cắt quá sớm)', () => {
    /* Một lượt bình thường (nhiều vòng nhưng không hùng dũ) phải qua nguyên vẹn:
       cắt ở 32 nghĩa là mất context mà model vẫn đang cần. */
    const normal = realTurn().slice(0, 24);
    const trimmed = trimToolInvocations(normal);
    expect(trimmed).toHaveLength(24);
    expect(trimmed).toEqual(normal);
  });

  it('mảng rỗng / không vượt trần thì trả về y hệt, không cắt cụt', () => {
    expect(trimToolInvocations([])).toEqual([]);
    const small = [invocation(0, 0), invocation(0, 1)];
    expect(trimToolInvocations(small)).toEqual(small);
  });

  it('KHÔNG mutate mảng gốc (useChat giữ nguyên mảng này để render)', () => {
    const original = realTurn();
    const before = original.length;
    trimToolInvocations(original);
    expect(original).toHaveLength(before);
  });

  /**
   * Rủi ro của việc cắt: invocation CHƯA có `result` mà bị cắt đi thì model
   * mất dấu tool_call, hoặc server ném
   * `AI_MessageConversionError: ToolInvocation must have a result`.
   *
   * Thực tế: server ĐÃ tự vá trường hợp này — `normalizeMessageToolInvocations`
   * (app/api/chat/route.ts, qua lib/message-normalize.ts) gắn kết quả tổng hợp
   * cho mọi invocation `state !== 'result'` trước khi chuyển sang CoreMessage.
   * Nên cắt bỏ invocation cũ đã có kết quả là an toàn; test này khoá đúng
   * ranh giới đó thay vì khoá một hành vi không tồn tại.
   */
  it('invocation chưa có result vẫn được server vá — không phải lý do để không cắt', () => {
    const pending: ToolInvocationLike = {
      state: 'call',
      step: 0,
      toolCallId: 'pending_1',
      toolName: 'fs_read',
      args: { path: 'pending.ts' },
    };
    /* Hàm cắt bỏ phần CŨ — và phần cũ là phần đã xong. */
    const trimmed = trimToolInvocations([...realTurn(), pending], 64, 32);
    expect(trimmed).toContainEqual(pending);
  });

  it('sau khi cắt, phần GIỮ lại đều là vòng ĐÃ hoàn tất', () => {
    /* Trong lượt agent thật, mọi invocation đã kịp có kết quả trước khi
       lượt kết thúc — nên phần đuôi giữ lại là dữ liệu sạch. */
    const trimmed = trimToolInvocations(realTurn());
    expect(trimmed.every((inv) => inv.state === 'result')).toBe(true);
  });

  it('giữ đúng 32 cái cuối khi vượt, bất kể vượt bao nhiêu', () => {
    const huge = Array.from({ length: 500 }, (_, i) => invocation(0, i));
    const trimmed = trimToolInvocations(huge);
    expect(trimmed).toHaveLength(RECENT_TOOL_INVOCATIONS_KEPT);
    expect(trimmed[trimmed.length - 1].toolCallId).toBe('call_0_499');
  });

  it('trần client không được RỘNG hơn trần server', () => {
    /* Hai hằng số ở hai tệp khác nhau phải đồng thuận; client rộng hơn là
       vô nghĩa (server vẫn 400) và client hẹp hơn là cắt oan. */
    expect(SERVER_CAP).toBe(64);
    expect(MAX_TOOL_INVOCATIONS_PER_MESSAGE).toBe(SERVER_CAP);
    expect(RECENT_TOOL_INVOCATIONS_KEPT).toBeLessThanOrEqual(MAX_TOOL_INVOCATIONS_PER_MESSAGE);
  });
});

/* ------------------------------------------------------------------ */
/* Nối dây phía client                                                  */
/* ------------------------------------------------------------------ */

/**
 * Hàm cắt chỉ có tác dụng nếu THỰC SỰ chạy trên body gửi đi. `useChat` không
 * cho ghim `messages` qua option nào khác, nên đường duy nhất là
 * `experimental_prepareRequestBody` — bỏ dòng này thì payload vẫn phình và
 * lượt agent vẫn chết ở vòng thứ 9, chỉ là test hàm vẫn xanh.
 *
 * Điều kiện đảo: xoá `experimental_prepareRequestBody` khỏi lời gọi
 * `useChat` → case này ĐỎ.
 */
describe('client thực sự cắt payload trước khi gửi', () => {
  const orchSource = fs
    .readFileSync(path.resolve(__dirname, '../react/use-chat-orchestration.ts'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('useChat nối prepareChatRequestBody (đường duy nhất can thiệp messages)', () => {
    expect(orchSource).toMatch(/experimental_prepareRequestBody: prepareChatRequestBody/);
  });

  it('prepareChatRequestBody cắt toolInvocations, KHÔNG cắt content', () => {
    /* `content` là nơi useChat nối text từng vòng — cắt nó là mất lịch sử
       hội thoại, mất cả bối cảnh mà phần toolInvocations bị cắt để nhường. */
    expect(orchSource).toMatch(
      /messages: requestMessages\.map\(\(m\) =>\s*\n\s*m\.toolInvocations && m\.toolInvocations\.length > 0\s*\n\s*\? \{ \.\.\.m, toolInvocations: trimToolInvocations\(m\.toolInvocations\) \}\s*\n\s*: m,\s*\n\s*\)/,
    );
  });

  it('body gốc của useChat không còn chứa toolInvocations để gửi thẳng', () => {
    /* Không gửi thẳng mảng phình lên; mọi request đi qua prepareChatRequestBody. */
    expect(orchSource).toMatch(/body: chatRequestBody,/);
  });
});

/* ------------------------------------------------------------------ */
/* Người dùng phải ĐƯỢC BIẾT lượt chết vì lý do gì                       */
/* ------------------------------------------------------------------ */

/**
 * BAD_SCHEMA không có mã `[XXX#id]` nên `onError` không bắt được, lỗi rơi
 * xuống `console.error` — người dùng chỉ thấy run dừng, không một chữ giải
 * thích (log thật: lỗi chỉ hiện ở `[browser] [useChat] Error:`).
 *
 * Điều kiện đảo: xoá nhánh `BAD_SCHEMA` → case ĐỎ.
 */
describe('onError nói rõ cho người dùng khi payload vượt trần', () => {
  const orchSource = fs
    .readFileSync(path.resolve(__dirname, '../react/use-chat-orchestration.ts'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('có nhánh riêng cho BAD_SCHEMA', () => {
    expect(orchSource).toMatch(/else if \(code === 'BAD_SCHEMA'\)/);
  });

  it('nhận diện đúng lý do toolInvocations quá trần, không báo chung chung', () => {
    expect(orchSource).toMatch(/tooManyToolResults/);
    expect(orchSource).toMatch(/\/toolInvocations\/\.test\(errMsg\)/);
  });

  it('vẫn báo được BAD_SCHEMA không liên quan tool (không nuốt lỗi im lặng)', () => {
    /* Cả hai nhánh đều showNotice: nhánh tool và nhánh chung. Nhánh chung là
       `else if (code && …)` mà BAD_SCHEMA rơi vào khi không phải lý do trên. */
    const badSchemaBranch = orchSource.slice(orchSource.indexOf("code === 'BAD_SCHEMA'"));
    expect(badSchemaBranch).toMatch(/showNotice\(/);
  });
});