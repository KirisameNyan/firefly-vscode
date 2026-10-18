import { describe, expect, it } from "vitest";
import { planNewPostFile } from "../src/core/newPost";

const existing = new Set(["/posts/hello.md", "/posts/taken.md"]);

describe("planNewPostFile", () => {
  it("重名时报错且不覆盖", () => {
    const plan = planNewPostFile("/posts", "hello", (p) => existing.has(p));
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("exists");
    expect(plan.filePath).toBe("/posts/hello.md");
  });

  it("不重名时给出目标路径", () => {
    const plan = planNewPostFile("/posts", "fresh", (p) => existing.has(p));
    expect(plan.ok).toBe(true);
    expect(plan.filePath).toBe("/posts/fresh.md");
  });

  it("非法 slug 直接拒绝", () => {
    const plan = planNewPostFile("/posts", "Hello", () => false);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("invalid-slug");
  });
});
