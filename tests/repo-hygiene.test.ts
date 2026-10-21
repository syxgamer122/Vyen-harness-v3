/**
 * Vệ sinh repo + cổng chống hạ chuẩn — những điều luật bằng lời không canh được, nên canh bằng test.
 *
 * ============ VÌ SAO CÓ FILE NÀY ============
 *
 * `AGENTS.md` §2 nói "phải làm hỏng đúng thứ mà test khoá". Nhưng nó **không**
 * nói: đừng viết lời hứa trước khi có test. Cả 8 lần lỗi tôi mắc trong phiên
 * 2026-10-19 đều thuộc loại đó — và loại đó không có test nào bắt được, vì nó
 * nằm ở **comment**, không nằm ở code.
 *
 * Vì vậy phần này chỉ canh những gì **đo được**:
 *
 *   1. File nguồn không được có BOM. Đo 2026-10-19: công cụ ghi file của
 *      harness thêm BOM vào **mọi** file tạo mới (10/10 file của tôi), còn
 *      502 file còn lại của repo thì sạch. Đó là thay đổi byte vô nghĩa nằm
 *      trong diff — đúng loại "sửa file hỏng âm thầm" mà AGENTS.md §2.3 cảnh
 *      báo.
 *
 *   2. Mọi file trong `CORE_ENTRIES` phải tồn tại và phải là file .ts — để một
 *      entry sai không làm bảng kiểm kê sai hoàn toàn mà không ai thấy.
 *
 *   3. Cổng không bị hạ chuẩn: không bỏ qua lỗi kiểu, không làm rỗng file test
 *      canh cổng. Đo 2026-10-21 (review độc lập): mọi cách "làm cho cổng im"
 *      đều đi qua đây — ép kiểu để `tsc` im, tắt lint, xoá assert.
 *
 * ============ PHẠM VI QUÉT: CẢ CÂY, KHÔNG CHỈ app/lib/... ============
 *
 * Đo 2026-10-21 (review độc lập): `tailwind.config.ts` ở gốc **nằm trong
 * chương trình `tsc`** (phần `include` của tsconfig phủ mọi file .ts ở gốc) nhưng
 * không nằm trong danh sách thư mục code ⇒ quét theo danh sách thư mục là quét
 * hụt. Quét cả cây, bỏ qua thư mục phụ thuộc và thư mục sinh ra.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { CORE_ENTRIES } from '@/scripts/cli-migration/import-graph';

const PHU_MOI = /\.(ts|tsx|mts|cts|cjs|mjs|js|jsx)$/;

/**
 * Thư mục KHÔNG phải mã nguồn của dự án.
 *
 * Danh sách đen TƯỜNG MINH, không phải "mọi thư mục bắt đầu bằng dấu chấm":
 * `.github/` **có** mã nguồn thật (`.github/scripts/discord-changelog.mjs` chạy
 * trong CI) ⇒ bỏ nó khỏi tầm quét là quét hụt (đo 2026-10-21, review độc lập).
 */
const BO_IGNORED = new Set([
  'node_modules',
  '.git',
  '.next',
  '.superpowers',
  '.vyen',
  'dist',
  'out',
  'coverage',
  'temp-test-profile',
]);

/** Bản sao file đã xoá (`.audit-backup-*`) — không phải nguồn. */
function laBackup(t: string): boolean {
  return t.startsWith('.audit-backup-');
}

/*
 * Hai mẫu bị cấm, GHÉP TỪ HAI PHẦN.
 *
 * Lý do: file này tự quét chính nó. Nếu viết mẫu đủ 4 chữ thì dòng định nghĩa
 * trong file này cũng bị báo — test tự tạo ra bằng chứng chống lại chính nó.
 * Ghép chuỗi ⇒ file không chứa mẫu, nhưng vẫn quét được mẫu trong file khác.
 */
const TS_IGNORE = '@ts-i' + 'gnore';
const TS_EXPECT = '@ts-expect' + '-error';

/**
 * Nhãn hiển thị khi phát hiện BOM.
 *
 * Tách thành hằng số để tripwire ở file khác neo vào **định danh** ổn định, không
 * neo vào câu chữ trong thông báo lỗi — người sau viết lại thông báo cho rõ
 * hơn thì không vô tình làm cả repo đỏ (đo 2026-10-21, review độc lập).
 */
const NHAN_BOM = 'nguồn có BOM';

/** Duyệt cây, bỏ qua thư mục phụ thuộc. */
function duyet(d: string, ra: string[] = []): string[] {
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync(d, { withFileTypes: true });
  } catch {
    return ra;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue;
      duyet(path.join(d, e.name), ra);
    } else if (PHU_MOI.test(e.name)) {
      ra.push(path.join(d, e.name));
    }
  }
  return ra;
}

/**
 * Duyệt CẢ CÂY repo, bỏ qua thư mục phụ thuộc / thư mục sinh ra / thư mục ẩn.
 *
 * Trả về đường dẫn TƯƠNG ĐỐI so với gốc repo, dấu gạch chéo ngược chuyển sang
 * `/`. (Tính đường dẫn tương đối ngay trong hàm đệ quy sẽ ra đường dẫn tương
 * đối với *thư mục con* — đọc file sẽ hỏng.)
 */
function duyetCay(dir: string, ra: string[] = []): string[] {
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return ra;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (BO_IGNORED.has(e.name) || laBackup(e.name)) continue;
      duyetCay(path.join(dir, e.name), ra);
    } else if (PHU_MOI.test(e.name)) {
      ra.push(path.join(dir, e.name));
    }
  }
  return ra;
}

/** Mọi file mã nguồn trong repo (đường dẫn tương đối, `/`). */
function tatCaFileNguon(): string[] {
  const goc = process.cwd();
  return duyetCay(goc).map((f) => path.relative(goc, f).replace(/\\/g, '/'));
}

/**
 * Tách phần CHÚ THÍCH MỘT DÒNG của từng dòng — bỏ qua chuỗi và chú thích khối.
 *
 * ============ VÌ SAO PHẢI CÓ HÀM NÀY ============
 *
 * Cách rút gọn "dòng có hai dấu gạch chéo và không có dấu mở khối" bị lách bằng
 * MỘT token: một chú thích khối đóng lại rồi `// @ts-ignore` ở cuối dòng là
 * chú thích MỘT DÒNG hợp lệ mà TypeScript **vẫn** tắt typecheck — cổng im.
 * Ngược lại, `nd.includes('// @ts-ignore')` là code hợp lệ (test khẳng định cổng
 * hoạt động) mà cổng báo nhầm.
 *
 * ⇒ Phải đi đúng ngữ pháp: chỉ phần SAU hai dấu gạch chéo, nằm ngoài chuỗi và
 * ngoài chú thích khối, mới là chú thích.
 *
 * Giới hạn đã đo: chuỗi nhiều dòng (template literal) bị coi là chuỗi hết
 * dòng ⇒ một `//` bên trong template làm lệch phân tích dòng đó. Chấp nhận
 * được: template có chứa mẫu bị cấm là trường hợp rất hiếm.
 */
function cacLenhTrenDong(noiDung: string): string[] {
  const ra: string[] = [];
  let trongKhoi = false; // đang ở trong chú thích khối (trải nhiều dòng)
  for (const dong of noiDung.split('\n')) {
    let doanChuThich = '';
    let i = 0;
    while (i < dong.length) {
      const c = dong[i];
      if (trongKhoi) {
        if (c === '*' && dong[i + 1] === '/') {
          trongKhoi = false;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      // Mở chú thích khối.
      if (c === '/' && dong[i + 1] === '*') {
        trongKhoi = true;
        i += 2;
        continue;
      }
      // Chú thích một dòng: phần còn lại của dòng là chú thích.
      if (c === '/' && dong[i + 1] === '/') {
        doanChuThich = dong.slice(i);
        break;
      }
      // Chuỗi: nội dung trong chuỗi KHÔNG phải chú thích.
      if (c === '"' || c === "'" || c === '`') {
        const dau = c;
        i += 1;
        while (i < dong.length) {
          if (dong[i] === '\\') {
            i += 2;
            continue;
          }
          if (dong[i] === dau) {
            i += 1;
            break;
          }
          i += 1;
        }
        continue;
      }
      i += 1;
    }
    ra.push(doanChuThich);
  }
  return ra;
}

describe('vệ sinh file nguồn', () => {
  it('KHÔNG file nguồn nào có BOM', () => {
    const coBom: string[] = [];
    for (const f of tatCaFileNguon()) {
      const b = readFileSync(f);
      // BOM = EF BB BF. Mọi công cụ đọc (tsc, vitest) đều bỏ qua nó, nên nó
      // không làm hỏng gì — chính vì vậy nó lọt vào diff mà không ai báo.
      if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) coBom.push(f);
    }
    expect(
      coBom,
      `file ${NHAN_BOM} (thay đổi byte vô nghĩa trong diff): ${coBom.join(', ')}`,
    ).toEqual([]);
  });
});

describe('cổng không bị hạ chuẩn', () => {
  /*
   * ============ VÌ SAO ============
   *
   * Cách agent lách luật phổ biến nhất KHÔNG phải viết code sai, mà là làm cho
   * cổng im: ép kiểu để `tsc` không nói gì, tắt lint, bỏ hook commit. Cổng mà
   * không còn nói gì thì không phải cổng.
   *
   * Văn xuôi trong `AGENTS.md` không có hiệu lực (§4) ⇒ luật ở đây phải tự đứng
   * được: đổi code ⇒ test đỏ.
   */
  it('KHÔNG file nguồn nào dùng chú thích bỏ qua lỗi kiểu (@ts-…)', () => {
    const co: string[] = [];
    for (const f of tatCaFileNguon()) {
      cacLenhTrenDong(readFileSync(f, 'utf8')).forEach((doan, i) => {
        if (doan.includes(TS_IGNORE)) co.push(`${f}:${i + 1}`);
      });
    }
    expect(co, `${TS_IGNORE} là cách tắt typecheck: ${co.join(', ')}`).toEqual([]);
  });

  it('chú thích "type sai ở đây" (@ts-…) phải có lý do ngay cùng dòng', () => {
    const thieu: string[] = [];
    for (const f of tatCaFileNguon()) {
      cacLenhTrenDong(readFileSync(f, 'utf8')).forEach((doan, i) => {
        const at = doan.indexOf(TS_EXPECT);
        if (at < 0) return;
        const lyDo = doan.slice(at + TS_EXPECT.length).trim();
        if (lyDo.length < 3) thieu.push(`${f}:${i + 1}`);
      });
    }
    expect(thieu, `${TS_EXPECT} không kèm lý do: ${thieu.join(', ')}`).toEqual([]);
  });

  it('tripwire: file test canh cổng còn giữ marker canh', () => {
    /*
     * ============ GIỚI HẠN ĐÃ ĐO — ĐỪNG HỨA QUÁ ============
     *
     * Bắt được: xoá hẳn, làm rỗng, hoặc **đổi tên** marker trong file test canh
     * cổng (đổi tên bị bắt nhờ so khớp theo ranh giới từ, không phải
     * `includes` — `includes('TIEU_DE')` vẫn đúng với `TIEU_DE_X`).
     *
     * KHÔNG bắt được: ai đó nới điều kiện assert mà vẫn giữ nguyên marker —
     * nên đây là **tripwire**, không phải bằng chứng. Việc nới assert vẫn phải
     * bị reviewer bắt (§2.5 Luật 4).
     *
     * ============ VÌ SAO MARKER GHÉP TỪ HAI PHẦN ============
     *
     * Marker phải là **định danh** của logic bị canh, không phải câu chữ; và
     * phải ghép lại, vì nếu viết thẳng thì chính DÒNG NÀY giữ chuỗi đó trong
     * file — xoá logic thật đi thì tripwire vẫn xanh. Đã đo: mutation đầu tiên
     * ("brand-lime" → "brand-lime-XX") không làm đỏ vì chuỗi cũ vẫn nằm trong
     * chuỗi mới.
     *
     * ============ VÌ SAO MARKER LÀ ĐỊNH DANH HẰNG SỐ ============
     *
     * Neo vào câu chữ trong thông báo lỗi thì quá gắt: người sau viết lại thông
     * báo cho rõ hơn là cả repo đỏ. ⇒ Mỗi file canh có một hằng số riêng
     * (`TEN_DESIGN`, `NHAN_BOM`, `TIEU_DE`, `APPROVED`) làm neo.
     */
    const CANH_CONG: { file: string; dau: string[] }[] = [
      { file: 'tests/plan-traceability.test.ts', dau: ['TIEU' + '_DE'] },
      { file: 'tests/design-system.test.ts', dau: ['TEN_' + 'DESIGN'] },
      { file: 'tests/repo-hygiene.test.ts', dau: ['NHAN_' + 'BOM'] },
      { file: 'tests/brand-placement.test.ts', dau: ['APPROV' + 'ED'] },
    ];
    const mat: string[] = [];
    for (const c of CANH_CONG) {
      const p = path.join(process.cwd(), c.file);
      if (!existsSync(p)) {
        mat.push(`${c.file} (mất file)`);
        continue;
      }
      const noiDung = readFileSync(p, 'utf8');
      for (const d of c.dau) {
        if (!coMarker(noiDung, d)) mat.push(`${c.file} mất marker "${d}"`);
      }
    }
    expect(mat, `file test canh cổng bị sửa/làm rỗng: ${mat.join(', ')}`).toEqual([]);
  });
});

/** So khớp theo ranh giới từ — đổi tên marker (thêm hậu tố) thì không khớp. */
function coMarker(noiDung: string, dau: string): boolean {
  const an = dau.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${an}\\b`).test(noiDung);
}

describe('CORE_ENTRIES', () => {
  it('mọi entry tồn tại và là file .ts', () => {
    const sai: string[] = [];
    for (const e of CORE_ENTRIES) {
      try {
        if (!statSync(e).isFile()) sai.push(`${e} (không phải file)`);
        else if (!e.endsWith('.ts')) sai.push(`${e} (không phải .ts)`);
      } catch {
        sai.push(`${e} (không tồn tại)`);
      }
    }
    expect(sai, `entry sai làm bảng kiểm kê sai hoàn toàn: ${sai.join(', ')}`).toEqual([]);
  });

  it('mọi file trong `cli/` đều phải được khai trong CORE_ENTRIES', () => {
    /* ============ VÌ SAO ============
     *
     * Đo 2026-10-19 (reviewer độc lập): guard "lõi CLI không kéo trình duyệt vào"
     * quét `browserBoundIn(listTsFiles('lib'), touchers)` — nên file trong `cli/`
     * **không bao giờ** bị đánh dấu, dù chúng nằm trong `core`. Thêm
     * `import { db } from '@/lib/db'` vào `cli/repl.ts` thì test vẫn xanh.
     *
     * Nên: file `cli/` mà KHÔNG khai trong `CORE_ENTRIES` thì nằm ngoài mọi
     * guard. Test này buộc mọi file mới trong `cli/` phải được khai — tức không
     * có lối để lọt mà không ai thấy.
     */
    const fileCli = duyet('cli').map((f) => f.replace(/\\/g, '/'));
    const chuaKhai = fileCli.filter((f) => !CORE_ENTRIES.includes(f));
    expect(
      chuaKhai,
      `file cli/ chưa khai trong CORE_ENTRIES nên nằm ngoài mọi guard: ${chuaKhai.join(', ')}`,
    ).toEqual([]);
  });
});
