//! vscode 侧路径解析：把 firefly.* 配置项解析成绝对路径。

import * as path from "node:path";
import * as vscode from "vscode";

const DEFAULT_POSTS_DIR = "src/content/posts";
const DEFAULT_ANNOUNCEMENT_FILE = "src/config/announcementConfig.ts";

export function workspaceRoot(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder === undefined ? null : folder.uri.fsPath;
}

function setting(key: string, fallback: string): string {
  const value = vscode.workspace.getConfiguration("firefly").get<string>(key);
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

export function resolveWorkspacePath(relative: string): string | null {
  if (path.isAbsolute(relative)) return relative;
  const root = workspaceRoot();
  return root === null ? null : path.join(root, relative);
}

export function resolvePostsDir(): string | null {
  return resolveWorkspacePath(setting("postsDir", DEFAULT_POSTS_DIR));
}

export function resolveAnnouncementPath(): string | null {
  return resolveWorkspacePath(setting("announcementFile", DEFAULT_ANNOUNCEMENT_FILE));
}

export function normalizeFsPath(p: string): string {
  const n = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? n.toLowerCase() : n;
}

export function samePath(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}
