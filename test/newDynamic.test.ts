import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/frontmatter";
import {
  buildDynamicContent,
  dynamicBodyStart,
  formatStamp,
  readTimezone,
} from "../src/core/newDynamic";

/** 2026-07-15 16:15:29 Asia/Shanghai == 2026-07-15T08:15:29Z */
const SHANGHAI_MS = Date.UTC(2026, 6, 15, 8, 15, 29);

describe("formatStamp", () => {
  it("Asia/Shanghai 下得到预期的字面时间与文件名", () => {
    const stamp = formatStamp(SHANGHAI_MS, "Asia/Shanghai");
    expect(stamp.timestamp).toBe("2026-07-15 16:15:29");
    expect(stamp.fileName).toBe("2026-07-15-161529.md");
  });

  it("跨日边界取 00 点而不是 24 点", () => {
    const stamp = formatStamp(Date.UTC(2026, 0, 1, 16, 0, 0), "Asia/Shanghai");
    expect(stamp.timestamp).toBe("2026-01-02 00:00:00");
    expect(stamp.fileName).toBe("2026-01-02-000000.md");
  });

  it("时区缺失或非法时回退本地时区且不抛错", () => {
    const local = formatStamp(SHANGHAI_MS);
    expect(formatStamp(SHANGHAI_MS, "Not/AZone")).toEqual(local);
    expect(local.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(local.fileName).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}\.md$/);
  });
});

describe("readTimezone", () => {
  it("从 siteConfig 源码里读到 timezone", () => {
    expect(readTimezone('const siteConfig = {\n\ttimezone: "Asia/Shanghai",\n};\n')).toBe(
      "Asia/Shanghai",
    );
    expect(readTimezone("timezone: 'UTC'")).toBeUndefined();
  });

  it("没有 timezone 时返回 undefined", () => {
    expect(readTimezone("export const siteConfig = {};\n")).toBeUndefined();
    expect(readTimezone('timezone: ""')).toBeUndefined();
  });
});

describe("buildDynamicContent", () => {
  it("与上游 scripts/new-dynamic.js 逐行一致", () => {
    const text = buildDynamicContent("2026-07-15 16:15:29", "今天天气真不错，流萤真可爱。");
    expect(text).toBe(
      "---\npublished: 2026-07-15 16:15:29\n---\n\n今天天气真不错，流萤真可爱。\n",
    );
  });

  it("有 location 时插在 published 之后", () => {
    const text = buildDynamicContent("2026-07-15 16:15:29", "飞萤之火", "广西");
    expect(text).toBe(
      "---\npublished: 2026-07-15 16:15:29\nlocation: 广西\n---\n\n飞萤之火\n",
    );
  });

  it("模板能被 parseFrontmatter 回读，且零诊断", async () => {
    const { collectDynamicIssues } = await import("../src/providers/dynamicCore");
    const text = buildDynamicContent("2026-07-15 16:15:29", "正文", "广西");
    const fm = parseFrontmatter(text);
    expect(fm.present).toBe(true);
    expect(fm.entries.map((entry) => entry.key)).toEqual(["published", "location"]);
    expect(fm.entries[0].value).toBe("2026-07-15 16:15:29");
    expect(fm.entries[1].value).toBe("广西");
    expect(collectDynamicIssues(text, "2026-07-15-161529.md")).toEqual([]);
  });
});

describe("dynamicBodyStart", () => {
  it("指向正文第一个字符", () => {
    const text = buildDynamicContent("2026-07-15 16:15:29", "飞萤之火", "广西");
    expect(text.slice(dynamicBodyStart(text))).toBe("飞萤之火\n");
  });

  it("没有 frontmatter 时退化为文件末尾", () => {
    expect(dynamicBodyStart("只有正文")).toBe("只有正文".length);
  });
});
