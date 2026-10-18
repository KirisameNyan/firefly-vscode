import { describe, expect, it } from "vitest";
import {
  PostIndexCache,
  blockListItems,
  buildIndex,
  readFileValues,
  splitInlineArray,
  type IndexedFile,
} from "../src/providers/postModel";

function post(body: string): string {
  return ["---", "title: t", "published: 2026-10-17", body, "---", ""].join("\n");
}

const FILES: IndexedFile[] = [
  {
    path: "a.md",
    text: post("tags: [随笔, 关于]\ncategory: 随笔\nseries: 站务\nlang: zh-CN"),
  },
  { path: "b.md", text: post("tags: [随笔]\ncategory: 随笔") },
  { path: "c.md", text: post("tags:\n  - 随笔\n  - Rust\n  - Rust\ncategory: 技术") },
];

describe("blockListItems", () => {
  it("读取缩进的 - 条目", () => {
    const map = blockListItems(post('tags:\n  - 随笔\n  - "关于"'));
    expect(map.get("tags")).toEqual(["随笔", "关于"]);
  });

  it("没有 frontmatter 时为空", () => {
    expect(blockListItems("tags:\n  - x\n").size).toBe(0);
  });
});

describe("splitInlineArray", () => {
  it("解析内联数组与单值", () => {
    expect(splitInlineArray("[随笔, 关于]")).toEqual(["随笔", "关于"]);
    expect(splitInlineArray('["a, b", c]')).toEqual(["a, b", "c"]);
    expect(splitInlineArray("随笔")).toEqual(["随笔"]);
    expect(splitInlineArray("[]")).toEqual([]);
    expect(splitInlineArray("")).toEqual([]);
  });
});

describe("readFileValues", () => {
  it("合并内联与块状写法", () => {
    const values = readFileValues(post("tags: [a]\ntags:\n  - b\ncategory: c\nlang: en"));
    expect(values.tags).toEqual(["a", "b"]);
    expect(values.categories).toEqual(["c"]);
    expect(values.langs).toEqual(["en"]);
  });
});

describe("buildIndex", () => {
  it("按使用文章数降序，同频次按字典序", () => {
    const index = buildIndex(FILES);
    expect(index.fileCount).toBe(3);
    expect(index.tags).toEqual([
      { value: "随笔", count: 3 },
      { value: "Rust", count: 1 },
      { value: "关于", count: 1 },
    ]);
    expect(index.categories).toEqual([
      { value: "随笔", count: 2 },
      { value: "技术", count: 1 },
    ]);
    expect(index.series).toEqual([{ value: "站务", count: 1 }]);
    expect(index.langs).toEqual([{ value: "zh-CN", count: 1 }]);
  });

  it("同一篇文章里重复的标签只计一次", () => {
    const index = buildIndex([{ path: "x.md", text: post("tags: [a, a, a]") }]);
    expect(index.tags).toEqual([{ value: "a", count: 1 }]);
  });

  it("空工作区返回空索引", () => {
    expect(buildIndex([])).toEqual({
      fileCount: 0,
      tags: [],
      categories: [],
      series: [],
      langs: [],
    });
  });
});

describe("PostIndexCache", () => {
  it("同一份索引只扫一次盘", async () => {
    let calls = 0;
    const cache = new PostIndexCache(async () => {
      calls += 1;
      return FILES;
    });
    await cache.get();
    await cache.get();
    expect(calls).toBe(1);
    expect(cache.scans).toBe(1);
    expect((await cache.get()).fileCount).toBe(3);
  });

  it("invalidate 之后重新扫描", async () => {
    let calls = 0;
    const cache = new PostIndexCache(async () => {
      calls += 1;
      return FILES;
    });
    await cache.get();
    cache.invalidate();
    await cache.get();
    expect(calls).toBe(2);
    expect(cache.scans).toBe(2);
  });

  it("并发请求共用一次扫描", async () => {
    let calls = 0;
    const cache = new PostIndexCache(async () => {
      calls += 1;
      return FILES;
    });
    const [first, second] = await Promise.all([cache.get(), cache.get()]);
    expect(calls).toBe(1);
    expect(first).toBe(second);
  });

  it("扫描期间失效时不会把旧结果写进缓存", async () => {
    let calls = 0;
    let release: ((files: readonly IndexedFile[]) => void) | undefined;
    const cache = new PostIndexCache(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<readonly IndexedFile[]>((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve([] as readonly IndexedFile[]);
    });
    const pending = cache.get();
    cache.invalidate();
    await Promise.resolve();
    release!(FILES);
    const stale = await pending;
    expect(stale.fileCount).toBe(3);
    const fresh = await cache.get();
    expect(fresh.fileCount).toBe(0);
    expect(cache.scans).toBe(2);
  });
});
