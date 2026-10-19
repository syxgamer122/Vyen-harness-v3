/**
 * Gọi lại lệnh đã gõ bằng phím mũi tên.
 *
 * ============ VÌ SAO KHÔNG NHỎ NHƯ TÔI NGHĨ ============
 *
 * Đây không chỉ là tiện. Trong một hội thoại dài, người dùng sửa lại một câu lệnh
 * đã gõ — bấm `↑` cho nhanh. **Nếu bấm `↑` không có tác dụng gì, họ sẽ tự gõ lại
 * từ đầu** — và tự gõ lại thường là gõ *khác*, tức mất luôn ý định ban đầu.
 *
 * Với công cụ có quyền ghi file, "gõ lại gần giống" là rủi ro thật: lệnh gần giống
 * mà khác một đối số là lệnh khác hẳn.
 *
 * ============ VÌ SAO `readline` KHÔNG ĐỦ ============
 *
 * `readline` có sẵn cơ chế lịch sử — nhưng nó gắn vào **readline**, còn ở đây dòng
 * lệnh là của REPL (`runAgentTurn` không dùng readline khi lượt đang chạy). Nếu bấm
 * `↑` giữa lúc chờ mà readline không ở chế độ line editor thì phím sẽ thành ký tự
 * rác trong câu hỏi. Vì vậy logic lịch sử nằm ở đây, thuần và test được.
 */
import { describe, expect, it } from 'vitest';

const { TaoLichSu } = await import('@/cli/history');

describe('TaoLichSu — gọi lại bằng phím mũi tên', () => {
  it('ban đầu không có gì để gọi lại', () => {
    const l = new TaoLichSu();
    expect(l.lai()).toBeUndefined();
  });

  it('sau khi gửi một câu, gọi lại được câu đó', () => {
    const l = new TaoLichSu();
    l.ghi('doc README');
    expect(l.lai()).toBe('doc README');
  });

  /* Gọi lần 2 mà không điều hướng thì phải đứng yên, không nhảy về đầu bảng như một
   * con trỏ chạy. */
  it('gọi lần hai không di chuyển thì vẫn trả về cùng câu', () => {
    const l = new TaoLichSu();
    l.ghi('cau 1');
    expect(l.lai()).toBe('cau 1');
    expect(l.lai()).toBe('cau 1');
  });

  it('↑ đi ngược: câu mới nhất trước', () => {
    const l = new TaoLichSu();
    l.ghi('cau 1');
    l.ghi('cau 2');
    expect(l.lai()).toBe('cau 2');
    expect(l.lai()).toBe('cau 1');
    /* Ở đầu bảng rồi thì đứng yên — không vòng qua đầu, vì gõ nhầm sẽ gửi câu
     * cũ đi khi người dùng chỉ muốn xem lại. */
    expect(l.lai()).toBe('cau 1');
  });

  it('↓ đi xuôi, và ở cuối thì trả về rỗng (để xoá dòng)', () => {
    const l = new TaoLichSu();
    l.ghi('cau 1');
    l.ghi('cau 2');
    l.lai();
    l.lai();
    expect(l.di()).toBe('cau 2');
    expect(l.di()).toBe('');
  });

  /* Nếu đi tới cuối rồi gõ câu mới thì phải bắt đầu lại từ đầu bảng — nếu không,
   * lệnh sử của phiên mới sẽ nối vào cuộc hội thoại cũ. */
  it('ghi câu mới thì con trỏ về cuối bảng', () => {
    const l = new TaoLichSu();
    l.ghi('cau 1');
    l.lai();
    l.lai();
    l.ghi('cau moi');
    expect(l.lai()).toBe('cau moi');
  });

  it('lệnh `/...` cũng được ghi — gọi lại lệnh là chuyện thường', () => {
    const l = new TaoLichSu();
    l.ghi('/exit');
    expect(l.lai()).toBe('/exit');
  });

  /* Dòng trống không lưu, không lệch chỉ số. */
  it('dòng trống hoặc toàn khoảng trắng thì không ghi', () => {
    const l = new TaoLichSu();
    l.ghi('   ');
    l.ghi('');
    expect(l.lai()).toBeUndefined();
  });

  /* ============ GHI LẠI: VÌ SAO PHẢI ĐẾM, KHÔNG CHỈ LÙI VÀI BƯỚC ============
   *
   * Bản đầu chỉ lùi 2 bước và vẫn xanh khi bỏ kiểm tra trùng — vì cả hai bảng
   * (có trùng và không trùng) trả về **cùng chuỗi** ở hai vị trí đó. Đó là test
   * rỗng theo đúng nghĩa AGENTS.md mô tả: xanh mà không canh gì.
   *
   * Nên phải quan sát được số phần tử.
   */
it('câu lặp lại liên tiếp chỉ lưu MỘT lần', () => {
    const l = new TaoLichSu();
    l.ghi('git status');
    l.ghi('git status');
    l.ghi('ls');
    expect(l.kichThuoc, 'cau lap bi luu nhieu lan').toBe(2);
    expect(l.lai()).toBe('ls');
    expect(l.lai()).toBe('git status');
  });

  it('câu trùng nhưng CÁCH NHAU câu khác thì vẫn giữ cả hai', () => {
    const l = new TaoLichSu();
    l.ghi('ls');
    l.ghi('pwd');
    l.ghi('ls');
    expect(l.kichThuoc).toBe(3);
  });

  /* Bảng phình vô hạn thì đĩa đầy dần — không có lý do phải để vậy. */
  it('giới hạn số câu nhớ gần nhất', () => {
    const l = new TaoLichSu({ toiDa: 3 });
    l.ghi('a');
    l.ghi('b');
    l.ghi('c');
    l.ghi('d');
    expect(l.lai()).toBe('d');
    expect(l.lai()).toBe('c');
    expect(l.lai()).toBe('b');
    expect(l.lai()).toBe('b');
  });
});