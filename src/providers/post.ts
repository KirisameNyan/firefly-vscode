//! 文章 frontmatter 的语言服务入口：只做 vscode 类型转换，逻辑全在 postCore / postModel。
import * as path from "node:path";
import * as vscode from "vscode";
import {
  buildHover,
  collectIssues,
  collectQuickFixes,
  fieldSuggestions,
  getCompletionContext,
  hitTest,
  isPostFile,
  isoToday,
  needsLeadingSpace,
  valueSuggestions,
  type OffsetRange,
  type Suggestion,
} from "./postCore";
import { EMPTY_INDEX, PostIndexCache, type IndexedFile } from "./postModel";

const CONFIG_SECTION = "firefly";
const POSTS_DIR_KEY = "postsDir";
const DEFAULT_POSTS_DIR = "src/content/posts";
const SOURCE = "firefly";
const SELECTOR: vscode.DocumentSelector = { scheme: "file", pattern: "**/*.{md,mdx}" };
const MAX_INDEXED_FILES = 2000;
const MAX_INDEXED_BYTES = 512 * 1024;
const VALIDATE_DEBOUNCE_MS = 300;

export function registerPostProviders(ctx: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("firefly-posts");
  const cache = new PostIndexCache(scanPostFiles);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const onIndexChanged = (): void => {
    cache.invalidate();
    revalidateAll();
  };
  const revalidate = (document: vscode.TextDocument): void => {
    if (!isInScope(document)) {
      diagnostics.delete(document.uri);
      return;
    }
    diagnostics.set(document.uri, toDiagnostics(document));
  };
  const revalidateAll = (): void => {
    for (const document of vscode.workspace.textDocuments) revalidate(document);
  };
  const cancelTimer = (uri: vscode.Uri): void => {
    const key = uri.toString();
    const timer = timers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(key);
  };
  const scheduleValidate = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    cancelTimer(document.uri);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        revalidate(document);
      }, VALIDATE_DEBOUNCE_MS),
    );
  };

  const completionProvider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
      if (!isInScope(document)) return undefined;
      const text = document.getText();
      const context = getCompletionContext(text, document.offsetAt(position));
      if (!context) return undefined;
      const range = toRange(document, context.range);
      const items =
        context.kind === "key"
          ? fieldSuggestions(context.existingKeys, { colonAfter: context.colonAfter })
          : valueSuggestions(context.key, await cache.get(), {
              leadingSpace:
                context.range.start === context.range.end &&
                needsLeadingSpace(text, context.range.start),
            });
      return items.map((suggestion) =>
        toCompletionItem(
          suggestion,
          range,
          context.kind === "key" ? vscode.CompletionItemKind.Field : vscode.CompletionItemKind.Value,
        ),
      );
    },
  };

  const hoverProvider: vscode.HoverProvider = {
    async provideHover(document, position) {
      if (!isInScope(document)) return undefined;
      const hit = hitTest(document.getText(), document.offsetAt(position));
      if (!hit) return undefined;
      const index = hit.target === "value" ? await cache.get() : EMPTY_INDEX;
      return new vscode.Hover(
        new vscode.MarkdownString(buildHover(hit, index)),
        toRange(document, hit.range),
      );
    },
  };

  const codeActionProvider: vscode.CodeActionProvider = {
    provideCodeActions(document, range, context) {
      if (!isInScope(document)) return [];
      const actions: vscode.CodeAction[] = [];
      for (const plan of collectQuickFixes(document.getText(), { today: isoToday() })) {
        const diagnostic = context.diagnostics.find(
          (item) =>
            item.code === plan.code &&
            (range.contains(item.range.start) || range.contains(item.range.end)),
        );
        if (!diagnostic) continue;
        const action = new vscode.CodeAction(plan.title, vscode.CodeActionKind.QuickFix);
        const edit = new vscode.WorkspaceEdit();
        for (const textEdit of plan.edits) {
          edit.replace(document.uri, toRange(document, textEdit.range), textEdit.newText);
        }
        action.edit = edit;
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        actions.push(action);
      }
      return actions;
    },
  };

  ctx.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, completionProvider, ":", "-"),
    vscode.languages.registerHoverProvider(SELECTOR, hoverProvider),
    vscode.languages.registerCodeActionsProvider(SELECTOR, codeActionProvider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    diagnostics,
    vscode.workspace.onDidOpenTextDocument((document) => revalidate(document)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isInScope(event.document)) scheduleValidate(event.document);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!isInScope(document)) return;
      cache.invalidate();
      revalidate(document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      cancelTimer(document.uri);
      diagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidCreateFiles((event) => {
      if (!event.files.some(isIndexableUri)) return;
      onIndexChanged();
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      if (!event.files.some(isIndexableUri)) return;
      for (const uri of event.files) diagnostics.delete(uri);
      onIndexChanged();
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      if (!event.files.some((file) => isIndexableUri(file.newUri) || isIndexableUri(file.oldUri))) {
        return;
      }
      for (const file of event.files) diagnostics.delete(file.oldUri);
      onIndexChanged();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(CONFIG_SECTION + "." + POSTS_DIR_KEY)) return;
      diagnostics.clear();
      onIndexChanged();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      diagnostics.clear();
      onIndexChanged();
    }),
    {
      dispose: () => {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      },
    },
  );

  revalidateAll();
}

/* ---------------- 作用域与配置 ---------------- */

function postsDirForFolder(folder: vscode.WorkspaceFolder): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, folder.uri);
  const configured = (config.get<string>(POSTS_DIR_KEY) ?? "").trim();
  return path.resolve(folder.uri.fsPath, configured || DEFAULT_POSTS_DIR);
}

function postsDirForUri(uri: vscode.Uri): string | null {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder ? postsDirForFolder(folder) : null;
}

function isIndexableUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") return false;
  const dir = postsDirForUri(uri);
  return dir !== null && isPostFile(uri.fsPath, dir);
}

function isInScope(document: vscode.TextDocument): boolean {
  return isIndexableUri(document.uri);
}

/* ---------------- vscode 类型转换 ---------------- */

function toRange(document: vscode.TextDocument, range: OffsetRange): vscode.Range {
  return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
}

function toDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
  return collectIssues(document.getText()).map((issue) => {
    const diagnostic = new vscode.Diagnostic(
      toRange(document, issue.range),
      issue.message,
      issue.severity === "error"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.code = issue.code;
    diagnostic.source = SOURCE;
    return diagnostic;
  });
}

function toCompletionItem(
  suggestion: Suggestion,
  range: vscode.Range,
  kind: vscode.CompletionItemKind,
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(suggestion.label, kind);
  item.detail = suggestion.detail;
  item.documentation = new vscode.MarkdownString(suggestion.documentation);
  item.insertText = suggestion.insertText;
  item.filterText = suggestion.label;
  item.sortText = suggestion.sortText;
  item.range = range;
  return item;
}

/* ---------------- 工作区扫描（缓存的数据源） ---------------- */

async function scanPostFiles(): Promise<readonly IndexedFile[]> {
  const files: IndexedFile[] = [];
  const decoder = new TextDecoder();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const postsDir = postsDirForFolder(folder);
    const relative = path.relative(folder.uri.fsPath, postsDir).replace(/\\/g, "/");
    if (!relative || relative.startsWith("..")) continue;
    const pattern = new vscode.RelativePattern(folder, relative + "/**/*.{md,mdx}");
    const uris = await vscode.workspace.findFiles(pattern, undefined, MAX_INDEXED_FILES);
    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > MAX_INDEXED_BYTES) continue;
        files.push({ path: uri.fsPath, text: decoder.decode(bytes) });
      } catch {
        // 读取失败（权限、瞬时删除）时跳过，不影响其它文章
      }
    }
  }
  return files;
}
