import * as vscode from "vscode";
import { ANNOUNCE_FIELD_MAP, ANNOUNCE_FIELDS, type FieldDef } from "../fields";
import { analyzeAnnouncement, announcementContext, parseAnnouncement } from "../core/announcement";
import { normalizeFsPath, resolveAnnouncementPath, samePath } from "../resolve";

const SELECTOR: vscode.DocumentSelector = [
  { language: "typescript" },
  { language: "typescriptreact" },
];

const CHANNEL = "firefly-announcement";

export function registerAnnouncementProviders(ctx: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection(CHANNEL);
  ctx.subscriptions.push(collection);

  const refresh = (doc: vscode.TextDocument): void => {
    if (doc.uri.scheme !== "file" || !isAnnouncementDoc(doc)) return;
    collection.set(doc.uri, toDiagnostics(doc.getText()));
  };

  const refreshFromDisk = async (): Promise<void> => {
    const target = resolveAnnouncementPath();
    if (target === null) {
      collection.clear();
      return;
    }
    const open = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.scheme === "file" && samePath(doc.uri.fsPath, target),
    );
    if (open !== undefined) {
      refresh(open);
      return;
    }
    const uri = vscode.Uri.file(target);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      collection.set(uri, toDiagnostics(Buffer.from(bytes).toString("utf8")));
    } catch {
      collection.delete(uri);
    }
  };

  ctx.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      SELECTOR,
      {
        provideCompletionItems(document, position) {
          if (!isAnnouncementDoc(document)) return undefined;
          const info = announcementContext(document.getText(), document.offsetAt(position));
          if (!info.inConfig || !info.atKeyPosition) return undefined;
          const cursor = document.offsetAt(position);
          const range = new vscode.Range(document.positionAt(cursor - info.typed.length), position);
          const items = candidates(info.prefix, info.presentKeys).map((c) => {
            const item = new vscode.CompletionItem(c.label, vscode.CompletionItemKind.Field);
            item.insertText = c.insert;
            item.detail = c.detail;
            item.documentation = c.docs;
            item.sortText = c.sortText;
            item.range = range;
            return item;
          });
          return new vscode.CompletionList(items, false);
        },
      },
      "{",
      ",",
      " ",
    ),
  );

  ctx.subscriptions.push(
    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(document, position) {
        if (!isAnnouncementDoc(document)) return undefined;
        const lit = parseAnnouncement(document.getText());
        if (!lit.found) return undefined;
        const offset = document.offsetAt(position);
        const prop = lit.props.find(
          (p) =>
            (offset >= p.keyStart && offset <= p.keyEnd) ||
            (!p.isContainer && offset >= p.valueStart && offset <= p.valueEnd),
        );
        if (prop === undefined) return undefined;
        const range = new vscode.Range(
          document.positionAt(prop.keyStart),
          document.positionAt(prop.keyEnd),
        );
        const def = ANNOUNCE_FIELD_MAP.get(prop.key);
        if (def === undefined) {
          if (prop.key === "link") {
            const md = new vscode.MarkdownString();
            md.appendMarkdown("**link** · 链接\n\n公告下方的链接按钮，包含 enable / text / url / external。");
            return new vscode.Hover(md, range);
          }
          return undefined;
        }
        return new vscode.Hover(fieldDoc(def, prop.key), range);
      },
    }),
  );

  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(doc)),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidSaveTextDocument((doc) => refresh(doc)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("firefly.announcementFile")) return;
      collection.clear();
      for (const doc of vscode.workspace.textDocuments) refresh(doc);
      void refreshFromDisk();
    }),
  );

  for (const doc of vscode.workspace.textDocuments) refresh(doc);
  void refreshFromDisk();
}

function isAnnouncementDoc(doc: vscode.TextDocument): boolean {
  const target = resolveAnnouncementPath();
  if (target === null) return false;
  return samePath(normalizeFsPath(doc.uri.fsPath), target);
}

function toDiagnostics(text: string): vscode.Diagnostic[] {
  return analyzeAnnouncement(text).map((issue) => {
    const range = new vscode.Range(
      new vscode.Position(issue.line - 1, issue.column - 1),
      new vscode.Position(issue.endLine - 1, issue.endColumn - 1),
    );
    const diag = new vscode.Diagnostic(
      range,
      issue.message,
      issue.severity === "error"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning,
    );
    diag.source = "firefly";
    diag.code = issue.code;
    return diag;
  });
}

function fieldDoc(def: FieldDef, shownKey: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(
    "**" + shownKey + "** · " + def.label + (def.required ? " · 必填" : " · 可选") + "\n\n",
  );
  md.appendMarkdown(def.doc + "\n\n");
  if (def.example !== undefined) {
    md.appendMarkdown("示例：" + def.example + "\n\n");
  }
  md.appendMarkdown("类型：" + def.type);
  return md;
}

interface Candidate {
  label: string;
  insert: string;
  detail: string;
  docs: vscode.MarkdownString;
  sortText: string;
}

function candidates(prefix: string, presentKeys: string[]): Candidate[] {
  const present = new Set(presentKeys);
  const out: Candidate[] = [];
  let order = 0;
  for (const def of ANNOUNCE_FIELDS) {
    const parts = def.key.split(".");
    order += 1;
    if (parts.length === 1) {
      if (prefix !== "" || present.has(def.key)) continue;
      out.push({
        label: def.key,
        insert: def.key + ": ",
        detail: def.label + (def.required ? "（必填）" : ""),
        docs: fieldDoc(def, def.key),
        sortText: String(order).padStart(3, "0"),
      });
      continue;
    }
    if (prefix !== parts[0] + "." || present.has(def.key)) continue;
    out.push({
      label: parts[1],
      insert: parts[1] + ": ",
      detail: def.label + "（" + def.key + "）",
      docs: fieldDoc(def, def.key),
      sortText: String(order).padStart(3, "0"),
    });
  }
  if (prefix === "" && !present.has("link")) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(
      "**link** · 链接 · 可选\n\n公告下方的链接按钮，内部字段：enable / text / url / external。",
    );
    out.push({
      label: "link",
      insert: "link: {}",
      detail: "链接（enable / text / url / external）",
      docs: md,
      sortText: "0link",
    });
  }
  return out;
}
