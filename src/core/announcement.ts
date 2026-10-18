//! 纯逻辑：announcementConfig.ts 对象字面量的轻量解析（不依赖 vscode / TypeScript 编译器）。
//! 只回答三件事：有哪些键、值是什么、在文本的哪个位置；足够驱动补全、悬停与诊断。

import { ANNOUNCE_FIELD_MAP, ANNOUNCE_FIELDS } from "../fields";
import { issueAt, type Issue } from "./issues";

const BACKTICK = String.fromCharCode(96);
const WHITESPACE = " \t\r\n";
const IDENT = /^[A-Za-z0-9_$]+$/;
const IDENT_RUN = /^[A-Za-z0-9_$]+/;

export interface AnnouncementProp {
  /** 点号全名，如 content、link.enable */
  key: string;
  /** 原样键名，如 enable */
  bareKey: string;
  /** 去空白后的值原文；对象容器为空串 */
  value: string;
  isContainer: boolean;
  keyStart: number;
  keyEnd: number;
  valueStart: number;
  valueEnd: number;
  /** 所属容器的起始 offset */
  containerStart: number;
}

export interface AnnouncementContainer {
  start: number;
  end: number;
  /** 内部键的公共前缀：根为 ""，link 对象为 "link." */
  prefix: string;
  depth: number;
  /** 该层每个 , 之后的位置，用于判断光标所在的分段 */
  delimiters: number[];
}

export interface AnnouncementLiteral {
  found: boolean;
  objectStart: number;
  objectEnd: number;
  props: AnnouncementProp[];
  containers: AnnouncementContainer[];
}

interface Acc {
  props: AnnouncementProp[];
  containers: AnnouncementContainer[];
}

function isQuote(c: string): boolean {
  return c === '"' || c === "'" || c === BACKTICK;
}

function skipString(text: string, i: number, end: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < end) {
    const c = text[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === "\n" && quote !== BACKTICK) return j;
    j += 1;
  }
  return end;
}

function skipComment(text: string, i: number, end: number): number {
  if (text[i + 1] === "/") {
    const nl = text.indexOf("\n", i + 2);
    return nl === -1 || nl > end ? end : nl;
  }
  if (text[i + 1] === "*") {
    const close = text.indexOf("*/", i + 2);
    return close === -1 || close + 2 > end ? end : close + 2;
  }
  return i + 1;
}

function skipTrivia(text: string, i: number, end: number): number {
  let j = i;
  for (;;) {
    while (j < end && WHITESPACE.indexOf(text[j]) !== -1) j += 1;
    if (j < end && text[j] === "/" && (text[j + 1] === "/" || text[j + 1] === "*")) {
      j = skipComment(text, j, end);
      continue;
    }
    return j;
  }
}

/** 从值起点扫到同层的 , 或 } 或末尾。 */
function scanValueEnd(text: string, i: number, end: number): number {
  let j = i;
  let depth = 0;
  while (j < end) {
    const c = text[j];
    if (isQuote(c)) {
      j = skipString(text, j, end);
      continue;
    }
    if (c === "/" && (text[j + 1] === "/" || text[j + 1] === "*")) {
      j = skipComment(text, j, end);
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth += 1;
      j += 1;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      if (depth === 0) return j;
      depth -= 1;
      j += 1;
      continue;
    }
    if (c === "," && depth === 0) return j;
    j += 1;
  }
  return j;
}

/** 去掉值尾部的行内注释。 */
function stripInlineComment(raw: string): string {
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (isQuote(c)) {
      i = skipString(raw, i, raw.length);
      continue;
    }
    if (c === "/" && (raw[i + 1] === "/" || raw[i + 1] === "*")) break;
    i += 1;
  }
  return raw.slice(0, i).trim();
}

function parseObject(
  text: string,
  open: number,
  end: number,
  prefix: string,
  depth: number,
  acc: Acc,
): number {
  const container: AnnouncementContainer = { start: open, end, prefix, depth, delimiters: [] };
  acc.containers.push(container);
  let i = open + 1;
  while (i < end) {
    i = skipTrivia(text, i, end);
    if (i >= end) break;
    const c = text[i];
    if (c === "}") {
      container.end = i;
      return i;
    }
    if (c === ",") {
      i += 1;
      container.delimiters.push(i);
      continue;
    }

    const keyStart = i;
    let bareKey: string;
    if (isQuote(c)) {
      const close = skipString(text, i, end);
      bareKey = text.slice(i + 1, Math.max(i + 1, close - 1));
      i = close;
    } else {
      const m = IDENT_RUN.exec(text.slice(i, Math.min(end, i + 128)));
      if (m === null) {
        i += 1;
        continue;
      }
      bareKey = m[0];
      i += bareKey.length;
    }
    const keyEnd = i;

    const colon = skipTrivia(text, i, end);
    if (colon >= end || text[colon] !== ":") {
      i = colon > i ? colon : i + 1;
      continue;
    }
    const valueStart = skipTrivia(text, colon + 1, end);

    if (text[valueStart] === "{") {
      const self: AnnouncementProp = {
        key: prefix + bareKey,
        bareKey,
        value: "",
        isContainer: true,
        keyStart,
        keyEnd,
        valueStart,
        valueEnd: valueStart + 1,
        containerStart: open,
      };
      acc.props.push(self);
      const childPrefix = prefix + bareKey + ".";
      const close = parseObject(text, valueStart, end, childPrefix, depth + 1, acc);
      self.valueEnd = close + 1;
      i = close + 1;
      continue;
    }

    const valueEnd = scanValueEnd(text, valueStart, end);
    acc.props.push({
      key: prefix + bareKey,
      bareKey,
      value: stripInlineComment(text.slice(valueStart, valueEnd)),
      isContainer: false,
      keyStart,
      keyEnd,
      valueStart,
      valueEnd,
      containerStart: open,
    });
    i = valueEnd;
  }
  container.end = Math.min(i, end);
  return i;
}

export function parseAnnouncement(text: string): AnnouncementLiteral {
  const empty: AnnouncementLiteral = {
    found: false,
    objectStart: -1,
    objectEnd: -1,
    props: [],
    containers: [],
  };
  const named = text.indexOf("announcementConfig");
  if (named === -1) return empty;
  const open = text.indexOf("{", named);
  if (open === -1) return empty;
  const acc: Acc = { props: [], containers: [] };
  const close = parseObject(text, open, text.length, "", 0, acc);
  return { found: true, objectStart: open, objectEnd: close, props: acc.props, containers: acc.containers };
}

/** 单值字段的取值校验：目前只有 boolean 需要严格 true/false。 */
export function analyzeAnnouncement(text: string): Issue[] {
  const lit = parseAnnouncement(text);
  if (!lit.found) {
    return [
      issueAt(text, 0, 0, "warning", "announce.no-object",
        "未能定位 announcementConfig 对象字面量，公告检查已跳过"),
    ];
  }

  const issues: Issue[] = [];
  const declared = new Set(lit.props.map((p) => p.key));

  for (const def of ANNOUNCE_FIELDS) {
    if (!def.required || declared.has(def.key)) continue;
    issues.push(
      issueAt(text, lit.objectStart, lit.objectStart + 1, "error", "announce.missing-required",
        "公告缺少必填字段 " + def.key + "（" + def.label + "）"),
    );
  }

  for (const p of lit.props) {
    const def = ANNOUNCE_FIELD_MAP.get(p.key);
    if (def === undefined) {
      if (p.key === "link") continue;
      issues.push(
        issueAt(text, p.keyStart, p.keyEnd, "warning", "announce.unknown-key",
          "未知配置项 " + p.key),
      );
      continue;
    }
    if (def.type === "boolean" && !p.isContainer && p.value !== "true" && p.value !== "false") {
      issues.push(
        issueAt(text, p.valueStart, p.valueEnd, "error", "announce.bad-boolean",
          p.key + " 的值必须是 true 或 false（当前：" + (p.value === "" ? "空值" : "'" + p.value + "'") + "）"),
      );
    }
  }
  return issues;
}

export interface AnnouncementCompletionContext {
  inConfig: boolean;
  /** 容器前缀：根为 ""，link 对象为 "link." */
  prefix: string;
  /** 光标前已输入的键前缀 */
  typed: string;
  atKeyPosition: boolean;
  presentKeys: string[];
  containerStart: number;
}

const NO_CONTEXT: AnnouncementCompletionContext = {
  inConfig: false,
  prefix: "",
  typed: "",
  atKeyPosition: false,
  presentKeys: [],
  containerStart: -1,
};

/** 判断 offset 处是否处于「可以写键名」的位置。 */
export function announcementContext(text: string, offset: number): AnnouncementCompletionContext {
  const lit = parseAnnouncement(text);
  if (!lit.found) return NO_CONTEXT;
  if (offset <= lit.objectStart || offset > lit.objectEnd) return NO_CONTEXT;

  let target: AnnouncementContainer | null = null;
  for (const c of lit.containers) {
    if (offset > c.start && offset <= c.end && (target === null || c.depth > target.depth)) {
      target = c;
    }
  }
  if (target === null) return NO_CONTEXT;

  const container = target;
  let base = container.start + 1;
  for (const d of container.delimiters) {
    if (d <= offset && d > base) base = d;
  }
  const presentKeys: string[] = [];
  for (const p of lit.props) {
    if (p.containerStart === container.start) presentKeys.push(p.key);
  }

  const raw = stripInlineComment(text.slice(base, offset))
    .replace(/^[,\s]+/, "")
    .trim();
  const atKeyPosition = raw === "" || IDENT.test(raw);
  return {
    inConfig: true,
    prefix: container.prefix,
    typed: atKeyPosition ? raw : "",
    atKeyPosition,
    presentKeys,
    containerStart: container.start,
  };
}
