/**
 * HUD Store — Quản lý trạng thái telemetry live cho các lane.
 *
 * Mỗi lane đại diện cho một luồng thực thi: main conversation, subagent relay, fanout unit,
 * hoặc orchestrator cell.
 *
 * Nguyên tắc:
 * - Hiển thị model:effort, turn, tokens, cost, elapsed, evidence.
 * - Cost chỉ hiển thị khi có giá xác nhận từ contract; nếu thiếu giá trả 'unknown', TUYỆT ĐỐI không $0.
 * - parallelShots: ghi nhận số lượng tool read-only chạy song song theo lô.
 */

import { create } from 'zustand';
import type { CategoryId } from '@/lib/routing/categories';
import type { Effort } from '@/lib/model-contracts';
import type { EvidenceLevel } from '@/lib/evidence';
import { calculateModelCost } from '@/lib/model-contracts';

export type LaneKind = 'main' | 'subagent' | 'unit' | 'orchestrator-cell';

export interface HudLane {
  laneId: string;
  kind: LaneKind;
  category: CategoryId;
  model: string;
  effort: Effort;
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn?: number;
  costUsd: number | 'unknown';
  evidence: EvidenceLevel;
  updatedAt: number;
}

interface HudState {
  lanes: Record<string, HudLane>;
  upsertLane: (lane: Partial<HudLane> & { laneId: string }) => void;
}

export const useHudStore = create<HudState>((set) => ({
  lanes: {},

  upsertLane: (input) => {
    set((state) => {
      const existing = state.lanes[input.laneId];
      /* Không có model mặc định của máy chủ: lane chưa gán model thì để
         rỗng, HUD hiện effort thay vì tên model bịa ra. */
      const model = input.model ?? existing?.model ?? '';
      const effort = input.effort ?? existing?.effort ?? 'medium';
      const category = input.category ?? existing?.category ?? 'capable';
      const kind = input.kind ?? existing?.kind ?? 'main';
      const tokensIn = input.tokensIn ?? existing?.tokensIn ?? 0;
      const tokensOut = input.tokensOut ?? existing?.tokensOut ?? 0;
      const cachedTokensIn = input.cachedTokensIn ?? existing?.cachedTokensIn ?? 0;
      const evidence = input.evidence ?? existing?.evidence ?? 'prepared';

      // Tính cost từ tokens
      const costUsd =
        input.costUsd !== undefined
          ? input.costUsd
          : calculateModelCost(model, {
              promptTokens: tokensIn,
              completionTokens: tokensOut,
              cachedPromptTokens: cachedTokensIn,
            });

      const updated: HudLane = {
        laneId: input.laneId,
        kind,
        category,
        model,
        effort,
        tokensIn,
        tokensOut,
        cachedTokensIn,
        costUsd,
        evidence,
        updatedAt: Date.now(),
      };

      return {
        lanes: { ...state.lanes, [input.laneId]: updated },
      };
    });
  },
}));
