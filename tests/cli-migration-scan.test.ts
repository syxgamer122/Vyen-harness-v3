/**
 * Kiểm kê di cư sang CLI — Task 1: script quét API trình duyệt.
 *
 * Ba test dưới đây cố tình hỗn hợp hai loại:
 *   - hai test đầu dùng fixture viết tay → nhanh, nhưng **tự chứng minh**:
 *     chúng xanh ngay cả khi regex hỏng, vì chúng so với cái mình tự viết.
 *   - test thứ ba quét `lib/db.ts` thật → **duy nhất bắt được** regex hỏng.
 *
 * Đây là dạng lỗi đã xảy ra nhiều lần trong phiên 2026-10-18: cơ chế kiểm
 * trông đúng nhưng không soi được gì (`describe.skipIf` làm 9 test "xanh";
 * `try/catch` nuốt `MODULE_NOT_FOUND` khiến tính năng chết mà full suite vẫn xanh;
 * marker sai một ký tự làm test luôn đỏ, tức cũng vô dụng).
 *
 * Xem plan: docs/superpowers/plans/2026-10-18-cli-migration-inventory.md
 * Spec: docs/superpowers/specs/2026-10-18-cli-core-design.md §4
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { BROWSER_APIS, scanBrowserApis, scanFile } from '@/scripts/cli-migration/scan-browser-apis';
import { countTsFiles } from '@/scripts/cli-migration/build-inventory';
import { FORCE_LABEL } from '@/scripts/cli-migration/ly-do';
import { CORE_ENTRIES, reachableFrom, resolveInternal, unreached, runtimeImportSpecs, browserBoundIn, listTsFiles } from '@/scripts/cli-migration/import-graph';

describe('scanFile', () => {
  it('dò đúng API trình duyệt và trả về số dòng', () => {
    const src = [
      "import Dexie from 'dexie';", // dòng 1
      'export const db = new Dexie("vyen");', // dòng 2
      'async function mo() {', // dòng 3
      '  const h = await showDirectoryPicker();', // dòng 4
      '  localStorage.setItem("k", "v");', // dòng 5
      '}',
    ].join('\n');

    const hits = scanFile(src, 'lib/demo.ts');
    expect(hits.map((h) => [h.line, h.api])).toEqual([
      [1, 'Dexie'],
      [2, 'Dexie'],
      [4, 'showDirectoryPicker'],
      [5, 'localStorage'],
    ]);
  });

  /* Nếu đưa `window` vào danh sách API thì mọi file đều dính vì guard
   * `typeof window !== 'undefined'` xuất hiện khắp nơi — bảng kiểm kê lúc đó
   * mất hết khả năng chỉ đường. Test này khoá đúng ranh giới đó. */
  it('bỏ qua guard typeof window — không phải API trình duyệt chỉ-server', () => {
    const src = ['if (typeof window !== "undefined") {', '  return null;', '}'].join('\n');
    expect(scanFile(src, 'lib/demo.ts')).toEqual([]);
  });

  /* Review C1 — review độc lập phát hiện bảng đếm CẢ COMMENT và STRING.
   * 39/44 dòng bảng không có dòng code nào dùng API nào. Có dòng còn phủ định
   * chính nó: `lib/turns.ts:32` viết "không kéo Dexie vào đúng import".
   * Chỉ đếm trong AST thì mới phân biệt được comment với code. */
  it('KHÔNG đếm API nằm trong comment', () => {
    const src = [
      '/**',
      ' * Thuần function, không Dexie/React → test được trong node.',
      ' */',
      'export function noop() {}',
    ].join('\n');
    expect(scanFile(src, 'lib/demo.ts')).toEqual([]);
  });

  it('KHÔNG đếm API nằm trong string literal', () => {
    const src = "export const skill = { name: 'Dexie IndexedDB Schema & Transactions' };";
    expect(scanFile(src, 'lib/demo.ts')).toEqual([]);
  });

  it('VẪN đếm API nằm trong import — import là dùng thật', () => {
    const src = "import Dexie from 'dexie';";
    expect(scanFile(src, 'lib/demo.ts').map((h) => h.api)).toEqual(['Dexie']);
  });

  it('đếm được API dạng dotted: navigator.storage', () => {
    const src = 'const x = await navigator.storage.getDirectory();';
    expect(scanFile(src, 'lib/demo.ts').map((h) => h.api)).toEqual(['navigator.storage']);
  });
});

describe('scanBrowserApis — cơ chế quét tự được kiểm', () => {
  /* Nếu regex hỏng, hai test trên VẪN xanh. Chỉ test này bắt được: nó so với
   * một file có thật, không phải fixture tự viết. */
  it('phải tìm thấy Dexie trong lib/db.ts thật', () => {
    const hits = scanBrowserApis('lib');
    const db = hits.filter((h) => h.file === 'lib/db.ts' && h.api === 'Dexie');
    expect(
      db.length,
      'lib/db.ts chắc chắn có Dexie (dòng 1: `import Dexie from "dexie"`) — quét mà không thấy là regex hỏng',
    ).toBeGreaterThan(0);
  });

  /* Đường dẫn phải dùng '/' kể cả trên Windows, nếu không mọi assert so với
   * 'lib/db.ts' sẽ hỏng âm thầm khi ai đó đổi máy. */
  it('đường dẫn luôn dùng dấu gạch chéo, kể cả trên Windows', () => {
    const hits = scanBrowserApis('lib');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.file, `đường dẫn phải dùng "/": ${h.file}`).not.toContain('\\');
      expect(h.file.startsWith('lib/')).toBe(true);
    }
  });
});

/**
 * Task 2: đồ thị import — file nào còn dùng bởi lõi.
 *
 * Test quan trọng nhất ở đây là "đồ thị phải lớn hơn 5 file": nếu regex
 * `from '@/x'` sai, hàm sẽ trả tập rỗng, mọi file trông như "không ai dùng"
 * — và kế hoạch phía sau sẽ kết luận **xoá hết**. Đây là hướng hại hại nhất
 * của cả công việc này: `AGENTS.md` §6 đã ghi đúng trường hợp đó.
 */
describe('import-graph', () => {
  it('đi từ entry tới được qua chuỗi import nhiều tầng', () => {
    const s = reachableFrom(['lib/agent-tools-server.ts']);
    // agent-tools-server -> tool-limits -> secret-registry: 3 tầng.
    expect(s.has('lib/secret-registry.ts')).toBe(true);
  });

  it('đồ thị phải lớn hơn 5 file — quét hỏng sẽ báo "không thấy gì" và trả về rỗng', () => {
    expect(reachableFrom(['lib/agent-tools-server.ts']).size).toBeGreaterThan(5);
  });

  it('file treo lơ lửng không nằm trong đồ thị lõi', () => {
    expect(unreached(['lib/db.ts'], ['lib/agent-tools-server.ts'])).toContain('lib/db.ts');
  });

  /* Review C3 — review độc lập phát hiện đồ thị BỎ QUA import tương đối và
   * dynamic import. Hậu quả: `lib/zeromem/store.ts` bị gán XOA trong khi
   * `zeromem/tools.ts` (một CORE_ENTRY) import nó bằng `from './store'`.
   * Tức bảng dẫn dắt kế hoạch xoá code lõi đang chạy. */
  it('đi được qua import TƯƠNG ĐỐI', () => {
    const core = reachableFrom();
    expect(core.has('lib/zeromem/tools.ts')).toBe(true);
    expect(core.has('lib/zeromem/store.ts')).toBe(true);
  });

  /* Đo thật thì lõi hiện KHÔNG có dynamic import nội bộ nào: quét cả đồ thị chỉ ra
   * đúng một `import(...)` và nó trỏ tới `node:dns/promises` — gói ngoài. Test
   * "dynamic import" viết theo giả định sẽ là ví dụ thứ hai của loại test tự
   * chứng minh: nó so với điều tôi TƯỞNG chứ không so với điều repo CÓ.
   * Test dưới đây bảo vệ đúng lúc cần: thêm `await import('./x')` vào một file
   * lõi rồi quên mở rộng đồ thị — file đó sẽ rơi ra và bị gán XOA. */
  it('mọi dynamic import NỘI BỘ của file lõi đều phải nằm trong đồ thị', () => {
    const core = reachableFrom();
    const re = /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]/g;
    const missing: string[] = [];
    for (const f of core) {
      const src = readFileSync(f, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const s = m[1];
        const internal = s.startsWith('@/') || s.startsWith('./') || s.startsWith('../');
        if (!internal) continue;
        const resolved = resolveInternal(s, f);
        if (resolved && !core.has(resolved)) missing.push(`${f} -> ${s}`);
      }
    }
    expect(missing, `dynamic import nội bộ lọt khỏi đồ thị lõi: ${missing.join(', ')}`).toEqual([]);
  });

  it('mọi entry mặc định đều là file có thật — entry sai là kết luận sai', () => {
    for (const e of CORE_ENTRIES) {
      expect(existsSync(e), `CORE_ENTRIES chứa file không tồn tại: ${e}`).toBe(true);
    }
  });
});

/**
 * Task 3: bảng kiểm kê.
 *
 * Cả hai test dưới đây canh cách bảng **âm thầm** báo sai:
 *   - bỏ sót file mới trong `lib/` → bảng vẫn trông đầy đủ
 *   - nhãn rỗn hoặc sai → người đọc vẫn tưởng đã được phân loại
 */
/**
 * Cạnh RUNTIME — phụ thuộc thật, không phải phụ thuộc kiểu.
 *
 * Vì sao phải có: `importsOf` cũ khớp bằng regex nên coi `import type` là cạnh.
 * Nhưng `import type` bị compiler XOÁ lúc build — file dùng nó không hề nạp
 * module kia ở runtime. Đo bằng regex thì `lib/date-groups.ts`
 * (`import type { ChatSession } from '@/lib/db'`) bị tính là kéo Dexie vào,
 * tức bị gán nhãn sai. Đây là lỗi C1 lặp lại ở tầng khác: đồ thị đúng về
 * hình thức, sai về thực tế chạy.
 */
describe('cạnh runtime — import type không phải phụ thuộc thật', () => {
  it('`import type` không tạo cạnh runtime', () => {
    const src = "import type { ChatSession } from '@/lib/db';";
    expect(runtimeImportSpecs(src, 'lib/demo.ts')).toEqual([]);
  });

  it('import lẫn GIÁ TRỊ và type thì CÓ cạnh runtime', () => {
    // `db` là giá trị, `type StoredMessage` là kiểu — chỉ `db` mới tạo cạnh.
    const src = "import { db, type StoredMessage } from '@/lib/db';";
    expect(runtimeImportSpecs(src, 'lib/demo.ts')).toEqual(['@/lib/db']);
  });

  it('`import * as` và `import` side-effect đều là cạnh runtime', () => {
    expect(runtimeImportSpecs("import * as ipc from '@/lib/ipc.cjs';", 'lib/demo.ts')).toEqual([
      '@/lib/ipc.cjs',
    ]);
    expect(runtimeImportSpecs("import '@/lib/db';", 'lib/demo.ts')).toEqual(['@/lib/db']);
  });

  it('gói NGOÀI cũng được liệt kê (bộ lọc gói ngoài nằm ở resolveInternal)', () => {
    const src = "import ts from 'typescript';\nimport type { Foo } from 'zod';";
    expect(runtimeImportSpecs(src, 'lib/demo.ts')).toEqual(['typescript']);
  });
});

/**
 * File nào kéo được module chạm API trình duyệt mà KHÔNG tự chạm trực tiếp.
 *
 * Bảng kiểm kê chỉ liệt kê file chạm trực tiếp, và nói rằng phần còn lại "dùng
 * được nguyên vẹn cho lõi Node". Lời đó SAI: `lib/tool-permissions.ts` không hề
 * viết chữ `Dexie`, nhưng nó gọi `db.toolPermissions.put` — `db` mới là Dexie.
 * Đó đúng là nợ chưa trả trong ledger: quét thấy phụ thuộc trực tiếp, không thấy
 * phụ thuộc xuyên.
 *
 * Ba test dưới đây dùng file CÓ THẬT, không dùng fixture tự viết — nên bắt được
 * cả khi triển khai sai, đúng như "lib/db.ts chắc chắn có Dexie" ở Task 1.
 */
describe('browserBound — file kéo trình duyệt vào qua cạnh runtime', () => {
  const allLibFiles = () => {
    const touchers = new Set(scanBrowserApis('lib').map((h) => h.file));
    return browserBoundIn(listTsFiles('lib'), touchers);
  };

  it('`tool-permissions.ts` — import GIÁ TRỊ `db` → bị coi là kéo trình duyệt', () => {
    // Nợ của ledger: file này không có mặt trong bảng kiểm kê dù spec §7 coi nó
    // là thứ người dùng tin CLI nhất. Chỉ `db.toolPermissions.put` chứng minh điều đó.
    expect(allLibFiles().has('lib/tool-permissions.ts')).toBe(true);
  });

  it('`tree-validation.ts` — import GIÁ TRỊ `ROOT_KEY` → bị coi là kéo trình duyệt', () => {
    expect(allLibFiles().has('lib/tree-validation.ts')).toBe(true);
  });

  it('`date-groups.ts` — CHỈ `import type` → KHÔNG bị tính là kéo trình duyệt', () => {
    // Chống đếm thừa. File này chỉ dùng kiểu, compiler xoá hẳn, nên nó chạy
    // được trên Node. Đếm thừa thì bảng gán nhãn sai file sạch.
    expect(allLibFiles().has('lib/date-groups.ts')).toBe(false);
  });
});

/**
 * GUỐ CHẶN HỒI QUY — canh thứ KHÔNG ĐƯỢC phá mà không thấy đỏ.
 *
 * Lõi CLI chạy trên Node, mà Dexie/IndexedDB chỉ có ở trình duyệt. Nếu một
 * CORE_ENTRY mới (hay một import trong file lõi) kéo theo module chạm API trình
 * duyệt, lõi sẽ không chạy được trên Node — và KHÔNG có gì báo: `tsc` xanh,
 * `lint` xanh, `npm run build` xanh, test xanh. Đúng như spill đã chết âm thầm.
 *
 * Test này xanh ngay vì lõi hiện sạch — nên nó BẮT BUỘC phải qua mutation mới
 * chứng minh được là không rỗng.
 */
describe('GUỐ — lõi CLI không được kéo trình duyệt vào', () => {
  it('không file lõi nào kéo được module chạm API trình duyệt', () => {
    const touchers = new Set(scanBrowserApis('lib').map((h) => h.file));
    const bound = browserBoundIn(listTsFiles('lib'), touchers);
    const core = reachableFrom();
    const polluted = [...core].filter((f) => bound.has(f)).sort();
    expect(
      polluted,
      `file lõi kéo trình duyệt vào — lõi sẽ không chạy được trên Node: ${polluted.join(', ')}`,
    ).toEqual([]);
  });
});

describe('bảng kiểm kê', () => {
  const MD = 'docs/cli-migration-inventory.md';

  it('bảng phải phủ hết file chạm API trình duyệt — không file nào vô hình', () => {
    const md = readFileSync(MD, 'utf8');
    const rows = md.split('\n').filter((l) => l.startsWith('| `lib/'));
    // So với QUẾT SỐNG, không so với bảng: bảng là file trên đĩa, còn đây là
    // script chạy lúc test. Thêm file mới dùng localStorage mà quên chạy lại
    // build-inventory.ts thì hai bên lệch nhau và test đỏ — đúng thứ cần chặn.
    const live = new Set(scanBrowserApis('lib').map((h) => h.file));
    expect(rows.length, 'bảng cũ hơn quét sống — chạy lại node scripts/cli-migration/build-inventory.ts').toBe(
      live.size,
    );
  });

  /* Nợ còn treu sau Giai đoạn 0: test cũ chỉ so SỐ ĐẾM. Xoá một file dính API
   * rồi thêm file mới dính API mà không chạy lại generator thì số đếm vẫn khớp,
   * bảng vẫn xanh — nhưng bảng liệt kê file không tồn tại và bỏ sót file mới.
   * So TẬP thì bắt được: tên file phải khớp từng cái. */
  it('bảng liệt kê ĐÚNG tập file quét sống tìm thấy', () => {
    const md = readFileSync(MD, 'utf8');
    const rows = md.split('\n').filter((l) => l.startsWith('| `lib/'));
    // `filter(Boolean)` KHÔNG narrowing kiểu trong TS — phải dùng type guard,
// nếu không `stale` thành Set<string | undefined> và `live.has(f)` lỗi type.
const listed = new Set(
      rows.map((r) => r.match(/`([^`]+)`/)?.[1]).filter((f): f is string => typeof f === 'string'),
    );
    const live = new Set(scanBrowserApis('lib').map((h) => h.file));
    const stale = [...listed].filter((f) => !live.has(f));
    const missing = [...live].filter((f) => !listed.has(f));
    expect({ stale, missing }, 'bảng lệch với quét sống — chạy lại generator').toEqual({
      stale: [],
      missing: [],
    });
  });

  /* Nợ: 7/10 tên trong BROWSER_APIS không khớp gì ở lib/, nên gõ sai một tên
   * thì bảng vẫn ra đúng số dòng và test vẫn xanh — sai im lặng. Test này bắt
   * đúng việc đó: MỌI tên khai trong danh sách phải khớp được bằng chính bộ
   * dò hiện tại. Đổi một tên thành sai chính tả thì test đỏ. */
  it('MỌI tên trong BROWSER_APIS đều khớp được bằng bộ dò hiện tại', () => {
    for (const name of BROWSER_APIS) {
      const src = name.includes('.')
        ? `const v = ${name};`
        : `import ${name} from 'x';\nconst v = new ${name}();`;
      expect(
        scanFile(src, 'lib/probe.ts').map((h) => h.api),
        `tên "${name}" không khớp được — nhiều khả năng gõ sai`,
      ).toContain(name);
    }
  });

  it('bảng không được vượt quá số file .ts thật trong lib', () => {
    const md = readFileSync(MD, 'utf8');
    const rows = md.split('\n').filter((l) => l.startsWith('| `lib/'));
    expect(rows.length).toBeLessThanOrEqual(countTsFiles('lib'));
  });

  it('mọi dòng đều có nhãn hợp lệ', () => {
    const md = readFileSync(MD, 'utf8');
    const rows = md.split('\n').filter((l) => l.startsWith('| `lib/'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, `nhãn phải là GHIU | VIET-LAI | XOA | THAY-THE: ${row}`).toMatch(
        /\| (GHIU|VIET-LAI|XOA|THAY-THE) \|/,
      );
    }
  });

  /* Nợ NGUY HIỂM NHẤT còn lại. `FORCE_LABEL` trong ly-do.ts cho phép người đè nhãn
   * của máy — đó là cửa thoát cần thiết khi máy không đủ thông tin. Nhưng nếu một
   * file bị đè nhãn lại ĐANG nằm trong đồ thị lõi, thì nhãn đó sai theo định
   * nghĩa: lõi đã dùng nó, không phải "thuộc web, bỏ được".
   *
   * Test này bắt đúng chỗ đó. Hiện chưa file nào xung đột, nên test xanh ngay —
   * đó là lý do cần mutation để chứng minh nó không rỗng. */
  it('KHÔNG file nào bị FORCE_LABEL mà lại nằm trong đồ thị lõi', () => {
    const core = reachableFrom();
    const conflict = Object.keys(FORCE_LABEL).filter((f) => core.has(f));
    expect(
      conflict,
      `file bị đè nhãn nhưng lõi thật sự dùng — nhãn đó sai, phải rà lại: ${conflict.join(', ')}`,
    ).toEqual([]);
  });
});