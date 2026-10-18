/**
 * Adapter CLIENT cho disk skills + hints (P0-3): đóng gói khác biệt desktop
 * bridge ↔ web File System Access để chat-interface chỉ gọi một hàm.
 *
 * Không test bằng vitest-node (đụng bridge/FSA thật) — logic thuần nằm ở
 * lib/skills/disk.ts và đã được test ở đó.
 */

import type { DiskSkillAdapters, DiskSkillEntry } from '@/lib/skills/disk';
import { pickHintsContent, HINTS_FILE_CANDIDATES } from '@/lib/skills/disk';
import { desktopFsList, desktopFsRead } from '@/lib/desktop-fs';
import { requireWorkspace, fsRead, type FsDeps, type FsDirHandleLike } from '@/lib/fs-access';
import { isVyenDesktop, vyenDesktop } from '@/lib/desktop-bridge';

async function webSkillDir(deps: FsDeps, dirName?: string): Promise<FsDirHandleLike> {
  let dir = await deps.root.getDirectoryHandle('.vyen', { create: false });
  dir = await dir.getDirectoryHandle('skills', { create: false });
  return dirName ? dir.getDirectoryHandle(dirName, { create: false }) : dir;
}

type FsDirLike = FsDirHandleLike;

export function buildDiskSkillAdapters(): DiskSkillAdapters {
  if (isVyenDesktop()) {
    const bridge = vyenDesktop();
    return {
      listWorkspaceSkillDirs: async () => {
        try {
          return (await desktopFsList('.vyen/skills'))
            .filter((e) => e.type === 'dir')
            .map((e) => e.name);
        } catch {
          return [];
        }
      },
      readWorkspaceSkill: async (dirName) => {
        const r = (await desktopFsRead(`.vyen/skills/${dirName}/SKILL.md`)) as unknown as {
          content?: string;
        };
        return String(r.content ?? '');
      },
      ...(bridge?.skills
        ? {
            listGlobalSkillDirs: async () =>
              (await bridge.skills!.listGlobal()).skills.map((s) => s.name),
            readGlobalSkill: async (name) => (await bridge.skills!.readGlobal(name)).content,
          }
        : {}),
    };
  }
  return {
    listWorkspaceSkillDirs: async () => {
      try {
        const ws = await requireWorkspace();
        if (!ws.ok) return [];
        const dir = (await webSkillDir(ws.deps)) as unknown as FsDirLike;
        const names: string[] = [];
        for await (const entry of dir.values()) {
          if (entry.kind === 'directory') names.push(entry.name);
        }
        return names;
      } catch {
        return [];
      }
    },
    readWorkspaceSkill: async (dirName) => {
      const ws = await requireWorkspace();
      if (!ws.ok) throw new Error(ws.error);
      const dir = (await webSkillDir(ws.deps, dirName)) as unknown as FsDirLike;
      const fh = await dir.getFileHandle('SKILL.md');
      return (await fh.getFile()).text();
    },
  };
}

/** Đọc hints (.vyenhints → AGENTS.md) từ workspace. */
export async function readHintsFromWorkspace(): Promise<{ file: string; content: string } | null> {
  let read: (file: string) => Promise<string>;
  if (isVyenDesktop()) {
    read = async (file) => {
      const r = (await desktopFsRead(file)) as unknown as { content?: string };
      return String(r.content ?? '');
    };
  } else {
    const ws = await requireWorkspace();
    if (!ws.ok) return null;
    read = (file) =>
      fsRead(ws.deps, file).then((r) => String((r as unknown as { content?: string }).content ?? ''));
  }
  const candidates: Array<{ file: string; content: string }> = [];
  for (const file of HINTS_FILE_CANDIDATES) {
    try {
      candidates.push({ file, content: await read(file) });
    } catch {
      /* file không tồn tại — bình thường */
    }
  }
  return pickHintsContent(candidates);
}

/**
 * Đọc các file agent ở `.vyen/agents/*.md` để gửi lên server.
 *
 * Server KHÔNG có đường dẫn workspace (cùng lý do `skillIndex` phải do client
 * dựng), nên nội dung file agent đi theo đúng con đường đó. Gửi cả tên file vì
 * tên agent CHÍNH LÀ tên file — nó không nằm trong nội dung markdown.
 *
 * `create: false` cố ý: thư mục chưa có phải là "chưa dùng tính năng", không phải
 * lỗi, và không được tự sinh ra thư mục rỗng trên máy người dùng.
 */
export async function readAgentFilesFromWorkspace(): Promise<
  { name: string; content: string }[]
> {
  // Trần khớp `BodySchema.agents` ở route.ts. Gửi vượt trần sẽ khiến
  // `safeParse` fail và mọi lượt chat sau đó trả 400 — một file agent quá dài
  // đủ để làm hỏng app cho người dùng đó.
  const MAX_FILES = 30;
  const MAX_CHARS = 4_000;
  const entries: { name: string; content: string }[] = [];
  const push = (name: string, content: string) => {
    if (entries.length >= MAX_FILES) return;
    if (!content.trim()) return;
    entries.push({ name, content: content.slice(0, MAX_CHARS) });
  };

  if (isVyenDesktop()) {
    try {
      const files = (await desktopFsList('.vyen/agents')).filter(
        (e) => e.type === 'file' && e.name.endsWith('.md'),
      );
      for (const e of files) {
        try {
          const r = (await desktopFsRead(`.vyen/agents/${e.name}`)) as unknown as {
            content?: string;
          };
          push(e.name, String(r.content ?? ''));
        } catch {
          /* file không đọc được — bỏ, agent còn lại vẫn dùng được */
        }
      }
    } catch {
      return [];
    }
    return entries;
  }

  const ws = await requireWorkspace();
  if (!ws.ok) return [];
  try {
    const vyen = await ws.deps.root.getDirectoryHandle('.vyen', { create: false });
    const dir = (await vyen.getDirectoryHandle('agents', { create: false })) as FsDirLike;
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue;
      try {
        const fh = await dir.getFileHandle(entry.name);
        push(entry.name, await (await fh.getFile()).text());
      } catch {
        /* bỏ qua file hỏng */
      }
    }
  } catch {
    return [];
  }
  return entries;
}

/** Đọc nội dung skill + danh sách file phụ — thân tool skill_load. */
export async function loadSkillContent(
  entry: DiskSkillEntry,
): Promise<{ name: string; source: string; content: string; files: string[] }> {
  if (entry.source === 'global') {
    const bridge = vyenDesktop();
    if (!bridge?.skills) throw new Error('Skill toàn cục cần desktop bridge bản mới (không có lệnh home-skills).');
    const r = await bridge.skills.readGlobal(entry.name);
    return { name: entry.name, source: 'global', content: r.content, files: r.files };
  }
  if (isVyenDesktop()) {
    const skillMd = (await desktopFsRead(`${entry.dir}/SKILL.md`)) as unknown as { content?: string };
    let files: string[] = [];
    try {
      files = (await desktopFsList(entry.dir))
        .filter((e) => e.name !== 'SKILL.md')
        .map((e) => (e.type === 'dir' ? `${e.name}/` : e.name));
    } catch {
      /* liệt kê hỏng — vẫn trả nội dung chính */
    }
    return { name: entry.name, source: 'workspace', content: String(skillMd.content ?? ''), files };
  }
  const ws = await requireWorkspace();
  if (!ws.ok) throw new Error(ws.error);
  const parts = entry.dir.split('/');
  const dirName = parts[parts.length - 1]!;
  const dir = (await webSkillDir(ws.deps, dirName)) as unknown as FsDirLike;
  const fh = await dir.getFileHandle('SKILL.md');
  const content = await (await fh.getFile()).text();
  const files: string[] = [];
  for await (const e of dir.values()) {
    if (e.name !== 'SKILL.md') files.push(e.kind === 'directory' ? `${e.name}/` : e.name);
  }
  return { name: entry.name, source: 'workspace', content, files };
}
