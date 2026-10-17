'use client';

import React from 'react';
import { describeEvidence, type EvidenceLevel } from '@/lib/evidence';
import { CheckCircle2, Play, AlertTriangle, XCircle, Circle } from 'lucide-react';

interface EvidenceBadgeProps {
  level?: EvidenceLevel | string;
  className?: string;
}

/**
 * Thang bằng chứng là CHÚ THÍCH, không phải đối tượng chính.
 *
 * Nó nói mức độ tin cậy của câu trả lời, nên phải đọc được mà không cạnh
 * tranh sự chú ý với chính câu trả lời. Vì vậy badge KHÔNG có nền và KHÔNG có
 * viền: màu chữ + hình icon là toàn bộ tín hiệu. (Bản cũ vẽ viền + nền alpha
 * cho từng variant — mỗi badge là một ô màu nhỏ, cộng dồn lại đúng cái hiện
 * tượng "mọi thứ đều là thẻ" mà bản retoken này đang gỡ.)
 *
 * Sắc độ vẫn phải phân biệt được: chỉ `running`/`verified` được nổi lên
 * (`text-secondary` + medium), còn lại đều lùi về `text-tertiary` vì chúng
 * là thông tin nền.
 *
 * CỠ CHỮ: badge nói mức bằng chứng — thứ người đọc phải quyết định có tin
 * câu trả lời hay không — nên nó KHÔNG được ở `micro` (10px). §15.3 điểm 12
 * viết thẳng: "thứ người dùng phải đọc để quyết định không được nằm ở `micro`
 * hay `meta`". Nó đi `text-meta` (12px) ở mọi nơi: các bậc cỡ cũ đã bị xoá
 * cùng prop `size` không còn call site nào truyền.
 */
const toneStyles: Record<string, string> = {
  default: 'text-tertiary',
  running: 'text-accent animate-pulse',
  warning: 'text-tertiary',
  success: 'text-secondary font-medium',
  danger: 'text-danger',
};

export function EvidenceBadge({ level = 'prepared', className = '' }: EvidenceBadgeProps) {
  const safeLevel: EvidenceLevel =
    level === 'prepared' ||
    level === 'running' ||
    level === 'reported_done' ||
    level === 'verified' ||
    level === 'blocked' ||
    level === 'failed'
      ? level
      : 'prepared';

  const info = describeEvidence(safeLevel);
  const toneClass = toneStyles[info.variant] ?? toneStyles.default;

  return (
    <span
      className={`inline-flex items-center gap-1 font-sans text-meta ${toneClass} ${className}`}
      title={`Mức bằng chứng: ${info.badgeText}`}
    >
      {safeLevel === 'verified' && <CheckCircle2 className="h-3 w-3 flex-shrink-0" />}
      {safeLevel === 'running' && <Play className="h-3 w-3 flex-shrink-0" />}
      {safeLevel === 'reported_done' && <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
      {safeLevel === 'prepared' && <Circle className="h-2.5 w-2.5 flex-shrink-0" />}
      {(safeLevel === 'blocked' || safeLevel === 'failed') && <XCircle className="h-3 w-3 flex-shrink-0" />}
      <span>{info.badgeText}</span>
    </span>
  );
}
