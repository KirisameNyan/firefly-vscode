import { describe, expect, it } from "vitest";
import { deriveSlug, isValidSlug } from "../src/core/slug";

describe("deriveSlug", () => {
  it("中文标题推导为空串", () => {
    expect(deriveSlug("你好，世界")).toBe("");
    expect(deriveSlug("我的第一篇博客")).toBe("");
  });

  it("大写转小写，空格与标点被丢弃", () => {
    expect(deriveSlug("Hello World")).toBe("helloworld");
    expect(deriveSlug("TypeScript 5.9 指南")).toBe("typescript59");
    expect(deriveSlug("  Foo_Bar-baz!  ")).toBe("foo_bar-baz");
  });

  it("去掉首尾分隔符", () => {
    expect(deriveSlug("--hello--")).toBe("hello");
    expect(deriveSlug("_x_")).toBe("x");
    expect(deriveSlug("!!!")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("接受 a-z0-9-_ 且首尾为字母数字", () => {
    expect(isValidSlug("hello")).toBe(true);
    expect(isValidSlug("hello-world_2")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
  });

  it("拒绝空串、大写、中文与首尾分隔符", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("Hello")).toBe(false);
    expect(isValidSlug("中文")).toBe(false);
    expect(isValidSlug("-abc")).toBe(false);
    expect(isValidSlug("abc-")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
  });
});
