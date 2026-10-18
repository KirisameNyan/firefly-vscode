import { describe, expect, it } from "vitest";
import {
  analyzeAnnouncement,
  announcementContext,
  parseAnnouncement,
} from "../src/core/announcement";

const BASE = [
  'import type { AnnouncementConfig } from "../types/announcementConfig";',
  "",
  "export const announcementConfig: AnnouncementConfig = {",
  "\t// 公告标题，留空则走i18n默认标题",
  '\ttitle: "",',
  "",
  "\t// 公告内容",
  '\tcontent: "欢迎来到我的博客!",',
  "",
  "\t// 是否允许用户关闭公告",
  "\tclosable: true,",
  "",
  "\tlink: {",
  "\t\tenable: true,",
  '\t\ttext: "了解更多",',
  '\t\turl: "/about/",',
  "\t\texternal: false,",
  "\t},",
  "};",
  "",
].join("\n");

function codes(text: string): string[] {
  return analyzeAnnouncement(text).map((i) => i.code);
}

describe("parseAnnouncement", () => {
  it("解析出根字段与 link 嵌套字段", () => {
    const lit = parseAnnouncement(BASE);
    expect(lit.found).toBe(true);
    const keys = lit.props.map((p) => p.key);
    expect(keys).toEqual([
      "title",
      "content",
      "closable",
      "link",
      "link.enable",
      "link.text",
      "link.url",
      "link.external",
    ]);
    expect(lit.containers.map((c) => c.prefix)).toEqual(["", "link."]);
    const external = lit.props.find((p) => p.key === "link.external");
    expect(external?.value).toBe("false");
    expect(external?.isContainer).toBe(false);
  });

  it("容忍行内注释", () => {
    const text = BASE.replace("\tclosable: true,", "\tclosable: true, // 可关闭");
    expect(codes(text)).toEqual([]);
  });
});

describe("analyzeAnnouncement", () => {
  it("上游示例配置零问题", () => {
    expect(analyzeAnnouncement(BASE)).toEqual([]);
  });

  it("缺 content 报 Error", () => {
    const text = BASE.replace('\tcontent: "欢迎来到我的博客!",\n', "");
    const issues = analyzeAnnouncement(text);
    const hit = issues.find((i) => i.code === "announce.missing-required");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toContain("content");
  });

  it("未知键报 Warning", () => {
    const text = BASE.replace("\tclosable: true,", "\tclosable: true,\n\tfoo: 1,");
    const issues = analyzeAnnouncement(text);
    const hit = issues.find((i) => i.code === "announce.unknown-key");
    expect(hit?.severity).toBe("warning");
    expect(hit?.message).toContain("foo");
    expect(hit?.line).toBe(12);
  });

  it("closable 不是布尔值报 Error", () => {
    const text = BASE.replace("\tclosable: true,", '\tclosable: "yes",');
    const issues = analyzeAnnouncement(text);
    const hit = issues.find((i) => i.code === "announce.bad-boolean");
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toContain("closable");
  });

  it("link.enable / link.external 不是布尔值报 Error", () => {
    expect(codes(BASE.replace("\t\tenable: true,", "\t\tenable: 1,"))).toContain(
      "announce.bad-boolean",
    );
    const issues = analyzeAnnouncement(BASE.replace("\t\texternal: false,", '\t\texternal: "no",'));
    expect(issues.filter((i) => i.code === "announce.bad-boolean")).toHaveLength(1);
    expect(issues[0].message).toContain("link.external");
  });

  it("link 嵌套里的未知键也要报", () => {
    const text = BASE.replace("\t\texternal: false,", "\t\texternal: false,\n\t\tbogus: 1,");
    expect(codes(text)).toContain("announce.unknown-key");
  });

  it("找不到 announcementConfig 时给出提示而不是崩溃", () => {
    const issues = analyzeAnnouncement("export const other = {};\n");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("announce.no-object");
  });
});

describe("announcementContext", () => {
  it("根对象里处于键位置时可补全根字段", () => {
    const text = "export const announcementConfig = {\n  title: \"x\",\n  clo";
    const ctx = announcementContext(text, text.length);
    expect(ctx.inConfig).toBe(true);
    expect(ctx.atKeyPosition).toBe(true);
    expect(ctx.prefix).toBe("");
    expect(ctx.typed).toBe("clo");
    expect(ctx.presentKeys).toContain("title");
  });

  it("link 对象里处于键位置时前缀为 link.", () => {
    const text = "export const announcementConfig = {\n  content: \"x\",\n  link: {\n    en";
    const ctx = announcementContext(text, text.length);
    expect(ctx.atKeyPosition).toBe(true);
    expect(ctx.prefix).toBe("link.");
    expect(ctx.typed).toBe("en");
  });

  it("值内部不是键位置", () => {
    const text = "export const announcementConfig = {\n  content: \"he";
    const ctx = announcementContext(text, text.length);
    expect(ctx.inConfig).toBe(true);
    expect(ctx.atKeyPosition).toBe(false);
  });

  it("对象之外不生效", () => {
    const text = "const x = 1;\nexport const announcementConfig = {\n  title: \"x\",\n};\n";
    const ctx = announcementContext(text, 3);
    expect(ctx.inConfig).toBe(false);
  });
});
