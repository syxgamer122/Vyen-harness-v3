/**
 * Cổng duyệt trên console — thứ đứng giữa "model muốn ghi file" và "file bị ghi".
 *
 * ============ VÌ SAO CẦN RIÊNG ============
 *
 * CLI không có UI. `spec §7` nói tool nguy hiểm phải hỏi trước, và đây là chỗ
 * hỏi duy nhất. Tách ra thành hàm nhận `io` để **test được không cần terminal
 * thật** — nếu viết thẳng `readline` trong `cli/index.ts` thì không test nào chạm
 * được, mà đây đúng là chỗ hỏng thì mất dữ liệu.
 */
import { describe, expect, it } from 'vitest';
import { createConsoleApprover, describeToolCall } from '@/cli/approve';

describe('describeToolCall — trình bày để người dùng quyết', () => {
  it('fs_write: hiện ĐƯỜNG DẪN và NỘI DUNG, không chỉ tên tool', () => {
    const s = describeToolCall('fs_write', { path: 'src/a.ts', content: 'xinh chao' });
    expect(s).toContain('fs_write');
    expect(s).toContain('src/a.ts');
    expect(s).toContain('xinh chao');
  });

  it('shell_run: hiện lệnh, không cắt cụt', () => {
    const s = describeToolCall('shell_run', { command: 'npm run build' });
    expect(s).toContain('npm run build');
  });

  it('cắt nội dung quá dài — không in cả file 100.000 ký tự ra console', () => {
    const s = describeToolCall('fs_write', { path: 'a.ts', content: 'y'.repeat(5000) });
    expect(s.length).toBeLessThan(1500);
  });

  it('cắt tiền tố nhạy cảm (key) trong tham số', () => {
    const s = describeToolCall('shell_run', { command: 'curl -H "sk-secret-abc123456789" https://x' });
    expect(s).not.toContain('sk-secret-abc123456789');
  });

  it('tham số lạ cũng không làm sập — chỉ stringify an toàn', () => {
    const s = describeToolCall('fs_write', { path: 'a.ts', weird: { a: [1, 2] } });
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });
});

describe('createConsoleApprover — chỉ "y" mới cho qua', () => {
  const ask = (answer: string) => createConsoleApprover(async () => answer);

  it('"y" thì cho qua', async () => {
    expect(await ask('y')( 'fs_write', { path: 'a.ts' })).toBe(true);
  });

  /* Enter trống phải là KHÔNG. Mặc định "không" là thứ giữ được dữ liệu: bấm
   * Enter theo phản xạ sẽ chạy nhầm lệnh xoá file. */
  it('Enter trống thì KHÔNG cho qua', async () => {
    expect(await ask('')( 'fs_write', { path: 'a.ts' })).toBe(false);
  });

  it('"n" thì không cho qua', async () => {
    expect(await ask('n')('fs_write', { path: 'a.ts' })).toBe(false);
  });

  it('"Y" hoa/thường đều được', async () => {
    expect(await ask('Y')('shell_run', { command: 'ls' })).toBe(true);
  });

  it('"co" (tiếng Việt không dấu) cũng được', async () => {
    expect(await ask('co')('shell_run', { command: 'ls' })).toBe(true);
  });

  it('gõ bậy thì hỏi lại, không tự coi là đồng ý', async () => {
    const hoi: string[] = [];
    let lan = 0;
    const approve = createConsoleApprover(async () => {
      lan++;
      hoi.push('hỏi');
      return lan === 1 ? 'hông' : 'y';
    });
    expect(await approve('fs_write', { path: 'a.ts' })).toBe(true);
    expect(hoi.length).toBe(2);
  });

  it('hỏi lại quá 3 lần thì từ chối, không hỏi vô hạn', async () => {
    let lan = 0;
    const approve = createConsoleApprover(async () => {
      lan++;
      return 'hông';
    });
    expect(await approve('fs_write', { path: 'a.ts' })).toBe(false);
    expect(lan).toBeLessThanOrEqual(4);
  });
});

describe('createAutoApprover — chỉ dùng khi người dùng tự bật', () => {
  it('VYEN_YOLO bật thì duyệt hết, nhưng vẫn ghi lại là đã bỏ qua duyệt', async () => {
    const { createAutoApprover } = await import('@/cli/approve');
    const approve = createAutoApprover(true);
    expect(await approve('shell_run', { command: 'rm -rf x' })).toBe(true);
    expect(await approve('fs_write', { path: 'a', content: 'b' })).toBe(true);
  });
});
