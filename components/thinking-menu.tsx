'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS, type ThinkingLevel } from '@/lib/thinking-levels';
import { resolveNearestEffort } from '@/lib/reasoning-capability';
import { useAnchoredPanel } from '@/lib/hooks/use-anchored-panel';
import { Z_CLASS } from '@/lib/ui-z';

const LEVELS: readonly {
  key: ThinkingLevel;
  label: string;
  description: string;
}[] = [
  /* Mô tả phải vừa một dòng trong menu 240px, nếu không `truncate` sẽ cắt giữa từ. */
  { key: 'none', label: 'Tắt', description: 'Không suy luận, trả lời thẳng' },
  { key: 'minimal', label: 'Tối thiểu', description: 'Suy luận càng ít càng tốt' },
  { key: 'low', label: 'Thấp', description: 'Cho câu hỏi đơn giản' },
  { key: 'medium', label: 'Trung bình', description: 'Cân bằng tốc độ và độ sâu' },
  { key: 'high', label: 'Cao', description: 'Phân tích sâu, chậm hơn' },
  { key: 'xhigh', label: 'Rất cao', description: 'Sâu hơn Cao một bậc' },
  { key: 'max', label: 'Tối đa', description: 'Sâu nhất, tốn nhiều token' },
];

type LevelDef = (typeof LEVELS)[number];

/** Bản thang bỏ mục "Tắt" — dành cho model bắt buộc suy luận. */
const NO_OFF_LEVELS: readonly LevelDef[] = LEVELS.filter((level) => level.key !== 'none');

const LEVEL_LABEL: Record<ThinkingLevel, string> = {
  none: 'Tắt',
  minimal: 'Tối thiểu',
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  xhigh: 'Rất cao',
  max: 'Tối đa',
};

function levelLabel(key: ThinkingLevel): string {
  return LEVEL_LABEL[key];
}

/** Danh sách mức hỗ trợ bằng tiếng Việt, theo thang low → max. */
export function supportedLevelsText(levels: readonly ThinkingLevel[]): string {
  const order = [...levels].sort(
    (a, b) => THINKING_LEVELS.indexOf(a) - THINKING_LEVELS.indexOf(b),
  );
  return order.map(levelLabel).join(', ');
}

/**
 * Phụ đề menu theo metadata của model:
 *  - không có metadata: mô tả chung tính năng;
 *  - khai báo subset: liệt kê đúng các mức model hỗ trợ;
 *  - efforts rỗng (toggle-only): gateway tự dịch mức thành bật/tắt;
 *  - mandatory: luôn suy luận, không có chế độ tắt (nên không liệt kê "Tắt").
 */
export function menuSubtitle(
  supportedLevels: ThinkingLevel[] | null | undefined,
  mandatory: boolean,
): string {
  const declared = mandatory
    ? supportedLevels?.filter((level) => level !== 'none')
    : supportedLevels;
  let base: string;
  if (!declared) {
    base = 'Điều khiển độ sâu phân tích của AI';
  } else if (declared.length === 0) {
    base = 'Gateway tự dịch mức thành bật/tắt';
  } else {
    base = `Model hỗ trợ: ${supportedLevelsText(declared)}`;
  }
  return mandatory ? `${base} · Model này luôn suy luận` : base;
}

/** title/aria-label khi mức yêu cầu bị model snapping sang mức gần nhất. */
export function snappedTitle(requested: ThinkingLevel, effective: ThinkingLevel): string {
  return `Mức suy luận: ${levelLabel(effective)} (Model không hỗ trợ ${levelLabel(requested)}, đang gửi ${levelLabel(effective)})`;
}

/**
 * Các mức menu hiển thị: đúng những mức model khai báo hỗ trợ (metadata
 * `/v1/models`), theo thang none → max.
 *
 * `null` (không có metadata) hoặc `[]` (model chỉ bật/tắt) → đủ cả thang. Mức
 * khai ngoài thang Vyen (vd "ultra") cũng rơi vào nhóm đó.
 *
 * `mandatory` bỏ mục "Tắt" ở mọi nhánh: bấm "Tắt" là bấm nút chết, và server
 * cũng bỏ tham số khi model không khai `none`.
 */
export function visibleLevelsFor(
  supportedLevels: readonly ThinkingLevel[] | null | undefined,
  mandatory?: boolean,
): readonly LevelDef[] {
  const fallback = mandatory ? NO_OFF_LEVELS : LEVELS;
  const declared = mandatory
    ? supportedLevels?.filter((level) => level !== 'none')
    : supportedLevels;
  if (!declared || declared.length === 0) return fallback;
  const matched = LEVELS.filter((level) => declared.includes(level.key));
  return matched.length > 0 ? matched : fallback;
}

/**
 * Meter 4 ô vuông 5x5px (gap 2px): số ô sáng = độ sâu mức. Thang có 7 mức nhưng
 * vẫn kẹp 4 ô để thanh status không nở ra; `meterFill` quy vị trí trên thang về
 * 4 ô (low/medium/high/max ra đúng 1/2/3/4, `none` = 0 ô).
 *
 * Màu 'max' dùng token warning vì đó là mức đốt token nhiều nhất; màu ở đây
 * báo chi phí, không phải để phân biệt mức (số ô đã làm việc đó).
 */
const METER_CELLS = 4;

function meterFill(level: ThinkingLevel): number {
  const lastIndex = THINKING_LEVELS.length - 1;
  return Math.round((THINKING_LEVELS.indexOf(level) / lastIndex) * METER_CELLS);
}

function LevelMeter({ level }: { level: ThinkingLevel }) {
  const fill = meterFill(level);
  // Ô vuông dùng giá trị token (rgb(var(--…))) vì đây là style inline, không phải class.
  const accent = level === 'max' ? 'rgb(var(--warning))' : 'rgb(var(--accent))';
  return (
    <span className="flex flex-none items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: METER_CELLS }, (_, i) => (
        <span
          key={i}
          className="h-[5px] w-[5px] border"
          style={
            i < fill
              ? { backgroundColor: accent, borderColor: accent }
              : {
                  backgroundColor: 'rgb(var(--bg-sunken))',
                  borderColor: 'rgb(var(--border-default))',
                }
          }
        />
      ))}
    </span>
  );
}

interface ThinkingMenuProps {
  value: ThinkingLevel;
  onChange: (value: ThinkingLevel) => void;
  disabled?: boolean;
  /**
   * Các mức model đang chọn hỗ trợ (metadata kiểu OpenRouter).
   * null/undefined = không có metadata. [] = model chỉ bật/tắt suy luận
   * (gateway tự dịch mức). Menu chỉ liệt kê đúng các mức trong danh sách;
   * giá trị hiện tại không được hỗ trợ sẽ hiển thị mức gần nhất.
   */
  supportedLevels?: ThinkingLevel[] | null;
  /** Model bắt buộc luôn suy luận (metadata reasoning.mandatory). */
  mandatory?: boolean;
}

export function ThinkingMenu({ value, onChange, disabled, supportedLevels, mandatory }: ThinkingMenuProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const visibleLevels = visibleLevelsFor(supportedLevels, mandatory);
  const visibleKeys = visibleLevels.map((level) => level.key);

  // Giá trị hiện tại không nằm trong mức menu đang hiện → hiển thị mức gần nhất
  // (server cũng map nearest khi gửi, UI chỉ phản chiếu cho trung thực).
  const effectiveValue = visibleKeys.includes(value)
    ? value
    : resolveNearestEffort(value, { efforts: visibleKeys, mandatory: false });
  const snapped = effectiveValue !== value;

  const current =
    visibleLevels.find((l) => l.key === effectiveValue)
    ?? LEVELS.find((l) => l.key === DEFAULT_THINKING_LEVEL)!;

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  /*
   * Menu render qua portal + position:fixed (xem use-anchored-panel cho
   * recipe chung). Trigger nằm sát phải status line: canh mép PHẢI panel theo
   * mép phải trigger rồi kẹp trong viewport. `placement: 'auto'` + kẹp cao như
   * `ModelSelector`: danh sách mức dài, không kẹp thì mục cuối rơi khỏi màn hình.
   */
  const { pos, panelRef } = useAnchoredPanel({
    open,
    triggerRef,
    width: 240,
    align: 'right',
    close,
    insideRef: containerRef,
    placement: 'auto',
    withMaxHeight: true,
  });

  // Chuẩn chung của các menu trong status line (ModelSelector,
  // ChatExportMenu): Escape trả focus về trigger; đóng khi click/cuộn ngoài
  // panel và khi bị disable giữa lúc đang mở (ví dụ stream bắt đầu) do hook
  // và effect dưới lo.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  // Mức đang chọn luôn nằm trong danh sách hiển thị: giá trị ngoài danh sách đã
  // được snap ở trên, danh sách rỗng thì hiện đủ cả thang.
  const activeIndex = Math.max(
    0,
    visibleLevels.findIndex((level) => level.key === effectiveValue),
  );

  // Ảnh chụp chỉ số lúc mở cho effect dưới: `activeIndex` đổi giữa lúc menu
  // đang mở (ví dụ metadata model về muộn) mà không được đưa vào deps — effect
  // chạy lại sẽ giật focus khỏi item user đang đứng.
  const openFocusIndexRef = useRef(0);
  openFocusIndexRef.current = activeIndex;

  // Mở bằng Enter/Space/click là focus ngay vào item của mức đang chọn, không
  // bắt user Tab thêm một bước (APG menu pattern); cũng là điều kiện để
  // ArrowUp/Down tới được onKeyDown của menu.
  useEffect(() => {
    if (!open) return;
    const target = openFocusIndexRef.current;
    setCursor(target);
    itemRefs.current[target]?.focus();
  }, [open]);

  const focusItem = (i: number) => {
    setCursor(i);
    itemRefs.current[i]?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const n = visibleLevels.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem((cursor + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem((cursor - 1 + n) % n);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(n - 1);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const snappedLabel = snapped
    ? snappedTitle(value, effectiveValue)
    : `Mức suy luận: ${current.label}`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-label={snappedLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={snapped ? snappedLabel : 'Mức độ suy luận của AI'}
        /*
         * CHỮ THUẦN trên nền thanh, không viền, không nền riêng, không chip tô
         * đầy — đúng luật của chính thanh này (`status-line.tsx`: "Mọi thứ
         * trước dấu `·` cuối là CHỮ THUẦN trên một nền"). Trigger cũ là một ô
         * viền + nền tô đầy, tức badge tròn nằm trong một thanh mà mọi mảng
         * khác đều là chữ — nó nổi lên đúng lúc không nên nổi. Nền chỉ hiện
         * lúc menu đang mở, để người đọc biết mình đang ở trong nó.
         *
         * `after:-inset-[6px]` phía dưới nới vùng chạm lên 44px (mốc WCAG
         * 2.5.5 trên mobile) mà không đổi khối hiển thị, giống nút composer.
         */
        className={`relative flex h-8 items-center gap-1.5 rounded-lg px-2 text-meta text-secondary transition-colors after:absolute after:-inset-[6px] after:content-[''] hover:bg-raised hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'bg-raised text-primary' : ''
        }`}
      >
        <LevelMeter level={effectiveValue} />
        <span aria-hidden="true" className="flex-none select-none px-0.5 text-disabled">
          ·
        </span>
        <span className="hidden sm:inline">
          {current.label}
          {snapped ? '*' : ''}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-tertiary transition-transform duration-100 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Mức suy luận"
            aria-orientation="vertical"
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            /* Số z lấy từ `lib/ui-z.ts`, không viết tay `z-40` — DESIGN.md §8.
               `flex flex-col` + danh sách cuộn riêng: tiêu đề và dòng cảnh báo
               luôn còn, chỉ danh sách mức trượt. */
            className={`surface-panel ${Z_CLASS.dropdown} animate-pop-in flex flex-col p-1.5`}
          >
            <div className="border-b border-subtle px-2.5 pb-1.5 pt-1">
              <p className="font-sans text-meta font-semibold uppercase tracking-[0.08em] text-accent-steel">
                Mức suy luận
              </p>
              <p className="mt-0.5 text-meta leading-relaxed text-tertiary">
                {menuSubtitle(supportedLevels, !!mandatory)}
              </p>
            </div>
            <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain">
              {visibleLevels.map((level, i) => {
                const isActive = effectiveValue === level.key;
                const activeToneClass = level.key === 'max' ? 'text-status-warning' : 'text-accent-steel';
                return (
                  <button
                    key={level.key}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onFocus={() => setCursor(i)}
                    onClick={() => {
                      onChange(level.key);
                      close();
                    }}
                    className={`menu-item ${isActive ? 'bg-raised text-primary' : ''} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent`}
                  >
                    <LevelMeter level={level.key} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-xs font-medium ${
                          isActive ? activeToneClass : 'text-primary'
                        }`}
                      >
                        {level.label}
                      </span>
                      <span className="mt-0.5 block truncate text-meta leading-tight text-tertiary">
                        {level.description}
                      </span>
                    </span>
                    {isActive && (
                      <Check size={13} className="flex-none text-accent-steel" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
            {snapped && (
              <p className="mt-1 border-t border-subtle px-2.5 py-1.5 text-meta leading-relaxed text-status-warning">
                {levelLabel(value)} không khả dụng, đang gửi {levelLabel(effectiveValue)}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
