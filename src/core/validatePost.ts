//! 纯逻辑：单篇文章 frontmatter 的校验（批量校验命令复用，不依赖 vscode）。

import { INTERNAL_KEYS, POST_FIELD_MAP, POST_FIELDS } from "../fields";
import { parseFrontmatter } from "../frontmatter";
import { isValidDate } from "./date";
import { issueAt, type Issue } from "./issues";

export function validatePostText(text: string): Issue[] {
  const fm = parseFrontmatter(text);
  if (!fm.present) {
    return [
      issueAt(
        text,
        0,
        3,
        "error",
        "post.no-frontmatter",
        "缺少 frontmatter：文件需以 --- 开始，并以 --- 结束",
      ),
    ];
  }

  const issues: Issue[] = [];
  const present = new Set<string>();

  for (const entry of fm.entries) {
    present.add(entry.key);
    const def = POST_FIELD_MAP.get(entry.key);
    if (def === undefined) {
      if (!INTERNAL_KEYS.has(entry.key)) {
        issues.push(
          issueAt(text, entry.keyStart, entry.keyEnd, "warning", "post.unknown-field",
            "未知字段 " + entry.key),
        );
      }
      continue;
    }
    if (def.type === "date" && !isValidDate(entry.value)) {
      issues.push(
        issueAt(text, entry.valueStart, entry.valueEnd, "error", "post.bad-date",
          entry.key + " 需要合法的 YYYY-MM-DD 日期（当前：" + quote(entry.rawValue) + "）"),
      );
      continue;
    }
    if (def.type === "boolean" && entry.value !== "true" && entry.value !== "false") {
      issues.push(
        issueAt(text, entry.valueStart, entry.valueEnd, "error", "post.bad-boolean",
          entry.key + " 的值必须是 true 或 false（当前：" + quote(entry.rawValue) + "）"),
      );
      continue;
    }
    if (def.type === "number" && entry.value !== "" && !/^-?[0-9]+$/.test(entry.value)) {
      issues.push(
        issueAt(text, entry.valueStart, entry.valueEnd, "warning", "post.bad-number",
          entry.key + " 应该是整数（当前：" + quote(entry.rawValue) + "）"),
      );
      continue;
    }
    if (def.type === "stringArray" && entry.rawValue !== "" && entry.rawValue[0] !== "[") {
      issues.push(
        issueAt(text, entry.valueStart, entry.valueEnd, "warning", "post.bad-array",
          entry.key + " 建议写成 [a, b] 形式"),
      );
    }
  }

  for (const def of POST_FIELDS) {
    if (def.required && !present.has(def.key)) {
      issues.push(
        issueAt(text, fm.bodyStart, fm.bodyStart, "error", "post.missing-required",
          "缺少必填字段 " + def.key + "（" + def.label + "）"),
      );
    }
  }
  return issues;
}

function quote(raw: string): string {
  return raw === "" ? "空值" : "'" + raw + "'";
}
