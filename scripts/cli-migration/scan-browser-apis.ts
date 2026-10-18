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
 *
 * QUÉT BẰNG AST, KHÔNG BẰNG REGEX DÒNG. Lý do (review độc lập, phiên 2026-10-18):
 * regex thùa cả comment lẫn string, nên 39/44 dòng bảng kiểm kê không có dòng
 * code nào thật sự dùng API nào — có dòng còn phủ định chính nó, kiểu
 * `lib/turns.ts:32` viết "không kéo Dexie vào đúng import". Bảng dẫn dắt kế hoạch
 * xoá code bằng bằng chứng không tồn tại thì còn tệ hơn không có bảng.
 * AST phân biệt được Identifier trong code với Identifier trong comment/string.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface ScanHit {
  /** Đường dẫn tương đối so với thư mục gốc repo, LUÔN dùng `/` kể cả trên Windows. */
  file: string;
  /** Số dòng 1-based. */
  line: number;
  /** Tên API, lấy từ khoá của `BROWSER_APIS`. */
  api: string;
}

/** API chỉ tồn tại trong trình duyệt. Thêm mục ở đây thì bảng kiểm kê tự rộng thêm. */
export const BROWSER_APIS = [
  'Dexie',
  'indexedDB',
  'localStorage',
  'showDirectoryPicker',
  'showOpenFilePicker',
  'FileSystemHandle',
  'getAsFileSystemHandle',
  'navigator.storage',
  'navigator.clipboard',
  'navigator.share',
] as const;

const BARE = new Set<string>(BROWSER_APIS.filter((n) => !n.includes('.')));
const DOTTED: ReadonlySet<string> = new Set(BROWSER_APIS.filter((n) => n.includes('.')));

const BOILERPLATE_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);

/** Quét nội dung một file. Chỉ tính dùng thật trong code, bỏ qua comment và string. */
export function scanFile(src: string, file: string): ScanHit[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: ScanHit[] = [];

  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const add = (api: string, node: ts.Node): void => {
    hits.push({ file, line: lineOf(node), api });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && BARE.has(node.text)) add(node.text, node);
    // `navigator.storage` là PropertyAccessExpression — lấy nguyên văn đúng 2 tầng.
    if (ts.isPropertyAccessExpression(node) && DOTTED.has(node.getText(sf))) {
      add(node.getText(sf), node);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
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