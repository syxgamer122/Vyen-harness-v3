/** @jsxImportSource @opentui/react */
import React from 'react';
import { theme } from './theme.ts';

export interface HeaderProps {
  /** Tên thư mục làm việc — người dùng nhìn thấy mình đang ở đâu. */
  workspace: string;
  /** Token đã dùng; `null` = chưa có lượt nào. */
  tokens: number | null;
  /** Cửa sổ ngữ cảnh của model — để thấy còn bao nhiêu chỗ. */
  windowTokens: number;
}

/**
 * Dải trên cùng: tên + mức dùng ngữ cảnh.
 *
 * ============ VÌ SAO KHÔNG ĐỂ CON SỐ TOKEN Ở ĐÂY ============
 *
 * Token là thứ người dùng **phải** đọc để quyết định (còn nén được không), nên
 * nó được đặt chỗ dễ thấy, và luôn đi kèm **ngữ cảnh còn lại** — một con số
 * token trần không nói được bao nhiêu phần trăm còn lại.
 */
export function Header({ workspace, tokens, windowTokens }: HeaderProps): React.ReactNode {
  const pct =
    tokens === null || windowTokens <= 0 ? 0 : Math.min(100, Math.round((tokens / windowTokens) * 100));
  const so = tokens === null ? '--' : tokens.toLocaleString('en-US');
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      height={3}
      paddingLeft={1}
      paddingRight={1}
      border
      borderStyle="rounded"
      borderColor={theme.border}
      backgroundColor={theme.bg}
    >
      <text fg={theme.text}># vyen · {workspace}</text>
      <text fg={theme.muted}>
        {so} tok · {pct}%
      </text>
    </box>
  );
}
