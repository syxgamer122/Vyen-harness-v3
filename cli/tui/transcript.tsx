/** @jsxImportSource @opentui/react */
import React from 'react';
import { theme } from './theme.ts';
import type { Block } from './blocks.ts';

/**
 * Vùng nội dung cuộn được, bám đáy.
 *
 * `stickyScroll` + `stickyStart="bottom"`: transcript luôn dính đáy khi có nội
 * dung mới — đúng như OpenCode và như mọi chat: bạn muốn thấy **mới nhất**.
 */
export function Transcript({ blocks }: { blocks: Block[] }): React.ReactNode {
  return (
    <scrollbox
      flexGrow={1}
      /* `flexShrink` + `minHeight: 0`: transcript là phần **co lại được** khi
       * terminal thấp (hoặc khi hộp duyệt xuất hiện) — mặc định của Yoga là
       * không co, nên nó sẽ đẩy các phần khác ra khỏi màn hình. */
      flexShrink={1}
      minHeight={0}
      stickyScroll
      stickyStart="bottom"
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={theme.bg}
    >
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </scrollbox>
  );
}

/** Ký hiệu trạng thái tool — luôn có CHỮ, không chỉ màu (WCAG + DESIGN.md §2.4). */
function BlockView({ block }: { block: Block }): React.ReactNode {
  if (block.kind === 'user') {
    return (
      <box flexDirection="row">
        <text fg={theme.accent}>▎ </text>
        <text fg={theme.text}>{block.text}</text>
      </box>
    );
  }

  if (block.kind === 'assistant') {
    return <text fg={theme.text}>{block.text}</text>;
  }

  if (block.kind === 'note') {
    const mau =
      block.level === 'error' ? theme.error : block.level === 'warn' ? theme.warning : theme.muted;
    return <text fg={mau}>{block.text}</text>;
  }

  /* Tool: ký hiệu + nhãn + chi tiết. Màu KHÔNG mang trạng thái một mình — ký
     hiệu mới mang (và màu chỉ nhấn mạnh). */
  const ky = block.status === 'ok' ? '✓' : block.status === 'error' ? '✗' : '*';
  const mau = block.status === 'error' ? theme.error : theme.accent;
  return (
    <box flexDirection="row">
      <text fg={mau}>{ky} </text>
      <text fg={theme.text}>{block.label}</text>
      <text fg={theme.muted}>  {block.detail}</text>
    </box>
  );
}
