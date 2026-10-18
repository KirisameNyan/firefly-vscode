//! 纯逻辑：问题条目、行列换算与批量校验汇总（不依赖 vscode）。

export type IssueSeverity = "error" | "warning";

export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** 1 基行号 */
  line: number;
  /** 1 基列号 */
  column: number;
  endLine: number;
  endColumn: number;
}

export interface LineCol {
  line: number;
  column: number;
}

/** offset -> 1 基行列。 */
export function lineColAt(text: string, offset: number): LineCol {
  const limit = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < limit; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: limit - lineStart + 1 };
}

export function issueAt(
  text: string,
  start: number,
  end: number,
  severity: IssueSeverity,
  code: string,
  message: string,
): Issue {
  const s = lineColAt(text, start);
  const e = lineColAt(text, Math.max(start, end));
  return {
    severity,
    code,
    message,
    line: s.line,
    column: s.column,
    endLine: e.line,
    endColumn: e.column,
  };
}

export interface FileIssues {
  file: string;
  issues: Issue[];
}

export interface BatchReport {
  files: FileIssues[];
  fileCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  cleanFileCount: number;
}

export function summarize(files: FileIssues[]): BatchReport {
  let errorCount = 0;
  let warningCount = 0;
  let cleanFileCount = 0;
  for (const file of files) {
    if (file.issues.length === 0) cleanFileCount += 1;
    for (const issue of file.issues) {
      if (issue.severity === "error") errorCount += 1;
      else warningCount += 1;
    }
  }
  return {
    files,
    fileCount: files.length,
    issueCount: errorCount + warningCount,
    errorCount,
    warningCount,
    cleanFileCount,
  };
}

export interface ReportFormat {
  /** 把 (文件, 行, 列) 渲染成可点击/可读的位置串。 */
  location: (file: string, line: number, column: number) => string;
  /** 覆盖默认首行标题。 */
  headline?: string;
}

export function formatReport(report: BatchReport, opts: ReportFormat): string[] {
  const headline =
    opts.headline === undefined
      ? "Firefly 校验：" +
        report.fileCount +
        " 个文件，" +
        report.issueCount +
        " 个问题（" +
        report.errorCount +
        " 错误 / " +
        report.warningCount +
        " 警告）"
      : opts.headline;
  const lines: string[] = [headline, ""];
  if (report.issueCount === 0) {
    lines.push("未发现问题。");
    return lines;
  }
  for (const file of report.files) {
    for (const issue of file.issues) {
      const sev = issue.severity === "error" ? "error  " : "warning";
      lines.push(
        opts.location(file.file, issue.line, issue.column) +
          "  " +
          sev +
          "  " +
          issue.message +
          "  [" +
          issue.code +
          "]",
      );
    }
  }
  return lines;
}
