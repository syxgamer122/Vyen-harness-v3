import { describe, expect, it } from 'vitest';
import { parseErrorIssues } from '@/components/chat/message-list';

/*
 * Regression cho banner lỗi im lặng (bước 0.5 của PLAN.md).
 *
 * `jsonError` (`app/api/chat/route.ts:171`) trả `details: parsed.error.issues`
 * cho BAD_SCHEMA, nhưng `friendlyErrorMessage` chỉ đọc `error`/`message` nên
 * người dùng thấy "Cấu trúc dữ liệu không hợp lệ." mà không biết ĐÂU hỏng.
 * Mỗi test ghi chú mutation nó bắt được (đảo điều kiện nào thì đỏ).
 *
 * Payload thật lấy từ `.next/dev/logs/next-development.log`:
 * `{"code":"too_big","maximum":64,"message":"Array must contain at most 64 element(s)",
 *   "path":["messages",1,"toolInvocations"]}`
 */

/** Dựng nguyên body mà API trả về, đúng thứ client nhận trong `err.message`. */
const badSchemaBody = (details: unknown) => JSON.stringify({ error: 'Cấu trúc dữ liệu không hợp lệ.', code: 'BAD_SCHEMA', requestId: 'r1', details });

describe('parseErrorIssues — lỗi KHÔNG phải JSON', () => {
  it('message thường (lỗi mạng, 500) → mảng rỗng, không throw', () => {
    expect(parseErrorIssues('fetch failed')).toEqual([]);
  });

  it('JSON hỏng → mảng rỗng, không throw', () => {
    expect(parseErrorIssues('{"error": "cắt ngang')).toEqual([]);
  });

  it('rỗng/undefined → mảng rỗng', () => {
    expect(parseErrorIssues('')).toEqual([]);
    expect(parseErrorIssues(undefined)).toEqual([]);
  });
});

describe('parseErrorIssues — lỗi CÓ details', () => {
  it('rút path + message từ issue thật', () => {
    const raw = badSchemaBody([
      { code: 'too_big', maximum: 64, type: 'array', message: 'Array must contain at most 64 element(s)', path: ['messages', 1, 'toolInvocations'] },
    ]);
    expect(parseErrorIssues(raw)).toEqual([
      { path: 'messages.1.toolInvocations', reason: 'Array must contain at most 64 element(s)' },
    ]);
  });

  it('nhiều issue → giữ đủ thứ tự', () => {
    const raw = badSchemaBody([
      { message: 'Required', path: ['id'] },
      { message: 'Expected string', path: ['model', 0] },
    ]);
    expect(parseErrorIssues(raw).map((i) => i.path)).toEqual(['id', 'model.0']);
  });

  it('issue ở gốc (path rỗng) → path là chuỗi rỗng, vẫn giữ message', () => {
    const raw = badSchemaBody([{ message: 'Phải là object', path: [] }]);
    expect(parseErrorIssues(raw)).toEqual([{ path: '', reason: 'Phải là object' }]);
  });

  it('path không phải mảng → path rỗng thay vì throw', () => {
    const raw = badSchemaBody([{ message: 'lỗi chung', path: 'messages' }]);
    expect(parseErrorIssues(raw)).toEqual([{ path: '', reason: 'lỗi chung' }]);
  });
});

describe('parseErrorIssues — payload rác', () => {
  it('details không phải mảng → mảng rỗng', () => {
    expect(parseErrorIssues(JSON.stringify({ error: 'x', details: 'không phải mảng' }))).toEqual([]);
  });

  it('details chứa phần tử không phải object → bỏ qua', () => {
    const raw = badSchemaBody(['chuỗi lạ', null, 42, { message: 'Còn lại', path: ['a'] }]);
    expect(parseErrorIssues(raw)).toEqual([{ path: 'a', reason: 'Còn lại' }]);
  });

  it('issue thiếu message → bỏ, không dựng dòng rỗng', () => {
    const raw = badSchemaBody([{ path: ['a'] }, { message: '', path: ['b'] }, { message: 'giữ', path: ['c'] }]);
    expect(parseErrorIssues(raw)).toEqual([{ path: 'c', reason: 'giữ' }]);
  });

  it('JSON nhưng không có details (rate limit) → mảng rỗng, banner giữ câu cũ', () => {
    expect(parseErrorIssues(JSON.stringify({ error: 'Quá nhiều yêu cầu', code: 'RATE_LIMIT' }))).toEqual([]);
  });
});

describe('parseErrorIssues — trần số issue', () => {
  it('hơn 5 issue → chỉ hiện 5, khớp `formatRecipeIssues`', () => {
    const raw = badSchemaBody(Array.from({ length: 12 }, (_, i) => ({ message: `lỗi ${i}`, path: ['p', i] })));
    const issues = parseErrorIssues(raw);
    expect(issues).toHaveLength(5);
    expect(issues[0]).toEqual({ path: 'p.0', reason: 'lỗi 0' });
    expect(issues[4]).toEqual({ path: 'p.4', reason: 'lỗi 4' });
  });
});
