/**
 * Hạng mục công việc và receipt định tuyến.
 *
 * File này TỪNG là engine Mixture-of-Models: mỗi hạng mục ánh xạ sang một chuỗi
 * dự phòng `{ model, effort }` mà người dùng khai ở Cài đặt. Toàn bộ phần đó đã
 * bị gỡ 2026-10-16 — `customChains` không bao giờ được client gửi lên server, và
 * ngay cả khi gửi thì `model` luôn khác rỗng nên nhánh route theo chuỗi không
 * bao giờ chạy. Xem `docs/superpowers/plans/2026-10-16-settings-dead-code-phase2.md`.
 *
 * CÒN LẠI và vẫn dùng: hệ hạng mục là hợp đồng dữ liệu cho badge ở
 * `components/hud/agent-hud.tsx` (nhãn tiếng Việt + mô tả) và cho `scoreRequest`
 * (`lib/routing/score-request.ts`) gán hạng mục cho mỗi lượt.
 */

import type { Effort } from '@/lib/model-contracts';

export type CategoryId =
  | 'ultrabrain'
  | 'deep'
  | 'architect'
  | 'capable'
  | 'quick'
  | 'writing'
  | 'visual-engineering'
  | 'simple-work';

export interface ChainEntry {
  model: string;
  effort: Effort;
}

export interface RouteReceipt {
  category: CategoryId;
  selected: ChainEntry;
  signals: string[];
}

export const CATEGORY_DESCRIPTIONS: Record<CategoryId, { label: string; description: string }> = {
  ultrabrain: {
    label: 'Ultrabrain',
    description: 'Bài toán hóc búa, suy luận tối đa, giải thuật phức tạp',
  },
  architect: {
    label: 'Kiến trúc',
    description: 'Thiết kế hệ thống, sửa nhiều file, chế độ lập kế hoạch',
  },
  deep: {
    label: 'Suy luận sâu',
    description: 'Tìm nguyên nhân gốc rễ, logic và toán học, phân tích lỗi',
  },
  capable: {
    label: 'Năng lực chuẩn',
    description: 'Lập trình thông thường, giải quyết tính năng cân bằng',
  },
  quick: {
    label: 'Nhanh',
    description: 'Sửa lỗi nhỏ, đổi tên 1 file, phản hồi tức thì',
  },
  writing: {
    label: 'Viết tài liệu',
    description: 'Viết README, tài liệu, dịch thuật, giải thích văn xuôi',
  },
  'visual-engineering': {
    label: 'Giao diện & Mỹ thuật',
    description: 'CSS, Tailwind, bố cục, component giao diện, soi bằng mắt',
  },
  'simple-work': {
    label: 'Tác vụ đơn giản',
    description: 'Kiểm tra cú pháp, format văn bản, tác vụ phụ trợ nhẹ nhất',
  },
};

export const ALL_CATEGORIES: readonly CategoryId[] = [
  'ultrabrain',
  'deep',
  'architect',
  'capable',
  'quick',
  'writing',
  'visual-engineering',
  'simple-work',
] as const;