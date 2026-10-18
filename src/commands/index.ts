import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { analyzeAnnouncement } from "../core/announcement";
import { DATE_HINT, isValidDate, today } from "../core/date";
import { formatReport, summarize, type FileIssues } from "../core/issues";
import { planNewPostFile } from "../core/newPost";
import { SLUG_HINT, deriveSlug, isValidSlug } from "../core/slug";
import { buildPostFrontmatter, postBodyStart } from "../core/template";
import { validatePostText } from "../core/validatePost";
import { resolveAnnouncementPath, resolvePostsDir } from "../resolve";

let channel: vscode.OutputChannel | null = null;

function getChannel(): vscode.OutputChannel {
  if (channel === null) channel = vscode.window.createOutputChannel("Firefly");
  return channel;
}

export function registerCommands(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("firefly.newPost", () => newPost()),
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
  const pattern = new vscode.RelativePattern(vscode.Uri.file(postsDir), "**/*.{md,mdx}");
  const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
  uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

  let postCount = 0;
  for (const uri of uris) {
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    } catch {
      continue;
    }
    postCount += 1;
    files.push({ file: uri.fsPath, issues: validatePostText(text) });
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
    " 篇文章" +
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
}
