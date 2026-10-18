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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
];

/** Import không nội bộ — không có file tương ứng trong repo nên bỏ qua. */
const EXTERNAL = /^(ai|zod|next|react|react-dom|node:[a-z/]+|[a-z@][^/']*)$/;

/** `from '@/lib/x'` hoặc `from '@/x'` → đường dẫn repo tương ứng. */
export function resolveInternal(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  // `@/` tro toi GOC REPO, khong phai `lib/` — nen spec da co `lib/` san.
  const base = spec.slice(2);
  if (EXTERNAL.test(base)) return null;
  // Spec co the da co duoi san (`@/lib/ipc.cjs`) — kiem tra chinh no truoc,
// neu khong moi noi them.
  for (const candidate of [base, `${base}.ts`, `${base}.cjs`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate.split(path.sep).join('/');
  }
  return null;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const resolved = resolveInternal(m[1]);
    // Spec sai dẫn đường là lỗi dữ liệu, im lặng bỏ qua là báo cáo sai.
    if (m[1].startsWith('@/') && resolved === null) {
      throw new Error(`${file}: import không giải được tới file thật: '${m[1]}'`);
    }
    if (resolved) out.push(resolved);
  }
  return out;
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