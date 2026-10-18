/**
 * Quét `lib/` tìm chỗ dùng API chỉ có ở trình duyệt — bước đầu của việc chuyển
 * Vyen sang CLI (spec `2026-10-18-cli-core-design.md` §4).
 *
 * Script này chỉ thu BẰNG CHỨNG: file, dòng, tên API. Nó không quyết định
 * file đó giữ hay xoá — việc đó là phán đoán của người, và làm máy quyết
 * định thì bảng sẽ sai một cách rất khó nhận ra.
 *
 * Danh sách API cố ý KHÔNG có `window`/`document`. Chúng xuất hiện trong guard
 * `typeof window !== 'undefined'` ở hầu hết mọi file và vô hại với Node; đưa
 * vào đây thì mọi file đều dính và bảng mất khả năng chỉ đường.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface ScanHit {
  /** Đường dẫn tương đối so với thư mục gốc repo, LUÔN dùng `/` kể cả trên Windows. */
  file: string;
  /** Số dòng 1-based. */
  line: number;
  /** Khoá của `BROWSER_APIS` — dùng làm tên cột trong bảng kiểm kê. */
  api: string;
}

/** API chỉ tồn tại trong trình duyệt. Thêm mục ở đây thì bảng kiểm kê tự rộng thêm. */
export const BROWSER_APIS: Record<string, RegExp> = {
  Dexie: /\bDexie\b/,
  indexedDB: /\bindexedDB\b/,
  localStorage: /\blocalStorage\b/,
  showDirectoryPicker: /\bshowDirectoryPicker\b/,
  showOpenFilePicker: /\bshowOpenFilePicker\b/,
  FileSystemHandle: /\bFileSystemHandle\b/,
  getAsFileSystemHandle: /\bgetAsFileSystemHandle\b/,
  'navigator.storage': /\bnavigator\.storage\b/,
  'navigator.clipboard': /\bnavigator\.clipboard\b/,
  'navigator.share': /\bnavigator\.share\b/,
};

const BOILERPLATE_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);

/** Quét nội dung một file. Một dòng có thể dính nhiều API thì trả nhiều hit. */
export function scanFile(src: string, file: string): ScanHit[] {
  const hits: ScanHit[] = [];
  src.split(/\r?\n/).forEach((line, i) => {
    for (const [api, re] of Object.entries(BROWSER_APIS)) {
      if (re.test(line)) hits.push({ file, line: i + 1, api });
    }
  });
  return hits;
}

/** Quét đệ quy mọi file `.ts` dưới `root`, trả về mọi hit tìm được. */
export function scanBrowserApis(root: string): ScanHit[] {
  const hits: ScanHit[] = [];

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (BOILERPLATE_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (name.endsWith('.ts')) {
        const rel = abs.split(path.sep).join('/');
        hits.push(...scanFile(readFileSync(abs, 'utf8'), rel));
      }
    }
  };

  walk(root);
  return hits;
}