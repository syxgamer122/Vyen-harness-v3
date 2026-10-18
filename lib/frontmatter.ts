/**
 * Tách frontmatter YAML (giữa hai dòng `---` ở đầu file) khỏi body markdown.
 *
 * Tách khỏi `lib/skills/disk.ts` để SKILL.md và agent dùng chung một quy tắc:
 * frontmatter phải là block YAML ở ĐẦU file, không phải xuất hiện ở giữa.
 * Nếu mỗi loại file tự cắt, một file không bắt đầu bằng `---` sẽ bị hai tầng
 * hiểu khác nhau về vị trí body — và lỗi đó chỉ lộ ra khi người dùng viết file.
 *
 * Chỉ cắt khoảng trắng ĐẦU body, không cắt cuối: `lib/skills/disk.ts` cắt tiếp
 * theo giới hạn ký tự và hành vi đó phải giữ nguyên byte. Agent parser tự cắt
 * cuối trong `parseAgentDefinition` — nơi không ai khác dùng chung.
 *
 * Không phụ thuộc gì: hàm thuần trên chuỗi.
 */

export function splitFrontmatter(text: string): { frontRaw: string; body: string } | null {
  const normalized = (text ?? '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return null;
  return {
    frontRaw: normalized.slice(3, end).replace(/^\n/, ''),
    body: normalized.slice(end + 4).replace(/^\n+/, ''),
  };
}
