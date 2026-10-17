import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseSlashCommand,
  normalizeModeParam,
  BUILTIN_SLASH_COMMANDS,
} from '@/lib/slash-commands';

describe('Lệnh slash mở Cài đặt tới đúng tab (source-scan)', () => {
  // Đây là HÀNH VI NGƯỜI DÙNG THẤY: gõ `/tools` rồi bấm xem phê duyệt. Assert
  // source thay vì hàm vì orchestration hook cần cả React + store, và điều ta
  // cần ghim ở đây chính là ĐOẠN LỆNH truyền chuỗi tab cho `openSettings` —
  // đổi chuỗi đó là đổi tab người dùng nhìn thấy.
  const src = fs.readFileSync(path.resolve(__dirname, '../react/use-chat-orchestration.ts'), 'utf8');

  it('lệnh tools mở tab safety — nơi có bảng phân quyền từng công cụ', () => {
    // Đột biến bị chặn: đổi 'safety' thành alias cũ 'chung' → resolveSettingsTab
    // map 'chung' sang 'appearance', tab không có cài đặt công cụ nào, toast
    // thì vẫn nói "đã mở cài đặt công cụ".
    //
    // Cố tình KHÔNG dùng regex khoảng-cách `[\s\S]{0,N}`: repo này comment rất
    // dày, nên chỉ cần chèn thêm vài dòng giải thích là vỡ — đã xảy ra đúng một
    // lần (thiếu `});` cũngngầm do lỗi đọc cấu trúc). Lát cắt độc lập với độ
    // dài comment; `expect(i).toBeGreaterThan(-1)` để marker hỏng thì đỏ ngay
    // thay vì âm thầm pass. Cùng pattern với `tests/evidence-badge.test.ts:65`.
    const i = src.indexOf("slash.kind === 'tools'");
    expect(i, 'không tìm thấy nhánh xử lý /tools').toBeGreaterThan(-1);

    const slice = src.slice(i, i + 900);
    expect(slice).toMatch(/openSettings\('safety'\)/);
    expect(slice).not.toMatch(/openSettings\('chung'\)/);
  });
});

describe('Chế độ phê duyệt chỉ có MỘT nơi đổi trực quan (source-scan)', () => {
  const orch = fs.readFileSync(
    path.resolve(__dirname, '../react/use-chat-orchestration.ts'),
    'utf8',
  );
  const composer = fs.readFileSync(
    path.resolve(__dirname, '../components/composer.tsx'),
    'utf8',
  );

  it('đã xoá onCycleAutoPilot — không còn nút xoay vòng 4 chế độ', () => {
    // Đột biến bị chặn: dựng lại hàm xoay-vòng trong composer ⇒ phải nhấn 4 lần
    // mới tới chế độ muốn, lại nằm trong cụm `overflow-x-auto` nên bị cuộn mất,
    // và disable ở menu "Tác vụ" lại khác nút trên dải. Ô select ở Cài đặt ›
    // Quyền & An toàn là nơi duy nhất còn cần.
    expect(orch).not.toMatch(/onCycleAutoPilot/);
    expect(composer).not.toMatch(/onCycleAutoPilot/);
  });

  it('pill trên dải công cụ là read-only, trỏ về ô select trong Cài đặt', () => {
    // Vẫn phải đọc được "tôi đang ở chế độ nào" lúc chat, nhưng bấm vào không
    // đổi được nữa. `approvalHint` tái dùng làm `title` để hướng dẫn.
    expect(composer).toMatch(/approvalHint\(approvalPolicy, autoPilot\)/);
    expect(composer).toMatch(/Quyền & An toàn/);
  });

  it('GIỮ /mode — phím tắt bàn phím, khác modality chứ không phải bản trùng', () => {
    // Cố ý KHÔNG gỡ: `/mode` là lối vào bàn phím cho người dùng thành thạo.
    // Xoá nó là quyết định sản phẩm, không phải dọn code chết — và
    // `tests/boost-honesty.test.ts:56` dùng `if (slash.kind === 'mode') {` làm
    // delimiter nên xoá sẽ làm hỏng cả file test lúc collect.
    expect(orch).toMatch(/slash\.kind === 'mode'/);
  });

  it('không truyền autoPilot kèm approvalPolicy — store tự suy ra rồi ghi đè', () => {
    // `store.ts` tính `next.autoPilot` từ `approvalPolicy` và GHI ĐÈ giá trị
    // truyền vào, nên nhánh `/mode` chỉ cần gửi `approvalPolicy`.
    expect(orch).not.toMatch(/updateSettings\(\{\s*approvalPolicy:\s*'[a-z_]+',\s*autoPilot:/);
  });
});

describe('Slash Commands Engine (P2-10)', () => {
  it('định nghĩa đầy đủ 8 lệnh slash built-in chuẩn', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain('plan');
    expect(names).toContain('mode');
    expect(names).toContain('summarize');
    expect(names).toContain('recipe');
    expect(names).toContain('skills');
    expect(names).toContain('memory');
    expect(names).toContain('tools');
    expect(names).toContain('cost');
  });

  describe('normalizeModeParam', () => {
    it('ánh xạ chính xác các mode hợp lệ', () => {
      expect(normalizeModeParam('auto')).toBe('never');
      expect(normalizeModeParam('never')).toBe('never');
      expect(normalizeModeParam('smart')).toBe('smart');
      expect(normalizeModeParam('approve')).toBe('always');
      expect(normalizeModeParam('always')).toBe('always');
      expect(normalizeModeParam('manual')).toBe('always');
      expect(normalizeModeParam('chat')).toBe('chat_only');
      expect(normalizeModeParam('chat_only')).toBe('chat_only');
      expect(normalizeModeParam('invalid')).toBeNull();
    });
  });

  describe('parseSlashCommand', () => {
    it('parse /boost với mục tiêu', () => {
      const res = parseSlashCommand('/boost tối ưu hóa bundle Next.js');
      expect(res).toEqual({
        kind: 'boost',
        target: 'tối ưu hóa bundle Next.js',
      });
    });

    it('parse /plan với mục tiêu', () => {
      const res = parseSlashCommand('/plan tối ưu hóa bundle Next.js');
      expect(res).toEqual({
        kind: 'plan',
        target: 'tối ưu hóa bundle Next.js',
      });
    });

    it('parse /mode sang các chính sách', () => {
      expect(parseSlashCommand('/mode auto')).toEqual({ kind: 'mode', mode: 'never' });
      expect(parseSlashCommand('/mode smart')).toEqual({ kind: 'mode', mode: 'smart' });
      expect(parseSlashCommand('/mode approve')).toEqual({ kind: 'mode', mode: 'always' });
      expect(parseSlashCommand('/mode chat')).toEqual({ kind: 'mode', mode: 'chat_only' });
      expect(parseSlashCommand('/policy auto')).toEqual({ kind: 'mode', mode: 'never' });
    });

    it('parse /summarize và alias /compact', () => {
      expect(parseSlashCommand('/summarize')).toEqual({ kind: 'summarize' });
      expect(parseSlashCommand('/compact')).toEqual({ kind: 'summarize' });
    });

    it('parse /recipe <name>', () => {
      expect(parseSlashCommand('/recipe git-summary')).toEqual({
        kind: 'recipe',
        recipeName: 'git-summary',
      });
    });

    it('parse /skills, /memory, /tools, /cost và các alias', () => {
      expect(parseSlashCommand('/skills')).toEqual({ kind: 'skills' });
      expect(parseSlashCommand('/skill')).toEqual({ kind: 'skills' });
      expect(parseSlashCommand('/memory')).toEqual({ kind: 'memory' });
      expect(parseSlashCommand('/memories')).toEqual({ kind: 'memory' });
      expect(parseSlashCommand('/tools search')).toEqual({ kind: 'tools', query: 'search' });
      expect(parseSlashCommand('/cost')).toEqual({ kind: 'cost' });
      expect(parseSlashCommand('/tokens')).toEqual({ kind: 'cost' });
    });

    it('parse custom slash command theo map người dùng cấu hình', () => {
      const customMappings = {
        lint: 'recipe-fix-lint',
        test: 'recipe-run-tests',
      };

      const res1 = parseSlashCommand('/lint --verbose', customMappings);
      expect(res1).toEqual({
        kind: 'custom_recipe',
        recipeId: 'recipe-fix-lint',
        args: '--verbose',
      });

      const res2 = parseSlashCommand('/test', customMappings);
      expect(res2).toEqual({
        kind: 'custom_recipe',
        recipeId: 'recipe-run-tests',
        args: undefined,
      });
    });

    it('trả về null nếu không bắt đầu bằng /', () => {
      expect(parseSlashCommand('xin chào')).toBeNull();
      expect(parseSlashCommand('')).toBeNull();
    });

    it('trả về unknown nếu lệnh không nằm trong catalog', () => {
      const res = parseSlashCommand('/unknown-cmd foo bar');
      expect(res).toEqual({
        kind: 'unknown',
        command: 'unknown-cmd',
        raw: '/unknown-cmd foo bar',
      });
    });
  });
});
