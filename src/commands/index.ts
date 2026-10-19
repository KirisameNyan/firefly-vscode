import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { analyzeAnnouncement } from "../core/announcement";
import { DATE_HINT, isValidDate, today } from "../core/date";
import { formatReport, issueAt, summarize, type FileIssues } from "../core/issues";
import { buildDynamicContent, dynamicBodyStart, formatStamp, readTimezone } from "../core/newDynamic";
import { planNewPostFile } from "../core/newPost";
import { SLUG_HINT, deriveSlug, isValidSlug } from "../core/slug";
import { buildPostFrontmatter, postBodyStart } from "../core/template";
import { validatePostText } from "../core/validatePost";
import { collectDynamicIssues } from "../providers/dynamicCore";
import { resolveAnnouncementPath, resolveDynamicDir, resolvePostsDir } from "../resolve";

let channel: vscode.OutputChannel | null = null;

function getChannel(): vscode.OutputChannel {
  if (channel === null) channel = vscode.window.createOutputChannel("Firefly");
  return channel;
}

export function registerCommands(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("firefly.newPost", () => newPost()),
    vscode.commands.registerCommand("firefly.newDynamic", () => newDynamic()),
    vscode.commands.registerCommand("firefly.openAnnouncement", () => openAnnouncement()),
    vscode.commands.registerCommand("firefly.validateAll", () => validateAll()),
    new vscode.Disposable(() => {
      if (channel !== null) channel.dispose();
      channel = null;
    }),
  );
}

function relPath(file: string): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return root === undefined ? file : path.relative(root, file).replace(/\\/g, "/");
}

async function newPost(): Promise<void> {
  const postsDir = resolvePostsDir();
  if (postsDir === null) {
    vscode.window.showErrorMessage("Firefly：请先打开一个工作区文件夹。");
    return;
  }

  const title = await vscode.window.showInputBox({
    title: "Firefly · 新建文章 1/3 标题",
    prompt: "写入 frontmatter 的 title",
    placeHolder: "你好，世界",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() === "" ? "标题不能为空" : undefined),
  });
  if (title === undefined) return;
  const articleTitle = title.trim();

  const slug = await askSlug(articleTitle);
  if (slug === undefined) return;

  const published = await askPublished();
  if (published === undefined) return;

  const plan = planNewPostFile(postsDir, slug, (p) => fs.existsSync(p));
  if (!plan.ok) {
    vscode.window.showErrorMessage(
      plan.reason === "invalid-slug"
        ? "Firefly：" + SLUG_HINT
        : "Firefly：" + relPath(plan.filePath) + " 已存在，未覆盖。",
    );
    return;
  }

  fs.mkdirSync(path.dirname(plan.filePath), { recursive: true });
  const content = buildPostFrontmatter({ title: articleTitle, published, slug });
  fs.writeFileSync(plan.filePath, content, "utf8");

  const doc = await vscode.workspace.openTextDocument(plan.filePath);
  const editor = await vscode.window.showTextDocument(doc);
  const caret = doc.positionAt(postBodyStart(content));
  editor.selection = new vscode.Selection(caret, caret);
  editor.revealRange(new vscode.Range(caret, caret), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  vscode.window.showInformationMessage("Firefly：已创建 " + relPath(plan.filePath));
}

async function newDynamic(): Promise<void> {
  const dynamicDir = resolveDynamicDir();
  if (dynamicDir === null) {
    vscode.window.showErrorMessage("Firefly：请先打开一个工作区文件夹。");
    return;
  }

  const content = await vscode.window.showInputBox({
    title: "Firefly · 新建动态 1/2 内容",
    prompt: "正文就是这条动态的内容",
    placeHolder: "今天天气真不错，流萤真可爱。",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() === "" ? "内容不能为空" : undefined),
  });
  if (content === undefined) return;
  const body = content.trim();

  const location = await vscode.window.showInputBox({
    title: "Firefly · 新建动态 2/2 位置（可留空）",
    prompt: "显示在发布时间旁，可留空",
    placeHolder: "广西",
    ignoreFocusOut: true,
  });
  if (location === undefined) return;
  const place = location.trim();

  const stamp = formatStamp(Date.now(), readSiteTimezone());
  const filePath = path.join(dynamicDir, stamp.fileName);
  if (fs.existsSync(filePath)) {
    vscode.window.showErrorMessage("Firefly：" + relPath(filePath) + " 已存在，未覆盖。");
    return;
  }

  const text = buildDynamicContent(stamp.timestamp, body, place === "" ? undefined : place);
  fs.mkdirSync(dynamicDir, { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");

  const doc = await vscode.workspace.openTextDocument(filePath);
  const editor = await vscode.window.showTextDocument(doc);
  const caret = doc.positionAt(dynamicBodyStart(text));
  editor.selection = new vscode.Selection(caret, caret);
  editor.revealRange(new vscode.Range(caret, caret), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  vscode.window.showInformationMessage("Firefly：已创建 " + relPath(filePath));
}

/** siteConfig.timezone 只用于计算字面时间；读不到（或没有工作区）时 formatStamp 回退本地时区。 */
function readSiteTimezone(): string | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root === undefined) return undefined;
  try {
    return readTimezone(fs.readFileSync(path.join(root, "src/config/siteConfig.ts"), "utf8"));
  } catch {
    return undefined;
  }
}

async function askSlug(title: string): Promise<string | undefined> {
  const suggestion = deriveSlug(title);
  const answer = await vscode.window.showInputBox({
    title: "Firefly · 新建文章 2/3 slug",
    prompt:
      suggestion === ""
        ? "标题无法推导出 slug，请手动填写（仅 a-z0-9-_）"
        : "文章路径为 /posts/<slug>/",
    value: suggestion,
    placeHolder: "hello-world",
    ignoreFocusOut: true,
    validateInput: (value) => {
      const s = value.trim();
      if (s === "") return "slug 不能为空";
      return isValidSlug(s) ? undefined : SLUG_HINT;
    },
  });
  return answer === undefined ? undefined : answer.trim();
}

async function askPublished(): Promise<string | undefined> {
  const answer = await vscode.window.showInputBox({
    title: "Firefly · 新建文章 3/3 发布日期",
    prompt: DATE_HINT,
    value: today(),
    placeHolder: "2026-10-17",
    ignoreFocusOut: true,
    validateInput: (value) => (isValidDate(value.trim()) ? undefined : DATE_HINT),
  });
  return answer === undefined ? undefined : answer.trim();
}

async function openAnnouncement(): Promise<void> {
  const target = resolveAnnouncementPath();
  if (target === null) {
    vscode.window.showErrorMessage("Firefly：请先打开一个工作区文件夹。");
    return;
  }
  if (!fs.existsSync(target)) {
    vscode.window.showWarningMessage(
      "Firefly：找不到公告配置文件 " + relPath(target) + "，请检查设置 firefly.announcementFile。",
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc);
}

async function validateAll(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const postsDir = resolvePostsDir();
  if (folder === undefined || postsDir === null) {
    vscode.window.showErrorMessage("Firefly：请先打开一个工作区文件夹。");
    return;
  }

  const out = getChannel();
  out.clear();
  out.show(true);

  const files: FileIssues[] = [];

  let postCount = 0;
  for (const uri of await findMarkdown(postsDir, "**/*.{md,mdx}")) {
    const text = await readText(uri);
    if (text === null) continue;
    postCount += 1;
    files.push({ file: uri.fsPath, issues: validatePostText(text) });
  }

  // 动态与 provider 共用 dynamicCore 的规则，这里只把 offset 换算成行列。
  const dynamicDir = resolveDynamicDir();
  let dynamicCount = 0;
  if (dynamicDir !== null) {
    for (const uri of await findMarkdown(dynamicDir, "*.md")) {
      const text = await readText(uri);
      if (text === null) continue;
      dynamicCount += 1;
      files.push({
        file: uri.fsPath,
        issues: collectDynamicIssues(text, path.basename(uri.fsPath)).map((issue) =>
          issueAt(
            text,
            issue.range.start,
            issue.range.end,
            issue.severity,
            issue.code,
            issue.message,
          ),
        ),
      });
    }
  }

  const announcePath = resolveAnnouncementPath();
  const hasAnnouncement = announcePath !== null && fs.existsSync(announcePath);
  if (announcePath !== null && hasAnnouncement) {
    files.push({
      file: announcePath,
      issues: analyzeAnnouncement(fs.readFileSync(announcePath, "utf8")),
    });
  }

  const report = summarize(files);
  const headline =
    "Firefly 校验：" +
    postCount +
    " 篇文章 + " +
    dynamicCount +
    " 条动态" +
    (hasAnnouncement ? " + 公告配置" : "") +
    "，共 " +
    report.issueCount +
    " 个问题（" +
    report.errorCount +
    " 错误 / " +
    report.warningCount +
    " 警告）";
  const lines = formatReport(report, {
    headline,
    location: (file, line, column) => vscode.Uri.file(file).toString() + ":" + line + ":" + column,
  });
  for (const line of lines) out.appendLine(line);
  if (postCount === 0) {
    out.appendLine("");
    out.appendLine("提示：在 " + relPath(postsDir) + " 下没有找到 .md / .mdx 文章，请检查设置 firefly.postsDir。");
  }
  if (dynamicCount === 0 && dynamicDir !== null) {
    out.appendLine("");
    out.appendLine("提示：在 " + relPath(dynamicDir) + " 下没有找到 .md 动态，请检查设置 firefly.dynamicDir。");
  }
}

async function findMarkdown(dir: string, pattern: string): Promise<vscode.Uri[]> {
  const found = await vscode.workspace.findFiles(
    new vscode.RelativePattern(vscode.Uri.file(dir), pattern),
    "**/node_modules/**",
  );
  return found.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

async function readText(uri: vscode.Uri): Promise<string | null> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch {
    return null;
  }
}
