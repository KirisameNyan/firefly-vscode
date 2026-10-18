//! 纯函数：slug 推导与校验（不依赖 vscode，命令层与单测共用）。

const DISALLOWED = /[^a-z0-9_-]+/g;

/** 从标题推导默认 slug：小写化后只保留 a-z0-9-_，其余字符丢弃，再去掉首尾分隔符。 */
export function deriveSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(DISALLOWED, "")
    .replace(/^[-_]+/, "")
    .replace(/[-_]+$/, "");
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export const SLUG_HINT =
  "slug 只能包含小写字母、数字、- 和 _，且需以字母或数字开头和结尾";
