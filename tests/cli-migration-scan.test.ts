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
import { existsSync } from 'node:fs';
import { scanBrowserApis, scanFile } from '@/scripts/cli-migration/scan-browser-apis';
import { CORE_ENTRIES, reachableFrom, unreached } from '@/scripts/cli-migration/import-graph';

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

  it('mọi entry mặc định đều là file có thật — entry sai là kết luận sai', () => {
    for (const e of CORE_ENTRIES) {
      expect(existsSync(e), `CORE_ENTRIES chứa file không tồn tại: ${e}`).toBe(true);
    }
  });
});