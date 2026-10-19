/**
 * Kho transcript của CLI — JSONL append-only.
 *
 * ============ VÌ SAO KHÔNG DÙNG SQLite ============
 *
 * opencode dùng SQLite + Drizzle, nhưng bản Vyen chạy tiến trình Node thuần: SQLite
 * sẽ kéo theo `better-sqlite3` (native dep phải build) hoặc `node:sqlite` (cần
 * Node ≥ 24). Với transcript **tuyến tính của một người**, SQL không mua được gì —
 * và đổi lại bạn có thể `Get-Content` ra đọc bằng mắt. Khi nào cần tìm kiếm hội
 * thoại thì mới đáng đổi.
 *
 * ============ MƯỜI DÒNG MỘT JSON, KHÔNG PHẢI MỘT JSON LỚN ============
 *
 * Ghi `JSON.stringify` cả lịch sử mỗi lượt là tự tạo đường cắt JSON. `JSONL` ghi
 * từng dòng một: dòng hỏng chỉ làm hỏng đúng một dòng.
 *
 * ============ HÌNH DẠNG ============
 *
 *   dòng 1: header   {"kind":"header","sessionId":...,"directory":...}
 *   dòng 2+: message {"seq":1,"message":{...}}
 *
 * `message` lưu **nguyên khối JSON của AI SDK**, không rút gọn thành cột riêng —
 * đúng cách opencode làm (`data: text({mode:'json'})` trong `session_message`).
 * Thêm kiểu message mới sau này thì không phải đổi cấu trúc lưu.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CoreMessage } from 'ai';
import { redactSecretsDeep } from '@/lib/secret-registry';

/* Che bí mật trước khi ghi xuống đĩa — dùng `redactSecretsDeep` của sẵn có, KHÔNG
 * tự viết hàm bọc thứ hai (AGENTS.md §6).
 *
 * ============ VÌ SAO BẮT BUỘC ============
 *
 * Kết quả `fs_read` nằm trong lịch sử hội thoại, tức nằm trong JSONL ở
 * `~/.vyen/cli/sessions/`. Đọc một `.env` là key của mọi thứ khác rơi vào đó.
 *
 * Đây là đường lưu duy nhất trong repo **không** che trước khi ghi: `lib/db.ts`,
 * `lib/tool-result-server.ts`, `lib/audit-log.ts` đều đã che, và spec §7 yêu cầu
 * rõ "redact trước khi ghi đĩa".
 *
 * Chỉ che lúc **ghi**, không che trong RAM: nếu che cả trong RAM thì lượt nối
 * tiếp sẽ gửi chuỗi đã bị che đi cho model. */

export interface SessionHeader {
  kind: 'header';
  sessionId: string;
  /** Thư mục dự án. Session gắn với thư mục, không gắn với người. */
  directory: string;
  createdAt: string;
}

export interface SessionStore {
  header: SessionHeader;
  /** Lịch sử đã nạp, theo thứ tự. */
  messages: CoreMessage[];
  /** Ghi thêm một message vào cuối file. */
  append(message: CoreMessage): void;
  /** Ghi thêm nhiều message — dùng sau khi một lượt sinh ra cả tool lẫn kết quả. */
  appendAll(messages: CoreMessage[]): void;
  close(): void;
}

/**
 * Đường dẫn file transcript của một thư mục.
 *
 * Tên file là **hash** của đường dẫn chứ không phải chính đường dẫn: `C:\Users\...`
 * chứa `:` và `\`, tức ký tự Windows cấm trong tên file. Mã hoá bằng hash thì tên
 * luôn hợp lệ và không đụng giới hạn 255 ký tự của Windows.
 *
 * Vì sao giữ cả thư mục trong header rồi: tên file băm không đọc được, người dùng
 * mở file ra phải biết nó nói về dự án nào.
 */
export function sessionFileFor(stateDir: string, directory: string): string {
  // `realpathSync` chuẩn hoá `C:\a\..\b` và viết hoa/thường trước khi băm, nếu không
  // cùng một thư mục mà gõ khác cách sẽ sinh ra hai file khác nhau.
  const chuan =
    (() => {
      try {
        return fs.realpathSync.native(directory);
      } catch {
        return path.resolve(directory);
      }
    })() ?? path.resolve(directory);
  const hash = crypto.createHash('sha256').update(chuan).digest('hex').slice(0, 16);
  return path.join(stateDir, 'sessions', `${hash}.jsonl`);
}

/**
 * Mở session của một thư mục — tạo mới nếu chưa có.
 *
 * ============ DÒNG CUỐI HỎNG THÌ BỎ, DÒNG GIỮA HỎNG THÌ NÉM ============
 *
 * Claude Code từng mất dữ liệu vì đúng chỗ này (CHANGELOG 2.1.300): *"Fixed the
 * first transcript entry written after resuming a session being lost when a crash
 * had cut the transcript's last line short"*.
 *
 * `appendFileSync` bị kill giữa chừng để lại dòng nửa vời. Nếu nối tiếp vào sau
 * dòng đó thì bản ghi mới dính liền vào dòng hỏng và không đọc được — mất trắng,
 * và lượt mất thường là lượt bạn vừa làm việc.
 *
 * Nên: dòng cuối hỏng là hậu quả **đã biết** của một crash, bỏ đi là đúng. Còn
 * dòng giữa hỏng thì không có lý do nào giải thích được — bỏ đi là nuốt lịch sử
 * khi người dùng không hề biết, nên phải nói ra và để họ quyết.
 */
export function openSession(stateDir: string, directory: string): SessionStore {
  const file = sessionFileFor(stateDir, directory);
  const header = readOrCreateHeader(file, directory);
  const { messages, canhBoi } = readMessages(file);
  /* PHẢI cắt file, không chỉ bỏ trong RAM.
   *
   * Đây là phần thứ hai của bug Claude Code từng dính. Nếu chỉ lọc trong RAM mà
   * để nguyên dòng hỏng trên đĩa thì lần `append` kế tiếp sẽ **nối liền vào dòng
   * hỏng**, tạo ra một dòng hỏng mới dài hơn — và bản ghi vừa ghi mất luôn.
   *
   * Đo được khi test: file có 2 bản ghi + dòng cụt, `append` thêm một dòng, mở lại
   * thì chỉ còn 1 message. Bỏ trong RAM thôi là **mất bản ghi ngay sau khi ghi**.
   *
   * ============ VÌ SAO `!== null` MÀ KHÔNG `if (canhBoi)` ============
   *
   * `canhBoi` là **byte offset**, và 0 là offset hợp lệ: dòng đầu tiên hỏng, không
   * có `\n` nào sau nó. Bản đầu viết `if (canhBoi)` nên offset 0 bị đọc thành
   * "file sạch" ⇒ không cắt ⇒ dòng hỏng sống dai ⇒ `append` tiếp dính liền vào
   * nó ⇒ lần mở sau ném `Transcript ... hong o dong 1` và CLI **từ chối khởi động**,
   * với thông báo không hề nói rằng xoá file là khỏi.
   */
  if (canhBoi !== null) catFile(file);
  let seq = messages.length;

  return {
    header,
    messages,
    append(message: CoreMessage): void {
      messages.push(message);
      appendLine(file, JSON.stringify({ seq: ++seq, message: redactSecretsDeep(message) }));
    },
    appendAll(batch: CoreMessage[]): void {
      if (batch.length === 0) return;
      // Ghi **một** lần cho cả lô: lô tool-call + tool-result phải vào đĩa cùng
      // nhau, nếu không thì crash giữa lô là mất cặp đôi và provider từ chối cả
      // lượt sau (tool_use không có tool_result).
      const phan = batch.map((m) => ({ seq: ++seq, message: redactSecretsDeep(m) }));
      appendLine(file, phan.map((p) => JSON.stringify(p)).join('\n'));
      messages.push(...batch);
    },
    close(): void {
      /* Không cần: appendFileSync ghi và đóng ngay. */
    },
  };
}

function appendLine(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${text}\n`, 'utf8');
}

function readOrCreateHeader(file: string, directory: string): SessionHeader {
  if (fs.existsSync(file)) {
    const dong = fs.readFileSync(file, 'utf8').split('\n')[0] ?? '';
    try {
      const h = JSON.parse(dong) as SessionHeader;
      if (h?.kind === 'header' && h.sessionId && h.directory) return h;
    } catch {
      /* Header hỏng = file hỏng từ đầu. Dựng lại header mới nhưng GIỮ file cũ:
       * xoá nó là mất lịch sử, mà ta còn chưa biết nó có giá trị gì. */
    }
  }
  const h: SessionHeader = {
    kind: 'header',
    sessionId: crypto.randomUUID(),
    directory,
    createdAt: new Date().toISOString(),
  };
  appendLine(file, JSON.stringify(h));
  return h;
}

/**
 * Nạp các bản ghi.
 *
 * Trả kèm `canhBoi`: độ dài **byte** của phần đầu file còn hợp lệ, để `openSession`
 * cắt bỏ đuôi hỏng. Trả `null` khi file sạch.
 */
function readMessages(file: string): { messages: CoreMessage[]; canhBoi: number | null } {
  if (!fs.existsSync(file)) return { messages: [], canhBoi: null };
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const out: CoreMessage[] = [];
  // Byte offset ngay sau dòng cuối còn hợp lệ. Mỗi lần đọc được một dòng thì
  // `canhHienTai` tiến thêm chiều dài dòng đó cộng `\n`.
  let canhHienTai = 0;
  let canhBoi: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const d = lines[i];
    // Phần tử cuối rỗng = file kết thúc bằng `\n`, tức sạch.
    if (i === lines.length - 1 && d === '') break;
    if (d.trim() === '') {
      canhHienTai += Buffer.byteLength(d, 'utf8') + 1;
      continue;
    }
    try {
      const parsed = JSON.parse(d) as { message?: CoreMessage };
      if (parsed?.message) out.push(parsed.message);
      canhHienTai += Buffer.byteLength(d, 'utf8') + 1;
    } catch (e) {
      const laDongCuoi = i === lines.length - 1 || lines.slice(i + 1).every((x) => x === '');
      if (laDongCuoi) {
        /* Crash cắt cụt dòng cuối — bỏ, và cắt file. Xem `openSession`. */
        canhBoi = canhHienTai;
        break;
      }
      throw new Error(
        `Transcript ${path.basename(file)} hong o dong ${i + 1} va KHONG phai dong ` +
          `cuoi nen khong bo duoc — bo di la mat lich su ma ban khong biet. ` +
          `Sua hoac xoa file roi chay lai. (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }
  return { messages: out, canhBoi };
}

/**
 * Cắt file còn đúng phần hợp lệ.
 *
 * Ghi lại tạm rồi `rename` thay vì `truncateSync`: `rename` là một lệnh nguyên tử
 * trên cùng ổ đĩa, nên crash giữa lúc sửa cũng không tạo ra file nửa vời — đúng
 * thứ đang sửa.
 */
function catFile(file: string): void {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const giu: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i];
    if (i === lines.length - 1 && d === '') break;
    if (d.trim() === '') continue;
    try {
      JSON.parse(d);
      giu.push(d);
    } catch {
      break; // tới dòng hỏng thì dừng, phần sau không dùng
    }
  }
  const tam = `${file}.tmp`;
  fs.writeFileSync(tam, giu.length ? `${giu.join('\n')}\n` : '', 'utf8');
  fs.renameSync(tam, file);
}