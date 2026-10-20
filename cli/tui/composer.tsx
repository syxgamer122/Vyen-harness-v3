/** @jsxImportSource @opentui/react */
import React, { useRef } from 'react';
import { theme } from './theme.ts';

export interface ComposerProps {
  /** Ô nhập có nhận phím không. */
  focused: boolean;
  /** Gửi một dòng (đã trim, đã bỏ rỗng). */
  onSubmit: (text: string) => void;
  /** Dòng trạng thái ngay trên ô nhập. */
  status?: string;
  placeholder?: string;
}

/**
 * Ô nhập + dòng trạng thái.
 *
 * ============ VÌ SAO GHI ĐÈ PHÍM ENTER ============
 *
 * Mặc định của OpenTUI: Enter = xuống dòng, Meta+Enter = gửi. Với CLI thì
 * ngược lại: Enter = gửi (người dùng gõ một câu rồi Enter), Shift+Enter =
 * xuống dòng (viết câu nhiều dòng). Nên phải ghi đè.
 */
export function Composer({
  focused,
  onSubmit,
  status,
  placeholder = 'gõ câu hỏi…',
}: ComposerProps): React.ReactNode {
  const ref = useRef<{ plainText: string; setText: (t: string) => void } | null>(null);

  return (
    <box
      flexDirection="column"
      /* KHÔNG co: ô nhập + dòng trạng thái là phần **cố định** của màn hình.
       * Đo 2026-10-21 (review độc lập): khi cột bị bóp, ô nhập và dòng trạng
       * thái rơi vào **cùng hàng** và textarea vẽ đè lên dòng trạng thái ⇒
       * dòng trạng thái (chỗ duy nhất nói "đang chạy") biến mất. Transcript
       * mới là phần co lại được. */
      flexShrink={0}
      backgroundColor={theme.bg}
      paddingLeft={2}
      paddingRight={2}
    >
      {status ? (
        <box flexDirection="row" height={1}>
          <text fg={theme.accent}>▎ </text>
          <text fg={theme.muted}>{status}</text>
        </box>
      ) : null}
      <textarea
        id="composer"
        ref={ref as never}
        focused={focused}
        placeholder={placeholder}
        backgroundColor={theme.bg}
        textColor={theme.text}
        keyBindings={[
          { name: 'return', action: 'submit' },
          { name: 'return', shift: true, action: 'newline' },
        ]}
        onSubmit={() => {
          const raw = ref.current?.plainText ?? '';
          const dong = raw.trim();
          /* Xoá ô TRƯỚC khi gọi `onSubmit`: nếu callback làm lỗi, người dùng
             không mất dòng đã gõ. */
          ref.current?.setText('');
          if (dong) onSubmit(dong);
        }}
      />
    </box>
  );
}
