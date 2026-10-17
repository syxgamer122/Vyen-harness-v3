/*
 * Logo Vyen — nguồn duy nhất cho dấu hiệu thương hiệu Vyen.
 *
 * Hình dạng bám theo ảnh logo mới: não–đám mây vẽ bằng 3 vòng nồng tâm,
 * mỗi vòng lùi vào trong và đậm dần. Mặt (2 mắt + miệng) nằm ở tâm bằng
 * xanh xỉ nhất.
 *
 * viewBox 34x34 thay vì 32x32: ảnh gốc có tỉ lệ 1362x1186 px (1.1484), không
 * vuông. Khung vuông 34x34 giữ đúng tỉ lệ đó; `size` vẫn là cạnh vuông nên
 * hình chiếm 27.6x24.03 đơn vị, tự để lại lề đều hai bên.
 */
import React from 'react';

/**
 * Bảng màu lấy từ ảnh logo mới (đo từ pixel, không ước lượng).
 *
 * `LIME` chỉ để trang trí — 1.9:1 trên trắng, không dùng làm chữ hay viền.
 * `DARK` 3.4:1 và `FACE` 5.4:1 nên đạt ngưỡng 3:1 cho vật thể đồ hoạ.
 * Cả bốn khai ở `PALETTE_TOKENS` của `tests/design-system.test.ts` — hợp
 * đồng bắt mọi hex trong component phải nằm trong bảng màu §2.
 */
const LIME = '#7ce652';
const MID = '#5abf5a';
const DARK = '#126644';
const FACE = '#114f36';

/** Ba vòng nồng tâm, ngoài → trong. */
const RINGS = [
  { d: 'M 17 7.19 C 19.31 6.2 21.2 5.56 23.51 5.56 C 27.09 5.56 30.13 8.72 30.13 13.34 C 30.13 16.18 28.77 18.28 27.72 19.33 C 26.67 20.06 26.67 20.69 27.72 21.43 C 28.77 22.48 29.61 24.26 28.56 26.37 C 27.3 28.78 24.88 29.83 21.73 29.83 C 19.63 29.83 18.26 29.1 17 27.84 C 15.74 29.1 14.37 29.83 12.27 29.83 C 9.12 29.83 6.7 28.78 5.44 26.37 C 4.39 24.26 5.23 22.48 6.28 21.43 C 7.33 20.69 7.33 20.06 6.28 19.33 C 5.23 18.28 3.87 16.18 3.87 13.34 C 3.87 8.72 6.91 5.56 10.49 5.56 C 12.8 5.56 14.69 6.2 17 7.67 Z', width: 1.34, color: DARK },
  { d: 'M 17 7.19 C 19.01 7.59 20.66 7.05 22.67 7.05 C 25.78 7.05 28.43 9.79 28.43 13.81 C 28.43 16.28 27.24 18.11 26.33 19.03 C 25.41 19.67 25.41 20.21 26.33 20.86 C 27.24 21.77 27.97 23.32 27.06 25.15 C 25.96 27.26 23.86 28.17 21.12 28.17 C 19.29 28.17 18.1 27.53 17 26.43 C 15.9 27.53 14.71 28.17 12.88 28.17 C 10.14 28.17 8.04 27.26 6.94 25.15 C 6.03 23.32 6.76 21.77 7.67 20.86 C 8.59 20.21 8.59 19.67 7.67 19.03 C 6.76 18.11 5.57 16.28 5.57 13.81 C 5.57 9.79 8.22 7.05 11.33 7.05 C 13.34 7.05 14.99 7.59 17 8.87 Z', width: 2.06, color: LIME },
  { d: 'M 17 7.19 C 18.6 9.54 19.9 9.11 21.5 9.11 C 23.96 9.11 26.06 11.28 26.06 14.47 C 26.06 16.43 25.12 17.88 24.4 18.61 C 23.67 19.11 23.67 19.55 24.4 20.06 C 25.12 20.78 25.7 22.01 24.98 23.46 C 24.11 25.13 22.44 25.86 20.26 25.86 C 18.81 25.86 17.87 25.35 17 24.48 C 16.13 25.35 15.19 25.86 13.74 25.86 C 11.56 25.86 9.89 25.13 9.02 23.46 C 8.3 22.01 8.88 20.78 9.6 20.06 C 10.33 19.55 10.33 19.11 9.6 18.61 C 8.88 17.88 7.94 16.43 7.94 14.47 C 7.94 11.28 10.04 9.11 12.5 9.11 C 14.1 9.11 15.4 9.54 17 10.56 Z', width: 2.67, color: MID },
];

export interface VyenMarkProps {
  size?: number;
  className?: string;
}

/** Dấu hiệu thương hiệu Vyen (não–đám mây có mặt). */
export function VyenMark({ size = 16, className }: VyenMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {RINGS.map((ring) => (
        <path
          key={ring.width}
          d={ring.d}
          stroke={ring.color}
          strokeWidth={ring.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* Mặt: gạch mắt nối vào trong, mắt và miệng dùng xanh xỉ nhất */}
      <g stroke={MID} strokeLinecap="round">
        <line x1="11.98" y1="15.13" x2="14.87" y2="15.13" strokeWidth="0.67" />
        <line x1="18.74" y1="15.13" x2="22.02" y2="15.13" strokeWidth="0.67" />
      </g>
      <circle cx="11.33" cy="15.13" r="1.31" fill={FACE} />
      <circle cx="22.67" cy="15.13" r="1.31" fill={FACE} />
      <g stroke={FACE} strokeLinecap="round">
        <line x1="12.79" y1="22.02" x2="21.21" y2="22.02" strokeWidth="1.28" />
      </g>
      <circle cx="12.79" cy="22.02" r="1.13" fill={FACE} />
      <circle cx="21.21" cy="22.02" r="1.13" fill={FACE} />
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

  const tile = (
    <div
      className={
        isLarge
          ? 'relative flex h-24 w-24 items-center justify-center'
          : 'relative flex h-9 w-9 items-center justify-center'
      }
    >
      <VyenMark size={isLarge ? 88 : 26} />
    </div>
  );

  if (isLarge) {
    return (
      <div className="flex flex-col items-center">
        {tile}
        <div className="mt-5">
          <span className="uic text-[32px] font-bold tracking-[0.05em] text-text-primary">Vyen</span>
        </div>
        <div className="mt-1.5 uic text-read text-text-muted">
          Ứng dụng chat AI và coding agent, chạy hoàn toàn trên máy bạn
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      {tile}
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
    </div>
  );
}
