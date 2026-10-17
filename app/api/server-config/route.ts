import { checkSameOrigin } from '@/lib/security';

export const runtime = 'nodejs';

/**
 * Endpoint nhận diện "app đã lên" cho desktop launcher (`scripts/launch-desktop.cjs`).
 *
 * Tầng gateway env đã gỡ — client dựa vào provider active của mình (metadata
 * reasoning đọc từ `GET /v1/models` — xem `lib/reasoning-capability.ts`).
 * Không còn trường `media`: tính năng tạo ảnh/video đã bị gỡ khỏi dự án.
 */
export async function GET(req: Request) {
  if (!checkSameOrigin(req)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  return Response.json(
    {
      thinkingLevel: false,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
