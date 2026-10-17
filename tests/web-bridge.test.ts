/**
 * Unit & Integration Tests cho Universal Web Bridge & Desktop launcher.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  initServerBridge,
  invokeBridgeChannel,
  isLocalRequest,
  getBridgeUserDataDir,
} from '../lib/bridge/server-bridge';
/* `CliCodingHarness` (lib/cli/interactive-agent) đã bị gỡ cùng CLI headless 2026-10-15. */

describe('Universal Web Bridge (Server Dispatcher)', () => {
  beforeAll(() => {
    initServerBridge();
  });

  it('khởi tạo thành công các kênh IPC cơ bản và MCP', () => {
    const dispatcher = initServerBridge();
    expect(dispatcher.initialized).toBe(true);
    expect(dispatcher.handlers.has('vyen:workspace-get')).toBe(true);
    expect(dispatcher.handlers.has('vyen:fs-list')).toBe(true);
    expect(dispatcher.handlers.has('vyen:shell-run')).toBe(true);
    expect(dispatcher.handlers.has('vyen:git-status')).toBe(true);
    expect(dispatcher.handlers.has('mcp:list-tools')).toBe(true);
  });

  it('getBridgeUserDataDir trả về đường dẫn hợp lệ và tồn tại', () => {
    const dir = getBridgeUserDataDir();
    expect(typeof dir).toBe('string');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('invokeBridgeChannel vyen:workspace-get trả về workspace hiện tại', async () => {
    const res = (await invokeBridgeChannel('vyen:workspace-get')) as { path: string | null };
    expect(res).toBeDefined();
    expect(typeof res.path).toBe('string');
    // Workspace là thư mục dự án hiện tại bất kể môi trường (sandbox CI dùng
    // '/home/daytona/codebase', máy dev dùng đường dẫn riêng của người dùng).
    expect(res.path!.length).toBeGreaterThan(0);
    expect(path.isAbsolute(res.path!)).toBe(true);
  });

  it('invokeBridgeChannel vyen:fs-list trả về danh sách file', async () => {
    const list = (await invokeBridgeChannel('vyen:fs-list', { relPath: '' })) as Array<{ name: string }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((item) => item.name === 'package.json')).toBe(true);
  });

  it('invokeBridgeChannel vyen:shell-run thực thi lệnh shell an toàn', async () => {
    const { createApprovalToken } = await import('../lib/approval-binding');
    const token = createApprovalToken({
      kind: 'shell',
      payload: { command: 'echo vyen-bridge-ok', cwd: undefined },
    });
    const res = (await invokeBridgeChannel('vyen:shell-run', {
      command: 'echo vyen-bridge-ok',
      approvalToken: token?.fingerprint,
    })) as { code: number; stdout: string; durationMs: number };

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('vyen-bridge-ok');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('chặn path traversal ra ngoài workspace khi dùng bridge', async () => {
    await expect(
      invokeBridgeChannel('vyen:fs-read', { relPath: '../outside-escape.txt' }),
    ).rejects.toThrow();
  });

  it('báo lỗi khi gọi channel không tồn tại', async () => {
    await expect(
      invokeBridgeChannel('vyen:invalid-channel-xyz'),
    ).rejects.toThrow(/không được hỗ trợ/i);
  });

  it('isLocalRequest xác thực chính xác origin an toàn', () => {
    const localReq = new Request('http://localhost:3000/api/bridge', {
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      },
    });
    expect(isLocalRequest(localReq)).toBe(true);

    const ipReq = new Request('http://127.0.0.1:3000/api/bridge', {
      headers: {
        host: '127.0.0.1:3000',
      },
    });
    expect(isLocalRequest(ipReq)).toBe(true);

    const remoteReq = new Request('http://evil.com/api/bridge', {
      headers: {
        host: 'evil.com',
        origin: 'https://evil.com',
      },
    });
    expect(isLocalRequest(remoteReq)).toBe(false);
  });

  it('chặn tuyệt đối tấn công giả mạo domain chứa chữ localhost hoặc 127.0.0.1', () => {
    // 1. Tấn công giả mạo origin: attacker-localhost.com
    const spoofedReq1 = new Request('http://localhost:3000/api/bridge', {
      headers: {
        host: 'localhost:3000',
        origin: 'http://attacker-localhost.com',
      },
    });
    expect(isLocalRequest(spoofedReq1)).toBe(false);

    // 2. Tấn công sub-domain: localhost.evil.com
    const spoofedReq2 = new Request('http://localhost:3000/api/bridge', {
      headers: {
        host: 'localhost:3000',
        origin: 'https://localhost.evil.com',
      },
    });
    expect(isLocalRequest(spoofedReq2)).toBe(false);

    // 3. Tấn công tham số: evil.com/?q=localhost
    const spoofedReq3 = new Request('http://localhost:3000/api/bridge', {
      headers: {
        host: 'localhost:3000',
        referer: 'https://evil.com/?q=localhost',
      },
    });
    expect(isLocalRequest(spoofedReq3)).toBe(false);

    // 4. Chặn browser cross-site metadata
    const crossSiteReq = new Request('http://localhost:3000/api/bridge', {
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(isLocalRequest(crossSiteReq)).toBe(false);
  });

  it('vyen:workspace-select với payload path cập nhật đúng workspace', async () => {
    const currentWd = process.cwd();
    const res = (await invokeBridgeChannel('vyen:workspace-select', { path: currentWd })) as { path: string };
    expect(res.path).toBe(path.resolve(currentWd));
  });
});

  /*
 * 2026-10-15: khối `CliCodingHarness (Harness Primitives)` và các lệnh CLI
 * (`--version / status / diff / read / audit / init / cli`) đã bị xoá cùng
 * `lib/cli/interactive-agent.ts` + `bin/vyen.ts`. Phần bridge phía trên và test
 * launcher dưới đây vẫn kiểm những thứ còn sống.
 */
describe('Desktop launcher', () => {
  it('scripts/launch-desktop.cjs hỗ trợ cờ --help và thoát 0', () => {
    const { spawnSync } = require('node:child_process');
    const res = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'launch-desktop.cjs'), '--help'], {
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Vyen Fast Desktop Launcher');
    expect(res.stdout).toContain('--port');
  });
});



