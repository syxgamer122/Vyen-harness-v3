/**
 * Spill — CHỐT CHẶN TRÊN ARTIFACT ĐÃ BUILD.
 *
 * Vì sao file này tồn tại: bản 1 của spill đi qua `tsc`, `lint`, `npm run
 * build`, 143 test và full suite 3.346 test — và tính năng KHÔNG chạy. Nguyên
 * nhân: `lib/tool-limits.ts` gọi `eval('require')('./ipc.cjs')`, mà trong bản
 * build đoạn đó nằm ở `.next/server/chunks/`, nơi **không có** `ipc.cjs`.
 * `try/catch` biến `MODULE_NOT_FOUND` thành hành vi im lặng.
 *
 * Test ở đây chạy trên SẢN PHẨM, không chạy trên đồ thị module của vitest —
 * đó mới là chỗ bản 1 hỏng mà không ai thấy.
 *
 * `npm run build` exit 0 KHÔNG chứng minh tính năng chạy.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();
const SERVER_DIR = path.join(REPO, '.next', 'server');

function jsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) jsFiles(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

function serverBundle(): string {
  return jsFiles(SERVER_DIR).map((f) => readFileSync(f, 'utf8')).join('\n');
}

describe.skipIf(!existsSync(SERVER_DIR))('spill — artifact đã build', () => {
  it('bản build có mang saveSpillText, không chỉ mang lời gọi', () => {
    const files = jsFiles(SERVER_DIR);
    expect(files.length).toBeGreaterThan(0);
    /* Marker phải là CHÍNH XÁC chuỗi nằm trong lib/ipc.cjs:95 —
     * `SPILL_FILE_PREFIX: 'vyen-spill'`, KHÔNG có dấu gạch nối. Dấu `-` được
     * template thêm lúc ghép tên file nên không tồn tại liền ký tự trong bất kỳ
     * bản build nào, kể cả bản đúng.
     *
     * Bản đầu của test này dùng 'vyen-spill-' → không bao giờ có thể xanh, tức
     * ĐỎ vì lý do sai: nó đỏ cả khi build hoàn hảo. Test không bao giờ xanh thì
     * không chứng minh gì — đó là gương của test không bao giờ đỏ.
     *
     * `vyen-spill` chỉ xuất hiện trong lib/ipc.cjs (grep toàn repo), nên có mặt
     * trong .next/server <=> ipc.cjs đã được Turbopack đóng gói. */
    expect(serverBundle()).toContain('vyen-spill');
  });

  it('không còn require theo đường dẫn tới ipc.cjs', () => {
    // Đường dẫn này không tồn tại sau khi bundle; require theo nó luôn ném,
    // rồi bị try/catch nuốt. Sự xuất hiện của nó = C1 còn sống.
    // Test này KHÔNG trùng lặp với test trên: nó là phép so sánh tuyệt đối, và
    // đã chứng minh đỏ có thật ở bản build trước khi sửa.
    expect(serverBundle()).not.toContain('./ipc.cjs');
  });

  it('không còn eval require trong sản phẩm server', () => {
    /* eval('require') là cách lách bundler của bản 1. Nó không chỉ là mùi
     * code — nó là CỘT SỐNG của C1: bundler không phân tích tĩnh nên ipc.cjs
     * không được đóng gói cho lời gọi đó, và try/catch nuốt MODULE_NOT_FOUND.
     * Canh riêng vì nếu ai đó viết lại bằng `new Function('return require')()`
     * thì chuỗi "eval('require')" không khớp mà lỗi vẫn quay lại. */
    const b = serverBundle();
    expect(b).not.toContain("eval('require')");
    expect(b).not.toContain('eval("require")');
  });
});

describe('ranh giới runtime — trình duyệt không được chạm ipc.cjs', () => {
  const CLIENT_ENTRIES = [
    'react/use-chat-orchestration.ts',
    'components/chat/tool-trace.tsx',
    'app/page.tsx',
  ];

  /** Đường dẫn các module mà file này import, quy về đường dẫn repo. */
  function importsOf(file: string): string[] {
    const src = readFileSync(path.join(REPO, file), 'utf8');
    const out: string[] = [];
    const re = /from\s+'@\/([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.push(`lib/${m[1]}.ts`);
    return out;
  }

  it('không module nào tới được từ trình duyệt import ipc.cjs', () => {
    const seen = new Set<string>();
    const queue = CLIENT_ENTRIES.filter((f) => existsSync(path.join(REPO, f)));
    const offenders: string[] = [];
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const abs = path.join(REPO, f);
      if (!existsSync(abs)) continue;
      const src = readFileSync(abs, 'utf8');
      if (/from\s+'[^']*ipc\.cjs'|require\([^)]*ipc\.cjs/.test(src)) offenders.push(f);
      for (const dep of importsOf(f)) queue.push(dep);
    }
    expect(
      offenders,
      `module chạm ipc.cjs nhưng nằm trong đồ thị trình duyệt: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('đồ thị import tới được hơn 5 module — quét có thật sự chạy', () => {
    // Nếu quét hỏng (ví dụ glob sai) thì test trên XANH một cách giả. Canh
    // độ sâu duyệt để đảm bảo nó không rơi vào tình huống "không thấy gì".
    const seen = new Set<string>();
    const queue = CLIENT_ENTRIES.filter((f) => existsSync(path.join(REPO, f)));
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const abs = path.join(REPO, f);
      if (!existsSync(abs)) continue;
      for (const dep of importsOf(f)) queue.push(dep);
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});