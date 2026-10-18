import { describe, expect, it } from "vitest";
import { buildPostFrontmatter } from "../src/core/template";
import { validatePostText } from "../src/core/validatePost";
import { formatReport, summarize, type FileIssues } from "../src/core/issues";

const TEMPLATE = buildPostFrontmatter({
  title: "你好，世界",
  published: "2026-10-17",
  slug: "hello-world",
});

function codes(text: string): string[] {
  return validatePostText(text).map((i) => i.code);
}

describe("validatePostText", () => {
  it("模板本身零问题", () => {
    expect(validatePostText(TEMPLATE)).toEqual([]);
  });

  it("缺少必填字段 title / published", () => {
    const text = "---\ndescription: 只有简介\n---\n正文\n";
    const issues = validatePostText(text);
    const missing = issues.filter((i) => i.code === "post.missing-required");
    expect(missing.map((i) => i.message).join("|")).toContain("title");
    expect(missing.map((i) => i.message).join("|")).toContain("published");
    expect(missing.every((i) => i.severity === "error")).toBe(true);
  });

  it("日期非法报错误", () => {
    const text = TEMPLATE.replace("2026-10-17", "2026-02-30");
    const issues = validatePostText(text);
    expect(issues.some((i) => i.code === "post.bad-date")).toBe(true);
    expect(issues[0].line).toBe(3);
  });

  it("未知字段报警告，内部键不报", () => {
    expect(codes(TEMPLATE.replace("draft:", "weird: 1\ndraft:"))).toContain("post.unknown-field");
    expect(codes(TEMPLATE + "prevTitle: x\n")).toEqual([]);
  });

  it("布尔值非法报错误", () => {
    expect(codes(TEMPLATE.replace("draft: false", "draft: yes"))).toContain("post.bad-boolean");
  });

  it("块状 tags 不误报，行内非数组形式报警告", () => {
    const block = TEMPLATE.replace("tags: []", "tags:\n  - 随笔\n  - 关于");
    expect(codes(block)).toEqual([]);
    expect(codes(TEMPLATE.replace("tags: []", "tags: 随笔"))).toContain("post.bad-array");
  });

  it("没有 frontmatter 直接报错", () => {
    expect(codes("# 只有正文\n")).toEqual(["post.no-frontmatter"]);
  });

  it("一次能同时发现多类问题", () => {
    const text = [
      "---",
      "weird: 1",
      "published: 2026-02-30",
      "draft: nope",
      "---",
      "正文",
      "",
    ].join("\n");
    const found = codes(text);
    expect(found).toContain("post.unknown-field");
    expect(found).toContain("post.bad-date");
    expect(found).toContain("post.bad-boolean");
    expect(found).toContain("post.missing-required");
    expect(new Set(found).size).toBeGreaterThanOrEqual(4);
  });
});

describe("summarize / formatReport", () => {
  const files: FileIssues[] = [
    {
      file: "/w/a.md",
      issues: [
        { severity: "error", code: "post.missing-required", message: "缺少必填字段 title（标题）", line: 2, column: 1, endLine: 2, endColumn: 5 },
        { severity: "warning", code: "post.unknown-field", message: "未知字段 weird", line: 4, column: 1, endLine: 4, endColumn: 6 },
      ],
    },
    { file: "/w/b.md", issues: [] },
  ];

  it("统计文件数、问题数、错误与警告", () => {
    const report = summarize(files);
    expect(report.fileCount).toBe(2);
    expect(report.issueCount).toBe(2);
    expect(report.errorCount).toBe(1);
    expect(report.warningCount).toBe(1);
    expect(report.cleanFileCount).toBe(1);
  });

  it("逐条渲染可点击位置与问题描述", () => {
    const lines = formatReport(summarize(files), {
      location: (f, l, c) => f + ":" + l + ":" + c,
    });
    expect(lines[0]).toContain("2 个文件");
    expect(lines[0]).toContain("2 个问题");
    expect(lines.some((l) => l.includes("/w/a.md:2:1") && l.includes("缺少必填字段"))).toBe(true);
    expect(lines.some((l) => l.includes("/w/a.md:4:1") && l.includes("warning"))).toBe(true);
  });

  it("全部通过时给出明确结论", () => {
    const lines = formatReport(summarize([{ file: "/w/c.md", issues: [] }]), {
      location: (f, l, c) => f + ":" + l + ":" + c,
    });
    expect(lines[lines.length - 1]).toBe("未发现问题。");
  });
});
