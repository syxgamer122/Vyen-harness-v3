/**
 * File spill/shell mồ côi phải được dọn — không phình `%TEMP%` vô hạn.
 *
 * ============ LỖI ĐÃ KIỂM CHỨNG (verifier 2026-10-20) ============
 *
 * `evictSavedOutputs` (lib/ipc.cjs) chỉ dọn được file của **tiến trình đang
 * chạy** — registry nằm trong RAM. Mỗi lần chạy CLI rồi thoát để lại vài
 * file `vyen-spill-*.txt` / `vyen-shell-*.txt` ở `%TEMP%` không ai xoá.
 *
 * Đo: 1.163 file / 55,1 MB chỉ từ vài giờ dùng. File đó **không còn giá trị**
 * cho phiên sau (registry đã mất ⇒ `fs_read` không đọc được nữa).
 *
 * Quy tắc: xoá file CŨ HƠN 24 giờ; file mới (đang dùng) thì giữ.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { purgeStaleTempArtifacts } from '@/lib/ipc.cjs';

function taoFile(dir: string, ten: string, ageHours: number): string {
  const full = path.join(dir, ten);
  writeFileSync(full, 'x', 'utf8');
  const moc = (Date.now() - ageHours * 3600 * 1000) / 1000;
  utimesSync(full, moc, moc);
  return full;
}

describe('dọn file spill/shell mồ côi', () => {
  it('xoá file CŨ, giữ file MỚI và file lạ', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vyen-purge-'));
    try {
      const cu = taoFile(dir, 'vyen-spill-cu.txt', 48);
      const moi = taoFile(dir, 'vyen-spill-moi.txt', 0);
      const shellCu = taoFile(dir, 'vyen-shell-cu.txt', 30);
      const la = taoFile(dir, 'file-khong-phai-cua-app.txt', 48);

      const removed = purgeStaleTempArtifacts(dir);

      expect(removed, 'phải xoá đúng 2 file cũ của app').toBe(2);
      const conLai = readdirSync(dir);
      expect(conLai).toContain('vyen-spill-moi.txt');
      expect(conLai).toContain('file-khong-phai-cua-app.txt');
      expect(conLai).not.toContain('vyen-spill-cu.txt');
      expect(conLai).not.toContain('vyen-shell-cu.txt');
      expect(cu).toBeTruthy();
      expect(shellCu).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('thư mục không tồn tại thì không ném (dọn rác không được làm hỏng lúc khởi động)', () => {
    expect(purgeStaleTempArtifacts(path.join(tmpdir(), 'khong-ton-tai-xyz'))).toBe(0);
  });
});
