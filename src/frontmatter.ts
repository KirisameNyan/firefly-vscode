//! 冻结契约：frontmatter 的行级解析（纯函数，不依赖 vscode 以便单测）。
//! 只读定位，不做写回 —— 写回由命令层按需做精确替换。

export interface FmEntry {
  key: string;
  /** 值的原文（不剥引号） */
  rawValue: string;
  /** 去掉引号/空白后的值 */
  value: string;
  /** 在整篇文本中的绝对 offset */
  keyStart: number;
  keyEnd: number;
  valueStart: number;
  valueEnd: number;
  /** 该行范围（不含换行符） */
  lineStart: number;
  lineEnd: number;
  /** 值的行号（0 基） */
  line: number;
}

export interface ParsedFrontmatter {
  present: boolean;
  /** 开围栏 --- 之后的 offset */
  bodyStart: number;
  /** 闭围栏 --- 的起始 offset */
  closeStart: number;
  entries: FmEntry[];
}

/** 解析 markdown 开头的 --- 围栏。没有或未闭合时 present=false。 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const none: ParsedFrontmatter = { present: false, bodyStart: 0, closeStart: 0, entries: [] };
  if (!/^---\r?\n/.test(text)) return none;

  const firstNl = text.indexOf("\n");
  const bodyStart = firstNl + 1;

  // 找闭合围栏
  let closeStart = -1;
  let pos = bodyStart;
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd).replace(/\r$/, "");
    if (line === "---") {
      closeStart = pos;
      break;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (closeStart === -1) return none;

  const entries: FmEntry[] = [];
  const block = text.slice(bodyStart, closeStart);
  let offset = bodyStart;
  let lineNo = 1;
  for (const raw of block.split("\n")) {
    const lineText = raw.replace(/\r$/, "");
    const lineStart = offset;
    const lineEnd = offset + lineText.length;
    if (lineText.trim() && !lineText.startsWith("#") && !/^\s/.test(lineText)) {
      const colon = lineText.indexOf(":");
      if (colon > 0) {
        const key = lineText.slice(0, colon).trim();
        const afterColon = lineText.slice(colon + 1);
        const leading = afterColon.length - afterColon.trimStart().length;
        const rawValue = afterColon.trim();
        const valueStart = lineStart + colon + 1 + leading;
        entries.push({
          key,
          rawValue,
          value: unquote(rawValue),
          keyStart: lineStart,
          keyEnd: lineStart + key.length,
          valueStart,
          valueEnd: valueStart + rawValue.length,
          lineStart,
          lineEnd,
          line: lineNo,
        });
      }
    }
    offset += raw.length + 1;
    lineNo += 1;
  }
  return { present: true, bodyStart, closeStart, entries };
}

/** 去掉 YAML 的成对引号。 */
export function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const q = s[0];
    if ((q === '"' || q === "'") && s[s.length - 1] === q) return s.slice(1, -1);
  }
  return s;
}

/** 判断某路径是否在文章目录下（用于 provider 的作用域）。 */
export function isPostPath(fsPath: string, postsDirAbs: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = norm(fsPath);
  const d = norm(postsDirAbs);
  return p.startsWith(d + "/") && /\.(md|mdx)$/i.test(p);
}
