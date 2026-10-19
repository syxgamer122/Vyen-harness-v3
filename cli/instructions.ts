/**
 * System prompt của CLI — dựng lúc khởi động.
 *
 * ============ PROMPT NGẮN, BỐI CẢNH THÌ ĐẾN TỪ FILE ============
 *
 * Bản đầu tôi viết một system prompt 12 dòng liệt kê cứng 14 tool. Đo mã
 * opencode (`packages/core/src/session/runner/prompt/system.txt`) cho thấy prompt
 * của họ chỉ ~10 dòng, và toàn bộ bối cảnh dự án đến từ **instruction file**.
 *
 * Nghĩa là chỗ tôi yếu không phải "prompt ngắn" mà là **không nạp file hướng dẫn**.
 * Repo này có sẵn `AGENTS.md` chi tiết mà CLI của tôi đang phớt lờ.
 *
 * ============ VÌ SAO HƯỚNG DẪN TOOL PHẢI CÓ ĐIỀU KIỆN ============
 *
 * Liệt kê cứng là đoán sai. Workspace không hợp lệ thì không có tool nào, nhưng
 * prompt vẫn bảo model "dùng `fs_write`" — model sẽ **bịa** công cụ không tồn tại
 * rồi báo lỗi không hiểu. opencode làm `if (tools.includes("shell"))`; ở đây làm
 * y hệt.
 *
 * ============ ĐỌC MỘT LẦN LÚC KHỞI ĐỘNG ============
 *
 * Không đọc lại giữa chừng. opencode có `renderUpdate` gửi **diff** khi file hướng
 * dẫn đổi giữa cuộc hội thoại — đúng, nhưng nó phụ thuộc máy trạng thái của họ, ta
 * chưa có. Đọc một lần thì đủ dùng; hạn chế này ghi rõ thay vì giấu.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * File hướng dẫn, theo thứ tự nạp.
 *
 * Khai ở MỘT chỗ: đây là quyết định của sản phẩm, không phải chi tiết kỹ thuật.
 * Rải khắp prompt thì thêm file thứ ba sẽ sót.
 */
export const INSTRUCTION_FILES: readonly string[] = ['AGENTS.md', 'CLAUDE.md'];

/**
 * Trần cho MỘT file hướng dẫn.
 *
 * Nội dung này đi kèm **mọi** lượt gọi model, nên file 500 KB là phí lãng phí mỗi
 * lần. Cắt thì phải nói rõ, im lặng cắt là để model tưởng đã đọc hết.
 */
export const MAX_INSTRUCTION_CHARS = 20_000;

/** Phần cố định. Không liệt kê tool — phần đó chèn theo điều kiện ở dưới. */
const NEN = [
  'Ban la mot AI agent chay tren terminal, tro giup nguoi dung lam viec tren du an.',
  '',
  '# Giao tiep',
  '- Noi ro bang tieng Viet, ngan gon. Khong nhung.',
  '- Khi goi den file, ghi duong dan day du.',
  '- Giup ngay cau hoi, khong vong vo.',
].join('\n');

/**
 * Hướng dẫn riêng cho từng tool — chỉ chèn khi tool **thật sự có**.
 *
 * Mỗi mục ghi rõ vì sao tool đó cần dạy, không phải liệt kê cho có. */
const HUONG_DAN: Record<string, string> = {
  fs_write: '- Tao file moi hoac viet lai toan bo file bang `fs_write`.',
  fs_edit:
    '- Sua mot doan trong file bang `fs_edit`, khai bao `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`. Doan SEARCH phai khop DUNG mot cho, khong khop thi lenh do that bai chu khong ghi gi.',
  fs_read: '- Doc file bang `fs_read` truoc khi sua. Khong sua khi chua doc.',
  shell_run:
    '- Chay lenh qua `shell_run`. KHONG noi lenh bang dau phan cach nhu `echo "===";` — output rac lam hong phia nguoi dung.',
  git_add: '- Them file vao staging bang `git_add`.',
  git_commit: '- Commit bang `git_commit`.',
};

/**
 * Dựng system prompt.
 *
 * @param tools  Danh sách tool đang có. `undefined` / rỗng = không có tool nào.
 * @param workspaceRoot Thư mục dự án để tìm file hướng dẫn.
 */
export function buildSystemPrompt(
  tools: readonly string[] | undefined,
  workspaceRoot: string,
): string {
  const khoi = [NEN];

  const coTool = tools && tools.length > 0;
  if (coTool) {
    const huong = Object.entries(HUONG_DAN)
      .filter(([ten]) => tools!.includes(ten))
      .map(([, s]) => s);
    if (huong.length > 0) {
      khoi.push('', '# Cong cu', ...huong);
    }
  }

  const huongDan = docHuongDan(workspaceRoot);
  if (huongDan) khoi.push('', huongDan);

  return khoi.join('\n');
}

/**
 * Nạp và render file hướng dẫn.
 *
 * Rỗng = không có gì để thêm, và KHÔNG thêm tiêu đề nào. Chèn tiêu đề "Instructions"
 * khi không có nội dung là để model tưởng có hướng dẫn rồi tự bịa.
 */
function docHuongDan(workspaceRoot: string): string {
  const khoi: string[] = [];
  for (const ten of INSTRUCTION_FILES) {
    const p = path.join(workspaceRoot, ten);
    let noiDung: string;
    try {
      noiDung = fs.readFileSync(p, 'utf8');
    } catch {
      // Không có file, hoặc không đọc được. Cả hai đều nghĩa là "không có hướng
      // dẫn" — và không được làm sập CLI vì việc đọc file hỏng.
      continue;
    }
    if (noiDung.length > MAX_INSTRUCTION_CHARS) {
      noiDung =
        `${noiDung.slice(0, MAX_INSTRUCTION_CHARS)}\n` +
        `… (da cat: con ${noiDung.length - MAX_INSTRUCTION_CHARS} ky tu nua)`;
    }
    // Đúng định dạng của opencode: đường dẫn để model biết chỗ này từ đâu.
    khoi.push(`Instructions from: ${p}\n${noiDung}`);
  }
  return khoi.join('\n\n');
}