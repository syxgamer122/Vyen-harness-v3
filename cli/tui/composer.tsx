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
    <box flexDirection="column" backgroundColor={theme.bg} paddingLeft={2} paddingRight={2}>
      {status ? (
        <box flexDirection="row">
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
