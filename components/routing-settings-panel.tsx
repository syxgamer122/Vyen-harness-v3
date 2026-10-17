'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import {
  DEFAULT_MODEL_ROUTING,
  normalizeModelRoutingConfig,
  type ModelRoutingConfig,
} from '@/lib/model-routing';

/**
 * Ô số của `LeadWorkerRoutingSection`.
 *
 * Tách thành component riêng, không phải hàm lồng trong thân panel: bản cũ gọi
 * `useState` bên trong một hàm tên thường được gọi như hàm (không phải JSX), nên
 * state gắn với thân `LeadWorkerRoutingSection` chứ không gắn với từng ô — mỗi
 * lần bấm là cả ba ô cùng remount, mất luôn phần đang gõ dở. Là component thật
 * thì mỗi ô giữ `raw` riêng và rules-of-hooks hợp lệ.
 *
 * HTML5 `min`/`max` KHÔNG chặn gõ — người dùng vẫn nhập được 99, và `Number('')`
 * là 0 nên xoá trống một ô sẽ ghi 0 xuống store. Vì vậy:
 *   - rỗng → KHÔNG ghi (giữ nguyên giá trị đang có, ô vẫn cho phép sửa),
 *   - ngoài khoảng → ghi kèm giá trị đã kẹp về min/max để store không nhận
 *     con số vô nghĩa, đồng thời hiện viền cảnh báo cho tới lần gõ hợp lệ sau.
 */
function NumberField({
  id,
  label,
  min,
  max,
  hint,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  hint: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const parsed = raw === null ? NaN : Number(raw);
  const outOfRange =
    raw !== null && raw.trim() !== '' && Number.isFinite(parsed) && (parsed < min || parsed > max);
  return (
    <div className="flex-1">
      <label htmlFor={id} className="field-label mb-1 block">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        /* Đang sửa → hiện đúng thứ người dùng gõ; không sửa → giá trị trong store. */
        value={raw ?? String(value)}
        aria-invalid={outOfRange}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          if (next.trim() === '') return; // Xoá trống: để nguyên store, không ghi 0
          const v = Number(next);
          if (!Number.isFinite(v)) return;
          onCommit(Math.min(max, Math.max(min, v)));
        }}
        onBlur={() => setRaw(null)}
        className={`field ${outOfRange ? 'border-danger bg-danger/10' : ''}`}
      />
      <p className="field-hint mt-0.5">
        {outOfRange
          ? `Ngoài khoảng ${min}–${max} — đã kẹp về ${Math.min(max, Math.max(min, parsed))}.`
          : hint}
      </p>
    </div>
  );
}

export function RoutingSettingsPanel() {
  /*
   * CHỈ còn Lead/Worker Routing. Khối "Mixture-of-Models" đã bị gỡ.
   *
   * Lý do KHÔNG phải xung đột thiết kế mà là sợi dây đứt: `chatRequestBody`
   * (`react/use-chat-orchestration.ts:2896-2947`) không chứa `customChains`, nên
   * server đọc ở `app/api/chat/route.ts:742,1093` và dùng ở `:1196,1296` không
   * bao giờ nhận được gì. Thêm nữa `:546-551` ép `model = MODELS[0].id` khi có
   * provider — mà khai chains thì bắt buộc có provider — nên `route.ts:1191` luôn
   * tính `activeCategory = undefined` và nhánh chains không bao giờ chạy.
   *
   * UI vẫn hiện đầy đủ ô cấu hình chuỗi, export/import JSON, ô chọn 8 hạng mục:
   * người dùng nhập công sức, không báo lỗi, rồi tưởng đã áp dụng. Xoá hẳn còn
   * hơn ẩn — ẩn đi thì người đã cấu hình không hiểu vì sao mất.
   *
   * Lead/Worker thì đã nối đúng vào body qua `routingBodyFor`
   * (`use-chat-orchestration.ts:940-943`) nên GIỮ. Đó là phần có ích.
   *
   * `lib/routing/categories.ts` vẫn GIỮ phần hệ hạng mục: `scoreRequest` gán
   * hạng mục cho mỗi lượt và HUD đọc `CATEGORY_DESCRIPTIONS`
   * (`components/hud/agent-hud.tsx:5`). Phần chuỗi dự phòng trong đó đã bị xoá
   * cùng nhánh `customChains` ở `app/api/chat/route.ts`.
   */
  return (
    <div className="space-y-4 text-ui font-sans">
      <LeadWorkerRoutingSection />
    </div>
  );
}

/* ------------------ Lead/Worker routing (P1-5) ------------------ */

function RoutingModelSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (v: string) => void;
}) {
  const orphan = Boolean(value) && !options.some((o) => o.id === value);
  return (
    <div className="flex-1">
      <label htmlFor={id} className="field-label mb-1 block">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field-sm w-full"
      >
        <option value="">— Theo model chính —</option>
        {orphan && <option value={value}>{value} (không còn trong danh sách)</option>}
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} ({m.id})
          </option>
        ))}
      </select>
    </div>
  );
}

function LeadWorkerRoutingSection() {
  const modelRouting = useAppStore((s) => s.settings.modelRouting) ?? DEFAULT_MODEL_ROUTING;
  const updateSettings = useAppStore((s) => s.updateSettings);
  const activeProvider = useAppStore((s) => s.activeProvider);

  const patch = (p: Partial<ModelRoutingConfig>) =>
    updateSettings({ modelRouting: normalizeModelRoutingConfig({ ...modelRouting, ...p }) });

  /* Danh sách chọn: model của provider đang bật (BYOK — danh sách đến từ
     /v1/models, không có catalog của app). Giá trị đã chọn mà rơi khỏi danh
     sách (đổi provider) vẫn hiện thành option mồ côi — không âm thầm xoá. */
  const modelOptions = (() => {
    const base = (activeProvider?.models ?? []).map((m) => ({ id: m.id, label: m.name || m.id }));
    return base;
  })();

  const numberField = (
    id: string,
    label: string,
    key: 'leadTurns' | 'failureThreshold' | 'fallbackTurns',
    min: number,
    max: number,
    hint: string,
  ) => (
    <NumberField
      id={id}
      label={label}
      min={min}
      max={max}
      hint={hint}
      value={modelRouting[key]}
      onCommit={(v) => patch({ [key]: v } as Partial<ModelRoutingConfig>)}
    />
  );

  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-read font-semibold text-primary">Lead/Worker Routing</h3>
          <p className="field-hint">
            Model mạnh chạy vài lượt đầu (lập kế hoạch) rồi model rẻ thực thi; thất bại liên tiếp
            thì tự quay lại model mạnh. Lệnh <code className="text-accent">/plan</code> dùng
            planner model riêng.
          </p>
        </div>
        <label className="flex flex-none cursor-pointer items-center gap-1.5 pt-1 text-ui text-primary">
          <input
            type="checkbox"
            checked={modelRouting.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="h-3.5 w-3.5 rounded-full accent-accent"
          />
          Bật
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <RoutingModelSelect
          id="lead-model"
          label="Lead (mạnh)"
          value={modelRouting.leadModel}
          options={modelOptions}
          onChange={(v) => patch({ leadModel: v })}
        />
        <RoutingModelSelect
          id="worker-model"
          label="Worker (rẻ)"
          value={modelRouting.workerModel}
          options={modelOptions}
          onChange={(v) => patch({ workerModel: v })}
        />
        <RoutingModelSelect
          id="planner-model"
          label="Planner (/plan)"
          value={modelRouting.plannerModel}
          options={modelOptions}
          onChange={(v) => patch({ plannerModel: v })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {numberField('lead-turns', 'Số lượt lead', 'leadTurns', 1, 20, 'Mặc định 3')}
        {numberField(
          'failure-threshold',
          'Ngưỡng thất bại',
          'failureThreshold',
          1,
          10,
          'Số lỗi liên tiếp để quay lại lead (mặc định 2)',
        )}
        {numberField(
          'fallback-turns',
          'Số lượt fallback',
          'fallbackTurns',
          0,
          10,
          'Giữ lead bao lâu trước khi về worker (mặc định 2)',
        )}
      </div>

      <p className="text-micro leading-relaxed text-tertiary">
        &ldquo;Thất bại&rdquo; = tool trả lỗi / lệnh build-test exit ≠ 0 / bạn phàn nàn
        (&ldquo;sai rồi&rdquo;, &ldquo;làm lại&rdquo;, &ldquo;wrong&rdquo;…). Lỗi mạng 429/5xx
        của gateway KHÔNG được tính — đã có retry im lặng riêng. Việc bạn TỪ CHỐI một phê duyệt
        cũng không tính là thất bại. Vai trò của từng lượt hiện thành badge{' '}
        <code className="text-accent">lead</code>/<code className="text-tertiary">worker</code>{' '}
        dưới câu trả lời.
      </p>
    </div>
  );
}
