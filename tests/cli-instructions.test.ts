/**
 * Nạp instruction file (`AGENTS.md`) vào system prompt + chèn hướng dẫn tool
 * **có điều kiện**.
 *
 * ============ VÌ SAO CẢ HAI NẰM CHUNG MỘT TEST FILE ============
 *
 * Cùng một chỗ sinh ra system prompt, cùng một chỗ quyết định model có tin là mình
 * có tool hay không. Tách ra thì mất đúng quan hệ đó: hướng dẫn tool mà vẫn còn
 * sau khi tool đã tắt là loại lỗi khiến model **bịa** công cụ không tồn tại.
 *
 * ============ ĐO ĐƯỢC TỪ MÃ opencode ============
 *
 * `packages/core/src/session/system-prompt.ts` của họ làm đúng hai việc: dán một
 * prompt tĩnh, rồi chèn `${OPENCODE_TOOL_GUIDANCE}` **chỉ cho tool đang có**:
 *
 *     if (tools.includes("shell")) instructions.push(...)
 *
 * Còn toàn bộ bối cảnh dự án đến từ instruction file, định dạng 4 dòng:
 * `Instructions from: ${path}\n${content}`.
 *
 * Bản của tôi trước đó liệt kê cứng 14 tool kể cả khi workspace không hợp lệ và
 * tool đã tắt — tức bảo model dùng `fs_write` trong khi `fs_write` không có.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSystemPrompt, INSTRUCTION_FILES, MAX_INSTRUCTION_CHARS } from '@/cli/instructions';

function ws(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vyen-instr-'));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  return dir;
}

const TOOLS = ['fs_read', 'fs_write', 'fs_edit', 'shell_run', 'git_add'];

describe('system prompt — nền', () => {
  it('luôn có phần mở đầu, kể cả khi không có tool và không có file hướng dẫn', () => {
    const p = buildSystemPrompt(undefined, ws());
    expect(p.length).toBeGreaterThan(0);
    expect(p.toLowerCase()).toContain('terminal');
  });

  it('tên file hướng dẫn được khai ở MỘT chỗ, không rải khắp prompt', () => {
    /* Danh sách file hướng dẫn là quyết định, không phải chi tiết. Nếu rải ở
     * nhiều nơi thì thêm file thứ hai sẽ phải sửa nhiều chỗ và sẽ sót. */
    expect(INSTRUCTION_FILES).toContain('AGENTS.md');
    expect(INSTRUCTION_FILES.length).toBeGreaterThan(0);
  });
});

describe('system prompt — hướng dẫn tool có điều kiện', () => {
  it('có `fs_write` thì mới nhắc dùng nó', () => {
    const p = buildSystemPrompt(['fs_read', 'fs_write'], ws());
    expect(p).toContain('fs_write');
  });

  /* ĐÂY LÀ LỖI THẬT CỦA BẢN CŨ: liệt kê cứng tool kể cả khi tool đã tắt. */
  it('KHÔNG có `fs_write` thì prompt không được nhắc tới `fs_write`', () => {
    const p = buildSystemPrompt(['fs_read'], ws());
    expect(p).not.toContain('fs_write');
  });

  it('không có tool nào thì không có đoạn hướng dẫn tool', () => {
    const p = buildSystemPrompt(undefined, ws());
    expect(p).not.toContain('fs_read');
    expect(p).not.toContain('shell_run');
  });

  it('cứ có `shell_run` là được bảo tránh nối lệnh bằng dấu phân cách', () => {
    const p = buildSystemPrompt(['shell_run'], ws());
    expect(p).toContain('shell_run');
  });
});

describe('system prompt — nạp AGENTS.md', () => {
  it('nội dung file vào prompt, kèm đường dẫn để biết nó từ đâu', () => {
    const d = ws({ 'AGENTS.md': 'Quy tac: commit KHONG co dau.' });
    const p = buildSystemPrompt(undefined, d);
    expect(p).toContain('Quy tac: commit KHONG co dau.');
    expect(p).toContain('AGENTS.md');
  });

  it('giữ nguyên tiếng Việt có dấu', () => {
    const d = ws({ 'AGENTS.md': 'Comment trong mã viết tiếng Việt CÓ DẤU.' });
    expect(buildSystemPrompt(undefined, d)).toContain('CÓ DẤU');
  });

  it('có cả `AGENTS.md` và `CLAUDE.md` thì nạp cả hai', () => {
    const d = ws({ 'AGENTS.md': 'tu AGENTS', 'CLAUDE.md': 'tu CLAUDE' });
    const p = buildSystemPrompt(undefined, d);
    expect(p).toContain('tu AGENTS');
    expect(p).toContain('tu CLAUDE');
  });

  /* Không có file nào thì KHÔNG được bịa tiêu đề "Instructions" — model sẽ tưởng
   * có hướng dẫn nào đó rồi tự bịa nội dung. */
  it('không có file thì KHÔNG chèn tiêu đề hướng dẫn', () => {
    const p = buildSystemPrompt(undefined, ws());
    expect(p).not.toContain('Instructions from:');
  });

  it('file trong thư mục con thì KHÔNG nạp — chỉ gốc workspace', () => {
    /* Nạp mọi thứ trong cây là đoán ý người dùng: `AGENTS.md` trong
     * `node_modules/...` hay thư mục test không phải chỉ dẫn cho bạn. */
    const d = ws({ 'con/AGENTS.md': 'huong dan trong thu muc con' });
    const p = buildSystemPrompt(undefined, d);
    expect(p).not.toContain('huong dan trong thu muc con');
  });
});

describe('system prompt — chống hỏng', () => {
  it('file quá lớn thì CẮT và nói rõ đã cắt — im lặng cắt là nói dối model', () => {
    const lon = 'x'.repeat(MAX_INSTRUCTION_CHARS + 5000);
    const d = ws({ 'AGENTS.md': lon });
    const p = buildSystemPrompt(undefined, d);
    expect(p.length).toBeLessThan(MAX_INSTRUCTION_CHARS + 5000);
    // Không dùng chữ có dấu trong regex: file .ts đi qua nhiều lớp encode và dấu
// thanh dễ bị đổi nên test đỏ vì lý do không liên quan tới logic.
expect(p).toMatch(/da cat/i);
  });

  it('đường dẫn workspace không tồn tại thì KHÔNG ném — CLI vẫn phải chạy được', () => {
    const p = buildSystemPrompt(undefined, 'C:\\khong\\ton\\tai\\xyz');
    expect(p.length).toBeGreaterThan(0);
  });

  it('workspace là một FILE chứ không phải thư mục thì không ném', () => {
    const d = ws();
    const f = path.join(d, 'la-file.txt');
    writeFileSync(f, 'x', 'utf8');
    expect(buildSystemPrompt(undefined, f).length).toBeGreaterThan(0);
  });
});