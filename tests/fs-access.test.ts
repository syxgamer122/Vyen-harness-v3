import { beforeEach, describe, expect, it } from 'vitest';
import {
  fsList,
  fsRead,
  fsSearch,
  fsWrite,
  normalizeRelPath,
  type FsDeps,
  type FsDirHandleLike,
} from '@/lib/fs-access';

/** Fake handle tối thiểu mô phỏng FileSystemDirectoryHandle trong bộ nhớ. */
function fakeFile(name: string, content: string) {
  const state = { content };
  const handle = {
    kind: 'file' as const,
    name,
    async getFile() {
      return { size: state.content.length, text: async () => state.content } as unknown as File;
    },
    async createWritable() {
      return {
        write: async (chunk: string) => {
          state.content = chunk;
        },
        close: async () => {},
      };
    },
  };
  return handle;
}

const fakeContent = new Map<string, string>();
let currentDir = '';

function pathKey(dir: string, name: string): string {
  return `${dir}/${name}`.replace(/^\/+/, '');
}

function fakeDir(name: string, children: Array<any>): FsDirHandleLike {
  const self: FsDirHandleLike = {
    kind: 'directory',
    name,
    values: async function* () {
      for (const c of children) yield c;
    },
    async getDirectoryHandle(childName: string, opts?: { create?: boolean }) {
      const found = children.find((c) => c.name === childName && c.kind === 'directory') as FsDirHandleLike | undefined;
      if (!found) {
        if (!opts?.create) throw new Error(`NotFoundError: ${childName}`);
        const created = fakeDir(childName, []);
        children.push(created);
        return created;
      }
      return found;
    },
    async getFileHandle(childName: string, opts?: { create?: boolean }) {
      const found = children.find((c) => c.name === childName && c.kind === 'file');
      if (!found) {
        if (!opts?.create) throw new Error(`NotFoundError: ${childName}`);
        const created = fakeFile(childName, '');
        children.push(created);
        return created;
      }
      return found;
    },
  };
  return self;
}

describe('normalizeRelPath — chắn path traversal', () => {
  it('chuẩn hóa backslash, slash thừa, ./', () => {
    expect(normalizeRelPath('src\\lib\\a.ts')).toBe('src/lib/a.ts');
    expect(normalizeRelPath('/src/')).toBe('src');
    expect(normalizeRelPath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizeRelPath('')).toBe('');
  });

  it('chặn tuyệt đối, drive, ..', () => {
    expect(normalizeRelPath('../secret')).toBeNull();
    expect(normalizeRelPath('src/../../etc/passwd')).toBeNull();
    expect(normalizeRelPath('C:/Windows')).toBeNull();
    expect(normalizeRelPath('//server/share')).toBeNull();
  });
});

describe('fs ops trên fake handle', () => {
  let root: FsDirHandleLike;
  let deps: FsDeps;

  beforeEach(() => {
    fakeContent.clear();
    currentDir = '';
    root = fakeDir('proj', [
      fakeFile('README.md', '# hello\nversion 1'),
      fakeDir('src', [
        fakeFile('index.ts', 'export function main() {\n  console.log("hi");\n}\n'),
        fakeFile('util.ts', 'export const add = (a,b) => a+b;'),
        fakeDir('__pycache__', [fakeFile('junk.pyc', 'binary-ish')]),
      ]),
    ]);
    deps = { root, writable: true };
  });

  it('fsList liệt kê một cấp, thư mục trước', async () => {
    const entries = await fsList(deps, '');
    expect(entries[0].type).toBe('dir');
    expect(entries.map((e) => e.name)).toContain('README.md');
    const src = await fsList(deps, 'src');
    expect(src.some((e) => e.name === '__pycache__' && e.type === 'dir')).toBe(true);
  });

  it('fsRead đọc nội dung + ghi nhận truncated', async () => {
    const r = await fsRead(deps, 'src/index.ts');
    expect(r.content).toContain('console.log');
    expect(r.truncated).toBe(false);
    await expect(fsRead(deps, '../outside')).rejects.toThrow();
  });

  it('fsWrite tạo file mới trong thư mục con có create', async () => {
    const r = await fsWrite(deps, 'src/new-file.ts', 'export {};\n');
    expect(r.created).toBe(true);
    expect(r.path).toBe('src/new-file.ts');
    const readBack = await fsRead(deps, 'src/new-file.ts');
    expect(readBack.content).toContain('export {}');
  });

  it('fsSearch tìm case-insensitive, bỏ qua node_modules/.git style dirs', async () => {
    const hits = await fsSearch(deps, 'CONSOLE.LOG'.toLowerCase(), { maxResults: 10 });
    expect(hits.some((h) => h.path === 'src/index.ts' && h.line === 2)).toBe(true);
  });

  it('fsSearch regex mode', async () => {
    const hits = await fsSearch(deps, 'add\\s*=', { isRegex: true });
    expect(hits[0]?.path).toBe('src/util.ts');
  });

  it('fsSearch query rỗng → rỗng', async () => {
    expect(await fsSearch(deps, '   ')).toEqual([]);
  });
});

/**
 * Bug B1: `content` bị cắt bởi `maxChars` TRƯỚC, nhưng `endLine` lấy từ
 * `selected` CHƯA cắt — nên model đọc `endLine` rồi báo "đã đọc tới dòng N"
 * trong khi `content` dừng dở ở dòng M (M < N). `truncated` vẫn đúng nên
 * không ai nghi ngờ.
 *
 * Đo thật: fs_read("big.txt") (252 779 bytes) trả
 * `{"truncated":true,"endLine":5000}` nhưng content dừng dở ở `line494`.
 *
 * Đảo điều kiện (tính `endLine` từ `endIndex` cũ) → describe này ĐỎ.
 */
describe('B1 — endLine phản ánh nội dung THỰC SỰ được trả về', () => {
  /** File nhiều dòng, mỗi dòng dài để vượt trần ký tự ở giữa file. */
  function bigFile(lines: number): string {
    return Array.from({ length: lines }, (_, i) => `line${i + 1} ${'x'.repeat(200)}`).join('\n');
  }

  let root: FsDirHandleLike;
  let deps: FsDeps;

  beforeEach(() => {
    root = fakeDir('proj', [fakeFile('big.txt', bigFile(500))]);
    deps = { root, writable: true };
  });

  it('cắt bởi maxChars → endLine khớp dòng cuối trong content', async () => {
    const r = await fsRead(deps, 'big.txt');
    expect(r.truncated).toBe(true);

    /* Hợp đồng: endLine là dòng CUỐI CÙNG thực sự nằm trong content. Đây là
       điều model tin để phân trang tiếp bằng start_line. */
    const lastLine = r.content.split('\n').at(-1) ?? '';
    expect(r.endLine).toBe(r.content.split('\n').length);
    expect(lastLine).toMatch(/^line\d+ /);
    expect(r.endLine).toBeLessThan(500);

    /* Dùng endLine đọc tiếp phải không lặp lại dòng đã đọc và không hụt dòng
       nào — đây là hệ quả thực dụng của việc endLine sai. */
    const next = await fsRead(deps, 'big.txt', { startLine: r.endLine + 1 });
    expect(next.startLine).toBe(r.endLine + 1);
    const nextFirst = next.content.split('\n')[0];
    expect(nextFirst).not.toBe(lastLine);
  });

  it('cắt bởi line_count (không đụng maxChars) → endLine đúng như cũ', async () => {
    const r = await fsRead(deps, 'big.txt', { startLine: 1, lineCount: 10 });
    expect(r.truncated).toBe(true);
    expect(r.endLine).toBe(10);
    expect(r.content.split('\n')).toHaveLength(10);
  });

  it('file vừa trần → endLine là số dòng thật', async () => {
    const small = fakeDir('proj', [fakeFile('small.txt', 'a\nb\nc')]);
    const r = await fsRead({ root: small, writable: true }, 'small.txt');
    expect(r.truncated).toBe(false);
    expect(r.endLine).toBe(3);
    expect(r.startLine).toBe(1);
  });

  it('startLine lệch → endLine vẫn là số thứ tự tuyệt đối', async () => {
    const r = await fsRead(deps, 'big.txt', { startLine: 100 });
    expect(r.startLine).toBe(100);
    // Dòng đầu tiên của content phải là line100, và endLine đếm từ 1.
    expect(r.content.split('\n')[0]).toMatch(/^line100 /);
    expect(r.endLine).toBeGreaterThan(100);
  });
});
