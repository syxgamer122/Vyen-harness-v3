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
/** Số dòng mô tả tối đa hiện trong hộp — lệnh dài 20 dòng thì hộp nuốt cả màn hình. */
const MAX_DONG_MOTA = 6;

export function ApprovalDialog({
  request,
}: {
  request: ApprovalRequest;
}): React.ReactNode {
  const dong = request.moTa.split('\n');
  const xem = dong.slice(0, MAX_DONG_MOTA);
  const biCat = dong.length > MAX_DONG_MOTA;
  return (
    <box
      flexDirection="column"
      /* KHÔNG đặt chiều cao cứng: mô tả lệnh dài bao nhiêu dòng tuỳ lệnh, và
       * chiều cao cứng sẽ **cắt dòng đầu** (tiêu đề "duyệt tool" biến mất —
       * đo. `flexShrink={0}` để hộp KHÔNG bị bóp khi transcript
       * chiếm chỗ. */
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={theme.warning}
      backgroundColor={theme.surface}
      padding={1}
    >
      <text fg={theme.warning}>duyệt tool</text>
      {xem.map((d, i) => (
        <text key={i} fg={theme.text}>
          {d}
        </text>
      ))}
      {biCat ? <text fg={theme.muted}>…</text> : null}
      <text fg={theme.muted}>
        Chạy &quot;{request.tool}&quot;? [y/N]
      </text>
    </box>
  );
}
