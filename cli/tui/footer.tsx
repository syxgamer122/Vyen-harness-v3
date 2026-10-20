/** @jsxImportSource @opentui/react */
import React from 'react';
import { theme } from './theme.ts';

/**
 * Dải gợi ý phím ở đáy.
 *
 * Màu `faint` — đây là thông tin phụ, không được giành mắt người dùng.
 */
export function Footer(): React.ReactNode {
  return (
    <box paddingLeft={2} paddingRight={2} height={1} backgroundColor={theme.bg}>
      <text fg={theme.faint}>esc dừng · /new phiên mới · /compact nén · ctrl+c thoát</text>
    </box>
  );
}
