/**
 * Bí mật đọc được từ file (`.env`, `~/.aws/credentials`) KHÔNG được nằm nguyên
 * văn trong IndexedDB và trong file sao lưu `.json` mà người dùng xuất ra.
 *
 * Vì sao phải che ở TẦNG LƯU, không chỉ ở tầng gửi lên model:
 *   - ngữ cảnh model đã được che (`attachToolResultParts` ở `app/api/chat/route.ts`
 *     gọi `redactSecretsDeep`) ⇒ **người dùng không thấy** khoá trong chat;
 *   - nhưng DB và file sao lưu thì có ⇒ khoá nằm trong file người dùng hay
 *     gửi đi (issue, ticket, nhóm chat) mà không có dấu vết nào trong app.
 *
 * Ranh giới: chỉ che **kết quả công cụ** (nội dung app tự đọc từ đĩa).
 * Nội dung người dùng TỰ GÕ là dữ liệu của họ — không được đổi.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeToolInvocations } from '@/lib/db';
import * as backup from '@/lib/backup';
import type { StoredMessage } from '@/lib/db';

/** Khoá giả, đúng hình dạng Anthropic API key (dài để khớp rule che). */
const KHOA = 'sk-ant-api03-Xy7Kd2Qp9RtVm4Zb8Nc1Lf6Hg3Js5Wq';

describe('bí mật không nằm trong IndexedDB', () => {
  it('kết quả tool lưu xuống không còn khoá thô', () => {
    const out = sanitizeToolInvocations([
      {
        toolCallId: 'call_1',
        toolName: 'fs_read',
        state: 'result',
        result: { content: `OPENAI_API_KEY=${KHOA}\n` },
      },
    ]);

    expect(out, 'phải còn invocation để tái dựng tool-call').toBeDefined();
    const text = JSON.stringify(out);
    expect(text, 'khoá KHÔNG được nằm trong DB').not.toContain(KHOA);
    expect(text, 'tên biến vẫn còn (chỉ giá trị bị che)').toContain('OPENAI_API_KEY');
  });

  it('kết quả tool KHÔNG phải bí mật thì giữ nguyên', () => {
    const out = sanitizeToolInvocations([
      {
        toolCallId: 'call_2',
        toolName: 'fs_read',
        state: 'result',
        result: { content: 'export const tong = 42;\n' },
      },
    ]);

    expect(JSON.stringify(out)).toContain('export const tong = 42;');
  });

  it('bí mật nằm SÂU hơn giới hạn đệ quy vẫn không lọt vào DB', () => {
    /* `redactDeep` dừng ở `DEEP_REDACT_MAX_DEPTH = 12` ⇒ kết quả lồng sâu hơn
     * vẫn giữ bí mật nếu chỉ dựa vào deep-redact. Che trên CHUỖI JSON đã
     * serialize không có giới hạn độ sâu. */
    let goc: Record<string, unknown> = { content: `token=${KHOA}` };
    for (let i = 0; i < 15; i += 1) goc = { [`k${i}`]: goc };

    const out = sanitizeToolInvocations([
      { toolCallId: 'call_3', toolName: 'fs_read', state: 'result', result: goc },
    ]);

    expect(JSON.stringify(out), 'khoá sâu 15 tầng cũng không được lọt').not.toContain(KHOA);
  });
});

describe('bí mật không nằm trong file sao lưu xuất ra', () => {
  it('bản xuất đã che khoá đọc từ file', () => {
    expect(typeof backup.sanitizeMessageForExport).toBe('function');

    const msg: StoredMessage = {
      id: 'm1',
      chatId: 'c1',
      role: 'assistant',
      content: 'Đã đọc file .env',
      parentId: '__ROOT__',
      seq: 0,
      branchOrder: 0,
      branchTieBreaker: 'm1',
      createdAt: 1,
      toolInvocations: [
        {
          toolCallId: 'call_1',
          toolName: 'fs_read',
          state: 'result',
          result: { content: `OPENAI_API_KEY=${KHOA}` },
        },
      ],
    };

    const exported = backup.sanitizeMessageForExport(msg);
    expect(JSON.stringify(exported), 'khoá KHÔNG được nằm trong file sao lưu').not.toContain(KHOA);
    expect(exported.content, 'nội dung tin nhắn của người dùng giữ nguyên').toBe('Đã đọc file .env');
  });
});
