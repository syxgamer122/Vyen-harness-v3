/**
 * Shell tool tests — smart output truncation trong lib/ipc.cjs.
 *
 * truncateShellOutput là hàm thuần (không phụ thuộc Electron/spawn) nên test
 * trực tiếp qua createRequire. shellRun integration test cần Electron env
 * nên chỉ test truncation logic ở đây.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

// Import truncateShellOutput từ ipc.cjs
// ipc.cjs export truncateShellOutput qua module.exports ở cuối file
let truncateShellOutput: (
  fullOutput: string,
  label: 'stdout' | 'stderr' | 'output',
) => { text: string; truncated: boolean; savedTo?: string; previewHint?: string };

let isSavedShellOutput: (p: string) => boolean;
let registerSavedShellOutput: (p: string, kind?: string) => void;
let SAVED_OUTPUT_REGISTRY_MAX: number;
let saveSpillText: (
  content: string,
  suggestedName: string,
) => { savedTo: string; bytes: number; notice: string } | null;

try {
  const ipc = require('../lib/ipc.cjs') as Record<string, unknown>;
  truncateShellOutput = ipc.truncateShellOutput as typeof truncateShellOutput;
  isSavedShellOutput = ipc.isSavedShellOutput as typeof isSavedShellOutput;
  registerSavedShellOutput = ipc.registerSavedShellOutput as typeof registerSavedShellOutput;
  SAVED_OUTPUT_REGISTRY_MAX = ipc.SAVED_OUTPUT_REGISTRY_MAX as number;
  saveSpillText = ipc.saveSpillText as typeof saveSpillText;
} catch {
  // Nếu ipc.cjs không export trực tiếp, test sẽ skip
  truncateShellOutput = null as any;
  isSavedShellOutput = null as any;
  registerSavedShellOutput = null as any;
  SAVED_OUTPUT_REGISTRY_MAX = 0;
  saveSpillText = null as any;
}

// Cleanup temp files created during tests
const tempFiles: string[] = [];
afterEach(() => {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  tempFiles.length = 0;
});

describe.skipIf(!truncateShellOutput)('truncateShellOutput', () => {
  it('returns empty string unchanged', () => {
    const result = truncateShellOutput('', 'stdout');
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.savedTo).toBeUndefined();
  });

  it('passes through short output without truncation', () => {
    const short = 'hello world\nline 2\nline 3';
    const result = truncateShellOutput(short, 'stdout');
    expect(result.text).toBe(short);
    expect(result.truncated).toBe(false);
  });

  it('truncates output exceeding line limit and saves to temp file', () => {
    // Generate 2500 lines (> 2000 limit)
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`);
    const full = lines.join('\n');

    const result = truncateShellOutput(full, 'stdout');

    expect(result.truncated).toBe(true);
    expect(result.savedTo).toBeDefined();
    expect(result.previewHint).toBeDefined();

    // Preview should contain last ~50 lines
    expect(result.text).toContain('line 2500');
    expect(result.text).toContain('line 2451');
    expect(result.text).not.toContain('line 1\n');

    // Temp file should contain full output
    if (result.savedTo) {
      tempFiles.push(result.savedTo);
      const saved = fs.readFileSync(result.savedTo, 'utf8');
      expect(saved).toBe(full);
    }
  });

  it('truncates output exceeding byte limit', () => {
    // Generate output > 50KB with few lines (long lines)
    const longLine = 'x'.repeat(60_000);
    const full = `header\n${longLine}\nfooter`;

    const result = truncateShellOutput(full, 'stderr');

    expect(result.truncated).toBe(true);
    expect(result.savedTo).toBeDefined();
    expect(result.previewHint).toContain('byte limit');

    if (result.savedTo) {
      tempFiles.push(result.savedTo);
      const saved = fs.readFileSync(result.savedTo, 'utf8');
      expect(saved).toBe(full);
    }
  });

  it('preview hint includes platform-appropriate read commands', () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`);
    const full = lines.join('\n');

    const result = truncateShellOutput(full, 'output');

    expect(result.previewHint).toBeDefined();
    const isWin = process.platform === 'win32';
    if (isWin) {
      expect(result.previewHint).toContain('Get-Content');
    } else {
      expect(result.previewHint).toContain('head');
    }

    if (result.savedTo) tempFiles.push(result.savedTo);
  });

  it('temp file is in OS temp directory', () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `data ${i}`);
    const full = lines.join('\n');

    const result = truncateShellOutput(full, 'stdout');

    if (result.savedTo) {
      tempFiles.push(result.savedTo);
      expect(result.savedTo.startsWith(os.tmpdir())).toBe(true);
      expect(path.basename(result.savedTo)).toMatch(/^vyen-shell-stdout-[a-f0-9]+\.txt$/);
    }
  });

  it('handles output exactly at limits without truncation', () => {
    // Exactly 2000 lines, each short → under byte limit too
    const lines = Array.from({ length: 2000 }, (_, i) => `l${i}`);
    const full = lines.join('\n');

    const result = truncateShellOutput(full, 'stdout');
    // 2000 lines is NOT exceeded (limit is >2000), so no truncation
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(full);
  });
});

describe.skipIf(!isSavedShellOutput)('saved output registry — fs_read whitelist', () => {
  it('truncateShellOutput tự đăng ký savedTo — đọc được qua isSavedShellOutput', () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `reg ${i}`);
    const r = truncateShellOutput(lines.join('\n'), 'stdout');
    expect(r.savedTo).toBeTruthy();
    if (r.savedTo) tempFiles.push(r.savedTo);
    expect(isSavedShellOutput(r.savedTo!)).toBe(true);
  });

  it('path trùng pattern tên nhưng CHƯA từng được ghi → không đọc được', () => {
    const fake = path.join(os.tmpdir(), 'vyen-shell-stdout-deadbeef.txt');
    expect(isSavedShellOutput(fake)).toBe(false);
  });

  it('path thường: tương đối / tuyệt đối lạ / rỗng → luôn false', () => {
    expect(isSavedShellOutput('README.md')).toBe(false);
    expect(isSavedShellOutput(path.join(os.tmpdir(), 'khac.txt'))).toBe(false);
    expect(isSavedShellOutput('')).toBe(false);
  });

  it('win32: path lệch hoa/thường vẫn khớp (model gõ lại không chính xác)', () => {
    const p = path.join(os.tmpdir(), 'vyen-shell-stdout-case1.txt');
    registerSavedShellOutput(p); // registry thuần — không chạm đĩa
    expect(isSavedShellOutput(p.toUpperCase())).toBe(process.platform === 'win32');
  });

  it('trần registry: vượt SAVED_OUTPUT_REGISTRY_MAX thì entry cũ nhất bị đẩy ra', () => {
    const first = path.join(os.tmpdir(), 'vyen-shell-stdout-evict-0.txt');
    registerSavedShellOutput(first);
    for (let i = 1; i < SAVED_OUTPUT_REGISTRY_MAX; i += 1) {
      registerSavedShellOutput(path.join(os.tmpdir(), `vyen-shell-stdout-evict-${i}.txt`));
    }
    expect(isSavedShellOutput(first)).toBe(true);
    const newest = path.join(os.tmpdir(), 'vyen-shell-stdout-evict-new.txt');
    registerSavedShellOutput(newest);
    expect(isSavedShellOutput(first)).toBe(false);
    expect(isSavedShellOutput(newest)).toBe(true);
  });
});

/**
 * Spill: lưu phần kết quả tool bị cắt ra file app tự ghi để `fs_read` đọc lại
 * được. Xem docs/superpowers/specs/2026-10-18-tool-result-spill-design.md.
 */
/* KHÔNG dùng describe.skipIf ở đây: skip làm test im lặng xanh trước khi có
 * saveSpillText, tức test rỗng. Feature phải FAIL thật cho tới khi ipc.cjs
 * export nó. */
describe('saveSpillText', () => {
  it('ghi file tạm, nội dung khớp byte-for-byte, trả savedTo + bytes', () => {
    const content = 'xin chào, đây là nội dung bị cắt';
    const r = saveSpillText(content, 'web_fetch.txt');
    expect(r).not.toBeNull();
    tempFiles.push(r!.savedTo);
    expect(fs.readFileSync(r!.savedTo, 'utf8')).toBe(content);
    expect(r!.bytes).toBe(Buffer.byteLength(content, 'utf8'));
    expect(r!.notice).toContain(r!.savedTo);
  });

  it('nội dung rỗng → trả null, không tạo file', () => {
    expect(saveSpillText('', 'x.txt')).toBeNull();
  });

  /* Review Focus #1: suggestedName do model kiểm soát, có thể bị ép ghi file
   * ngoài tmpdir qua prompt-injection. Mọi biến thể phải nằm trong tmpdir. */
  it.each([
    '../../evil.txt',
    '..\\..\\windows\\system32\\evil.txt',
    '/etc/passwd',
    'a/b/c.txt',
    '....//....//x.txt',
  ])('suggestedName độc hại %s vẫn nằm trong tmpdir', (name) => {
    const r = saveSpillText('payload', name);
    expect(r).not.toBeNull();
    tempFiles.push(r!.savedTo);
    expect(path.dirname(path.resolve(r!.savedTo))).toBe(path.resolve(os.tmpdir()));
  });

  it('suggestedName rỗng hoặc toàn ký tự lạ → vẫn ghi được, không ném', () => {
    for (const name of ['', '///', '...', '⚠️⚠️']) {
      const r = saveSpillText('payload', name);
      expect(r, `tên: ${JSON.stringify(name)}`).not.toBeNull();
      tempFiles.push(r!.savedTo);
      expect(fs.existsSync(r!.savedTo)).toBe(true);
    }
  });

  it('hai lần ghi → hai file khác nhau, không đè lên nhau', () => {
    const a = saveSpillText('nội dung A', 'cùng-tên.txt');
    const b = saveSpillText('nội dung B', 'cùng-tên.txt');
    tempFiles.push(a!.savedTo, b!.savedTo);
    expect(a!.savedTo).not.toBe(b!.savedTo);
    expect(fs.readFileSync(a!.savedTo, 'utf8')).toBe('nội dung A');
    expect(fs.readFileSync(b!.savedTo, 'utf8')).toBe('nội dung B');
  });
});
