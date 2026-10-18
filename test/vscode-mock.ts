// 最小 vscode mock：只覆盖 providers/post.ts 用到的 API，
// 让 provider 入口能在没有 GUI 的环境里被 vitest 驱动。
export interface MockFile {
  uri: Uri;
  text: string;
}

export class Position {
  constructor(readonly line: number, readonly character: number) {}
  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }
  isBefore(other: Position): boolean {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }
  isAfter(other: Position): boolean {
    return other.isBefore(this);
  }
}

export class Range {
  constructor(readonly start: Position, readonly end: Position) {}
  contains(position: Position): boolean {
    return !position.isBefore(this.start) && !position.isAfter(this.end);
  }
  isEqual(other: Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }
  intersection(other: Range): Range | undefined {
    const start = this.start.isAfter(other.start) ? this.start : other.start;
    const end = this.end.isBefore(other.end) ? this.end : other.end;
    return start.isAfter(end) ? undefined : new Range(start, end);
  }
}

export class Uri {
  readonly scheme: string;
  readonly fsPath: string;
  constructor(fsPath: string, scheme = "file") {
    this.fsPath = fsPath;
    this.scheme = scheme;
  }
  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
  toString(): string {
    return this.scheme + "://" + this.fsPath;
  }
}

export class Diagnostic {
  code?: string | number;
  source?: string;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: number,
  ) {}
}

export class MarkdownString {
  constructor(public value = "") {}
  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }
  appendText(text: string): MarkdownString {
    this.value += text;
    return this;
  }
}

export class CompletionItem {
  detail?: string;
  documentation?: unknown;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  range?: Range;
  constructor(
    readonly label: string,
    readonly kind: number,
  ) {}
}

export class Hover {
  constructor(
    readonly contents: { value: string },
    readonly range?: Range,
  ) {}
}

export class WorkspaceEdit {
  readonly edits: { uri: Uri; range: Range; newText: string }[] = [];
  replace(uri: Uri, range: Range, newText: string): void {
    this.edits.push({ uri, range, newText });
  }
}

export class CodeAction {
  edit?: WorkspaceEdit;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  constructor(
    readonly title: string,
    readonly kind?: unknown,
  ) {}
}

export class RelativePattern {
  constructor(
    readonly base: unknown,
    readonly pattern: string,
  ) {}
}

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;
export const CompletionItemKind = { Text: 0, Field: 2, Value: 12 } as const;
export const CodeActionKind = { QuickFix: { value: "quickfix" } } as const;

export interface MockFolder {
  uri: Uri;
  name: string;
  index: number;
}

export const state = {
  folders: [] as MockFolder[],
  configuration: {} as Record<string, string>,
  files: [] as MockFile[],
  openDocuments: [] as unknown[],
  findFilesCalls: 0,
  diagnostics: new Map<string, Diagnostic[]>(),
  completion: [] as { selector: unknown; provider: any; triggers: string[] }[],
  hover: [] as { selector: unknown; provider: any }[],
  codeActions: [] as { selector: unknown; provider: any; metadata: unknown }[],
  handlers: {
    open: [] as ((document: any) => void)[],
    change: [] as ((event: any) => void)[],
    save: [] as ((document: any) => void)[],
    close: [] as ((document: any) => void)[],
    createFiles: [] as ((event: any) => void)[],
    deleteFiles: [] as ((event: any) => void)[],
    renameFiles: [] as ((event: any) => void)[],
    configuration: [] as ((event: any) => void)[],
    folders: [] as (() => void)[],
  },
};

export function resetState(): void {
  state.folders = [];
  state.configuration = {};
  state.files = [];
  state.openDocuments = [];
  state.findFilesCalls = 0;
  state.diagnostics.clear();
  state.completion = [];
  state.hover = [];
  state.codeActions = [];
  state.handlers.open.length = 0;
  state.handlers.change.length = 0;
  state.handlers.save.length = 0;
  state.handlers.close.length = 0;
  state.handlers.createFiles.length = 0;
  state.handlers.deleteFiles.length = 0;
  state.handlers.renameFiles.length = 0;
  state.handlers.configuration.length = 0;
  state.handlers.folders.length = 0;
}

function disposable(): { dispose(): void } {
  return { dispose() {} };
}

export const languages = {
  createDiagnosticCollection(name: string) {
    return {
      name,
      set(uri: Uri, list: readonly Diagnostic[]) {
        state.diagnostics.set(uri.fsPath, [...list]);
      },
      delete(uri: Uri) {
        state.diagnostics.delete(uri.fsPath);
      },
      clear() {
        state.diagnostics.clear();
      },
      dispose() {
        state.diagnostics.clear();
      },
      forEach(callback: (uri: Uri, list: readonly Diagnostic[]) => void) {
        for (const [fsPath, list] of state.diagnostics) callback(Uri.file(fsPath), list);
      },
    };
  },
  registerCompletionItemProvider(selector: unknown, provider: any, ...triggers: string[]) {
    state.completion.push({ selector, provider, triggers });
    return disposable();
  },
  registerHoverProvider(selector: unknown, provider: any) {
    state.hover.push({ selector, provider });
    return disposable();
  },
  registerCodeActionsProvider(selector: unknown, provider: any, metadata?: unknown) {
    state.codeActions.push({ selector, provider, metadata });
    return disposable();
  },
};

export const workspace = {
  get workspaceFolders(): MockFolder[] {
    return state.folders;
  },
  get textDocuments(): unknown[] {
    return state.openDocuments;
  },
  getConfiguration(_section?: string, _scope?: unknown) {
    return {
      get<T>(key: string, fallback?: T): T {
        return (key in state.configuration ? state.configuration[key] : fallback) as T;
      },
    };
  },
  getWorkspaceFolder(uri: Uri): MockFolder | undefined {
    return state.folders.find((folder) => uri.fsPath.startsWith(folder.uri.fsPath + "/"));
  },
  async findFiles(): Promise<Uri[]> {
    state.findFilesCalls += 1;
    return state.files.map((file) => file.uri);
  },
  fs: {
    async readFile(uri: Uri): Promise<Uint8Array> {
      const file = state.files.find((entry) => entry.uri.fsPath === uri.fsPath);
      if (!file) throw new Error("ENOENT " + uri.fsPath);
      return new TextEncoder().encode(file.text);
    },
  },
  onDidOpenTextDocument(listener: (document: any) => void) {
    state.handlers.open.push(listener);
    return disposable();
  },
  onDidChangeTextDocument(listener: (event: any) => void) {
    state.handlers.change.push(listener);
    return disposable();
  },
  onDidSaveTextDocument(listener: (document: any) => void) {
    state.handlers.save.push(listener);
    return disposable();
  },
  onDidCloseTextDocument(listener: (document: any) => void) {
    state.handlers.close.push(listener);
    return disposable();
  },
  onDidCreateFiles(listener: (event: any) => void) {
    state.handlers.createFiles.push(listener);
    return disposable();
  },
  onDidDeleteFiles(listener: (event: any) => void) {
    state.handlers.deleteFiles.push(listener);
    return disposable();
  },
  onDidRenameFiles(listener: (event: any) => void) {
    state.handlers.renameFiles.push(listener);
    return disposable();
  },
  onDidChangeConfiguration(listener: (event: any) => void) {
    state.handlers.configuration.push(listener);
    return disposable();
  },
  onDidChangeWorkspaceFolders(listener: () => void) {
    state.handlers.folders.push(listener);
    return disposable();
  },
};
