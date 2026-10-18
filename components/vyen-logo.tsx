/*
 * Logo Vyen — nguồn duy nhất cho dấu hiệu thương hiệu Vyen.
 *
 * Hình não–đám mây có mặt, dựng lại từ ảnh nguồn `brand/logo-source.png`
 * (2048×2048, logo chiếm 1516×1331 px). MỌI HẰNG SỐ DƯỚI ĐÂY ĐỀU ĐO TỪ ẢNH —
 * xem `brand/README.md` cho công thức và giá trị gốc. Không có số nào ở đây là
 * ước lượng bằng mắt.
 *
 * Cấu túc bốn dải, đo từ ngoài vào (ở đường ngang qua giữa):
 *   viền 17px → xanh 65px → mint 89px → xanh 65px → trắng
 * Chuyển màu chạy NGANG: sáng bên trái, tối bên phải.
 *
 * Màu thì LẤY NGUYÊN từ `mark.json` — file này không khai lại, để tránh có hai
 * nơi định nghĩa cùng một màu. Muốn đổi thì sửa `mark.json` rồi
 * `npm run icons:build`.
 *
 * viewBox 34×34 giống bản trước: ảnh gốc không vuông (1.139:1), nên khung vuông
 * để hình tự khoảng trống đều hai bên thay vì mép chạm mép.
 */
import React, { useId } from 'react';
import mark from '@/brand/mark.json';

/**
 * Bảng màu đo từ ảnh. Tên khớp `PALETTE_TOKENS` trong `tests/design-system.test.ts`.
 *
 * `mint` và `link` chỉ dùng làm nấc chuyển màu, không làm chữ: mint sáng 1.1:1,
 * `link` 3.2:1 — dưới ngưỡng 4.5:1. `face` 5.2:1 và `ring` 5.6:1 đạt AA nên dùng
 * cho mắt/miệng và viền ngoài.
 *
 * Sửa màu ở `brand/mark.json`, KHÔNG sửa ở đây — `scripts/build-icons.cjs` đọc
 * cùng file đó để sinh icon ngoài app, nên sửa một bên là lệch.
 */
const { ringTop, ringBot, greenTop, greenBot, mintTop, mintBot, faceTop, faceBot, linkEye, linkIn, mouth } =
  mark.palette;

/** Đường viền não–đám mây. Logo trong ảnh: x 3.87→30.13, y 5.56→29.83. */
const CLOUD = mark.cloud;

/**
 * Thang co 5 bản sao của CLOUD, từ ngoài vào.
 *
 * Đây là THU NHỎ đồng dạng, không phải offset thật — nên khía lõm ở bốn cạnh bị
 * kéo vào trong nhiều hơn ảnh gốc một chút. Chấp nhận được ở cỡ 24px trở lên;
 * muốn khớp tuyệt đối thì phải vẽ tay bốn đường viền lồng nhau.
 */
const BANDS = mark.bands;

const F = mark.face;
const EYE_Y = F.eyeY;
const EYE_R = F.eyeR;
const MOUTH_Y = F.mouthY;

/** Hộp toạ độ gradient của bốn dải — chạy chéo khung logo như ảnh gốc. */
const DIAG = {
  x1: mark.logoBox.x,
  y1: mark.logoBox.y,
  x2: mark.logoBox.x + mark.logoBox.w,
  y2: mark.logoBox.y + mark.logoBox.h,
};

export interface VyenMarkProps {
  size?: number;
  className?: string;
}

/** Dấu hiệu thương hiệu Vyen — một mình, không wordmark. */
export function VyenMark({ size = 16, className }: VyenMarkProps) {
  /*
   * `useId` vì một trang có thể render nhiều `VyenMark` (sidebar + màn trống +
   * màn hình lỗi). ID gradient trùng nhau là HTML sai dù trông vẫn đúng — nên
   * sinh ID duy nhất cho từng bản dựng.
   */
  const uid = useId().replace(/:/g, '');
  const g = (n: string) => `${uid}-${n}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        {/*
         * Gradient khai theo TOẠ ĐỘ ẢNH, không theo bbox.
         *
         * Bắt buộc cho `linkL`/`linkR`: vạch nối mắt là đường nằm ngang nên
         * bbox cao bằng 0, và gradient `objectBoundingBox` trên bbox rỗng không
         * sinh ra gì — hai vạch biến mất im lặng, phần còn lại vẫn đúng.
         */}
        <linearGradient id={g('ring')} gradientUnits="userSpaceOnUse" {...DIAG}>
          <stop offset="0" stopColor={ringTop} />
          <stop offset="1" stopColor={ringBot} />
        </linearGradient>
        <linearGradient id={g('green')} gradientUnits="userSpaceOnUse" {...DIAG}>
          <stop offset="0" stopColor={greenTop} />
          <stop offset="1" stopColor={greenBot} />
        </linearGradient>
        <linearGradient id={g('mint')} gradientUnits="userSpaceOnUse" {...DIAG}>
          <stop offset="0" stopColor={mintTop} />
          <stop offset="1" stopColor={mintBot} />
        </linearGradient>
        <linearGradient id={g('face')} gradientUnits="userSpaceOnUse" {...DIAG}>
          <stop offset="0" stopColor={faceTop} />
          <stop offset="1" stopColor={faceBot} />
        </linearGradient>
        <linearGradient
          id={g('linkL')}
          gradientUnits="userSpaceOnUse"
          x1={F.leftEyeX}
          y1={F.eyeY}
          x2={F.leftLinkEndX}
          y2={F.eyeY}
        >
          <stop offset="0" stopColor={linkEye} />
          <stop offset="1" stopColor={linkIn} />
        </linearGradient>
        <linearGradient
          id={g('linkR')}
          gradientUnits="userSpaceOnUse"
          x1={F.rightEyeX}
          y1={F.eyeY}
          x2={F.rightLinkEndX}
          y2={F.eyeY}
        >
          <stop offset="0" stopColor={linkEye} />
          <stop offset="1" stopColor={linkIn} />
        </linearGradient>
      </defs>

      {BANDS.map((s, i) => (
        <path
          key={i}
          d={CLOUD}
          fill={mark.bandFills[i] === 'white' ? '#FFFFFF' : `url(#${g(mark.bandFills[i])})`}
          transform={`translate(17 17) scale(${s}) translate(-17 -17)`}
        />
      ))}

      {/* Mặt: vạch nối mắt (tối ở mắt → sáng ở đầu trong), mắt, rồi miệng */}
      <path d={`M ${F.leftEyeX} ${EYE_Y} H ${F.leftLinkEndX}`} stroke={`url(#${g('linkL')})`} strokeWidth={F.linkWidth} strokeLinecap="round" />
      <path d={`M ${F.rightEyeX} ${EYE_Y} H ${F.rightLinkEndX}`} stroke={`url(#${g('linkR')})`} strokeWidth={F.linkWidth} strokeLinecap="round" />
      <circle cx={F.leftEyeX} cy={EYE_Y} r={EYE_R} fill={`url(#${g('face')})`} />
      <circle cx={F.rightEyeX} cy={EYE_Y} r={EYE_R} fill={`url(#${g('face')})`} />
      <path d={`M ${F.mouthLeftX} ${MOUTH_Y} H ${F.mouthRightX}`} stroke={mouth} strokeWidth={F.mouthWidth} strokeLinecap="round" />
      <circle cx={F.mouthLeftX} cy={MOUTH_Y} r={F.mouthDotR} fill={mouth} />
      <circle cx={F.mouthRightX} cy={MOUTH_Y} r={F.mouthDotR} fill={mouth} />
    </svg>
  );
}

export interface VyenLogoProps {
  /** `sm` cho sidebar, `lg` cho empty state. */
  size?: 'sm' | 'lg';
}

/** Dấu hiệu + wordmark, dùng ở sidebar và trạng thái rỗng. */
export function VyenLogo({ size = 'sm' }: VyenLogoProps) {
  const isLarge = size === 'lg';

  /*
   * Bản `lg` CHỈ dựng mark + wordmark, không mang câu tự giới thiệu.
   *
   * Trước đây nó in thêm tagline ở đây, và màn trống (`message-list.tsx`) lại in
   * một câu nữa ngay bên dưới — hai câu cách nhau 24px, và chúng mâu thuẫn: câu
   * trong logo gọi app là "chat AI và coding agent", câu ngoài gọi là "agent
   * harness". Câu tự giới thiệu thuộc về MÀN HÌNH, không thuộc về component
   * thương hiệu: để trong logo thì mọi nơi gọi `lg` đều bị in thêm một câu.
   */
  return (
    <div className={isLarge ? 'flex flex-col items-center' : 'flex items-center gap-2.5'}>
      <div
        className={
          isLarge
            ? 'relative flex h-24 w-24 items-center justify-center'
            : 'relative flex h-9 w-9 items-center justify-center'
        }
      >
        <VyenMark size={isLarge ? 88 : 26} />
      </div>
      {isLarge ? (
        <div className="mt-5">
          <span className="uic text-[32px] font-bold tracking-[0.05em] text-text-primary">Vyen</span>
        </div>
      ) : (
        <div className="leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="uic text-[16px] font-bold tracking-[0.05em] text-text-primary">Vyen</span>
            <span className="rounded-full border border-subtle bg-raised px-2 py-0.5 uic text-micro uppercase tracking-[0.08em] text-accent">
              v0.1
            </span>
          </div>
          <div className="uic text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
            AI Innovations
          </div>
        </div>
      )}
    </div>
  );
}