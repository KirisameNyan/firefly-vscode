import { describe, expect, it } from "vitest";
import {
  DynamicIndexCache,
  buildDynamicEntries,
  buildDynamicHover,
  collectDynamicIssues,
  collectDynamicQuickFixes,
  dynamicCompletionContext,
  dynamicFieldSuggestions,
  dynamicHitTest,
  dynamicValueSuggestions,
  isDynamicFile,
  isValidPublished,
  locationCounts,
  parseDynamicFileName,
} from "../src/providers/dynamicCore";

/** 真实博客仓库 src/content/dynamic 下的 4 条动态，逐字复制，用来验证零误报。 */
const REAL_FILES: readonly { file: string; text: string }[] = [
  {
    file: "2026-07-15-010756.md",
    text: `---
published: 2026-07-15 01:07:56
---

今天天气真不错，流萤真可爱。

![图片1](https://s41.ax1x.com/2026/05/13/peXsfit.webp)
![图片2](https://s41.ax1x.com/2026/05/13/peXs2dA.webp)
![图片3](https://s41.ax1x.com/2026/05/13/peXshJP.webp)
![图片4](https://s41.ax1x.com/2026/05/13/peXsRII.webp)
![图片5](https://s41.ax1x.com/2026/05/13/peXyWm4.jpg)
![图片6](https://s41.ax1x.com/2026/05/13/peXyf0J.jpg)
![图片7](https://s41.ax1x.com/2026/05/13/peXyh79.jpg)
`,
  },
  {
    file: "2026-07-15-020613.md",
    text: `---
published: 2026-07-15 02:06:13
---

这是一条测试动态！
`,
  },
  {
    file: "2026-07-15-021127.md",
    text: `---
published: 2026-07-15 02:11:27
pinned: true
---

又是美好的一天！
`,
  },
  {
    file: "2026-07-15-161529.md",
    text: `---
published: 2026-07-15 16:15:29
location: 广西
---

飞萤之火自无梦的长夜亮起，绽放在终竟的明天。
`,
  },
];

function codes(text: string, fileName?: string): string[] {
  return collectDynamicIssues(text, fileName).map((issue) => issue.code);
}

function withPublished(value: string): string {
  return "---\npublished: " + value + "\n---\n\n正文\n";
}

describe("isValidPublished", () => {
  it("接受日期时间与纯日期", () => {
    expect(isValidPublished("2026-07-15 16:15:29")).toBe(true);
    expect(isValidPublished("2026-07-15")).toBe(true);
    expect(isValidPublished("2026-02-28 23:59:59")).toBe(true);
  });

  it("拒绝不存在的日期与错误格式", () => {
    expect(isValidPublished("2026-02-30 10:00:00")).toBe(false);
    expect(isValidPublished("2026-02-30")).toBe(false);
    expect(isValidPublished("2026/07/15")).toBe(false);
    expect(isValidPublished("2026-07-15 24:00:00")).toBe(false);
    expect(isValidPublished("2026-07-15 16:15")).toBe(false);
    expect(isValidPublished("")).toBe(false);
  });
});

describe("parseDynamicFileName", () => {
  it("从约定文件名推出时间", () => {
    expect(parseDynamicFileName("2026-07-15-161529.md")).toBe("2026-07-15 16:15:29");
    expect(parseDynamicFileName("2026-01-02-000000.md")).toBe("2026-01-02 00:00:00");
  });

  it("不合约定或时间非法时返回 undefined", () => {
    expect(parseDynamicFileName("hello.md")).toBeUndefined();
    expect(parseDynamicFileName("2026-07-15.md")).toBeUndefined();
    expect(parseDynamicFileName("2026-07-15-1615.md")).toBeUndefined();
    expect(parseDynamicFileName("2026-07-15-161529.markdown")).toBeUndefined();
    expect(parseDynamicFileName("2026-02-30-100000.md")).toBeUndefined();
    expect(parseDynamicFileName("2026-07-15-250000.md")).toBeUndefined();
  });
});

describe("collectDynamicIssues", () => {
  it("4 条真实动态零误报", () => {
    for (const real of REAL_FILES) {
      expect(collectDynamicIssues(real.text, real.file)).toEqual([]);
    }
  });

  it("没有 frontmatter 报错", () => {
    const issues = collectDynamicIssues("只有正文\n");
    expect(issues.map((i) => i.code)).toEqual(["dynamic.no-frontmatter"]);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("published");
  });

  it("缺 published 报错", () => {
    const text = "---\nlocation: 广西\n---\n\n正文\n";
    const issues = collectDynamicIssues(text, "2026-07-15-161529.md");
    expect(issues.map((i) => i.code)).toEqual(["dynamic.missing-published"]);
    expect(issues[0].severity).toBe("error");
  });

  it("published 非法时报错", () => {
    expect(codes(withPublished("2026/07/15"), "2026-07-15-161529.md")).toEqual([
      "dynamic.invalid-published",
    ]);
    expect(codes(withPublished("2026-02-30 10:00:00"))).toEqual(["dynamic.invalid-published"]);
    expect(codes(withPublished(""))).toEqual(["dynamic.invalid-published"]);
  });

  it("pinned 不是布尔值时报错", () => {
    const text = "---\npublished: 2026-07-15 16:15:29\npinned: yes\n---\n正文\n";
    const issues = collectDynamicIssues(text);
    expect(issues.map((i) => i.code)).toEqual(["dynamic.invalid-pinned"]);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("true");
  });

  it("未知键报警告，且不阻断", () => {
    const text = "---\npublished: 2026-07-15 16:15:29\ntitle: 你好\n---\n正文\n";
    const issues = collectDynamicIssues(text);
    expect(issues.map((i) => i.code)).toEqual(["dynamic.unknown-key"]);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("title");
  });

  it("文件名不合约定只提醒", () => {
    const text = REAL_FILES[1].text;
    const issues = collectDynamicIssues(text, "我的动态.md");
    expect(issues.map((i) => i.code)).toEqual(["dynamic.filename"]);
    expect(issues[0].severity).toBe("warning");
  });
});

describe("collectDynamicQuickFixes", () => {
  it("缺 published 且文件名可解析时补出时间", () => {
    const text = "---\nlocation: 广西\n---\n\n正文\n";
    const plans = collectDynamicQuickFixes(text, "2026-07-15-161529.md");
    expect(plans).toHaveLength(1);
    expect(plans[0].code).toBe("dynamic.missing-published");
    const edit = plans[0].edits[0];
    expect(edit.newText).toBe("published: 2026-07-15 16:15:29\n");
    const patched = text.slice(0, edit.range.start) + edit.newText + text.slice(edit.range.end);
    expect(collectDynamicIssues(patched, "2026-07-15-161529.md")).toEqual([]);
  });

  it("文件名推不出时间时不提供修复", () => {
    expect(collectDynamicQuickFixes("---\nlocation: 广西\n---\n", "我的动态.md")).toEqual([]);
  });
});

describe("补全", () => {
  it("字段补全跳过已存在的键，Detail 带中文名与类型", () => {
    const all = dynamicFieldSuggestions([]);
    expect(all.map((s) => s.label)).toEqual(["published", "location", "pinned"]);
    expect(all[0].detail).toContain("发布时间");
    expect(all[0].detail).toContain("YYYY-MM-DD HH:mm:ss");
    expect(all[0].detail).toContain("必填");
    expect(all[0].documentation).toContain("**发布时间**");
    expect(all[0].insertText).toBe("published: ");

    const partial = dynamicFieldSuggestions(["published", "location"]);
    expect(partial.map((s) => s.label)).toEqual(["pinned"]);
  });

  it("键名上下文能识别已填字段", () => {
    const text = "---\npublished: 2026-07-15 16:15:29\n\n---\n正文\n";
    const context = dynamicCompletionContext(text, text.indexOf("\n\n---") + 1);
    expect(context).not.toBeNull();
    expect(context?.kind).toBe("key");
    if (context?.kind !== "key") return;
    expect(context.existingKeys).toEqual(["published"]);
    expect(context.colonAfter).toBe(false);
  });

  it("值上下文识别 pinned，范围覆盖当前值", () => {
    const text = "---\npublished: 2026-07-15 16:15:29\npinned: false\n---\n";
    const valueStart = text.indexOf("false");
    const context = dynamicCompletionContext(text, valueStart + 3);
    expect(context?.kind).toBe("value");
    if (context?.kind !== "value") return;
    expect(context.key).toBe("pinned");
    expect(context.range).toEqual({ start: valueStart, end: valueStart + "false".length });
    expect(context.prefix).toBe("fal");
  });

  it("空值的补全范围是一个插入点", () => {
    const text = "---\npublished: 2026-07-15 16:15:29\nlocation: \n---\n";
    const context = dynamicCompletionContext(text, text.indexOf("location: ") + "location: ".length);
    expect(context?.kind).toBe("value");
    if (context?.kind !== "value") return;
    expect(context.key).toBe("location");
    expect(context.range.start).toBe(context.range.end);
    expect(context.prefix).toBe("");
  });

  it("frontmatter 之外不给补全", () => {
    const text = "---\npublished: 2026-07-15 16:15:29\n---\n正文\n";
    expect(dynamicCompletionContext(text, text.length)).toBeNull();
  });

  it("pinned 的值为 true / false", () => {
    expect(dynamicValueSuggestions("pinned").map((s) => s.label)).toEqual(["true", "false"]);
    expect(dynamicValueSuggestions("pinned")[0].documentation).toContain("**置顶**");
  });

  it("location 取其它动态用过的值，去重并按次数降序", () => {
    const entries = buildDynamicEntries([
      { path: "/w/src/content/dynamic/a.md", text: "---\npublished: 2026-07-15 16:15:29\nlocation: 广西\n---\n" },
      { path: "/w/src/content/dynamic/b.md", text: "---\npublished: 2026-07-16 10:00:00\nlocation: 广西\n---\n" },
      { path: "/w/src/content/dynamic/c.md", text: "---\npublished: 2026-07-17 10:00:00\nlocation: 上海\nlocation: 广西\n---\n" },
    ]);
    expect(locationCounts(entries)).toEqual([
      { value: "广西", count: 3 },
      { value: "上海", count: 1 },
    ]);
    expect(dynamicValueSuggestions("location", entries).map((s) => s.label)).toEqual(["广西", "上海"]);

    const except = dynamicValueSuggestions("location", entries, {
      exceptPath: "/w/src/content/dynamic/a.md",
    });
    expect(except.map((s) => s.label)).toEqual(["广西", "上海"]);
    expect(except[0].detail).toContain("2 条动态");

    const onlyOne = dynamicValueSuggestions("location", entries, {
      exceptPath: "\\w\\src\\content\\dynamic\\c.md",
    });
    expect(onlyOne.map((s) => s.label)).toEqual(["广西"]);
  });

  it("光标紧跟冒号时值补全补一个空格", () => {
    const suggestions = dynamicValueSuggestions("pinned", [], { leadingSpace: true });
    expect(suggestions.map((s) => s.insertText)).toEqual([" true", " false"]);
  });
});

describe("悬停", () => {
  it("字段名与值都给出说明", () => {
    const text = "---\npublished: 2026-07-15 16:15:29\nlocation: 广西\n---\n";
    const keyHit = dynamicHitTest(text, text.indexOf("location") + 2);
    expect(keyHit?.target).toBe("key");
    expect(buildDynamicHover(keyHit!)).toContain("**位置**");

    const valueHit = dynamicHitTest(text, text.indexOf("广西") + 1);
    expect(valueHit?.target).toBe("value");
    const md = buildDynamicHover(valueHit!, [{ path: "/w/a.md", locations: ["广西"] }], "/w/b.md");
    expect(md).toContain("当前值");
    expect(md).toContain("工作区中已有 1 条动态使用它");
  });

  it("未知键提示动态的 3 个字段", () => {
    const text = "---\npublished: 2026-07-15 16:15:29\ntitle: 你好\n---\n";
    const hit = dynamicHitTest(text, text.indexOf("title") + 1);
    expect(hit?.field).toBeNull();
    expect(buildDynamicHover(hit!)).toContain("published / location / pinned");
  });
});

describe("isDynamicFile", () => {
  it("只认动态目录下的 .md", () => {
    expect(isDynamicFile("/w/src/content/dynamic/a.md", "/w/src/content/dynamic")).toBe(true);
    expect(isDynamicFile("/w/src/content/dynamic/sub/a.md", "/w/src/content/dynamic/")).toBe(true);
    expect(isDynamicFile("/w/src/content/dynamic/a.mdx", "/w/src/content/dynamic")).toBe(false);
    expect(isDynamicFile("/w/src/content/posts/a.md", "/w/src/content/dynamic")).toBe(false);
  });
});

describe("DynamicIndexCache", () => {
  it("只扫描一次，invalidate 后重扫", async () => {
    let scans = 0;
    const cache = new DynamicIndexCache(async () => {
      scans += 1;
      return [{ path: "/w/a.md", text: "---\npublished: 2026-07-15 16:15:29\nlocation: 广西\n---\n" }];
    });
    expect((await cache.get())[0].locations).toEqual(["广西"]);
    await cache.get();
    expect(scans).toBe(1);
    cache.invalidate();
    await cache.get();
    expect(scans).toBe(2);
  });
});
