/** @jsxImportSource @opentui/react */
import React from 'react';
import { theme } from './theme.ts';
import { Header } from './header.tsx';
import { Transcript } from './transcript.tsx';
import { Composer } from './composer.tsx';
import { ApprovalDialog } from './approval.tsx';
import { Footer } from './footer.tsx';
import type { Block } from './blocks.ts';
import type { ApprovalRequest } from '../approval-broker.ts';

export interface AppProps {
  workspace: string;
  modelLabel: string;
  windowTokens: number;
  tokens: number | null;
  blocks: Block[];
  /** Lượt đang chạy. */
  running: boolean;
  /** Lời hỏi duyệt đang chờ (nếu có). */
  approval?: ApprovalRequest;
  onSubmit: (text: string) => void;
}

/**
 * Màn hình TUI: header · transcript · (hộp duyệt) · ô nhập · footer.
 *
 * ============ VÌ SAO KHÔNG `useKeyboard` Ở ĐÂY ============
 *
 * `useKeyboard` là **toàn cục**: nó nhận phím bất kể ô nhập có focus hay không.
 * Nếu App dùng nó để trả lời hộp duyệt, thì phím Esc được **hai** người nghe:
 * App (trả lời "không") và store (cắt lượt). App đăng ký trước (lúc mount) ⇒ nó
 * gỡ lời hỏi khỏi hàng đợi ⇒ store thấy "không còn lời hỏi" ⇒ **cắt lượt**.
 * Đo 2026-10-21 (review độc lập): Esc trong hộp duyệt vừa từ chối tool vừa
 * cắt lượt ⇒ mất câu trả lời của model.
 *
 * ⇒ **Store làm chủ phím** (một listener duy nhất, đăng ký lúc khởi tạo store);
 * App chỉ vẽ.
 *
 * ============ VÌ SAO BLUR KHI ĐANG CHẠY ============
 *
 * Gõ phím lúc lượt đang chạy sẽ chen vào dòng đang gõ ⇒ người dùng tưởng lỗi.
 * Blur làm phím gõ không vào đâu cả, và trạng thái "đang chạy" đã nói rõ ở dòng
 * trạng thái.
 */
export function App(props: AppProps): React.ReactNode {
  const trangThai = props.approval
    ? 'chờ bạn quyết'
    : props.running
      ? `đang chạy · ${props.modelLabel}`
      : `chat · ${props.modelLabel}`;

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
      <Header
        workspace={props.workspace}
        tokens={props.tokens}
        windowTokens={props.windowTokens}
      />
      {/* Hộp duyệt đứng NGAY DƯỚI header — không phải overlay tuyệt đối.
          *
          * Lý do : bố cục cột của terminal không cắt hộp con theo
          * kiểu web — hộp duyệt nằm cuối cột bị **bóp** mất dòng tiêu đề khi
          * transcript chiếm chỗ. Đặt nó lên trên thì nó luôn hiện đủ, còn
          * transcript là phần co giãn (flexShrink + minHeight 0) nên nhường chỗ
          * khi terminal thấp. */}
      {props.approval ? <ApprovalDialog request={props.approval} /> : null}
      <Transcript blocks={props.blocks} />
      <Composer
        focused={!props.approval && !props.running}
        onSubmit={props.onSubmit}
        status={trangThai}
      />
      <Footer />
    </box>
  );
}
