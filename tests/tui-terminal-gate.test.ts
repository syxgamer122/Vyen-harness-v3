/**
 * Cổng GO/NO-GO của toàn bộ TUI: nó có mở được trên terminal thật không.
 *
 * ============ VÌ SAO LÀ TEST, KHÔNG PHẢI "CHECK TAY" ============
 *
 * chạy `npx tsx cli/tui/entry.tsx` trong terminal thật thì màn
 * hình mở, chữ hiện, Esc thoát sạch — nhưng đó là **một lần quan sát của tôi**,
 * không có gì chặn lần sau nó hỏng. Cổng này nên là test: nó chạy được trong
 * CI, và hỏng thì đỏ.
 *
 * ============ RANH GIỚI QUAN SÁT ĐƯỢC ============
 *
 * Không chụp màn hình (không có màn hình để chụp) — mà đo đúng ba thứ mà một
 * tiến trình terminal thật để lại:
 *   1. **exit code 0** sau khi nhận Esc;
 *   2. **chuỗi alternate-screen bật** (`ESC[?1049h`) ⇒ nó thật sự chiếm màn hình;
 *   3. **chuỗi alternate-screen tắt** (`ESC[?1049l`) ⇒ nó **trả terminal lại**,
 *      không để người dùng lại với màn hình hỏng.
 *
 * Mắt người vẫn cần xem (màu, khoảng cách, nhịp dòng) — nhưng phần "nó có chạy
 * không" thì máy lo.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';

const ALT_SCREEN_BAT = '\u001b[?1049h';
const ALT_SCREEN_TAT = '\u001b[?1049l';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('cổng TUI trên tiến trình thật', () => {
  /* Timeout riêng 150s: mặc định của repo là 30s, mà cổng này phải nạp tsx +
     AI SDK + OpenTUI trong một tiến trình con — khi cả suite chạy song song thì
     nạp module chậm hơn nhiều. */
  it(
    'mở alternate screen, Esc thoát với exit 0, terminal được trả lại',
    async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'cli/tui/entry.tsx'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      out += d;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => {
      err += d;
    });

    try {
      /* Chờ **cả hai**: alternate-screen bật VÀ chữ đã vẽ.
       *
       * Lần đầu chỉ chờ alt-screen rồi khẳng định chữ ⇒ dưới tải nặng (chạy cả
       * suite) khung hình đầu chỉ có escape, chữ vẽ ở khung sau ⇒ đỏ giả.
       * xanh khi chạy riêng, đỏ khi chạy song song với cả suite. */
      let coBat = false;
      let coChu = false;
      /* Ngân sách 60s: tiến trình con phải nạp tsx + cả AI SDK + OpenTUI, mà
       * khi cả suite chạy song song thì nạp module chậm hơn nhiều. */
      const HAN = 120; // 120 * 500ms = 60s
      for (let i = 0; i < HAN && !(coBat && coChu); i++) {
        await wait(500);
        coBat = out.includes(ALT_SCREEN_BAT);
        coChu = out.includes('# vyen · dev');
      }
      expect(
        coBat,
        `TUI không bật alternate screen sau 60s. stderr: ${err.slice(-400)}`,
      ).toBe(true);
      expect(
        coChu,
        `TUI không vẽ header sau 60s. stdout: ${JSON.stringify(out.slice(-300))}`,
      ).toBe(true);

      child.stdin.write('\u001b'); // Esc

      let exitCode: number | null = null;
      for (let i = 0; i < 120 && exitCode === null; i++) {
        await wait(500);
        exitCode = child.exitCode;
      }
      expect(exitCode, `TUI không thoát sau Esc. stderr: ${err.slice(-400)}`).toBe(0);
      expect(
        out.includes(ALT_SCREEN_TAT),
        'terminal không được trả lại — người dùng sẽ còn kẹt trong màn hình cũ',
      ).toBe(true);
    } finally {
      child.kill('SIGKILL');
    }
    },
    150_000,
  );
});
