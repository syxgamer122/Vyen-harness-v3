import { describe, it, expect } from 'vitest';
import {
  projectCapabilities,
  computeAuthorityDigest,
  DEFAULT_TOOL_CANDIDATES,
  type ToolCandidate,
  type ExclusionReason,
} from '@/lib/capability-projection';

describe('Capability Projection', () => {
  describe('computeAuthorityDigest', () => {
    it('produces deterministic digest regardless of set insertion order', () => {
      const set1 = new Set(['fs_read', 'shell_run', 'git_status']);
      const set2 = new Set(['git_status', 'fs_read', 'shell_run']);
      expect(computeAuthorityDigest(set1)).toBe(computeAuthorityDigest(set2));
      expect(computeAuthorityDigest(set1).startsWith('auth-')).toBe(true);
    });

    it('phân biệt hai authority khác nhau', () => {
      expect(computeAuthorityDigest(new Set(['fs_read']))).not.toBe(
        computeAuthorityDigest(new Set(['fs_read', 'fs_write'])),
      );
    });
  });

  describe('projectCapabilities - Closed 4 Exclusion Reasons', () => {
    const VALID_EXCLUSION_REASONS: ExclusionReason[] = [
      'beyond_context_budget',
      'not_granted_by_authority',
      'not_relevant_to_request',
      'outranked_by_shortlist',
    ];

    it('excludes tools not in authority set with "not_granted_by_authority"', () => {
      const authority = new Set(['fs_read']); // only fs_read granted
      const proj = projectCapabilities({
        text: 'Đọc file và kiểm tra mã nguồn',
        authority,
        budgetBytes: 5000,
      });

      expect(proj.included.some((t) => t.id === 'fs_read')).toBe(true);
      const ungranted = proj.excluded.filter((e) => e.reason === 'not_granted_by_authority');
      expect(ungranted.length).toBeGreaterThan(0);
      expect(ungranted.some((t) => t.id === 'fs_write')).toBe(true);
    });

    it('excludes tools with no relevance to request with "not_relevant_to_request"', () => {
      // Grant git_status and web_search, but text is only about memory
      const authority = new Set(['git_status', 'memory_search']);
      const proj = projectCapabilities({
        text: 'Nhớ bài học từ lần trước',
        authority,
        budgetBytes: 5000,
      });

      expect(proj.included.some((t) => t.id === 'memory_search')).toBe(true);
      const notRelevant = proj.excluded.find((e) => e.id === 'git_status');
      expect(notRelevant).toBeDefined();
      expect(notRelevant?.reason).toBe('not_relevant_to_request');
    });

    it('enforces byte budget ceiling and excludes overflow items', () => {
      const candidates: ToolCandidate[] = [
        { id: 'tool_a', group: 'fs', description: 'Tool A', bytes: 600 },
        { id: 'tool_b', group: 'fs', description: 'Tool B', bytes: 600 },
        { id: 'tool_c', group: 'fs', description: 'Tool C', bytes: 600 },
      ];
      const authority = new Set(['tool_a', 'tool_b', 'tool_c']);

      const proj = projectCapabilities({
        text: 'sửa file',
        authority,
        budgetBytes: 1000, // can only fit 1 tool of 600 bytes
        allCandidates: candidates,
      });

      expect(proj.budget.usedBytes).toBeLessThanOrEqual(1000);
      expect(proj.included).toHaveLength(1);
      expect(proj.budget.droppedIds).toHaveLength(2);

      for (const exc of proj.excluded) {
        expect(VALID_EXCLUSION_REASONS).toContain(exc.reason);
      }
    });

    it('ensures every excluded item strictly belongs to the 4 closed reasons', () => {
      const authority = new Set(['fs_read', 'fs_write', 'shell_run']);
      const proj = projectCapabilities({
        text: 'chạy test',
        authority,
        budgetBytes: 800,
      });

      for (const exc of proj.excluded) {
        expect(VALID_EXCLUSION_REASONS).toContain(exc.reason);
      }
    });

    it('authorityDigest phản ánh authority đã dùng để chiếu', () => {
      const authority = new Set(['fs_read', 'shell_run']);
      const proj = projectCapabilities({
        text: 'chạy lệnh',
        authority,
        budgetBytes: 4000,
      });

      // Đã bỏ registry "đóng băng theo taskId" (chỉ ghi, không đọc lại) —
      // digest giờ là chữ ký của lần chiếu NÀY, để caller đối chiếu.
      expect(proj.authorityDigest).toBe(computeAuthorityDigest(authority));
    });

    it('mặc định dùng DEFAULT_TOOL_CANDIDATES', () => {
      const proj = projectCapabilities({
        text: 'đọc file',
        authority: new Set(DEFAULT_TOOL_CANDIDATES.map((c) => c.id)),
        budgetBytes: 5000,
      });
      expect(proj.included.length).toBeGreaterThan(0);
    });
  });
});