/**
 * Vệ sinh repo — những điều luật bằng lời không canh được, nên canh bằng test.
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
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { CORE_ENTRIES } from '@/scripts/cli-migration/import-graph';

const THU_MUC = ['app', 'lib', 'components', 'react', 'scripts', 'tests', 'cli', 'core'];
const PHU_MOI = /\.(ts|tsx|cjs|js|mjs)$/;

/** Duyệt cây, bỏ qua thư mục phụ thuộc. */
function duyet(d: string, ra: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(d);
  } catch {
    return ra;
  }
  for (const ten of entries) {
    if (ten === 'node_modules' || ten === '.git' || ten === '.next' || ten === 'dist') continue;
    const p = path.join(d, ten);
    let laThuMuc = false;
    try {
      laThuMuc = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (laThuMuc) duyet(p, ra);
    else if (PHU_MOI.test(ten)) ra.push(p.replace(/\\/g, '/'));
  }
  return ra;
}

describe('vệ sinh file nguồn', () => {
  it('KHÔNG file nguồn nào có BOM', () => {
    const coBom: string[] = [];
    for (const d of THU_MUC) {
      for (const f of duyet(d)) {
        const b = readFileSync(f);
        // BOM = EF BB BF. Mọi công cụ đọc (tsc, vitest) đều bỏ qua nó, nên nó
        // không làm hỏng gì — chính vì vậy nó lọt vào diff mà không ai báo.
        if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) coBom.push(f);
      }
    }
    expect(
      coBom,
      `file nguồn có BOM (thay đổi byte vô nghĩa trong diff): ${coBom.join(', ')}`,
    ).toEqual([]);
  });
});

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
     * có lối nào để lọt mà không ai thấy.
     */
    const fileCli = duyet('cli').map((f) => f.replace(/\\/g, '/'));
    const chuaKhai = fileCli.filter((f) => !CORE_ENTRIES.includes(f));
    expect(
      chuaKhai,
      `file cli/ chưa khai trong CORE_ENTRIES nên nằm ngoài mọi guard: ${chuaKhai.join(', ')}`,
    ).toEqual([]);
  });
});
