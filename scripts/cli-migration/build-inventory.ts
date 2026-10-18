/**
 * Task 3 — sinh bảng kiểm kê: file nào trong `lib/` còn dùng bởi lõi, và file
 * nào chạm API trình duyệt.
 *
 * Script này **không quyết định** giữ hay xoá. Nó gán nhãn theo tiêu chí máy kiểm
 * được, nhưng để trống cột `LÝ DO` — đó là chỗ phán đoán của người. Máy đoán thì
 * bảng sai một cách rất khó nhận ra, và bảng sai ở đây nghĩa là xoá nhầm code
 * đang chạy.
 *
 * Tiêu chí gán nhãn (định nghĩa ở đây để người đọc file sinh ra không phải đoán):
 *   GHIU     — không chạm API trình duyệt
 *   VIET-LAI — chạm API trình duyệt VÀ nằm trong đồ thị lõi → lõi cần, phải có bản Node
 *   XOA      — chạm API trình duyệt và KHÔNG nằm trong đồ thị lõi → thuộc web
 *
 * Chạy: `node scripts/cli-migration/build-inventory.ts`
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { scanBrowserApis, type ScanHit } from './scan-browser-apis.ts';
import { CORE_ENTRIES, reachableFrom, browserBoundIn, listTsFiles } from './import-graph.ts';
import { FORCE_LABEL, LY_DO } from './ly-do.ts';

/** Đếm file `.ts` đệ quy — test dùng để canh bảng phủ hết file, không bỏ sót. */
export function countTsFiles(root: string): number {
  return listTsFiles(root).length;
}

/** Rút gọn danh sách dòng thành `12, 40, 88` để cột không dài lê thê. */
function compactLines(hits: ScanHit[]): string {
  const byFile = new Map<string, number[]>();
  for (const h of hits) {
    const arr = byFile.get(h.file) ?? [];
    arr.push(h.line);
    byFile.set(h.file, arr);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, lines]) => `\`${f}\`:${lines.join(',')}`)
    .join('<br>');
}

/** Dựng nội dung markdown của bảng kiểm kê. */
export function renderInventory(scan: ScanHit[], core: Set<string>, bound: Set<string>): string {
  const byFile = new Map<string, string[]>();
  for (const h of scan) {
    const arr = byFile.get(h.file) ?? [];
    if (!arr.includes(h.api)) arr.push(h.api);
    byFile.set(h.file, arr);
  }

  const header =
    '| file | API trình duyệt | nằm trong đồ thị lõi | nhãn | lý do |\n' +
    '|---|---|---|---|---|\n';

  const rows = [...byFile.keys()]
    .sort()
    .map((file) => {
      const apis = byFile.get(file)!.join(', ');
      const inCore = core.has(file);
      const label = FORCE_LABEL[file] ?? (inCore ? 'VIET-LAI' : 'XOA');
      // Lý do lấy từ ly-do.ts — nơi phán đoán của người sống, tách khỏi script
      // để chạy lại generator không xoá mất. Chưa có thì in `—`, không bịa.
      const why = LY_DO[file] ?? '—';
      return `| \`${file}\` | ${apis} | ${inCore ? 'có' : 'không'} | ${label} | ${why} |`;
    })
    .join('\n');

  const boundRows = [...bound].sort();

  return (
    '# Bảng kiểm kê di cư sang CLI\n\n' +
    'Sinh bằng `node scripts/cli-migration/build-inventory.ts`. Cột **LÝ DO** lấy từ\n' +
    '`scripts/cli-migration/ly-do.ts` — sửa ở đó, chạy lại script sẽ không mất.\n\n' +
    '## Tiêu chí\n\n' +
    '| nhãn | điều kiện |\n|---|---|\n' +
    '| `GHIU` | không chạm API trình duyệt |\n' +
    '| `VIET-LAI` | chạm API trình duyệt **và** nằm trong đồ thị lõi → lõi cần, phải có bản Node |\n' +
    '| `XOA` | chạm API trình duyệt và **không** nằm trong đồ thị lõi → thuộc tính năng web |\n' +
    '| `THAY-THE` | máy gán sai — lõi vẫn cần chức năng này qua đường khác. Nhãn do người đặt trong `ly-do.ts`, **đọc trước khi lên kế hoạch** |\n\n' +
    '> Bảng dưới chỉ liệt kê file chạm API trình duyệt **trực tiếp**.\n' +
    '>\n' +
    '> **Đừng suy ra phần còn lại chạy được trên Node.** Một file không viết chữ\n' +
    '> `Dexie` vẫn có thể gọi `db.…` mà `db` mới là Dexie — xem mục kế bên.\n\n' +
    '## Điểm vào của lõi\n\n' +
    CORE_ENTRIES.map((e) => `- \`${e}\``).join('\n') +
    '\n\n## Bằng chứng dòng\n\n' +
    header +
    rows +
    '\n\n## Kéo trình duyệt vào qua phụ thuộc xuyên\n\n' +
    (boundRows.length
      ? boundRows.map((f) => `- \`${f}\``).join('\n') +
        `\n\n${boundRows.length} file **không tự chạm** API trình duyệt nào, nhưng kéo được\n` +
        'một module chạm, nên cũng không chạy được trên Node. Chúng không có mặt ở bảng\n' +
        'trên vì quét chỉ thấy phụ thuộc TRỰC TIẾP — `lib/tool-permissions.ts` là ví dụ:\n' +
        'không viết chữ `Dexie`, chỉ gọi `db.toolPermissions.put`.\n\n' +
        'Test `GUỐ — lõi CLI không được kéo trình duyệt vào` trong\n' +
        '`tests/cli-migration-scan.test.ts` canh rằng **không file nào trong đồ thị lõi**\n' +
        'rơi vào danh sách này. Thêm `CORE_ENTRIES` mà kéo theo Dexie thì test đỏ.\n'
      : '(không file nào)') +
    '\n\n## File chạm API trình duyệt\n\n' +
    compactLines(scan) +
    '\n'
  );
}

// Chạy trực tiếp khi được gọi như script, không chạy khi được import.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const scan = scanBrowserApis('lib');
  const core = reachableFrom();
  const allFiles = listTsFiles('lib');
  const bound = browserBoundIn(allFiles, new Set(scan.map((h) => h.file)));
  const out = 'docs/cli-migration-inventory.md';
  writeFileSync(out, renderInventory(scan, core, bound), 'utf8');
  console.log(
    `da viet ${out}: ${allFiles.length} file .ts trong lib, ` +
      `${new Set(scan.map((h) => h.file)).size} file cham API trinh duyet, ` +
      `${bound.size} file keo trinh duyet vao qua phu thuoc xuyen, ` +
      `${core.size} file nam trong do thi loi`,
  );
}