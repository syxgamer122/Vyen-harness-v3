#!/usr/bin/env node
/**
 * Cổng kiểm tra TÀI LIỆU ↔ CODEBASE (`npm run docs:check`).
 *
 * Vì sao cần: docs Vyen từng trôi khỏi code — lệnh `npm run app:fast` được doc
 * nhắc trong khi `package.json` chỉ có `app` (đã gộp còn một, 2026-10-17);
 * `/api/diag`, `/api/orchestrate` và
 * `components/orchestrator/` đã gỡ nhưng README vẫn quảng cáo.
 *
 * Hai lớp tài liệu:
 *  - CONTRACT_DOCS (hiện trạng): mọi đường dẫn file và biến môi trường nêu ra
 *    phải tồn tại / phải được code đọc, mọi `npm run <x>` phải có thật.
 *  - RECORD_DOCS (bản ghi lịch sử, kế hoạch, báo cáo thi công): được phép nhắc
 *    file đã bị gỡ, nhưng KHÔNG được nhắc lệnh `npm run` không tồn tại.
 *
 * Thoát mã 1 khi có vi phạm ⇒ dùng được trong CI.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

const CONTRACT_DOCS = [
  'README.md',
  'DESIGN.md',
  'TEST_INFRA.md',
  'docs/DESKTOP_ARCHITECTURE.md',
  'docs/DESKTOP-CHOICE.md',
  'docs/harness-port-handoff.md',
  'AGENTS.md',
  'PROJECT.md',
];

/* Nhật ký/báo cáo đã gỡ 2026-10-04: CRITIQUE_RECONCILIATION.md,
   ORIGINAL_REQUEST.md, TEST_READY.md, docs/UI_REDESIGN_PLAN_V2.md,
   docs/UI_REDESIGN_REPORT.md, docs/UI_SETTINGS_REFACTOR_PLAN.md,
   docs/agent-memory-port-report.md — lịch sử nằm trong git, không mô tả
   code đang chạy nên gỡ khỏi cả danh sách lẫn repo (checker báo "doc không
   tồn tại" nếu còn tên mà file đã mất). */
const RECORD_DOCS = [
  'docs/MCP_INTEGRATION_DESIGN.md',
  /* Bản `DESIGN.md` 1410 dòng đã XOÁ 2026-10-20 — lịch sử nằm trong git
   * (`git log --diff-filter=D --name-only`). Không đăng ký ở đây: còn tên mà
   * file đã mất thì checker báo "doc không tồn tại". */
];

const DOCS = [...CONTRACT_DOCS, ...RECORD_DOCS];
const CODE_EXT = /\.(ts|tsx|cjs|mjs|js|json)$/;

const ENV_READ_RE = /[a-zA-Z]+\s*\.\s*env\s*(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g;

/*
 * Đường dẫn trong backtick.
 *
 * Lớp ký tự đầu PHẢI có `.`, không chỉ `[A-Za-z0-9_]`: trước đây nó bắt đầu bằng
 * `[A-Za-z0-9_]` nên mọi đường dẫn bắt đầu bằng dấu chấm — `.vyen/…`,
 * `.github/…`, `.env.example` — rơi khỏi regex và **không bao giờ được kiểm**.
 * Đó là lý do `README.md` khẳng định `.vyen/schedules.json` trong khi file đó
 * không tồn tại mà `docs:check` vẫn báo 0 lệch.
 */
const PATH_RE = /`([.A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:ts|tsx|cjs|mjs|js|json|md|ya?ml))`/g;
/** Route API được nhắc trong docs phải có `app/api/<đoạn>/route.ts` thật. */
const ROUTE_RE = /`?\/api\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)`?/g;
const CMD_RE = /npm run ([A-Za-z0-9:_-]+)/g;
const ENV_RE = /`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g;

let tracked;
try {
  tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).filter(Boolean);
} catch {
  function walkFiles(dir) {
    let res = [];
    for (const f of fs.readdirSync(dir)) {
      if (f === 'node_modules' || f === '.git' || f === '.next') continue;
      // Dự án không phải git repo nên `git ls-files` không chạy, và phải quét
      // cây thư mục. `.audit-backup-*` là nơi backup file trước khi sửa/xoá —
      // nó chứa bản sao cũ đã lỗi thời, soi vào đó chỉ ra lệch giả.
      if (f.startsWith('.audit-backup-')) continue;
      const fp = path.join(dir, f);
      const st = fs.statSync(fp);
      if (st.isDirectory()) res = res.concat(walkFiles(fp));
      else res.push(path.relative(ROOT, fp).replace(/\\/g, '/'));
    }
    return res;
  }
  tracked = walkFiles(ROOT);
}
const trackedSet = new Set(tracked);
const scripts = Object.keys(require(path.join(ROOT, 'package.json')).scripts);
/*
 * Chỉ đọc những file CÒN trên đĩa.
 *
 * `tracked` lấy từ `git ls-files`, tức **index** — còn index có thể vẫn giữ một
 * file đã bị xoá trên đĩa (khi ai đó `git restore --staged` một lần xoá, hoặc xoá
 * xong chưa kịp `git add`). Trước đây dòng này `readFileSync` thẳng mọi file
 * trong index nên ném ENOENT và **làm hỏng cả `npm run docs:check`** thay vì báo
 * lệch. Lệnh này vốn để kiểm tra doc, không phải để phát hiện việc dở dang.
 */
const codeText = tracked
  .filter((p) => CODE_EXT.test(p) && !p.startsWith('package-lock'))
  .filter((p) => fs.existsSync(path.join(ROOT, p)))
  .map((p) => fs.readFileSync(path.join(ROOT, p), 'utf8'))
  .join('\n');

/** `foo/bar.ts` khớp khi tồn tại đúng đường dẫn, hoặc khớp hậu tố đường dẫn. */
function pathExists(token) {
  if (trackedSet.has(token)) return true;
  const suffix = '/' + token;
  return tracked.some((p) => p.endsWith(suffix));
}

/** Biến môi trường mà code thật sự đọc — nguồn để đối chiếu bảng env trong docs. */
function envNamesRead() {
  const names = new Set();
  for (const m of codeText.matchAll(ENV_READ_RE)) names.add(m[1] || m[2]);
  return [...names].sort();
}

if (process.argv.includes('--list-env')) {
  console.log(envNamesRead().join('\n'));
  process.exit(0);
}

const problems = [];
const skipPath = (t) => t.startsWith('node_modules/') || t.includes('*') || t.startsWith('/');

for (const doc of DOCS) {
  if (!fs.existsSync(path.join(ROOT, doc))) {
    problems.push([doc, 0, 'doc', 'file tài liệu không tồn tại']);
    continue;
  }
  const contract = CONTRACT_DOCS.includes(doc);
  fs.readFileSync(path.join(ROOT, doc), 'utf8').split('\n').forEach((line, i) => {
    const at = i + 1;
    /* Dòng có `docs-check:ignore` được miễn kiểm tra đường dẫn/env — dùng cho câu khẳng định
       phủ định kiểu "không có `tauri.conf.json`" trong doc hiện trạng. */
    if (line.includes('docs-check:ignore')) return;
    for (const m of line.matchAll(CMD_RE)) {
      if (!scripts.includes(m[1])) problems.push([doc, at, 'lệnh', `npm run ${m[1]}`]);
    }
    if (contract) {
      for (const m of line.matchAll(PATH_RE)) {
        if (skipPath(m[1])) continue;
        if (!pathExists(m[1])) problems.push([doc, at, 'đường dẫn', m[1]]);
      }
      for (const m of line.matchAll(ROUTE_RE)) {
        /* Bỏ qua khi `/api/...` là phần đuôi của URL ngoài (`https://host/api/v1`)
           hay của đường dẫn file (`app/api/bridge/route.ts`). */
        if (/[A-Za-z0-9_.\/-]$/.test(line.slice(0, m.index))) continue;
        const route = `app/api/${m[1]}/route.ts`;
        if (!trackedSet.has(route)) problems.push([doc, at, 'route API', `/api/${m[1]}`]);
      }
      for (const m of line.matchAll(ENV_RE)) {
        if (!codeText.includes(m[1])) problems.push([doc, at, 'biến môi trường', m[1]]);
      }
    }
  });
}

// Số file test mà doc ghi phải khớp `tests/*.test.ts` thật.
const testsActual = tracked.filter((p) => p.startsWith('tests/') && p.endsWith('.test.ts'));
const testCountRegex = /([0-9]+)\s*file\s*`tests\/\*\.test\.ts`/g;
for (const doc of ['PROJECT.md', 'TEST_INFRA.md']) {
  const docPathFull = path.join(ROOT, doc);
  if (fs.existsSync(docPathFull)) {
    const content = fs.readFileSync(docPathFull, 'utf8');
    let tm;
    while ((tm = testCountRegex.exec(content)) !== null) {
      const statedCount = parseInt(tm[1], 10);
      if (statedCount !== testsActual.length) {
        problems.push([doc, 0, 'số file test', `doc ghi ${statedCount}, thực tế ${testsActual.length}`]);
      }
    }
  }
}

if (problems.length === 0) {
  console.log(`docs:check OK — ${DOCS.length} tài liệu, 0 lệch (${tracked.length} file theo dõi).`);
  process.exit(0);
}

console.error(`docs:check FAIL — ${problems.length} điểm lệch:\n`);
for (const [doc, line, kind, token] of problems) {
  console.error(`  ${doc}:${line}  [${kind}]  ${token}`);
}
console.error('\nSửa code cho khớp docs, hoặc sửa docs cho khớp code — đừng bỏ qua.');
process.exit(1);
