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

describe('createConsoleApprover — khi KHÔNG đọc được câu trả lời (EOF)', () => {
  /* Đo 2026-10-20 (chạy CLI thật): cổng duyệt báo *"Nguoi dung KHONG duyet"*
   * trong khi người dùng **chưa hề được hỏi** — vì stdin không phải terminal
   * (pipe) và dòng trả lời đã bị readline nuốt mất trước khi có câu hỏi.
   *
   * EOF (null) KHÁC với "người dùng bấm Enter" (chuỗi rỗng): Enter là câu
   * trả lời "không" có chủ đích, còn EOF là "không hỏi được" ⇒ phải báo đúng
   * lý do, không đổ lỗi cho người dùng. */
  it('EOF thì từ chối NGAY (không hỏi lại 3 lần)', async () => {
    let soLanHoi = 0;
    const duyet = createConsoleApprover(async () => {
      soLanHoi++;
      return null;
    });
    expect(await duyet('fs_write', { path: 'a.ts' })).toBe(false);
    expect(soLanHoi, 'hết dòng rồi thì hỏi thêm cũng vô ích').toBe(1);
  });

  it('báo rõ lý do từ chối (không phải "người dùng từ chối")', async () => {
    const ghiChu: string[] = [];
    const duyet = createConsoleApprover(async () => null, {
      note: (s) => ghiChu.push(s),
    });
    await duyet('fs_write', { path: 'a.ts' });
    expect(ghiChu.join('\n')).toMatch(/stdin|terminal/i);
  });

  it('Enter trống thì VẪN hỏi lại một lần (không phải EOF)', async () => {
    let soLanHoi = 0;
    const duyet = createConsoleApprover(async () => {
      soLanHoi++;
      return '';
    });
    expect(await duyet('fs_write', { path: 'a.ts' })).toBe(false);
    expect(soLanHoi, 'Enter trống = câu trả lời "không" có chủ đích ⇒ hỏi lại cho chắc').toBe(2);
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
  /* Tên test bản đầu nói "vẫn ghi lại là đã bỏ qua duyệt" nhưng không khẳng định
   * điều gì như vậy, và `createAutoApprover(_on)` **bỏ qua tham số** — nên
   * `createAutoApprover(false)` cũng duyệt hết. Tham số chết là thứ đáng sợ ở
   * đây: đó là cờ bỏ lớp bảo vệ, và một lần gọi sai là xoá file không hỏi. */
  it('tắt thì KHÔNG duyệt gì cả', async () => {
    const { createAutoApprover } = await import('@/cli/approve');
    expect(await createAutoApprover(false)('shell_run', { command: 'rm -rf x' })).toBe(false);
    expect(await createAutoApprover(false)('fs_write', { path: 'a', content: 'b' })).toBe(false);
  });

  it('bật thì duyệt hết', async () => {
    const { createAutoApprover } = await import('@/cli/approve');
    const approve = createAutoApprover(true);
    expect(await approve('shell_run', { command: 'rm -rf x' })).toBe(true);
    expect(await approve('fs_write', { path: 'a', content: 'b' })).toBe(true);
  });
});
