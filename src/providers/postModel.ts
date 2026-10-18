//! 纯逻辑：工作区文章索引的提取、聚合与缓存。不依赖 vscode，可直接单测。
import { parseFrontmatter, unquote } from "../frontmatter";

export interface ValueCount {
  value: string;
  count: number;
}

/** 从工作区已有文章收集到的候选值（按使用频次降序）。 */
export interface WorkspaceIndex {
  fileCount: number;
  tags: ValueCount[];
  categories: ValueCount[];
  series: ValueCount[];
  langs: ValueCount[];
}

export const EMPTY_INDEX: WorkspaceIndex = {
  fileCount: 0,
  tags: [],
  categories: [],
  series: [],
  langs: [],
};

export interface IndexedFile {
  path: string;
  text: string;
}

export interface FileValues {
  tags: string[];
  categories: string[];
  series: string[];
  langs: string[];
}

/**
 * 块状列表写法（tags 常见）：
 *   tags:
 *     - 随笔
 * 返回 键 -> 条目 的映射。解析正文交给冻结的 parseFrontmatter，
 * 这里只补它故意跳过的缩进行。
 */
export function blockListItems(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const fm = parseFrontmatter(text);
  if (!fm.present) return out;
  let current: string | null = null;
  for (const raw of text.slice(fm.bodyStart, fm.closeStart).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const lead = /^\s*/.exec(line)![0].length;
    if (lead > 0) {
      const item = /^-\s*(.*)$/.exec(line.slice(lead));
      if (!item) {
        current = null;
        continue;
      }
      if (current === null) continue;
      const value = unquote(item[1].trim());
      if (!value) continue;
      const list = out.get(current) ?? [];
      list.push(value);
      out.set(current, list);
      continue;
    }
    const colon = line.indexOf(":");
    current = colon > 0 ? line.slice(0, colon).trim() : null;
  }
  return out;
}

/** tags: [a, b] 的内联数组解析；也接受单值。 */
export function splitInlineArray(raw: string): string[] {
  const text = raw.trim();
  if (!text.startsWith("[")) return text ? [unquote(text)] : [];
  const inner = text.endsWith("]") ? text.slice(1, -1) : text.slice(1);
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function readFileValues(text: string): FileValues {
  const out: FileValues = { tags: [], categories: [], series: [], langs: [] };
  const fm = parseFrontmatter(text);
  if (!fm.present) return out;
  const blocks = blockListItems(text);
  for (const entry of fm.entries) {
    switch (entry.key) {
      case "tags":
        out.tags.push(...splitInlineArray(entry.rawValue));
        break;
      case "category":
        if (entry.value) out.categories.push(entry.value);
        break;
      case "series":
        if (entry.value) out.series.push(entry.value);
        break;
      case "lang":
        if (entry.value) out.langs.push(entry.value);
        break;
    }
  }
  out.tags.push(...(blocks.get("tags") ?? []));
  return out;
}

function toValueCounts(counter: Map<string, number>): ValueCount[] {
  return [...counter.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

/** 同一篇文章里重复出现的值只计一次，按「多少篇文章用过」排序。 */
export function buildIndex(files: readonly IndexedFile[]): WorkspaceIndex {
  const tags = new Map<string, number>();
  const categories = new Map<string, number>();
  const series = new Map<string, number>();
  const langs = new Map<string, number>();
  const bump = (counter: Map<string, number>, values: readonly string[]): void => {
    for (const value of new Set(values)) counter.set(value, (counter.get(value) ?? 0) + 1);
  };
  for (const file of files) {
    const values = readFileValues(file.text);
    bump(tags, values.tags);
    bump(categories, values.categories);
    bump(series, values.series);
    bump(langs, values.langs);
  }
  return {
    fileCount: files.length,
    tags: toValueCounts(tags),
    categories: toValueCounts(categories),
    series: toValueCounts(series),
    langs: toValueCounts(langs),
  };
}

export type IndexScan = () => Promise<readonly IndexedFile[]>;

/**
 * 索引缓存：首次需要时扫描一次，之后只在 invalidate() 后重扫。
 * 扫描期间发生的失效不会把旧结果写进缓存。
 */
export class PostIndexCache {
  private cached: WorkspaceIndex | null = null;
  private inflight: Promise<WorkspaceIndex> | null = null;
  private generation = 0;
  private scanCount = 0;

  constructor(private readonly scan: IndexScan) {}

  get scans(): number {
    return this.scanCount;
  }

  invalidate(): void {
    this.generation += 1;
    this.cached = null;
  }

  async get(): Promise<WorkspaceIndex> {
    if (this.cached) return this.cached;
    if (this.inflight) return this.inflight;
    const generation = this.generation;
    this.scanCount += 1;
    const pending: Promise<WorkspaceIndex> = Promise.resolve()
      .then(() => this.scan())
      .then((files) => {
        const index = buildIndex(files);
        if (this.generation === generation) this.cached = index;
        return index;
      })
      .finally(() => {
        if (this.inflight === pending) this.inflight = null;
      });
    this.inflight = pending;
    return pending;
  }
}
