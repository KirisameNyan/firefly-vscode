//! 纯函数：新文章 frontmatter 模板。
//! 字段与顺序逐行对齐上游 Firefly/scripts/new-post.js 的 content 常量，不要增删或重排。

export const POST_TEMPLATE_KEYS = [
  "title",
  "published",
  "description",
  "image",
  "tags",
  "category",
  "draft",
  "lang",
  "slug",
] as const;

export interface PostTemplateInput {
  title: string;
  published: string;
  slug: string;
}

/** 生成与上游 new-post.js 一致的 markdown 文本（含 --- 围栏与结尾换行）。 */
export function buildPostFrontmatter(input: PostTemplateInput): string {
  const lines = [
    "---",
    "title: " + input.title,
    "published: " + input.published,
    "description: ''",
    "image: ''",
    "tags: []",
    "category: ''",
    "draft: false",
    "lang: ''",
    "slug: " + input.slug,
    "---",
  ];
  return lines.join("\n") + "\n";
}

/** 正文起点 offset：闭围栏之后的位置。 */
export function postBodyStart(text: string): number {
  const fence = text.lastIndexOf("\n---");
  if (fence === -1) return text.length;
  let i = fence + 4;
  if (text[i] === "\r") i += 1;
  if (text[i] === "\n") i += 1;
  return Math.min(i, text.length);
}
