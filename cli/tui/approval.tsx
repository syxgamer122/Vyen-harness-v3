/** @jsxImportSource @opentui/react */
import React from 'react';
import { theme } from './theme.ts';
import type { ApprovalRequest } from '../approval-broker.ts';

/**
 * Hộp duyệt tool.
 *
 * ============ VÌ SAO CHỮ ĐƯỢC CHỮ, KHÔNG CHỈ MÀU ============
 *
 * Mặc định là **KHÔNG**: người dùng phải gõ `y` mới chạy. Vậy nên hộp này phải
 * nói rõ (1) sắp làm gì, (2) ảnh hưởng ra sao, (3) trả lời thế nào — và màu
 * vàng chỉ là lớp thứ ba, không phải lớp duy nhất (DESIGN.md §2.4).
 */
export function ApprovalDialog({
  request,
}: {
  request: ApprovalRequest;
}): React.ReactNode {
  return (
    <box
      flexDirection="column"
      /* Chiều cao CỐ ĐỊNH + không co: đo 2026-10-20 — để Yoga tự tính thì hộp bị
       * bóp mất dòng tiêu đề khi transcript chiếm chỗ (dòng tiêu đề biến mất,
       * còn dòng nhắc bị dính liền). Hộp duyệt phải luôn hiện **đủ**. */
      height={7}
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={theme.warning}
      backgroundColor={theme.surface}
      padding={1}
    >
      <text fg={theme.warning}>duyệt tool</text>
      <text fg={theme.text}>{request.moTa}</text>
      <text fg={theme.muted}>
        Chạy &quot;{request.tool}&quot;? [y/N]
      </text>
    </box>
  );
}
