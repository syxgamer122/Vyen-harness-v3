/**
 * `flushSync was called from inside a lifecycle method` — React 19 cảnh báo.
 *
 * Bằng chứng thật, log trình duyệt (dòng 1686/1687/1744/1745), xen kẽ từng
 * lượt tool call:
 *   [browser] flushSync was called from inside a lifecycle method. React cannot
 *   flush when React is already rendering. Consider moving this call to a
 *   scheduler task or micro task.
 *
 * Nguồn KHÔNG phải code của app: `grep flushSync` trong components/ react/
 * app/ không ra một lời gọi nào. Nó đến từ `@tanstack/react-virtual`
 * (`node_modules/@tanstack/react-virtual/src/index.tsx:191`):
 *
 *   if (useFlushSync && sync) { flushSync(rerender) } else { rerender() }
 *
 * `useFlushSync` MẶC ĐỊNH là `true`. Đường sync tới đó:
 *   ref của hàng → `measureElement` → `resizeItem` → `applyScrollAdjustment`
 *   (đã ghi `scrollTop` trong callback) → `notify(adjustedSync=true)`
 *   → `onChange(instance, sync=true)` → `flushSync(rerender)`.
 *
 * Ref callback chạy trong lúc React COMMIT — đúng cái mà React 19 chặn
 * (`ReactDOMSharedInternals.d.f()` kiểm tra `isRendering || flushSyncWork()`),
 * và `flushSync` bên trong commit không flush được: lời gọi chỉ là schedule
 * thừa cộng thêm một dòng cảnh báo đỏ mỗi lượt. Đây là lỗi thật, không phải
 * nhiễu — nhưng nguyên nhân là CẤU HÌNH, không phải lời gọi trong app.
 *
 * Repo không có jsdom (vitest `environment: 'node'`) nên không render được
 * component; ta khoá bằng đọc source + khẳng định trên CẢ HAI bên: option của
 * thư viện, và thực tế thư viện dùng nó để chặn flushSync. Đúng convention
 * của tests/chat-route-fixes.test.ts và tests/message-item-timeline.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* CRLF → LF một lần: file trên đĩa là CRLF (core.autocrlf), regex bám `\n`
   sẽ pass ở máy này và ĐỎ trên CI. */
const listSource = fs
  .readFileSync(path.resolve(__dirname, '../components/chat/message-list.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

const reactVirtualSource = fs
  .readFileSync(
    path.resolve(__dirname, '../node_modules/@tanstack/react-virtual/src/index.tsx'),
    'utf8',
  )
  .replace(/\r\n/g, '\n');

const reactVirtualTypes = fs
  .readFileSync(
    path.resolve(__dirname, '../node_modules/@tanstack/react-virtual/dist/esm/index.d.ts'),
    'utf8',
  )
  .replace(/\r\n/g, '\n');

/**
 * Điều kiện đảo (bỏ dòng `useFlushSync: false` khỏi message-list.tsx) →
 * describe này ĐỎ, và cảnh báo flushSync quay lại log.
 */
describe('virtualizer không gọi flushSync trong lifecycle của React', () => {
  it('message-list tắt useFlushSync', () => {
    expect(listSource).toMatch(/useFlushSync: false/);
  });

  it('option được đặt trong useVirtualizer, không phải ở chỗ khác', () => {
    /* Đặt nhầm ra ngoài khối options thì thành prop vô dụng — virtualizer vẫn
       flushSync và cảnh báo vẫn về. */
    const virtualizerBlock = listSource.slice(
      listSource.indexOf('useVirtualizer({'),
      listSource.indexOf('useVirtualizer({') + 2000,
    );
    expect(virtualizerBlock).toMatch(/useFlushSync: false/);
  });

  it('thư viện thực sự bỏ flushSync khi useFlushSync=false', () => {
    /* Khoá cả HAI vế của nhánh: thư viện phải rẽ sang `rerender()` thay vì
       `flushSync(rerender)`. Nếu thư viện đổi cấu trúc, test này đỏ thay vì
       im lặng hỏng. */
    expect(reactVirtualSource).toMatch(
      /if \(useFlushSync && sync\) \{\s*\n\s*flushSync\(rerender\)\s*\n\s*\} else \{\s*\n\s*rerender\(\)/,
    );
  });

  it('mặc định của thư viện là flushSync (nên phải tắt TƯỜNG MINH BẰNG OPTION)', () => {
    /* `useFlushSync = true` trong destructuring của useVirtualizerBase. Nếu
       thư viện đổi mặc định thì comment trong message-list.tsx sai và cảnh báo
       có thể đã không còn — cần biết để không sửa mù. */
    expect(reactVirtualSource).toMatch(/useFlushSync = true/);
    expect(reactVirtualTypes).toMatch(/useFlushSync\?: boolean/);
  });

  it('app không tự GỌI flushSync ở đâu cả (cảnh báo thuộc thư viện)', () => {
    /* Bỏ dòng comment trước khi so: chính khối comment giải thích lý do lại
       nhắc `flushSync(rerender)`. Chỉ CODE được so — import hay lời gọi
       `flushSync(...)` trong code mới là ứng viên gây lại cảnh báo. */
    const code = listSource
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/import[^;]*\bflushSync\b/);
    expect(code).not.toMatch(/\bflushSync\s*\(/);
    /* Còn `useFlushSync` thì phải là option, không phải lời gọi. */
    expect(code).toMatch(/useFlushSync: false/);
  });
});

/**
 * `useFlushSync: false` chỉ đúng khi vị trí hàng do React vẽ — nếu app bật
 * `directDomUpdates` thì virtualizer tự ghi `transform` vào DOM và đường
 * flushSync trở lại là cần thiết thật. Khoá để đổi cấu hình sau này không âm
 * thầm làm hỏng giả định này.
 */
describe('giả định: hàng do React render, không phải virtualizer tự ghi', () => {
  it('directDomUpdates không được bật', () => {
    expect(listSource).not.toMatch(/directDomUpdates:\s*true/);
  });

  it('vị trí hàng do chính JSX (style transform) viết', () => {
    expect(listSource).toMatch(/transform: `translateY\(\$\{virtualRow\.start\}px\)`/);
  });
});