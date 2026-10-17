/**
 * Chỉ mục tìm kiếm trong Cài đặt phải BÁM SỰ THẬT.
 *
 * `SETTINGS_SEARCH_ITEMS` là chỉ mục người dùng gõ vào. Một mục mô tả tính
 * năng không tồn tại thì tệ hơn không có mục nào: người dùng gõ "openai",
 * được dẫn tới ô không có, rồi tưởng mình chưa tìm kỹ.
 *
 * Không có test nào khoá số lượng hay nội dung mảng này trước đây
 * (`SETTINGS_SEARCH_ITEMS` chỉ xuất hiện ở `settings-tabs.ts:65` và
 * `settings-dialog.tsx:17,96`), nên sửa chỉ mục trước đây không có lưới an toàn.
 * File này là lưới đó.
 */

import { describe, it, expect } from 'vitest';
import {
  SETTINGS_TABS,
  SETTINGS_SEARCH_ITEMS,
  resolveSettingsTab,
} from '@/components/settings/settings-tabs';
import { TOOL_CATALOG } from '@/lib/tool-catalog';

describe('SETTINGS_SEARCH_ITEMS — mọi mục trỏ tới tab có thật', () => {
  const tabIds = new Set(SETTINGS_TABS.map((t) => t.id));

  it('không mục nào trỏ tới tab không tồn tại', () => {
    // Đột biến bị chặn: đổi `tab: 'data'` thành `'backup'` cho một mục → người
    // dùng bấm vào kết quả thì không có tab nào mở ra.
    for (const item of SETTINGS_SEARCH_ITEMS) {
      expect(tabIds.has(item.tab), `mục ${item.id} trỏ tab không có: ${item.tab}`).toBe(true);
    }
  });

  it('id không trùng nhau', () => {
    // React dùng `item.id` làm key của listbox; trùng id là khoá trùng.
    const ids = SETTINGS_SEARCH_ITEMS.map((i) => i.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `id trùng: ${dupes.join(', ')}`).toEqual([]);
  });

  it('mọi tab đều có ít nhất một mục tìm kiếm', () => {
    // Lưới an toàn: một tab không có mục nào là tab chỉ tìm được bằng cách cuộn.
    const covered = new Set(SETTINGS_SEARCH_ITEMS.map((i) => i.tab));
    for (const t of SETTINGS_TABS) {
      expect(covered.has(t.id), `tab ${t.id} chưa có mục tìm kiếm nào`).toBe(true);
    }
  });
});

describe('SETTINGS_SEARCH_ITEMS — không mô tả tính năng không tồn tại', () => {
  const texts = SETTINGS_SEARCH_ITEMS.map((i) => i.description);

  it('không hứa ô API key OpenAI riêng — preset đã bị gỡ có chủ đích', () => {
    // `lib/providers.ts:104-121` để lại `/* Seed — ĐÃ XOÁ */`: không còn provider
    // seed nào. `api.openai.com` chỉ còn là placeholder trong ô Base URL.
    //
    // CANH NGUYÊN VẤN ĐỀ ĐÚNG, KHÔNG PHẢI TỪ "openai": mục cũ `prov-openai` mô
    // tả ô nhập API key riêng cho OpenAI. Mô tả của `prov-byok` hợp lệ lại có
    // chữ "OpenAI" ("endpoint tương thích OpenAI, OpenRouter") — nên cấm mọi
    // chữ "openai" sẽ đỏ chính vì mục đúng. Vì thế:
    //   (a) không mục nào có CHỦ ĐỀ nhắc OpenAI, và
    //   (b) không mô tả nào hứa một ô riêng cho provider đó.
    const titles = SETTINGS_SEARCH_ITEMS.map((i) => i.title.toLowerCase());
    expect(
      titles.some((t) => t.includes('openai')),
      'có mục tìm kiếm nào hứa ô OpenAI riêng',
    ).toBe(false);

    const descriptions = SETTINGS_SEARCH_ITEMS.map((i) => i.description.toLowerCase());
    for (const d of descriptions) {
      expect(
        d,
        `mô tả hứa ô nhập key riêng: "${d}"`,
      ).not.toMatch(/api key openai|khóa openai chính gốc|openai qua api\.openai\.com/);
    }
  });

  it('không hứa số công cụ vượt quá catalog', () => {
    // `TOOL_CATALOG` chỉ có TOOL_CATALOG.length tool. Muốn vượt con số đó phải
    // có tool MCP từ server của chính người dùng. Bảng phân quyền in số thật lên
    // màn hình (`tool-permissions-table.tsx:189,318`) nên copy ghi sai số là
    // mâu thuẫn ngay trên cùng màn hình.
    expect(
      texts.some((t) => /\d+\s*\+/.test(t)),
      `copy hứa số công cụ dạng "N+" trong khi catalog chỉ có ${TOOL_CATALOG.length}`,
    ).toBe(false);
  });

  it('không nhắc Mixture-of-Models — tính năng đã bị gỡ khỏi Settings', () => {
    // Model Chains không bao giờ được gửi lên server nên đã gỡ UI + state
    // (commit 2092fcf). Copy còn nhắc nó là người dùng đi tìm không thấy.
    for (const t of texts) {
      expect(t.toLowerCase(), `copy còn nhắc Mixture-of-Models: "${t}"`).not.toMatch(/mixture/);
    }
  });
});

describe('SETTINGS_SEARCH_ITEMS — các tính năng quan trọng đều tìm được', () => {
  const ids = new Set(SETTINGS_SEARCH_ITEMS.map((i) => i.id));

  it('có mục cho các tính năng sau', () => {
    // Đột biến bị chặn: xoá một dòng trong danh sách này → đỏ.
    // Đặc biệt `mem-zeromem`: toggle MẶC ĐỊNH TẮT điều khiển việc ghi vào
    // IndexedDB của người dùng — không tìm được thì không bật được.
    const REQUIRED = [
      'mem-zeromem',
      'safety-audit',
      'safety-mcpgrants',
      'data-storage',
    ] as const;
    for (const id of REQUIRED) {
      expect(ids.has(id), `thiếu mục tìm kiếm: ${id}`).toBe(true);
    }
  });

  it('gõ "openai" vẫn rơi đúng chỗ qua keywords của mục BYOK', () => {
    // Thay vì giữ một mục bịa riêng, từ khoá "openai" phải nằm trong mục BYOK
    // để người dùng gõ ra đúng nơi có thật.
    //
    // Lọc trên MẢNG ITEM rồi mới lấy `id` — dựng `haystacks` rồi lọc chuỗi
    // thì mất `id` và không kiểm được mục nào thắng (đã xảy ra một lần).
    const hits = SETTINGS_SEARCH_ITEMS.filter((i) =>
      `${i.title} ${i.description} ${i.keywords}`.toLowerCase().includes('openai'),
    );
    expect(
      hits.map((i) => i.id),
      'đúng một mục chứa từ khoá openai, và phải là BYOK',
    ).toEqual(['prov-byok']);
  });
});

describe('resolveSettingsTab', () => {
  const ids = SETTINGS_TABS.map((t) => t.id);

  it('mọi id tab hiện hành trả về chính nó', () => {
    for (const id of ids) {
      expect(resolveSettingsTab(id), `tab ${id} phải giữ nguyên`).toBe(id);
    }
  });

  it('không xác định thì về appearance', () => {
    expect(resolveSettingsTab(undefined)).toBe('appearance');
    expect(resolveSettingsTab('khong-ton-tai')).toBe('appearance');
  });

  it('alias cũ đã dọn — mọi khoá legacy về appearance', () => {
    // 10 nhánh `case` cũ: 3 alias còn được gọi, 2 trùng id (no-op), 5 không ai
    // truyền. Đã rút gọn còn một kiểm tra `SETTINGS_TABS.some(...)`.
    // Lập luận "tương thích ngược" là sai: `settingsInitialTab` KHÔNG được
    // persist (`partialize` không có nó) và bị xoá khi đóng Settings, nên không
    // có dữ liệu phiên cũ nào mang khoá cũ.
    const LEGACY = [
      'chung',
      'provider',
      'routing',
      'tools',
      'skills',
      'prompts',
      'stats',
      'schedules',
    ] as const;
    for (const k of LEGACY) {
      expect(resolveSettingsTab(k), `alias cũ ${k} chưa dọn`).toBe('appearance');
    }
  });
});