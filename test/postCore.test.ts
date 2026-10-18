import { describe, expect, it } from "vitest";
import {
  buildHover,
  collectIssues,
  collectQuickFixes,
  fieldSuggestions,
  getCompletionContext,
  hitTest,
  isIsoDate,
  isPostFile,
  needsLeadingSpace,
  valueSuggestions,
  type CompletionContext,
  type TextEditPlan,
} from "../src/providers/postCore";
import { EMPTY_INDEX, type WorkspaceIndex } from "../src/providers/postModel";

const OK_POST = [
  "---",
  "title: 你好，世界",
  "published: 2026-10-17",
  "pinned: true",
  "tags: [随笔, 关于]",
  "category: 随笔",
  "series: 站务",
  "seriesOrder: 1",
  "---",
  "",
  "## 正文",
  "",
].join("\n");

const INDEX: WorkspaceIndex = {
  fileCount: 3,
  tags: [
    { value: "随笔", count: 3 },
    { value: "关于", count: 1 },
  ],
  categories: [{ value: "随笔", count: 2 }],
  series: [],
  langs: [{ value: "zh-CN", count: 1 }],
};

function applyEdits(text: string, edits: readonly TextEditPlan[]): string {
  let out = text;
  const ordered = [...edits].sort((a, b) => b.range.start - a.range.start);
  for (const edit of ordered) {
    out = out.slice(0, edit.range.start) + edit.newText + out.slice(edit.range.end);
  }
  return out;
}

function keyContext(context: CompletionContext | null): Extract<CompletionContext, { kind: "key" }> {
  if (!context || context.kind !== "key") throw new Error("expected key context");
  return context;
}

function valueContextOf(
  context: CompletionContext | null,
): Extract<CompletionContext, { kind: "value" }> {
  if (!context || context.kind !== "value") throw new Error("expected value context");
  return context;
}

describe("collectIssues", () => {
  it("正常文章无错", () => {
    expect(collectIssues(OK_POST)).toEqual([]);
  });

  it("未知键 -> Warning，并给出整行范围", () => {
    const text = OK_POST.replace("pinned: true", "pinnd: true");
    const issues = collectIssues(text);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("unknown-key");
    expect(issues[0].severity).toBe("warning");
    expect(text.slice(issues[0].range.start, issues[0].range.end)).toBe("pinnd");
    const line = issues[0].lineRange!;
    expect(text.slice(line.start, line.end)).toBe("pinnd: true\n");
  });

  it("INTERNAL_KEYS 里的键静默放过", () => {
    const text = OK_POST.replace("pinned: true", "prevTitle: 上一篇\nnextSlug: prev");
    expect(collectIssues(text)).toEqual([]);
  });

  it("缺 published -> Error，定位到 frontmatter 开头", () => {
    const text = OK_POST.replace("published: 2026-10-17\n", "");
    const issues = collectIssues(text);
    expect(issues.map((issue) => issue.code)).toEqual(["missing-published"]);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].range.start).toBe(4);
    expect(issues[0].range.end).toBe(5);
  });

  it("同时缺 title 与 published 时各报一条", () => {
    const text = ["---", "description: 只有简介", "---", ""].join("\n");
    const issues = collectIssues(text);
    expect(issues.map((issue) => issue.code)).toEqual(["missing-title", "missing-published"]);
    expect(issues.every((issue) => issue.range.start === 4)).toBe(true);
  });

  it("非法日期 -> Error，范围是值本身", () => {
    for (const bad of ["2026-13-45", "2026-02-30", "2026/10/17", "2026-1-1"]) {
      const text = OK_POST.replace("published: 2026-10-17", "published: " + bad);
      const issues = collectIssues(text);
      expect(issues.map((issue) => issue.code)).toEqual(["invalid-date"]);
      expect(text.slice(issues[0].range.start, issues[0].range.end)).toBe(bad);
    }
  });

  it("seriesOrder 非整数 -> Error", () => {
    const text = OK_POST.replace("seriesOrder: 1", "seriesOrder: 1.5");
    const issues = collectIssues(text);
    expect(issues.map((issue) => issue.code)).toEqual(["invalid-number"]);
    expect(text.slice(issues[0].range.start, issues[0].range.end)).toBe("1.5");
  });

  it("布尔字段不是 true/false -> Error", () => {
    const text = OK_POST.replace("pinned: true", "pinned: yes");
    const issues = collectIssues(text);
    expect(issues.map((issue) => issue.code)).toEqual(["invalid-boolean"]);
  });

  it("重复键 -> Warning，指向第二次出现的键名", () => {
    const text = OK_POST.replace("pinned: true", "pinned: true\ntitle: 重复的标题");
    const issues = collectIssues(text);
    expect(issues.map((issue) => issue.code)).toEqual(["duplicate-key"]);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("第 2 行");
  });

  it("块状 tags 不误判", () => {
    const text = [
      "---",
      "title: 块状标签",
      "published: 2026-10-17",
      "tags:",
      "  - 随笔",
      '  - "关于"',
      "draft: false",
      "---",
      "",
    ].join("\n");
    expect(collectIssues(text)).toEqual([]);
  });

  it("没有 frontmatter 时不报错", () => {
    expect(collectIssues("## 只有正文\n")).toEqual([]);
  });
});

describe("isIsoDate", () => {
  it("接受合法日期", () => {
    expect(isIsoDate("2026-10-17")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("拒绝非法日期", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate("2026/10/17")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});

describe("isPostFile", () => {
  const dir = "/w/src/content/posts";
  it("识别文章目录下的 md/mdx", () => {
    expect(isPostFile(dir + "/a.md", dir)).toBe(true);
    expect(isPostFile(dir + "/nested/b.mdx", dir)).toBe(true);
    expect(isPostFile("C:\\w\\src\\content\\posts\\a.md", "C:\\w\\src\\content\\posts")).toBe(true);
  });

  it("排除目录外与非 markdown", () => {
    expect(isPostFile(dir + "/a.txt", dir)).toBe(false);
    expect(isPostFile("/w/src/content/posts2/a.md", dir)).toBe(false);
    expect(isPostFile("/w/src/content/posts.md", dir)).toBe(false);
  });
});

describe("getCompletionContext", () => {
  const keyText = ["---", "title: t", "published: 2026-10-17", "ca", "---", ""].join("\n");

  it("行首半截键名 -> key 上下文", () => {
    const offset = keyText.indexOf("\nca\n") + 3;
    const context = keyContext(getCompletionContext(keyText, offset));
    expect(context.prefix).toBe("ca");
    expect(context.colonAfter).toBe(false);
    expect(context.existingKeys).toContain("title");
    expect(keyText.slice(context.range.start, context.range.end)).toBe("ca");
  });

  it("frontmatter 之外返回 null", () => {
    const text = ["---", "title: t", "---", "", "ca", ""].join("\n");
    expect(getCompletionContext(text, text.lastIndexOf("ca") + 2)).toBeNull();
  });

  it("没有 frontmatter 返回 null", () => {
    expect(getCompletionContext("title: t\n", 3)).toBeNull();
  });

  it("内联数组元素 -> value 上下文", () => {
    const text = ["---", "title: t", "published: 2026-10-17", "tags: [随笔, 关]", "---", ""].join(
      "\n",
    );
    const offset = text.indexOf("关") + 1;
    const context = valueContextOf(getCompletionContext(text, offset));
    expect(context.key).toBe("tags");
    expect(context.prefix).toBe("关");
    expect(context.array).toBe(true);
    expect(text.slice(context.range.start, context.range.end)).toBe("关");
  });

  it("块状列表项 -> value 上下文", () => {
    const text = ["---", "title: t", "published: 2026-10-17", "tags:", "  - 随", "---", ""].join(
      "\n",
    );
    const offset = text.indexOf("随") + 1;
    const context = valueContextOf(getCompletionContext(text, offset));
    expect(context.key).toBe("tags");
    expect(context.prefix).toBe("随");
    expect(context.array).toBe(true);
  });

  it("空值 -> 插入点在行尾，不吞已有空格", () => {
    const text = ["---", "title: t", "published: 2026-10-17", "category: ", "---", ""].join("\n");
    const offset = text.indexOf("category: ") + "category: ".length;
    const context = valueContextOf(getCompletionContext(text, offset));
    expect(context.prefix).toBe("");
    expect(context.range.start).toBe(offset);
    expect(context.range.start).toBe(context.range.end);
    expect(needsLeadingSpace(text, context.range.start)).toBe(false);
  });

  it("冒号后紧跟光标时需要补空格", () => {
    const text = ["---", "title: t", "category:", "---", ""].join("\n");
    const offset = text.indexOf("category:") + "category:".length;
    const context = valueContextOf(getCompletionContext(text, offset));
    expect(context.key).toBe("category");
    expect(needsLeadingSpace(text, context.range.start)).toBe(true);
  });
});

describe("fieldSuggestions", () => {
  it("只提示尚未出现的字段，Detail 为 label + 类型", () => {
    const suggestions = fieldSuggestions(["title", "published"]);
    expect(suggestions).toHaveLength(18);
    const labels = suggestions.map((suggestion) => suggestion.label);
    expect(labels).not.toContain("title");
    expect(labels).not.toContain("published");
    const tags = suggestions.find((suggestion) => suggestion.label === "tags")!;
    expect(tags.detail).toContain("标签");
    expect(tags.detail).toContain("字符串数组");
    expect(tags.insertText).toBe("tags: ");
    expect(tags.documentation).toContain("标签数组");
  });

  it("已经有冒号时只插入键名", () => {
    const tags = fieldSuggestions([], { colonAfter: true }).find((s) => s.label === "tags")!;
    expect(tags.insertText).toBe("tags");
  });
});

describe("valueSuggestions", () => {
  it("tags 按工作区频次降序", () => {
    const tags = valueSuggestions("tags", INDEX);
    expect(tags.map((suggestion) => suggestion.label)).toEqual(["随笔", "关于"]);
    expect(tags[0].detail).toContain("3 篇");
    expect(tags[0].insertText).toBe("随笔");
  });

  it("category / series 来自工作区", () => {
    expect(valueSuggestions("category", INDEX).map((s) => s.label)).toEqual(["随笔"]);
    expect(valueSuggestions("series", INDEX)).toEqual([]);
    expect(valueSuggestions("tags", EMPTY_INDEX)).toEqual([]);
  });

  it("lang 合并工作区值与常用语言", () => {
    expect(valueSuggestions("lang", INDEX).map((s) => s.label)).toEqual(["zh-CN", "zh-TW", "en"]);
  });

  it("布尔字段给 true/false", () => {
    for (const key of ["draft", "pinned", "comment", "link.external"]) {
      expect(valueSuggestions(key).map((s) => s.label)).toEqual(["true", "false"]);
    }
    expect(valueSuggestions("draft")[0].documentation).toContain("draft: true");
  });

  it("licenseName 给协议预设", () => {
    const labels = valueSuggestions("licenseName").map((s) => s.label);
    expect(labels).toContain("CC BY-NC-SA 4.0");
    expect(labels).toContain("MIT");
    expect(labels).toContain("保留所有权利");
  });

  it("leadingSpace 只为值加前导空格", () => {
    expect(valueSuggestions("category", INDEX, { leadingSpace: true })[0].insertText).toBe(" 随笔");
    expect(valueSuggestions("category", INDEX)[0].insertText).toBe("随笔");
  });

  it("没有建议的字段返回空数组", () => {
    expect(valueSuggestions("description", INDEX)).toEqual([]);
  });
});

describe("collectQuickFixes", () => {
  it("缺必填字段 -> 在闭围栏前插入一行", () => {
    const text = ["---", "title: t", "---", ""].join("\n");
    const plans = collectQuickFixes(text, { today: "2026-10-17" });
    expect(plans.map((plan) => plan.code)).toEqual(["missing-published"]);
    expect(applyEdits(text, plans[0].edits)).toBe(
      ["---", "title: t", "published: 2026-10-17", "---", ""].join("\n"),
    );
  });

  it("未知键 -> 删除整行", () => {
    const text = ["---", "title: t", "published: 2026-10-17", "foo: bar", "---", ""].join("\n");
    const plans = collectQuickFixes(text);
    expect(plans).toHaveLength(1);
    expect(plans[0].code).toBe("unknown-key");
    expect(plans[0].title).toContain("foo");
    expect(applyEdits(text, plans[0].edits)).toBe(
      ["---", "title: t", "published: 2026-10-17", "---", ""].join("\n"),
    );
  });

  it("没有问题时没有修复项", () => {
    expect(collectQuickFixes(OK_POST)).toEqual([]);
  });
});

describe("hitTest / buildHover", () => {
  const text = [
    "---",
    "title: 你好",
    "published: 2026-10-17",
    "tags: [随笔, 关于]",
    "foo: bar",
    "---",
    "",
  ].join("\n");

  it("停在字段名上", () => {
    const hit = hitTest(text, text.indexOf("title") + 2)!;
    expect(hit.key).toBe("title");
    expect(hit.target).toBe("key");
    const hover = buildHover(hit, EMPTY_INDEX);
    expect(hover).toContain("标题");
    expect(hover).toContain("字符串");
    expect(hover).toContain("必填");
    expect(hover).toContain("示例");
  });

  it("停在内联数组元素上", () => {
    const hit = hitTest(text, text.indexOf("随笔") + 1)!;
    expect(hit.key).toBe("tags");
    expect(hit.target).toBe("value");
    expect(hit.value).toBe("随笔");
    expect(buildHover(hit, INDEX)).toContain("3 篇文章使用");
  });

  it("未知字段给出提示", () => {
    const hit = hitTest(text, text.indexOf("foo") + 1)!;
    expect(hit.field).toBeNull();
    expect(buildHover(hit)).toContain("未知字段");
  });

  it("停在块状列表项上", () => {
    const blockText = ["---", "title: t", "tags:", "  - 随笔", "---", ""].join("\n");
    const hit = hitTest(blockText, blockText.indexOf("随") + 1)!;
    expect(hit.key).toBe("tags");
    expect(hit.value).toBe("随笔");
    expect(hit.array).toBe(true);
  });
});
