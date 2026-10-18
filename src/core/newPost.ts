//! 纯逻辑：新文章落盘计划（重名检测、slug 兜底），不依赖 vscode。

import * as path from "node:path";
import { isValidSlug } from "./slug";

export type NewPostPlan =
  | { ok: true; filePath: string; slug: string }
  | { ok: false; reason: "invalid-slug" | "exists"; filePath: string; slug: string };

/** 规划目标文件；exists 由调用方注入（命令层传 fs.existsSync，单测传内存集合）。 */
export function planNewPostFile(
  postsDir: string,
  rawSlug: string,
  exists: (filePath: string) => boolean,
): NewPostPlan {
  const slug = rawSlug.trim();
  if (!isValidSlug(slug)) {
    return { ok: false, reason: "invalid-slug", filePath: "", slug };
  }
  const filePath = path.join(postsDir, slug + ".md");
  if (exists(filePath)) {
    return { ok: false, reason: "exists", filePath, slug };
  }
  return { ok: true, filePath, slug };
}
