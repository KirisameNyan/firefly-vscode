import { describe, expect, it } from "vitest";
import { isPostPath, parseFrontmatter, unquote } from "../src/frontmatter";

describe("isPostPath（冻结契约的回归测试）", () => {
  const dir = "/w/src/content/posts";
  it("接受文章目录下的 md/mdx", () => {
    expect(isPostPath("/w/src/content/posts/a.md", dir)).toBe(true);
    expect(isPostPath("/w/src/content/posts/sub/b.MDX", dir)).toBe(true);
  });
  it("拒绝目录外、其它扩展名、前缀相同但不同目录", () => {
    expect(isPostPath("/w/src/content/pages/a.md", dir)).toBe(false);
    expect(isPostPath("/w/src/content/posts/a.txt", dir)).toBe(false);
    expect(isPostPath("/w/src/content/posts-extra/a.md", dir)).toBe(false);
  });
  it("处理尾随斜杠与反斜杠", () => {
    expect(isPostPath("/w/src/content/posts/a.md", dir + "/")).toBe(true);
    expect(isPostPath("C:\\w\\src\\content\\posts\\a.md", "C:\\w\\src\\content\\posts")).toBe(true);
  });
});

describe("parseFrontmatter", () => {
  const text = ["---", "title: 你好", "tags: [a, b]", "# 注释", "draft: true", "---", "", "正文"].join("\n");

  it("定位每个键并给出绝对 offset", () => {
    const fm = parseFrontmatter(text);
    expect(fm.present).toBe(true);
    expect(fm.entries.map((e) => e.key)).toEqual(["title", "tags", "draft"]);
    const title = fm.entries[0];
    expect(text.slice(title.keyStart, title.keyEnd)).toBe("title");
    expect(text.slice(title.valueStart, title.valueEnd)).toBe("你好");
  });

  it("注释行与缩进行不算字段", () => {
    const fm = parseFrontmatter(text);
    expect(fm.entries.some((e) => e.key === "#")).toBe(false);
  });

  it("没有围栏或未闭合时 present=false", () => {
    expect(parseFrontmatter("# 标题\n正文").present).toBe(false);
    expect(parseFrontmatter("---\ntitle: x\n").present).toBe(false);
  });

  it("unquote 去掉成对引号", () => {
    expect(unquote("'a b'")).toBe("a b");
    expect(unquote('"x"')).toBe("x");
    expect(unquote("plain")).toBe("plain");
  });
});
