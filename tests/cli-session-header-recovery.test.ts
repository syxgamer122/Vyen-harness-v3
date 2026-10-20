/**
 * Transcript CLI hỏng ở DÒNG ĐẦU phải tự phục hồi được.
 *
 * ============ LỖI ĐÃ KIỂM CHỨNG ============
 *
 * `readOrCreateHeader` (cli/session.ts) khi dòng 1 không phải header hợp lệ thì
 * **nối** một header MỚI vào CUỐI file — dòng 1 vẫn hỏng. `readMessages` ném khi
 * dòng hỏng không phải dòng cuối ⇒ **mọi** lần chạy sau đều ném cùng một lỗi,
 * và mỗi lần chạy lại còn nối thêm một dòng rác ⇒ file phình dần.
 *
 * Đo (probe trên đúng hàm production): 3 lần mở ⇒ 3 lần ném
 * "Transcript ... hong o dong 1", file tích thêm header mỗi lần.
 *
 * Phiên bị chết vĩnh viễn chỉ vì MỘT dòng JSON hỏng ở đầu file — trong khi
 * phần lịch sử còn lại vẫn đọc được.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openSession, sessionFileFor } from '@/cli/session';

function mk() {
  const state = mkdtempSync(path.join(tmpdir(), 'vyen-hdr-'));
  const dir = mkdtempSync(path.join(tmpdir(), 'vyen-du-an-'));
  return {
    state,
    dir,
    cleanup: () => {
      rmSync(state, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Làm hỏng DÒNG ĐẦU của transcript (giữ nguyên phần còn lại). */
function hongDongDau(file: string): void {
  const raw = readFileSync(file, 'utf8');
  const xuongDong = raw.indexOf('\n');
  writeFileSync(file, '{"kind":"head' + (xuongDong >= 0 ? raw.slice(xuongDong) : '\n'), 'utf8');
}

describe('transcript hỏng ở dòng đầu — phải mở lại được', () => {
  it('không ném lỗi và giữ nguyên lịch sử', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.append({ role: 'user', content: 'cau hoi' });
      s.append({ role: 'assistant', content: 'tra loi' });

      const file = sessionFileFor(state, dir);
      hongDongDau(file);

      const moi = openSession(state, dir);
      expect(moi.messages.length, 'phải đọc được cả lịch sử còn lại').toBe(2);
      expect(moi.messages[0]).toMatchObject({ role: 'user', content: 'cau hoi' });
      expect(moi.messages[1]).toMatchObject({ role: 'assistant', content: 'tra loi' });
    } finally {
      cleanup();
    }
  });

  it('dòng đầu sau khi mở lại phải là header hợp lệ', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.append({ role: 'user', content: 'cau hoi' });
      const file = sessionFileFor(state, dir);
      hongDongDau(file);

      openSession(state, dir);

      const dongDau = readFileSync(file, 'utf8').split('\n')[0] ?? '';
      const header = JSON.parse(dongDau);
      expect(header.kind).toBe('header');
      expect(typeof header.sessionId).toBe('string');
    } finally {
      cleanup();
    }
  });

  it('mở nhiều lần thì file KHÔNG phình thêm', () => {
    const { state, dir, cleanup } = mk();
    try {
      const s = openSession(state, dir);
      s.append({ role: 'user', content: 'cau hoi' });
      const file = sessionFileFor(state, dir);
      hongDongDau(file);

      openSession(state, dir);
      const sizeSauLan1 = readFileSync(file, 'utf8').length;
      openSession(state, dir);
      openSession(state, dir);
      const sizeSauLan3 = readFileSync(file, 'utf8').length;

      expect(sizeSauLan3, 'mỗi lần mở không được nối thêm gì').toBe(sizeSauLan1);
    } finally {
      cleanup();
    }
  });
});
