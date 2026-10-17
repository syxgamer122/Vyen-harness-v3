'use client';

/**
 * Settings → tab "Model & Nhà cung cấp"
 *
 * Quản lý provider preset, định tuyến model và model đọc ảnh.
 *
 * (Tách ra từ components/settings-dialog.tsx.)
 *
 * Không nhận prop: tự đọc `useAppStore` như các section khác trong
 * components/settings/ — tránh luồn chục prop qua nhiều tầng chỉ để lấy `settings`.
 */

import dynamic from 'next/dynamic';
import { useAppStore } from '@/lib/store';
import { SectionLoading } from '@/components/settings/section-loading';
import { VisionModelSection } from '@/components/settings/vision-model-section';

const ProviderManager = dynamic(() => import('@/components/provider-manager').then((m) => m.ProviderManager), { ssr: false, loading: SectionLoading });
const RoutingSettingsPanel = dynamic(() => import('@/components/routing-settings-panel').then((m) => m.RoutingSettingsPanel), { ssr: false, loading: SectionLoading });

export function ProvidersTab() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  return (
    <>
      <div className="border-b border-subtle pb-2">
        <h3 className="text-read font-semibold text-primary">Model &amp; Nhà cung cấp</h3>
        <p className="mt-0.5 text-meta text-tertiary">
          Quản lý API key cá nhân (BYOK), danh sách model, vision model và chiến lược điều phối Lead/Worker.
        </p>
      </div>

      <div>
        <h4 className="field-label mb-1.5 block text-read">Nhà cung cấp API (BYOK)</h4>
        <p className="mb-2 text-ui leading-relaxed text-tertiary">
          Lưu nhiều nhà cung cấp chuẩn OpenAI-compatible, tải danh sách model và chuyển
          nhanh mà không cần cấu hình lại server. Vyen không có model sẵn — mọi lượt
          gửi đi qua một trong các nhà cung cấp bạn tự thêm ở đây.
        </p>
        <ProviderManager />
      </div>

      <div className="border-t border-subtle pt-3">
        <VisionModelSection />
      </div>


      <div className="border-t border-subtle pt-3">
        <RoutingSettingsPanel />
      </div>
    </>
  );
}
