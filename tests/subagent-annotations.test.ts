/**
 * Gom nhật ký subagent về trạng thái hiện tại — mỗi lượt một thẻ.
 *
 * Bug 2026-10-18 (chủ repo báo kèm ảnh): một subagent chạy xong, câu trả lời đã ra,
 * nhưng vẫn còn HAI dòng quay "đang chạy" cùng một `#runId`, bên cạnh dòng
 * "đã báo xong". Nguyên nhân: annotation là nhật ký sự kiện (start + N progress +
 * done) mà UI render thẳng từng sự kiện như một subagent riêng. `phase` của các
 * bản ghi cũ đã đóng băng ở giá trị "progress" nên quay vĩnh viễn.
 *
 * Test ở đây gọi HÀM THẬT, không soi source — gom nhóm sai thì import vẫn chạy.
 */
import { describe, it, expect } from 'vitest';
import { getSubagentAnnotations } from '@/components/subagent-card';

const ann = (subagent: Record<string, unknown>) => ({ subagent });

describe('getSubagentAnnotations — gom nhật ký về trạng thái hiện tại', () => {
  it('một lượt có start + nhiều progress + done ra MỘT thẻ ở trạng thái cuối', () => {
    const out = getSubagentAnnotations([
      ann({ phase: 'start', runId: 'r1', agentName: 'Code', maxTurns: 6 }),
      ann({ phase: 'progress', runId: 'r1', type: 'text' }),
      ann({ phase: 'progress', runId: 'r1', type: 'tool' }),
      ann({ phase: 'progress', runId: 'r1', type: 'reasoning' }),
      ann({ phase: 'done', runId: 'r1', agentName: 'Code', result: 'xong' }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].subagent.phase).toBe('done');
    expect(out[0].subagent.result).toBe('xong');
  });

  it('lượt chưa xong thì vẫn ra thẻ "đang chạy" chứ không biến mất', () => {
    const out = getSubagentAnnotations([
      ann({ phase: 'start', runId: 'r1', agentName: 'Code' }),
      ann({ phase: 'progress', runId: 'r1', type: 'text' }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].subagent.phase).toBe('progress');
  });

  it('hai lượt xen kẽ nhau ra hai thẻ, mỗi lượt một trạng thái', () => {
    const out = getSubagentAnnotations([
      ann({ phase: 'start', runId: 'r1' }),
      ann({ phase: 'start', runId: 'r2' }),
      ann({ phase: 'progress', runId: 'r1' }),
      ann({ phase: 'done', runId: 'r1', result: 'A' }),
      ann({ phase: 'done', runId: 'r2', result: 'B' }),
    ]);

    expect(out).toHaveLength(2);
    expect(out.map((a) => a.subagent.runId)).toEqual(['r1', 'r2']);
    expect(out.map((a) => a.subagent.phase)).toEqual(['done', 'done']);
    expect(out.map((a) => a.subagent.result)).toEqual(['A', 'B']);
  });

  it('giữ trường chỉ xuất hiện ở sự kiện đầu (maxTurns, task)', () => {
    const out = getSubagentAnnotations([
      ann({ phase: 'start', runId: 'r1', agentName: 'Code', maxTurns: 6, task: 'viết bài' }),
      ann({ phase: 'done', runId: 'r1', result: 'xong' }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].subagent.maxTurns).toBe(6);
    expect(out[0].subagent.task).toBe('viết bài');
    expect(out[0].subagent.agentName).toBe('Code');
  });

  it('progress KHÔNG có runId (tin ghi trước bản sửa) quy về lượt đứng trước', () => {
    const out = getSubagentAnnotations([
      ann({ phase: 'start', runId: 'r1', agentName: 'Code' }),
      ann({ phase: 'progress', type: 'text' }),
      ann({ phase: 'done', runId: 'r1', result: 'xong' }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].subagent.phase).toBe('done');
  });

  it('bỏ annotation không phải subagent, và chịu undefined', () => {
    expect(getSubagentAnnotations([{ tool: { id: 't1' } }, ann({ phase: 'done', runId: 'r1' })])).toHaveLength(1);
    expect(getSubagentAnnotations(undefined)).toEqual([]);
    expect(getSubagentAnnotations([])).toEqual([]);
  });

  /**
   * Khoá tính duy nhất của React `key`.
   *
   * `tool-trace.tsx` dùng `key={ann.subagent.runId || i}` — nếu `getSubagentAnnotations`
   * trả về hai thẻ cùng `runId`, React báo "two children with the same key" và
   * có thể bỏ sót/hái lặn phần tử. Test này dựng đúng chuỗi annotation mà
   * server phát ra: hai lượt, mỗi lượt start + progress + done, xen kẽ nhau.
   */
  it('không bao giờ trả về hai thẻ mang cùng runId', () => {
    const out = getSubagentAnnotations([
      ann({ phase: 'start', runId: 'r1', agentName: 'Code' }),
      ann({ phase: 'start', runId: 'r2', agentName: 'Code' }),
      ann({ phase: 'progress', runId: 'r1', type: 'text' }),
      ann({ phase: 'done', runId: 'r1', result: 'A' }),
      ann({ phase: 'progress', runId: 'r2', type: 'tool' }),
      ann({ phase: 'done', runId: 'r2', result: 'B' }),
    ]);

    expect(out).toHaveLength(2);
    const keys = out.map((a) => a.subagent.runId);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /** Lượt đã kết thúc không được bị một `progress` về sau đẩy ngược về "đang chạy". */
  it('progress về sau KHÔNG hạ một lượt đã xong', () => {
    const out = getSubagentAnnotations([
      ann({ phase: 'start', runId: 'r1' }),
      ann({ phase: 'done', runId: 'r1', result: 'A' }),
      ann({ phase: 'progress', runId: 'r1', type: 'text' }),
    ]);
    expect(out[0].subagent.phase).toBe('done');
  });
});
