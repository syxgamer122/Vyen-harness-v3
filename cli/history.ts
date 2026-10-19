/**
 * Lịch sử dòng lệnh — phím mũi tên gọi lại câu đã gõ.
 *
 * ============ VÌ SAO NẰM Ở ĐÂY, KHÔNG DÙNG CỦA `readline` ============
 *
 * `readline` có lịch sử sẵn, nhưng nó gắn vào readline. Ở đây dòng lệnh thuộc về
 * REPL, và `readline` chỉ được mở khi **hỏi duyệt tool** hoặc chờ giữa hai lượt —
 * còn khi lượt đang chạy thì không ai đọc stdin. Bấm `↑` lúc đó sẽ thành ký tự rác.
 *
 * Nên phần này chỉ lo **con trỏ điều hướng**, phần đọc phím thì do `cli/index.ts`
 * gắn vào stdin. Hai đầu nối, mỗi đầu một việc.
 *
 * ============ CỐ Ý KHÔNG VÒNG QUA ĐẦU ============
 *
 * Ở đầu bảng thì `↑` đứng yên, không quay về câu cuối. Vòng qua đầu là kiểu hành
 * vi của shell cũ, nhưng ở đây hậu quả khác: người dùng bấm `↑` để *xem lại* câu
 * cũ, thấy quay về cuối là tưởng hỏng, bấm thêm và bấm `Enter` — gửi nhầm lệnh.
 */
export interface HistoryOptions {
  /** Số câu giữ gần nhất. */
  toiDa?: number;
}

export class TaoLichSu {
  private readonly cai: string[] = [];
  private readonly toiDa: number;
  /** -1 = không đang duyệt. 0 = câu mới nhất. */
  private viTri = -1;

  constructor(opts: HistoryOptions = {}) {
    this.toiDa = opts.toiDa ?? 200;
  }

  /** Ghi một câu đã gửi đi. */
  ghi(dong: string): void {
    const s = dong.trim();
    if (!s) return;
    // Câu lặp liên tiếp chỉ giữ một: người dùng bấm `↑↑` thì muốn lùi thật sự,
    // chứ không phải đọc lại `git status` ba lần.
    if (this.cai[this.cai.length - 1] !== s) this.cai.push(s);
    while (this.cai.length > this.toiDa) this.cai.shift();
    this.viTri = -1;
  }

  /** Lùi một câu. `undefined` khi chưa có gì để lùi. */
  lai(): string | undefined {
    if (this.cai.length === 0) return undefined;
    if (this.viTri === -1) this.viTri = this.cai.length - 1;
    else if (this.viTri > 0) this.viTri--;
    return this.cai[this.viTri];
  }

  /**
   * Tiến một câu. Trả về chuỗi rỗng ở cuối bảng — để CLI **xoá sạch dòng nhập**,
   * vì người dùng đã đi quá xa và muốn gõ lại từ đầu.
   */
  di(): string {
    if (this.viTri === -1) return '';
    if (this.viTri < this.cai.length - 1) {
      this.viTri++;
      return this.cai[this.viTri];
    }
    this.viTri = this.cai.length; // quá cuối
    return '';
  }

  /** Thoát chế độ duyệt — gọi khi người dùng bắt đầu gõ lại. */
  dung(): void {
    this.viTri = -1;
  }

  /**
   * Số câu đang nhớ.
   *
   * Chỉ để test đếm được. Nếu không có nó thì test "câu lặp chỉ lưu một lần" đi
   * bằng cách lùi vài bước — mà lùi vài bước thì **không phân biệt được** có câu
   * trùng hay không, vì hai bảng cho ra cùng chuỗi ở những vị trí đó. Đo 2026-10-19:
   * bỏ kiểm tra trùng mà test vẫn xanh.
   */
  get kichThuoc(): number {
    return this.cai.length;
  }
}