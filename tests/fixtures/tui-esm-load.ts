/**
 * Fixture: nạp đảo ESM của CLI từ **tiến trình Node thật** (CJS → ESM).
 *
 * Chạy bằng `node --import tsx tests/fixtures/tui-esm-load.ts` — không có vitest,
 * không có Vite, đúng như cách `cli/index.ts` sẽ gọi vào đảo TUI lúc chạy thật.
 */
async function main(): Promise<void> {
  const mod = await import('../../cli/tui/entry.tsx');
  if (typeof mod.createTui !== 'function') {
    console.error('thieu createTui');
    process.exitCode = 1;
    return;
  }
  console.log('TUI_ESM_OK');
}

void main();
