/**
 * Vẽ đồ thị import của `lib/` để biết file nào **còn dùng bởi lõi** — cột
 * "còn dùng bởi lõi?" trong bảng kiểm kê (spec `2026-10-18-cli-core-design.md` §4).
 *
 * Câu hỏi mà bảng này phải trả lời đúng: file nào không nằm trong đồ thị lõi
 * thì thuộc tính năng web, và sẽ bị xoá khi chuyển CLI. Trả lời sai ở đây
 * nghĩa là **xoá nhầm code đang chạy** — nên mọi im lặng ở đây đều là sai.
 *
 * Vì vậy: file không tồn tại thì **ném**, không bỏ qua. Tìm-hụt dễ dẫn tới kết
 * luận sai; `AGENTS.md` §6 ghi rõ đúng cái bẫy này.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const BOILERPLATE_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);

/**
 * Liệt kê mọi file `.ts` dưới `root`, quy về đường dẫn repo dùng `/`.
 *
 * Một chỗ duyệt FS duy nhất cho cả máy đo: `countTsFiles` của build-inventory
 * đếm bằng chính hàm này. Hai vòng duyệt riêng là hai nơi lệch nhau âm thầm —
 * số đếm một bên, danh sách một bên, rồi bảng "không lệch" trong khi thực ra lệch.
 */
export function listTsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (BOILERPLATE_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.ts')) out.push(abs.split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Điểm vào của lõi — khai MỘT chỗ duy nhất, nơi khác import từ đây.
 * Thêm bớt ở đây là điều kiện để bảng kiểm kê có ý nghĩa: entry thiếu thì
 * đồ thị thu hẹp, file bị gán nhầm `XOA`.
 */
export const CORE_ENTRIES = [
  'lib/agent-tools-server.ts',
  'lib/tool-result-server.ts',
  'lib/emulated-agent.ts',
  'lib/tool-limits.ts',
  'lib/context-budget.ts',
  'lib/secret-registry.ts',
  'lib/mcp/tool-mapper.ts',
  // Lớp provider (plan 2026-10-18-provider-layer). KHÔNG chạm API trình duyệt —
  // đây là tầng gọi model, chạy được trên Node.
  'lib/provider/adapter.ts',
  'lib/provider/openai-adapter.ts',
  'lib/provider/anthropic-adapter.ts',
  // Task 4 tạo thêm file thứ tư trong `lib/provider/` — plan viết trước nên
  // Global Constraint của plan yêu cầu mọi plan lõi khai entry mới ở đây.
  'lib/provider/upstream-diagnosis.ts',
  // Lớp cầu nối ipc.cjs ra khỏi Electron. Thay cho `lib/tools/fs-node.ts` mà
  // spec §5 dự kiến — đo cho thấy ipc.cjs đã có đủ backend và máy an toàn.
  'lib/tools/ipc-node.ts',
  // Tầng CLI. Không file nào import API trình duyệt, nhưng phải khai ở đây vì
  // lý do đúng như Global Constraint: entry thiếu thì đồ thị thu hẹp và file bị
  // gán nhầm `XOA`.
  //
  // ============ VỀ `cli/index.ts` ============
  //
  // Bản đầu **cố ý không khai** nó, với lý do "nó đọc `process.env` và
  // `process.exit`, tức không thuần". Lý do đó **sai**: `process.env` và
  // `process.exit` là API **Node**, không phải trình duyệt — file đó chạy trên
  // Node hoàn toàn bình thường.
  //
  // Hậu quả của việc bỏ nó: đây là file có bề mặt import rộng nhất của cả CLI
  // (`@/lib/api-keys`, `@/lib/provider/upstream-diagnosis`, `@/lib/tools/ipc-node`)
  // mà **không** nằm trong bất kỳ guard nào. Đo 2026-10-19: thêm
  // `import { db } from '@/lib/db'` vào nó thì mọi test vẫn xanh.
  //
  // Nên nay khai, và `tests/repo-hygiene.test.ts` bắt buộc **mọi** file trong
  // `cli/` phải ở đây — không còn lối để lọt mà không ai thấy.
  'cli/index.ts',
  'cli/agent-turn.ts',
  'cli/approve.ts',
  'cli/repl.ts',
  'cli/session.ts',
  'cli/instructions.ts',
  'cli/history.ts',
  'cli/terminal.ts',
];



/**
 * Một spec import, quy về đường dẫn repo tương ứng với file `fromFile`.
 *
 * Phải xử lý BA dạng: `@/x` (alias), `./x` và `../x` (tương đối); dạng khác là
 * gói ngoài. Bỏ sót dạng tương đối là lỗi nghiêm trọng: review độc lập (2026-10-18)
 * phát hiện `zeromem/tools.ts` import `./store` bị bỏ qua, khiến
 * `zeromem/store.ts` — thật ra lõi dùng — bị gán `XOA`, tức bảng dẫn dắt kế
 * hoạch xoá code đang chạy.
 */
export function resolveInternal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) {
    base = spec.slice(2);
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    base = path.posix.join(path.posix.dirname(fromFile), spec);
  } else {
    return null;
  }
  // `@/` tro toi GOC REPO, khong phai `lib/` — nen spec da co `lib/` san.
  // Spec co the da co duoi san (`@/lib/ipc.cjs`) — kiem tra chinh no truoc,
// neu khong moi noi them.
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.cjs`,
    `${base}.tsx`,
    `${base}/index.ts`,
  ]) {
    if (existsSync(candidate)) return candidate.split(path.sep).join('/');
  }
  return null;
}

/**
 * Spec import nào tạo cạnh **runtime** — tức module thật sự được nạp lúc chạy.
 *
 * Đọc bằng AST, KHÔNG bằng regex, vì `import type` bị compiler xoá: nó khai báo
 * kiểu chứ không nạp module. Đếm nó như phụ thuộc thật thì
 * `lib/date-groups.ts` (`import type { ChatSession } from '@/lib/db'`) bị quy
 * kết là kéo Dexie vào — sai, và sai theo hướng làm bảng phân loại nhầm file
 * vốn sạch. Cùng dạng với lỗi C1 mà review độc lập bắt ở tầng quét API.
 *
 * `import('x')` động CŨNG không tạo cạnh ở đây, khớp với hành vi cũ; test
 * "mọi dynamic import nội bộ của file lõi đều phải nằm trong đồ thị" canh chỗ
 * đó. Gặp trường hợp thật thì thêm vào đây, đừng thêm cơ chế thứ hai.
 */
export function runtimeImportSpecs(src: string, file: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const clause = st.importClause;
    if (!clause) {
      out.push(spec); // side-effect import — luôn nạp
      continue;
    }
    if (clause.isTypeOnly) continue; // `import type ... from` — bị xoá
    if (clause.name) {
      out.push(spec); // default import
      continue;
    }
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      out.push(spec); // `import * as`
      continue;
    }
    // `import { a, type B }` — chỉ `a` mới nạp module.
    if (bindings.elements.some((e) => !e.isTypeOnly)) out.push(spec);
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const spec of runtimeImportSpecs(src, file)) {
    const resolved = resolveInternal(spec, file);
    // Spec sai dẫn đường là lỗi dữ liệu, im lặng bỏ qua là báo cáo sai.
    if (resolved === null && spec.startsWith('@/')) {
      throw new Error(`${file}: import không giải được tới file thật: '${spec}'`);
    }
    if (resolved) out.push(resolved);
  }
  return out;
}

/**
 * File nào kéo được một file trong `touchers` (file chạm API trình duyệt) qua
 * cạnh runtime — dù nó không tự chạm API nào.
 *
 * Bảng kiểm kê chỉ liệt kê file chạm TRỰC TIẾP và khẳng định phần còn lại "dùng
 * được nguyên vẹn cho lõi Node". Lời đó sai với những file như
 * `lib/tool-permissions.ts`: không viết chữ `Dexie`, nhưng gọi `db.…` mà `db`
 * mới là Dexie.
 *
 * Duyệt ngược từ `touchers`: file nào import (trực tiếp hay gián tiếp) một file
 * đã biết là bị coi là kéo trình duyệt vào. Chính `touchers` không nằm trong kết
 * quả — bảng kiểm kê đã liệt kê chúng riêng.
 */
export function browserBoundIn(files: string[], touchers: Iterable<string>): Set<string> {
  const parents = new Map<string, string[]>();
  for (const f of files) {
    for (const dep of importsOf(f)) {
      const arr = parents.get(dep);
      if (arr) arr.push(f);
      else parents.set(dep, [f]);
    }
  }
  const seen = new Set<string>(touchers);
  const bound = new Set<string>();
  const queue = [...seen];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const parent of parents.get(cur) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      bound.add(parent);
      queue.push(parent);
    }
  }
  return bound;
}

/** Tập file trong đồ thị import bắt đầu từ `entries`, quy về đường dẫn repo dùng `/`. */
export function reachableFrom(entries: string[] = CORE_ENTRIES): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    if (!existsSync(file)) throw new Error(`Điểm vào của lõi không tồn tại: ${file}`);
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return seen;
}

/** File nào trong `files` KHÔNG nằm trong đồ thị lõi. */
export function unreached(files: string[], entries: string[] = CORE_ENTRIES): string[] {
  const core = reachableFrom(entries);
  return files.filter((f) => !core.has(f));
}