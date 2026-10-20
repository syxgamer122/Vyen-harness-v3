/* @ts-nocheck */
/**
 * Fixture: import đặt **SAU** JSX.
 *
 * ============ VÌ SAO HÌNH DẠNG NÀY ============
 *
 * Đo 2026-10-20 (probe ngoài repo, `runtimeImportSpecs` với `ts.ScriptKind.TS`):
 * import đứng TRƯỚC JSX thì parser vẫn thấy; import đứng SAU JSX thì parser
 * **không thấy** — cạnh runtime biến mất khỏi đồ thị lõi.
 *
 * Nếu fixture đặt import trước JSX thì test sẽ xanh dù cả fix lẫn cái hỏng
 * — tức test rỗng. Vì vậy import nằm SAU, đúng chỗ đo thấy hỏng.
 */
/** @jsxImportSource @opentui/react */
export const A = () => <text>chao</text>;

import { b } from './b.tsx';
export const ket = b;
