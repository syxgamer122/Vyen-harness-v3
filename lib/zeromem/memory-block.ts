/**
 * Dựng khối bộ nhớ để gửi kèm lượt (2026-10-16).
 *
 * VÌ SAO Ở CLIENT: kho Zero-Mem nằm trong IndexedDB của trình duyệt; server
 * (`app/api/chat/route.ts`) không đọc được IndexedDB. Nên client tính truy hồi
 * rồi gửi khối đã render; server chỉ việc bọc chống injection và chèn vào
 * system prompt — đúng như `webContext`/`hints`/`skillIndex` đang làm.
 *
 * CỔNG RẺ TRƯỚC KHI TỐN TOKEN: `retriever` trả về 0 evidence khi câu hỏi không
 * chạm vào thứ đã từng thấy, nên phần lớn lượt không tạo ra khối nào. Đây là
 * hình thức rẻ nhất của ý "Relational vs Local routing" trong paper — không cần
 * viết module routing để không chèn nhầm.
 *
 * Mặc định TẮT: không bật thì hàm trả `''` ngay, không hydrate, không đọc Dexie.
 */
import { ZeroMemRetriever } from './retriever';
import { getZeroMemStore } from './tools';
import { hydrateZeroMem } from './persistence';

/** Trần ký tự của khối gửi đi — server có zod cap riêng, đây là lớp phía client. */
export const MEMORY_BLOCK_MAX_CHARS = 4_000;

/** Ngân sách token cho retriever (dùng hằng số sẵn có của retriever). */
const RETRIEVE_MAX_TOKENS = 800;

export interface BuildMemoryBlockOptions {
  enabled: boolean;
  /** Quyền nhóm memory — 'deny' thì không sinh khối. */
  memoryPermission?: string;
  /** Câu hỏi của người dùng, dùng làm truy vấn. */
  query: string;
  sessionId: string;
  workspaceKey: string;
}

/**
 * Trả về khối bộ nhớ dạng văn bản (đã cắt trần), hoặc chuỗi rỗng khi không có
 * gì đáng chèn. Không ném lỗi — lỗi ở đường bộ nhớ không được làm hỏng lượt gửi.
 */
export async function buildMemoryBlock(options: BuildMemoryBlockOptions): Promise<string> {
  try {
    if (!options.enabled) return '';
    if (options.memoryPermission === 'deny') return '';
    const query = options.query.trim();
    if (query.length < 3) return '';

    const store = getZeroMemStore(options.workspaceKey);
    await hydrateZeroMem(store);
    if (store.getTraces().length === 0) return '';

    const retriever = new ZeroMemRetriever(store.getGraph(), store.getTemporal());
    const pack = retriever.retrieve([...store.getTraces()], {
      query,
      maxTokens: RETRIEVE_MAX_TOKENS,
    });

    if (pack.evidences.length === 0) return '';
    const block = pack.injectedBlock.trim();
    if (!block) return '';
    return block.slice(0, MEMORY_BLOCK_MAX_CHARS);
  } catch {
    return '';
  }
}