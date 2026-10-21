/**
 * Plan phải TRUY VẾT ĐƯỢC: tiêu chí → test, và kịch bản người dùng.
 *
 * ============ VÌ SAO CÓ FILE NÀY ============
 *
 * Đo 2026-10-20: feature "đường giả lập cho CLI" ship với **1 Critical** — câu
 * trả lời của model KHÔNG BAO GIỜ được ghi vào transcript (người dùng thấy trên
 * màn hình nhưng transcript trên đĩa không có, lượt sau model không biết mình đã
 * trả lời gì).
 *
 * Nguyên nhân KHÔNG phải "không cẩn thận": plan có **hai tầng** lệch nhau —
 *   - tầng tiêu chí (văn xuôi): *"Review Focus: Transcript của lượt giả lập phải ghi
 *     được"* — **không tiêu chí nào có test**;
 *   - tầng việc (mã): Task chỉ nói *"trả `messages.slice(soDauVao)`"* ⇒ **thoả mãn
 *     được** trong khi tiêu chí vẫn sai.
 *
 * ⇒ Đúng `AGENTS.md` §4 ("tài liệu không có hiệu lực, test mới có") nhưng mở rộng
 * cho **KẾ HOẠCH**: văn xuôi không có hiệu lực, kể cả văn xuôi trong plan.
 *
 * ============ PHẠM VI ============
 *
 * Luật áp cho plan trong `docs/superpowers/plans/` viết **từ 2026-10-20**. Plan cũ là
 * **lịch sử** (repo đã dán nhãn ở `AGENTS.md` §4) — viết lại chúng là sửa lịch sử,
 * không phải sửa lỗi.
 *
 * ============ GIỚI HẠN ĐÃ ĐO — ĐỪNG HỨA QUÁ ============
 *
 * Test này canh **HÌNH THỨC**: mỗi tiêu chí có một dòng bảng, và file test nêu ở
 * bảng tồn tại (khi plan đã xong).
 *
 * Nó **KHÔNG** canh được việc dòng bảng có thật sự phủ tiêu chí hay không — đã thử
 * ràng buộc bằng cách so cụm từ dẫn nhập, và nó **bắt oan** một plan hợp lệ của
 * agent khác (tiêu chí "Màn hình" ↔ dòng bảng nói về "Transcript … cùng block":
 * cùng một thứ nhưng không dùng chung từ nào). ⇒ Văn xuôi trong bảng vẫn phải được
 * ĐỌC (bởi agent và bởi reviewer), không có test nào thay được.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const THU_MUC_PLAN = path.join(process.cwd(), 'docs', 'superpowers', 'plans');
const FILE_AGENTS = path.join(process.cwd(), 'AGENTS.md');
/** Từ ngày này, plan mới phải có mục truy vết. */
const TU_NGAY = '2026-10-20';
/** Tiêu đề mục bắt buộc trong plan (anchor dùng chung với AGENTS.md). */
const TIEU_DE = /##\s*Kịch bản\s*&\s*Test\b/;

interface Plan {
  ten: string;
  noiDung: string;
  /** true nếu plan còn bước chưa xong (`- [ ]`) ⇒ đang làm dở. */
  dangLam: boolean;
}

/** Chuẩn hoá: CRLF → LF, bỏ khối code (ví dụ trong plan không phải tiêu chí). */
function chuanHoa(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/```[\s\S]*?```/g, '');
}

/** Duyệt cây, bỏ qua thư mục phụ thuộc. */
function duyet(d: string, ra: string[] = []): string[] {
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync(d, { withFileTypes: true });
  } catch {
    return ra;
  }
  for (const e of entries) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) duyet(p, ra);
    else if (e.name.endsWith('.md')) ra.push(p);
  }
  return ra;
}

function cacPlan(): Plan[] {
  return duyet(THU_MUC_PLAN)
    .map((full) => {
      const ten = path.relative(THU_MUC_PLAN, full).replace(/\\/g, '/');
      const noiDung = chuanHoa(readFileSync(full, 'utf8'));
      return {
        ten,
        noiDung,
        dangLam: /^\s*-\s\[ \]/m.test(noiDung),
      };
    })
    /* Tên file KHÔNG có tiền tố ngày ⇒ coi như TRONG phạm vi (fail-closed):
       không muốn một plan lọt khỏi tầm canh chỉ vì đặt tên lạ. */
    .filter((p) => {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(p.ten);
      return m ? m[1] >= TU_NGAY : true;
    })
    .sort((a, b) => a.ten.localeCompare(b.ten));
}

/** Nội dung một mục `## ...` (tới mục `##` kế tiếp), hoặc null nếu không có. */
function layMuc(noiDung: string, re: RegExp): string | null {
  const m = re.exec(noiDung);
  if (!m) return null;
  const phan = noiDung.slice(m.index + m[0].length);
  const het = /\n##\s/.exec(phan);
  return het ? phan.slice(0, het.index) : phan;
}

/** Các mục đánh số trong `## Review Focus`. */
function soTieuChi(noiDung: string): string[] {
  const muc = layMuc(noiDung, /##\s*Review Focus\b/i);
  if (muc === null) return [];
  const ra: string[] = [];
  for (const dong of muc.split('\n')) {
    /* Chấp nhận `1.`, `- 1.`, `1)`, `**1.**` — bắt mọi cách viết mà tác giả hay
     * dùng, chứ không siết vào một hình thức. */
    const m = /^\s*(?:[-*]\s+)?(?:\*\*)?(\d+)\s*[.)]?\s+(.+)$/.exec(dong);
    if (m) ra.push(m[1]);
  }
  return ra;
}

interface DongBang {
  so: string;
  fileTest: string[];
}

/** Các dòng bảng `| # | tiêu chí | test |` trong mục `## Kịch bản & Test`. */
function cacDongBang(muc: string): DongBang[] {
  const ra: DongBang[] = [];
  for (const dong of muc.split('\n')) {
    const m = /^\|\s*(\d+)\s*\|(.+)$/.exec(dong);
    if (!m) continue;
    const fileTest: string[] = [];
    for (const f of m[2].matchAll(/`(tests\/[^`]+?\.(?:ts|tsx))`/g)) fileTest.push(f[1]);
    ra.push({ so: m[1], fileTest });
  }
  return ra;
}

describe('plan phải truy vết được (tiêu chí → test)', () => {
  const plans = cacPlan();

  it('có ít nhất MỘT plan trong phạm vi — không được rỗng (AGENTS.md §2.4)', () => {
    expect(
      plans.length,
      'không có plan nào trong phạm vi ⇒ test này rỗng, canh được gì?',
    ).toBeGreaterThan(0);
  });

  for (const p of plans) {
    const coFocus = layMuc(p.noiDung, /##\s*Review Focus\b/i) !== null;

    it(`${p.ten}: có mục "Kịch bản & Test" với kịch bản người dùng`, () => {
      const muc = layMuc(p.noiDung, TIEU_DE);
      expect(
        muc,
        'thiếu mục "## Kịch bản & Test" — không có chỗ nào ghi "người dùng sẽ thấy gì"',
      ).not.toBeNull();
      expect(
        /\*\*Người dùng thấy:\*\*/.test(muc ?? ''),
        'thiếu câu "**Người dùng thấy:**" TRONG mục — kịch bản người dùng là thứ duy nhất tự đặt ra ranh giới quan sát mà tác giả plan không nghĩ tới',
      ).toBe(true);
    });

    it(`${p.ten}: mục "Review Focus" phải parse ra được tiêu chí`, () => {
      if (!coFocus) return;
      expect(
        soTieuChi(p.noiDung).length,
        'có mục "## Review Focus" mà không parse ra tiêu chí nào ⇒ check rỗng, coi như pass',
      ).toBeGreaterThan(0);
    });

    it(`${p.ten}: mỗi tiêu chí có một dòng bảng tương ứng`, () => {
      if (!coFocus) return;
      const tieuChi = soTieuChi(p.noiDung);
      const muc = layMuc(p.noiDung, TIEU_DE);
      const dong = muc === null ? [] : cacDongBang(muc);
      const coSo = new Set(dong.map((d) => d.so));
      const thieuDong = tieuChi.filter((so) => !coSo.has(so));
      expect(
        thieuDong,
        `tiêu chí ${thieuDong.join(', ')} trong "Review Focus" không có dòng "tiêu chí → test" ⇒ văn xuôi không có hiệu lực`,
      ).toEqual([]);
    });

    it(`${p.ten}: mỗi dòng bảng nêu file test có thật`, () => {
      /* Plan ĐANG LÀM thì chưa có file test là bình thường (TDD: test sinh ra
       * trong lúc implement). Chỉ plan ĐÃ XONG mới bắt buộc file tồn tại — nếu
       * không, một plan đang làm dở làm ĐỎ cả repo (đo 2026-10-20). */
      if (p.dangLam) return;
      const muc = layMuc(p.noiDung, TIEU_DE);
      const dong = muc === null ? [] : cacDongBang(muc);
      expect(dong.length, 'plan đã xong mà bảng "tiêu chí → test" rỗng').toBeGreaterThan(0);
      const thieu: string[] = [];
      for (const d of dong) {
        if (d.fileTest.length === 0) {
          thieu.push(`dòng ${d.so} không nêu file test nào`);
          continue;
        }
        for (const f of d.fileTest) {
          if (!existsSync(path.join(process.cwd(), f))) thieu.push(`${f} (dòng ${d.so})`);
        }
      }
      expect(thieu, `file test không tồn tại: ${thieu.join(', ')}`).toEqual([]);
    });
  }
});

describe('luật trong AGENTS.md phải còn sống', () => {
  const ag = readFileSync(FILE_AGENTS, 'utf8');

  it('AGENTS.md có đủ 4 luật mà test này canh', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(ag, `AGENTS.md thiếu "### Luật ${n}"`).toContain(`### Luật ${n}`);
    }
  });

  it('AGENTS.md nêu mục "Kịch bản & Test" mà test này canh', () => {
    expect(ag).toContain('Kịch bản & Test');
  });

  it('AGENTS.md nêu rõ review độc lập là bắt buộc trước khi push', () => {
    expect(ag).toContain('requesting-code-review');
  });

  it('AGENTS.md nêu luật cấm lách cổng', () => {
    /* So khớp theo ý nghĩa, không khoá cứng câu chữ: diễn đạt lại vẫn xanh,
     * **xoá hẳn luật** thì đỏ. */
    expect(ag, 'AGENTS.md thiếu luật cấm lách cổng').toMatch(
      /Cấm\s+lách\s+cổng|Cấm\s+hạ\s+chuẩn\s+cổng/i,
    );
  });

  it('AGENTS.md liệt kê ĐỦ lệnh phá huỷ cây làm việc', () => {
    /* Đủ 5 lệnh. Đo 2026-10-21 (review độc lập): assert chỉ ghim 1/5 lệnh
     * thì xoá 4 lệnh còn lại vẫn xanh — luật còn câu chữ nhưng đã hụt. */
    const canh = [
      'git reset --hard',
      'git checkout -- .',
      'git restore .',
      'git clean -fd',
      'git push --force',
    ];
    const thieu = canh.filter((c) => !ag.includes(c));
    expect(thieu, `AGENTS.md thiếu lệnh phá huỷ: ${thieu.join(', ')}`).toEqual([]);
  });

  it('AGENTS.md khai báo môi trường làm việc NGAY ĐẦU FILE (Windows/PowerShell)', () => {
    /* Môi trường phải ở đầu: đọc AGENTS.md là thấy ngay, không phải lật tới
     * §2 mới biết mình đang gõ lệnh trên shell nào. */
    const dau = ag.split('\n').slice(0, 10).join('\n');
    expect(dau, '10 dòng đầu AGENTS.md không nói Windows').toContain('Windows');
    expect(dau, '10 dòng đầu AGENTS.md không nói PowerShell').toContain('PowerShell');
  });

  it('AGENTS.md nêu bẫy Next 16: `params` phải await', () => {
    expect(ag, 'AGENTS.md thiếu cảnh báo async request API của Next 16').toMatch(
      /await[^\n]{0,40}params/i,
    );
  });

  it('file canh cổng "hạ chuẩn" còn tồn tại và còn logic quét', () => {
    /* Tripwire trong `tests/repo-hygiene.test.ts` **không tự bảo vệ được chính
     * nó**: xoá cả file thì không còn test nào chạy để báo. Đo 2026-10-21
     * (review độc lập): xoá file ⇒ 3 file canh còn lại vẫn xanh. ⇒ file này
     * canh NGƯỢC LẠI: hai bên canh nhau.
     *
     * Giới hạn đã đo: xoá **cả hai** file thì không còn ai canh — cổng bảo vệ
     * cổng không thay được việc review độc lập (§2.5 Luật 4). */
    const p = path.join(process.cwd(), 'tests/repo-hygiene.test.ts');
    expect(existsSync(p), 'file canh cổng bị xoá — không còn ai chặn hạ chuẩn').toBe(true);
    const nd = readFileSync(p, 'utf8');
    expect(nd, 'logic quét chú thích bỏ qua lỗi kiểu đã bị xoá').toContain('TS_' + 'IGNORE');
    expect(nd, 'gate "type sai ở đây" đã bị xoá').toContain('TS_' + 'EXPECT');
    expect(nd, 'tripwire trong file canh cổng đã bị xoá').toContain('CANH_' + 'CONG');
    expect(nd, 'cổng vệ sinh file nguồn đã bị xoá').toContain('NHAN_' + 'BOM');
    /*
     * Xoá RIÊNG một test case (không xoá cả file) thì các hằng số trên vẫn
     * còn ⇒ phải đếm số test case. Đo 2026-10-21 (review độc lập): xoá riêng
     * gate "@ts-expect-error" ⇒ **không ai báo** — lớp lỗi M1/M2 tái diễn ở
     * mức test case.
     */
    const soTest = (nd.match(/\bit\(/g) ?? []).length;
    expect(soTest, 'repo-hygiene mất test case (số it() giảm)').toBeGreaterThanOrEqual(6);
  });
});
