/**
 * Cây nguồn không được có **export chết** (định nghĩa mà không nơi nào dùng).
 *
 * ============ VÌ SAO CẦN CANH ============
 *
 * AGENTS.md §6: *"Cái nào không cần thì xoá hết, không giữ lại"* — nhưng "không
 * giữ lại" chỉ có tác dụng nếu có ai phát hiện. Export chết là thứ **không bao
 * giờ hỏng** nên không ai thấy, và mỗi lần thêm là một lần phải đọc thêm.
 *
 * ============ CÁCH QUÉT (và điều nó KHÔNG bắt được) ============
 *
 * Đếm số lần xuất hiện của mỗi mã định danh trong TOÀN CÂY (nguồn + tests).
 * Tên chỉ xuất hiện đúng MỘT lần (tại chỗ khai báo) ⇒ export chết.
 *
 * Có tính cả lần xuất hiện trong CHUỖI ⇒ một tên chỉ được dùng động (ví dụ
 * tên tool truyền qua JSON) sẽ **không** bị flag — thiên về không báo oan.
 *
 * Cái nó KHÔNG bắt được: export dùng động mà tên không xuất hiện ở đâu (rất
 * hiếm). Vì vậy allowlist ở dưới là danh sách **có lý do**, không phải chỗ
 * giấu tên.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const THU_MUC_NGUON = ['lib', 'app', 'components', 'react', 'cli', 'core', 'hooks', 'scripts'];
const THU_MUC_TEST = ['tests'];

/**
 * Export được PHÉP chết — mỗi mục kèm LÝ DO (để người sau không xoá nhầm và
 * không thêm lại).
 */
const CHO_Phep = new Map<string, string>([
  ['requireVyenDesktop', 'API cho app Electron (repo khác) — dùng bởi renderer ngoài repo này'],
  ['desktopLlmFetch', 'API cho app Electron (repo khác) — dùng bởi renderer ngoài repo này'],
]);

function duyet(dir: string, ra: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return ra;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git' || name === '.next') continue;
    const p = path.join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) duyet(p, ra);
    else if (/\.(ts|tsx|cjs|mjs|js)$/.test(name)) ra.push(p);
  }
  return ra;
}

/** File cấu hình ở THƯ MỤC GỐC (`next.config.ts`, `vitest.config.ts`…) — không
 * khai báo export nào nhưng CÓ thể dùng tên export ⇒ phải tính vào tần suất,
 * nếu không thì export dùng ở đó bị flag oan. */
function duvetThuMucGoc(goc: string): string[] {
  try {
    return readdirSync(goc)
      .filter((n) => /\.(ts|tsx|cjs|mjs|js)$/.test(n))
      .map((n) => path.join(goc, n));
  } catch {
    return [];
  }
}

describe('cây nguồn không có export chết', () => {
  it('mọi export đều được dùng ở đâu đó', () => {
    const goc = process.cwd();
    const fileNguon = THU_MUC_NGUON.flatMap((d) => duyet(path.join(goc, d)));
    const fileTest = THU_MUC_TEST.flatMap((d) => duyet(path.join(goc, d)));
    const fileTatCa = [...fileNguon, ...fileTest, ...duvetThuMucGoc(goc)];
    const tapNguon = new Set(fileNguon);

    /* Đếm số lần xuất hiện của MỌI mã định danh trong toàn cây. */
    const tanSuat = new Map<string, number>();
    for (const f of fileTatCa) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
        tanSuat.set(m[0], (tanSuat.get(m[0]) ?? 0) + 1);
      }
    }

    /* Tên được KHAI BÁO export trong mã nguồn. */
    const khaiBao = new Map<string, string[]>();
    for (const f of fileNguon) {
      const text = readFileSync(f, 'utf8');
      const re = /export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/g;
      for (const m of text.matchAll(re)) {
        const list = khaiBao.get(m[1]) ?? [];
        list.push(path.relative(goc, f).replace(/\\/g, '/'));
        khaiBao.set(m[1], list);
      }
    }

    const chet = [...khaiBao.entries()]
      .filter(([ten]) => (tanSuat.get(ten) ?? 0) <= 1 && !CHO_Phep.has(ten))
      .map(([ten, file]) => `${ten} — ${file.join(', ')}`)
      .sort();

    expect(
      chet,
      'export chết: xoá hẳn (AGENTS.md §6) hoặc dùng lại — đừng giữ "có thể sau này cần"',
    ).toEqual([]);
  });
});
