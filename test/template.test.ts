import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/frontmatter";
import { POST_TEMPLATE_KEYS, buildPostFrontmatter, postBodyStart } from "../src/core/template";

const INPUT = { title: "你好，世界", published: "2026-10-17", slug: "hello-world" };

describe("buildPostFrontmatter", () => {
  it("逐行对齐上游 new-post.js", () => {
    const expected = [
      "---",
      "title: 你好，世界",
      "published: 2026-10-17",
      "description: ''",
      "image: ''",
      "tags: []",
      "category: ''",
      "draft: false",
      "lang: ''",
      "slug: hello-world",
      "---",
      "",
    ].join("\n");
    expect(buildPostFrontmatter(INPUT)).toBe(expected);
  });

  it("字段顺序为 title/published/description/image/tags/category/draft/lang/slug", () => {
    expect([...POST_TEMPLATE_KEYS]).toEqual([
      "title",
      "published",
      "description",
      "image",
      "tags",
      "category",
      "draft",
      "lang",
      "slug",
    ]);
    const parsed = parseFrontmatter(buildPostFrontmatter(INPUT));
    expect(parsed.present).toBe(true);
    expect(parsed.entries.map((e) => e.key)).toEqual([...POST_TEMPLATE_KEYS]);
  });

  it("正文起点位于闭围栏之后", () => {
    const text = buildPostFrontmatter(INPUT);
    expect(postBodyStart(text)).toBe(text.length);
    expect(text.slice(postBodyStart(text))).toBe("");
  });
});
