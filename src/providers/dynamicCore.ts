//! 纯逻辑：动态（src/content/dynamic）的补全、悬停、诊断、快速修复与位置索引。
//! 不依赖 vscode，全量可单测；provider（dynamic.ts）只做类型转换。
//! 文章侧的分层（postCore / postModel）在动态这里被压成一个模块，因为动态只有 3 个标量字段。
import {
  DYNAMIC_FIELDS,
  DYNAMIC_FIELD_MAP,
  DYNAMIC_FILE_RE,
  type FieldDef,
} from "../fields";
import { parseFrontmatter } from "../frontmatter";
import { isIsoDate, type OffsetRange, type Suggestion } from "./postCore";
import type { IndexedFile, ValueCount } from "./postModel";

/* ---------------- 作用域 ---------------- */

/** 文件是否位于动态目录下（只有 .md；动态不支持 mdx）。 */
export function isDynamicFile(fsPath: string, dynamicDirAbs: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = norm(fsPath);
  const dir = norm(dynamicDirAbs);
  return file.startsWith(dir + "/") && /\.md$/i.test(file);
}

/* ---------------- 字段展示 ---------------- */

function typeLabel(field: FieldDef): string {
  if (field.type === "date") {
    return field.format === "datetime" ? "日期时间 YYYY-MM-DD HH:mm:ss" : "日期 YYYY-MM-DD";
  }
  switch (field.type) {
    case "boolean":
      return "布尔值 true / false";
    case "number":
      return "整数";
    case "url":
      return "URL";
    case "path":
      return "路径";
    case "stringArray":
      return "字符串数组";
    case "password":
      return "字符串（加密）";
    default:
      return "字符串";
  }
}

export function dynamicFieldMarkdown(field: FieldDef): string {
  const lines = [
    "**" + field.label + "**（`" + field.key + "`）",
    "",
    field.doc,
    "",
    "- 类型：" + typeLabel(field),
    "- 必填：" + (field.required ? "是" : "否"),
  ];
  if (field.example) {
    lines.push("", "示例：", "", "```yaml", field.key + ": " + field.example, "```");
  }
  return lines.join("\n");
}

/* ---------------- 时间与文件名 ---------------- */

/** published：`YYYY-MM-DD HH:mm:ss`（也接受纯日期），且必须是真实存在的时刻。 */
export function isValidPublished(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return false;
  if (!isIsoDate(match[1] + "-" + match[2] + "-" + match[3])) return false;
  if (match[4] === undefined) return true;
  return Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) < 60;
}

/** 从 `YYYY-MM-DD-HHmmss.md` 推出 `YYYY-MM-DD HH:mm:ss`；不合约定或日期非法返回 undefined。 */
export function parseDynamicFileName(fileName: string): string | undefined {
  const match = DYNAMIC_FILE_RE.exec(fileName);
  if (!match) return undefined;
  const date = match[1] + "-" + match[2] + "-" + match[3];
  if (!isIsoDate(date)) return undefined;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return undefined;
  return date + " " + match[4] + ":" + match[5] + ":" + match[6];
}

/* ---------------- 诊断 ---------------- */

export type IssueSeverity = "error" | "warning";

export interface DynamicIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  range: OffsetRange;
  key?: string;
}

const PUBLISHED_HINT = "published 必须是 YYYY-MM-DD HH:mm:ss（也接受 YYYY-MM-DD）格式的有效时间";

function quoteRaw(raw: string): string {
  return raw === "" ? "空值" : "'" + raw + "'";
}

/**
 * 校验一条动态。fileName 传入时额外检查命名约定（仅提醒，不阻断）。
 * 与 `firefly.validateAll` 共用这一份规则。
 */
export function collectDynamicIssues(text: string, fileName?: string): DynamicIssue[] {
  const issues: DynamicIssue[] = [];
  const fm = parseFrontmatter(text);

  if (!fm.present) {
    issues.push({
      code: "dynamic.no-frontmatter",
      severity: "error",
      message: "动态需要有 frontmatter 并填写 published。",
      range: { start: 0, end: Math.min(3, text.length) },
    });
  } else {
    let hasPublished = false;
    for (const entry of fm.entries) {
      const field = DYNAMIC_FIELD_MAP.get(entry.key);
      if (!field) {
        issues.push({
          code: "dynamic.unknown-key",
          severity: "warning",
          message:
            "未知字段 " + entry.key + "，动态只支持 published / location / pinned。",
          range: { start: entry.keyStart, end: entry.keyEnd },
          key: entry.key,
        });
        continue;
      }
      if (entry.key === "published") {
        hasPublished = true;
        if (!isValidPublished(entry.value)) {
          issues.push({
            code: "dynamic.invalid-published",
            severity: "error",
            message: PUBLISHED_HINT + "，当前是 " + quoteRaw(entry.rawValue) + "。",
            range: { start: entry.valueStart, end: entry.valueEnd },
            key: entry.key,
          });
        }
        continue;
      }
      if (field.type === "boolean" && !isBooleanLiteral(entry.value)) {
        issues.push({
          code: "dynamic.invalid-pinned",
          severity: "error",
          message:
            "字段 " + entry.key + " 只能是 true 或 false，当前是 " + quoteRaw(entry.rawValue) + "。",
          range: { start: entry.valueStart, end: entry.valueEnd },
          key: entry.key,
        });
      }
    }

    if (!hasPublished) {
      issues.push({
        code: "dynamic.missing-published",
        severity: "error",
        message: "缺少必填字段 published（发布时间）：" + PUBLISHED_HINT + "。",
        // 指向 frontmatter 开头；零长度范围编辑器不画下划线。
        range: { start: fm.bodyStart, end: Math.max(fm.bodyStart, Math.min(fm.bodyStart + 1, fm.closeStart)) },
        key: "published",
      });
    }
  }

  if (fileName !== undefined && fileName !== "" && !DYNAMIC_FILE_RE.test(fileName)) {
    issues.push({
      code: "dynamic.filename",
      severity: "warning",
      message:
        "文件名建议写成 YYYY-MM-DD-HHmmss.md（当前：" + fileName + "），与 create new-dynamic 保持一致。",
      range: { start: 0, end: Math.min(3, text.length) },
    });
  }
  return issues;
}

function isBooleanLiteral(value: string): boolean {
  return value === "true" || value === "false";
}

export interface TextEditPlan {
  range: OffsetRange;
  newText: string;
}

export interface DynamicQuickFixPlan {
  code: string;
  title: string;
  trigger: OffsetRange;
  edits: TextEditPlan[];
}

/** 缺 published 且文件名能解析出时间 → 从文件名补出 published。 */
export function collectDynamicQuickFixes(
  text: string,
  fileName?: string,
): DynamicQuickFixPlan[] {
  if (fileName === undefined) return [];
  const derived = parseDynamicFileName(fileName);
  if (derived === undefined) return [];
  const fm = parseFrontmatter(text);
  if (!fm.present) return [];
  return collectDynamicIssues(text, fileName)
    .filter((issue) => issue.code === "dynamic.missing-published")
    .map((issue) => ({
      code: issue.code,
      title: "从文件名插入 published: " + derived,
      trigger: issue.range,
      edits: [
        {
          range: { start: fm.closeStart, end: fm.closeStart },
          newText: "published: " + derived + "\n",
        },
      ],
    }));
}

/* ---------------- 行内定位 ---------------- */

const KEY_CHAR = /[A-Za-z0-9_.-]/;

function lineBounds(text: string, offset: number): OffsetRange {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const next = text.indexOf("\n", offset);
  return { start, end: next === -1 ? text.length : next };
}

function trimEnd(text: string, start: number, end: number): number {
  let index = end;
  while (index > start && /\s/.test(text[index - 1])) index -= 1;
  return index;
}

function skipSpaces(text: string, from: number, end: number): number {
  let index = from;
  while (index < end && (text[index] === " " || text[index] === "\t")) index += 1;
  return index;
}

function wordRange(text: string, offset: number, low: number, high: number): OffsetRange {
  let start = Math.min(Math.max(offset, low), high);
  let end = start;
  while (start > low && KEY_CHAR.test(text[start - 1])) start -= 1;
  while (end < high && KEY_CHAR.test(text[end])) end += 1;
  return { start, end };
}

/* ---------------- 补全 ---------------- */

export type DynamicCompletionContext =
  | {
      kind: "key";
      range: OffsetRange;
      prefix: string;
      existingKeys: string[];
      colonAfter: boolean;
    }
  | {
      kind: "value";
      range: OffsetRange;
      prefix: string;
      key: string;
      field: FieldDef | null;
    };

/** 由「文本 + 绝对 offset」判定补全语境；返回 null 表示不该出补全。 */
export function dynamicCompletionContext(
  text: string,
  offset: number,
): DynamicCompletionContext | null {
  const fm = parseFrontmatter(text);
  if (!fm.present) return null;
  if (offset < fm.bodyStart || offset > fm.closeStart) return null;

  const bounds = lineBounds(text, offset);
  const line = text.slice(bounds.start, bounds.end);
  if (/^\s*---\s*$/.test(line)) return null;

  const contentEnd = trimEnd(text, bounds.start, bounds.end);
  const lead = /^\s*/.exec(line)![0].length;
  const existingKeys = fm.entries.map((entry) => entry.key);

  if (bounds.start + lead >= contentEnd) {
    return {
      kind: "key",
      range: { start: offset, end: offset },
      prefix: "",
      existingKeys,
      colonAfter: false,
    };
  }
  // 动态的 frontmatter 只有标量字段，缩进行不是本文件形态。
  if (lead > 0) return null;

  const colon = text.indexOf(":", bounds.start);
  const hasColon = colon !== -1 && colon < contentEnd;
  if (!hasColon || offset <= colon) {
    const range = wordRange(text, offset, bounds.start, hasColon ? colon : contentEnd);
    const prefix = text.slice(range.start, offset);
    if (!/^[A-Za-z0-9_.-]*$/.test(prefix)) return null;
    return { kind: "key", range, prefix, existingKeys, colonAfter: hasColon };
  }

  const key = text.slice(bounds.start, colon).trim();
  const field = DYNAMIC_FIELD_MAP.get(key) ?? null;
  let start = Math.min(skipSpaces(text, colon + 1, contentEnd), contentEnd);
  let end = contentEnd;
  const quote = text[start];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, start + 1);
    start += 1;
    end = close !== -1 && close <= contentEnd ? close : contentEnd;
  }
  if (offset <= start) return { kind: "value", range: { start, end: start }, prefix: "", key, field };
  return {
    kind: "value",
    range: { start, end },
    prefix: text.slice(start, Math.min(offset, end)),
    key,
    field,
  };
}

export function dynamicFieldSuggestions(
  existingKeys: readonly string[],
  colonAfter = false,
): Suggestion[] {
  const have = new Set(existingKeys);
  const suffix = colonAfter ? "" : ": ";
  const out: Suggestion[] = [];
  for (const field of DYNAMIC_FIELDS) {
    if (have.has(field.key)) continue;
    out.push({
      label: field.key,
      detail:
        field.label + " · " + typeLabel(field) + (field.required ? " · 必填" : ""),
      documentation: dynamicFieldMarkdown(field),
      insertText: field.key + suffix,
      sortText: (field.required ? "0" : "1") + field.key,
    });
  }
  return out;
}

export interface DynamicFileEntry {
  path: string;
  locations: string[];
}

/** 单条动态用过的 location（同一文件内重复值只算一次）。 */
export function dynamicLocations(text: string): string[] {
  const fm = parseFrontmatter(text);
  if (!fm.present) return [];
  const out: string[] = [];
  for (const entry of fm.entries) {
    if (entry.key === "location" && entry.value !== "" && !out.includes(entry.value)) {
      out.push(entry.value);
    }
  }
  return out;
}

export function buildDynamicEntries(files: readonly IndexedFile[]): DynamicFileEntry[] {
  return files.map((file) => ({ path: file.path, locations: dynamicLocations(file.text) }));
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 工作区里其它动态用过的 location，去重后按使用次数降序。 */
export function locationCounts(
  entries: readonly DynamicFileEntry[],
  exceptPath?: string,
): ValueCount[] {
  const skip = exceptPath === undefined ? null : normalizePath(exceptPath);
  const counter = new Map<string, number>();
  for (const entry of entries) {
    if (skip !== null && normalizePath(entry.path) === skip) continue;
    for (const value of new Set(entry.locations)) {
      counter.set(value, (counter.get(value) ?? 0) + 1);
    }
  }
  return [...counter.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

export function dynamicValueSuggestions(
  key: string,
  entries: readonly DynamicFileEntry[] = [],
  options: { leadingSpace?: boolean; exceptPath?: string } = {},
): Suggestion[] {
  const field = DYNAMIC_FIELD_MAP.get(key) ?? null;
  const doc = field ? dynamicFieldMarkdown(field) : "";
  let out: Suggestion[];
  if (field?.type === "boolean") {
    out = ["true", "false"].map((value, position) => ({
      label: value,
      detail: "布尔值 · " + value,
      documentation:
        (doc ? doc + "\n\n" : "") + "补全后在文件中写作 " + key + ": " + value + "。",
      insertText: value,
      sortText: String(position).padStart(3, "0"),
    }));
  } else if (key === "location") {
    out = locationCounts(entries, options.exceptPath).map((entry, position) => ({
      label: entry.value,
      detail: "位置 · " + entry.count + " 条动态",
      documentation:
        (doc ? doc + "\n\n" : "") + "工作区中已有 " + entry.count + " 条动态使用 " + entry.value + "。",
      insertText: entry.value,
      sortText: String(position).padStart(3, "0"),
    }));
  } else {
    return [];
  }
  if (!options.leadingSpace) return out;
  return out.map((suggestion) => ({ ...suggestion, insertText: " " + suggestion.insertText }));
}

/* ---------------- 悬停 ---------------- */

export interface DynamicHoverHit {
  key: string;
  field: FieldDef | null;
  range: OffsetRange;
  target: "key" | "value";
  value?: string;
}

export function dynamicHitTest(text: string, offset: number): DynamicHoverHit | null {
  const fm = parseFrontmatter(text);
  if (!fm.present) return null;
  for (const entry of fm.entries) {
    const field = DYNAMIC_FIELD_MAP.get(entry.key) ?? null;
    if (offset >= entry.keyStart && offset <= entry.keyEnd) {
      return {
        key: entry.key,
        field,
        range: { start: entry.keyStart, end: entry.keyEnd },
        target: "key",
      };
    }
    if (
      entry.rawValue !== "" &&
      offset >= entry.valueStart &&
      offset <= entry.valueEnd
    ) {
      return {
        key: entry.key,
        field,
        range: { start: entry.valueStart, end: entry.valueEnd },
        target: "value",
        value: entry.value,
      };
    }
  }
  return null;
}

export function buildDynamicHover(
  hit: DynamicHoverHit,
  entries: readonly DynamicFileEntry[] = [],
  currentPath?: string,
): string {
  if (!hit.field) {
    return (
      "**未知字段**（`" + hit.key + "`）\n\n动态没有这个字段，" +
      "只会读取 published / location / pinned。"
    );
  }
  const parts = [dynamicFieldMarkdown(hit.field)];
  if (hit.target === "value") {
    parts.push("", "当前值：`" + (hit.value ?? "") + "`");
    if (hit.key === "location") {
      const used = locationCounts(entries, currentPath).find((entry) => entry.value === hit.value);
      if (used) parts.push("工作区中已有 " + used.count + " 条动态使用它。");
    }
  }
  return parts.join("\n");
}

/* ---------------- 工作区索引缓存 ---------------- */

export type DynamicIndexScan = () => Promise<readonly IndexedFile[]>;

/** 首次需要时扫描一次，之后只在 invalidate() 后重扫（与文章侧 PostIndexCache 同构）。 */
export class DynamicIndexCache {
  private cached: DynamicFileEntry[] | null = null;
  private inflight: Promise<DynamicFileEntry[]> | null = null;
  private generation = 0;

  constructor(private readonly scan: DynamicIndexScan) {}

  invalidate(): void {
    this.generation += 1;
    this.cached = null;
  }

  async get(): Promise<readonly DynamicFileEntry[]> {
    if (this.cached !== null) return this.cached;
    if (this.inflight !== null) return this.inflight;
    const generation = this.generation;
    const pending: Promise<DynamicFileEntry[]> = Promise.resolve()
      .then(() => this.scan())
      .then((files) => {
        const entries = buildDynamicEntries(files);
        if (this.generation === generation) this.cached = entries;
        return entries;
      })
      .finally(() => {
        if (this.inflight === pending) this.inflight = null;
      });
    this.inflight = pending;
    return pending;
  }
}
