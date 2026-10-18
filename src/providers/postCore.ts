//! 纯逻辑：补全上下文、悬停文档、诊断、快速修复。不依赖 vscode，全量可单测。
import {
  INTERNAL_KEYS,
  POST_FIELDS,
  POST_FIELD_MAP,
  type FieldDef,
  type FieldType,
} from "../fields";
import { parseFrontmatter, unquote, type FmEntry } from "../frontmatter";
import { EMPTY_INDEX, type ValueCount, type WorkspaceIndex } from "./postModel";

export interface OffsetRange {
  start: number;
  end: number;
}

/**
 * 判断文件是否位于文章目录下（.md / .mdx）。
 * 冻结的 frontmatter.isPostPath 正则写成了 /\\\\.(md|mdx)$/i，对任何正常路径都返回 false，
 * 因此这里自带一份正确的判定（冻结文件只读，不做修改）。
 */
export function isPostFile(fsPath: string, postsDirAbs: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const path = norm(fsPath);
  const dir = norm(postsDirAbs);
  return path.startsWith(dir + "/") && /\.(md|mdx)$/i.test(path);
}

/* ---------------- 字段展示 ---------------- */

export function typeLabel(type: FieldType): string {
  switch (type) {
    case "string":
      return "字符串";
    case "date":
      return "日期 YYYY-MM-DD";
    case "stringArray":
      return "字符串数组";
    case "boolean":
      return "布尔值 true / false";
    case "number":
      return "整数";
    case "url":
      return "URL";
    case "path":
      return "路径";
    case "password":
      return "字符串（加密）";
  }
}

export function fieldMarkdown(field: FieldDef): string {
  const lines = [
    "**" + field.label + "**（`" + field.key + "`）",
    "",
    field.doc,
    "",
    "- 类型：" + typeLabel(field.type),
    "- 必填：" + (field.required ? "是" : "否"),
    "- 分组：" + field.group,
  ];
  if (field.example) {
    lines.push("", "示例：", "", "```yaml", field.key + ": " + field.example, "```");
  }
  return lines.join("\n");
}

/* ---------------- 诊断 ---------------- */

export type IssueSeverity = "error" | "warning";

export interface RawIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  range: OffsetRange;
  key?: string;
  /** 未知键：整行（含换行符）范围，供快速修复删除。 */
  lineRange?: OffsetRange;
}

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isBooleanLiteral(value: string): boolean {
  return value === "true" || value === "false";
}

function lineWithBreak(text: string, entry: { lineStart: number; lineEnd: number }): OffsetRange {
  let end = entry.lineEnd;
  if (text[end] === "\r") end += 1;
  if (text[end] === "\n") end += 1;
  return { start: entry.lineStart, end: Math.max(end, entry.lineEnd) };
}

/**
 * 校验一整篇 markdown 的 frontmatter，返回与 vscode 无关的问题列表。
 * 定位：未知/重复键指向键名；值错误指向值；缺必填字段指向 frontmatter 开头。
 */
export function collectIssues(text: string): RawIssue[] {
  const fm = parseFrontmatter(text);
  if (!fm.present) return [];
  const issues: RawIssue[] = [];
  const seen = new Map<string, FmEntry>();

  for (const entry of fm.entries) {
    const first = seen.get(entry.key);
    if (first) {
      issues.push({
        code: "duplicate-key",
        severity: "warning",
        message: "字段 " + entry.key + " 重复定义（第一次出现在第 " + (first.line + 1) + " 行）",
        range: { start: entry.keyStart, end: entry.keyEnd },
        key: entry.key,
      });
      continue;
    }
    seen.set(entry.key, entry);

    const field = POST_FIELD_MAP.get(entry.key);
    if (!field) {
      if (INTERNAL_KEYS.has(entry.key)) continue;
      issues.push({
        code: "unknown-key",
        severity: "warning",
        message: "未知字段 " + entry.key + "，Firefly 不会读取它，检查拼写或删掉这一行。",
        range: { start: entry.keyStart, end: entry.keyEnd },
        key: entry.key,
        lineRange: lineWithBreak(text, entry),
      });
      continue;
    }

    if (!entry.value) continue;
    const range: OffsetRange = { start: entry.valueStart, end: entry.valueEnd };

    if (field.type === "date" && !isIsoDate(entry.value)) {
      issues.push({
        code: "invalid-date",
        severity: "error",
        message:
          "字段 " + entry.key + " 必须是 YYYY-MM-DD 格式的有效日期，当前是 " + entry.value + "。",
        range,
        key: entry.key,
      });
    } else if (field.type === "number" && !/^-?\d+$/.test(entry.value)) {
      issues.push({
        code: "invalid-number",
        severity: "error",
        message: "字段 " + entry.key + " 必须是整数，当前是 " + entry.value + "。",
        range,
        key: entry.key,
      });
    } else if (field.type === "boolean" && !isBooleanLiteral(entry.value)) {
      issues.push({
        code: "invalid-boolean",
        severity: "error",
        message: "字段 " + entry.key + " 只能是 true 或 false，当前是 " + entry.value + "。",
        range,
        key: entry.key,
      });
    }
  }

  for (const field of POST_FIELDS) {
    if (!field.required || seen.has(field.key)) continue;
    issues.push({
      code: "missing-" + field.key,
      severity: "error",
      message: "缺少必填字段 " + field.key + "（" + field.label + "）。",
      // 指向 frontmatter 开头；至少覆盖一个字符，否则编辑器不画下划线。
      range: { start: fm.bodyStart, end: Math.min(fm.bodyStart + 1, fm.closeStart) },
      key: field.key,
    });
  }
  return issues;
}

/* ---------------- 补全上下文 ---------------- */

export type CompletionContext =
  | {
      kind: "key";
      range: OffsetRange;
      prefix: string;
      existingKeys: string[];
      /** 光标后是否已有冒号：有则只插入键名，没有则补上 ": "。 */
      colonAfter: boolean;
    }
  | {
      kind: "value";
      range: OffsetRange;
      prefix: string;
      key: string;
      field: FieldDef | null;
      /** 是否处在内联数组或块状列表里。 */
      array: boolean;
    };

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

function keysOf(entries: readonly FmEntry[]): string[] {
  return entries.map((entry) => entry.key);
}

function owningKey(entries: readonly FmEntry[], lineStart: number): string | null {
  let key: string | null = null;
  for (const entry of entries) {
    if (entry.lineStart < lineStart) key = entry.key;
    else break;
  }
  return key;
}

function wordRange(text: string, offset: number, low: number, high: number): OffsetRange {
  let start = Math.min(Math.max(offset, low), high);
  let end = start;
  while (start > low && KEY_CHAR.test(text[start - 1])) start -= 1;
  while (end < high && KEY_CHAR.test(text[end])) end += 1;
  return { start, end };
}

function valueContext(
  text: string,
  valueStart: number,
  contentEnd: number,
  offset: number,
  key: string,
  field: FieldDef | null,
  array: boolean,
): CompletionContext {
  if (text[valueStart] === "[") {
    const close = text.indexOf("]", valueStart);
    const closeAbs = close === -1 || close > contentEnd ? contentEnd : close;
    let start = valueStart + 1;
    for (let index = Math.min(offset, closeAbs); index > valueStart + 1; index -= 1) {
      if (text[index - 1] === ",") {
        start = index;
        break;
      }
    }
    let end = closeAbs;
    for (let index = Math.max(offset, valueStart + 1); index < closeAbs; index += 1) {
      if (text[index] === ",") {
        end = index;
        break;
      }
    }
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (offset <= start) {
      return { kind: "value", range: { start, end: start }, prefix: "", key, field, array: true };
    }
    return {
      kind: "value",
      range: { start, end: Math.max(end, Math.min(offset, contentEnd)) },
      prefix: text.slice(start, Math.min(offset, end)),
      key,
      field,
      array: true,
    };
  }

  if (valueStart >= contentEnd) {
    const insertAt = Math.max(offset, contentEnd);
    return { kind: "value", range: { start: insertAt, end: insertAt }, prefix: "", key, field, array };
  }

  let start = valueStart;
  let end = contentEnd;
  const quote = text[start];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, start + 1);
    start += 1;
    end = close !== -1 && close <= contentEnd ? close : contentEnd;
  }
  if (offset <= start) {
    return { kind: "value", range: { start, end: start }, prefix: "", key, field, array };
  }
  return {
    kind: "value",
    range: { start, end: offset > end ? offset : end },
    prefix: text.slice(start, Math.min(offset, end)),
    key,
    field,
    array,
  };
}

/** 由「文本 + 绝对 offset」判定补全语境；返回 null 表示不该出补全。 */
export function getCompletionContext(text: string, offset: number): CompletionContext | null {
  const fm = parseFrontmatter(text);
  if (!fm.present) return null;
  if (offset < fm.bodyStart || offset > fm.closeStart) return null;

  const bounds = lineBounds(text, offset);
  const line = text.slice(bounds.start, bounds.end);
  if (/^\s*---\s*$/.test(line)) return null;

  const contentEnd = trimEnd(text, bounds.start, bounds.end);
  const lead = /^\s*/.exec(line)![0].length;
  const bodyStart = bounds.start + lead;

  if (bodyStart >= contentEnd) {
    return {
      kind: "key",
      range: { start: offset, end: offset },
      prefix: "",
      existingKeys: keysOf(fm.entries),
      colonAfter: false,
    };
  }

  if (lead > 0) {
    const item = /^-\s*/.exec(text.slice(bodyStart, contentEnd));
    if (!item) return null;
    const owner = owningKey(fm.entries, bounds.start);
    if (!owner) return null;
    const field = POST_FIELD_MAP.get(owner) ?? null;
    if (field && field.type !== "stringArray") return null;
    return valueContext(
      text,
      bodyStart + item[0].length,
      contentEnd,
      offset,
      owner,
      field,
      true,
    );
  }

  const colonIndex = text.indexOf(":", bounds.start);
  const hasColon = colonIndex !== -1 && colonIndex < contentEnd;
  if (!hasColon || offset <= colonIndex) {
    const high = hasColon ? colonIndex : contentEnd;
    const range = wordRange(text, offset, bounds.start, high);
    const prefix = text.slice(range.start, offset);
    if (!/^[A-Za-z0-9_.-]*$/.test(prefix)) return null;
    return { kind: "key", range, prefix, existingKeys: keysOf(fm.entries), colonAfter: hasColon };
  }

  const key = text.slice(bounds.start, colonIndex).trim();
  const field = POST_FIELD_MAP.get(key) ?? null;
  const valueStart = Math.min(skipSpaces(text, colonIndex + 1, contentEnd), contentEnd);
  return valueContext(text, valueStart, contentEnd, offset, key, field, text[valueStart] === "[");
}

/* ---------------- 补全项 ---------------- */

export interface Suggestion {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
  sortText: string;
}

export function fieldSuggestions(
  existingKeys: readonly string[],
  options: { colonAfter?: boolean } = {},
): Suggestion[] {
  const have = new Set(existingKeys);
  const suffix = options.colonAfter ? "" : ": ";
  const out: Suggestion[] = [];
  for (const field of POST_FIELDS) {
    if (have.has(field.key)) continue;
    out.push({
      label: field.key,
      detail:
        field.label + " · " + typeLabel(field.type) + (field.required ? " · 必填" : ""),
      documentation: fieldMarkdown(field),
      insertText: field.key + suffix,
      sortText: (field.required ? "0" : "1") + field.key,
    });
  }
  return out;
}

const BOOLEAN_VALUES: readonly string[] = ["true", "false"];
const BOOLEAN_KEY_EXTRA = new Set(["link.external"]);

export const LICENSE_PRESETS: readonly { value: string; note: string }[] = [
  { value: "CC BY 4.0", note: "署名 4.0 国际" },
  { value: "CC BY-SA 4.0", note: "署名-相同方式共享 4.0 国际" },
  { value: "CC BY-NC-SA 4.0", note: "署名-非商业性使用-相同方式共享 4.0 国际" },
  { value: "MIT", note: "MIT License" },
  { value: "保留所有权利", note: "All Rights Reserved" },
];

export const LANG_SEEDS: readonly string[] = ["zh-CN", "zh-TW", "en"];

function countsFor(key: string, index: WorkspaceIndex): ValueCount[] {
  switch (key) {
    case "tags":
      return index.tags;
    case "category":
      return index.categories;
    case "series":
      return index.series;
    case "lang":
      return index.langs;
    default:
      return [];
  }
}

function fromCounts(kind: string, counts: readonly ValueCount[], doc: string): Suggestion[] {
  return counts.map((entry, position) => ({
    label: entry.value,
    detail: kind + " · " + (entry.count > 0 ? entry.count + " 篇" : "常用"),
    documentation:
      (doc ? doc + "\n\n" : "") +
      "工作区中已有 " + entry.count + " 篇文章使用 " + entry.value + "。",
    insertText: entry.value,
    sortText: String(position).padStart(3, "0"),
  }));
}

export function valueSuggestions(
  key: string,
  index: WorkspaceIndex = EMPTY_INDEX,
  options: { leadingSpace?: boolean } = {},
): Suggestion[] {
  const suggestions = valueSuggestionsCore(key, index);
  if (!options.leadingSpace) return suggestions;
  return suggestions.map((suggestion) => ({ ...suggestion, insertText: " " + suggestion.insertText }));
}

/** 光标紧跟在 ":" 或 "-" 之后时，补全值需要补一个空格。 */
export function needsLeadingSpace(text: string, offset: number): boolean {
  if (offset <= 0) return false;
  const previous = text[offset - 1];
  return previous === ":" || previous === "-";
}

function valueSuggestionsCore(key: string, index: WorkspaceIndex): Suggestion[] {
  const field = POST_FIELD_MAP.get(key) ?? null;
  const doc = field ? fieldMarkdown(field) : "";
  switch (key) {
    case "tags":
      return fromCounts("标签", index.tags, doc);
    case "category":
      return fromCounts("分类", index.categories, doc);
    case "series":
      return fromCounts("系列", index.series, doc);
    case "lang": {
      const merged: ValueCount[] = index.langs.slice();
      for (const seed of LANG_SEEDS) {
        if (!merged.some((entry) => entry.value === seed)) merged.push({ value: seed, count: 0 });
      }
      return fromCounts("语言", merged, doc);
    }
    case "licenseName":
      return LICENSE_PRESETS.map((preset, position) => ({
        label: preset.value,
        detail: "协议 · " + preset.note,
        documentation:
          (doc ? doc + "\n\n" : "") + "预设协议：**" + preset.value + "**（" + preset.note + "）。",
        insertText: preset.value,
        sortText: String(position).padStart(3, "0"),
      }));
    default:
      if (field?.type !== "boolean" && !BOOLEAN_KEY_EXTRA.has(key)) return [];
      return BOOLEAN_VALUES.map((value, position) => ({
        label: value,
        detail: "布尔值 · " + value,
        documentation:
          (doc ? doc + "\n\n" : "布尔字段，取值 true 或 false。\n\n") +
          "补全后在文件中写作 " + key + ": " + value + "。",
        insertText: value,
        sortText: String(position).padStart(3, "0"),
      }));
  }
}

/* ---------------- 悬停 ---------------- */

export interface HoverHit {
  key: string;
  field: FieldDef | null;
  range: OffsetRange;
  target: "key" | "value";
  value?: string;
  array: boolean;
}

function arrayElementAt(
  text: string,
  start: number,
  end: number,
  offset: number,
): { value: string; range: OffsetRange } | null {
  let segmentStart = start + 1;
  for (let index = start + 1; index <= Math.min(offset, end); index += 1) {
    if (text[index] === ",") segmentStart = index + 1;
  }
  let segmentEnd = end;
  for (let index = Math.max(offset, start + 1); index < end; index += 1) {
    if (text[index] === "," || text[index] === "]") {
      segmentEnd = index;
      break;
    }
  }
  let low = segmentStart;
  let high = segmentEnd;
  while (low < high && /\s/.test(text[low])) low += 1;
  while (high > low && /\s/.test(text[high - 1])) high -= 1;
  if (offset < low || offset > high) return null;
  return { value: unquote(text.slice(low, high)), range: { start: low, end: high } };
}

export function hitTest(text: string, offset: number): HoverHit | null {
  const fm = parseFrontmatter(text);
  if (!fm.present) return null;
  const bounds = lineBounds(text, offset);
  const line = text.slice(bounds.start, bounds.end);
  const lead = /^\s*/.exec(line)![0].length;

  if (lead > 0) {
    const item = /^-\s*/.exec(line.slice(lead));
    if (!item) return null;
    const owner = owningKey(fm.entries, bounds.start);
    if (!owner) return null;
    const contentEnd = trimEnd(text, bounds.start, bounds.end);
    const valueStart = bounds.start + lead + item[0].length;
    if (offset < valueStart || offset > contentEnd) return null;
    return {
      key: owner,
      field: POST_FIELD_MAP.get(owner) ?? null,
      range: { start: valueStart, end: contentEnd },
      target: "value",
      value: unquote(text.slice(valueStart, contentEnd)),
      array: true,
    };
  }

  for (const entry of fm.entries) {
    const field = POST_FIELD_MAP.get(entry.key) ?? null;
    if (offset >= entry.keyStart && offset <= entry.keyEnd) {
      return {
        key: entry.key,
        field,
        range: { start: entry.keyStart, end: entry.keyEnd },
        target: "key",
        array: false,
      };
    }
    if (offset >= entry.valueStart && offset <= entry.valueEnd) {
      if (entry.rawValue.startsWith("[")) {
        const element = arrayElementAt(text, entry.valueStart, entry.valueEnd, offset);
        if (element) {
          return {
            key: entry.key,
            field,
            range: element.range,
            target: "value",
            value: element.value,
            array: true,
          };
        }
      }
      return {
        key: entry.key,
        field,
        range: { start: entry.valueStart, end: entry.valueEnd },
        target: "value",
        value: entry.value,
        array: false,
      };
    }
  }
  return null;
}

export function buildHover(hit: HoverHit, index: WorkspaceIndex = EMPTY_INDEX): string {
  if (!hit.field) {
    return (
      "**未知字段**（`" + hit.key + "`）\n\nFirefly 没有这个文章字段，" +
      "检查拼写或删掉这一行。"
    );
  }
  const parts = [fieldMarkdown(hit.field)];
  if (hit.target === "value") {
    parts.push("", "当前值：`" + (hit.value ?? "") + "`");
    const used = countsFor(hit.key, index).find((entry) => entry.value === hit.value);
    if (used) parts.push("工作区中已有 " + used.count + " 篇文章使用它。");
  }
  return parts.join("\n");
}

/* ---------------- 快速修复 ---------------- */

export interface TextEditPlan {
  range: OffsetRange;
  newText: string;
}

export interface QuickFixPlan {
  code: string;
  title: string;
  trigger: OffsetRange;
  edits: TextEditPlan[];
}

export function defaultLiteral(field: FieldDef, today: string): string {
  switch (field.type) {
    case "date":
      return today ? today : '""';
    case "number":
      return "1";
    case "boolean":
      return "false";
    case "stringArray":
      return "[]";
    default:
      return '""';
  }
}

/** 为「缺必填字段」与「未知键」生成与编辑器无关的文本编辑计划。 */
export function collectQuickFixes(
  text: string,
  options: { today?: string } = {},
): QuickFixPlan[] {
  const fm = parseFrontmatter(text);
  if (!fm.present) return [];
  const today = options.today ?? "";
  const plans: QuickFixPlan[] = [];
  for (const issue of collectIssues(text)) {
    if (issue.code.startsWith("missing-") && issue.key) {
      const field = POST_FIELD_MAP.get(issue.key);
      if (!field) continue;
      plans.push({
        code: issue.code,
        title: "插入必填字段 " + issue.key,
        trigger: issue.range,
        edits: [
          {
            range: { start: fm.closeStart, end: fm.closeStart },
            newText: issue.key + ": " + defaultLiteral(field, today) + "\n",
          },
        ],
      });
      continue;
    }
    if (issue.code === "unknown-key" && issue.key && issue.lineRange) {
      plans.push({
        code: issue.code,
        title: "删除未知字段 " + issue.key,
        trigger: issue.range,
        edits: [{ range: issue.lineRange, newText: "" }],
      });
    }
  }
  return plans;
}

export function isoToday(now: Date = new Date()): string {
  const pad = (value: number): string => (value < 10 ? "0" + value : String(value));
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
}
