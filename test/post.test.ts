import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { registerPostProviders } from "../src/providers/post";
import { Position, Uri, resetState, state } from "./vscode-mock";

const ROOT = "/ws";
const POSTS_DIR = ROOT + "/src/content/posts";
const ARTICLE = POSTS_DIR + "/a.md";

function positionAt(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  const line = (before.match(/\n/g) ?? []).length;
  const lastBreak = before.lastIndexOf("\n");
  return new Position(line, offset - lastBreak - 1);
}

function offsetAt(text: string, position: Position): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let index = 0; index < position.line; index += 1) offset += lines[index].length + 1;
  return offset + position.character;
}

function makeDocument(fsPath: string, text: string) {
  return {
    uri: Uri.file(fsPath),
    languageId: "markdown",
    getText: () => text,
    offsetAt: (position: Position) => offsetAt(text, position),
    positionAt: (offset: number) => positionAt(text, offset),
  };
}

function register(): { subscriptions: { dispose(): void }[] } {
  const context = { subscriptions: [] as { dispose(): void }[] };
  registerPostProviders(context as never);
  return context;
}

function completion(): any {
  return state.completion[0].provider;
}

function post(body: string): string {
  return ["---", "title: t", "published: 2026-10-17", body, "---", ""].join("\n");
}

beforeEach(() => {
  resetState();
  state.folders = [{ uri: Uri.file(ROOT), name: "ws", index: 0 }];
  state.configuration = { postsDir: "src/content/posts" };
});

describe("registerPostProviders", () => {
  it("注册补全/悬停/快速修复并挂上生命周期监听", () => {
    const context = register();
    expect(state.completion).toHaveLength(1);
    expect(state.completion[0].triggers).toEqual([":", "-"]);
    expect(state.hover).toHaveLength(1);
    expect(state.codeActions).toHaveLength(1);
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(12);
  });

  it("作用域外的 markdown 不参与", async () => {
    register();
    const text = ["---", "title: t", "ca", "---", ""].join("\n");
    const document = makeDocument(ROOT + "/src/pages/notes.md", text);
    const result = await completion().provideCompletionItems(
      document,
      positionAt(text, text.indexOf("ca") + 2),
    );
    expect(result).toBeUndefined();
    expect(state.findFilesCalls).toBe(0);
  });

  it("文章目录下的 .mdx 也在作用域内", () => {
    const text = ["---", "title: t", "---", ""].join("\n");
    const document = makeDocument(POSTS_DIR + "/a.mdx", text);
    state.openDocuments = [document];
    register();
    expect(state.diagnostics.get(POSTS_DIR + "/a.mdx")?.map((item) => item.code)).toEqual([
      "missing-published",
    ]);
  });
});

describe("字段名补全", () => {
  it("只给尚未出现的字段，Detail 带 label 与类型", async () => {
    register();
    const text = ["---", "title: t", "published: 2026-10-17", "ca", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    const items: any[] = await completion().provideCompletionItems(
      document,
      positionAt(text, text.indexOf("\nca\n") + 3),
    );
    const labels = items.map((item) => item.label);
    expect(labels).toContain("category");
    expect(labels).not.toContain("title");
    expect(labels).not.toContain("published");
    const category = items.find((item) => item.label === "category");
    expect(category.detail).toContain("分类");
    expect(category.detail).toContain("字符串");
    expect(category.insertText).toBe("category: ");
    expect(category.documentation.value).toContain("分类名，单值");
  });
});

describe("值补全", () => {
  it("分类候选来自工作区已有文章，且第二次命中缓存", async () => {
    state.files = [
      {
        uri: Uri.file(POSTS_DIR + "/existing.md"),
        text: post("category: 随笔\ntags: [随笔, 关于]"),
      },
    ];
    register();
    const text = ["---", "title: t", "published: 2026-10-17", "category: ", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    const offset = text.indexOf("category: ") + "category: ".length;
    const first: any[] = await completion().provideCompletionItems(
      document,
      positionAt(text, offset),
    );
    expect(first.map((item) => item.label)).toEqual(["随笔"]);
    expect(first[0].insertText).toBe("随笔");
    expect(first[0].documentation.value).toContain("1 篇文章使用");
    expect(state.findFilesCalls).toBe(1);

    await completion().provideCompletionItems(document, positionAt(text, offset));
    expect(state.findFilesCalls).toBe(1);
  });

  it("冒号后立即补全会补一个空格", async () => {
    state.files = [{ uri: Uri.file(POSTS_DIR + "/existing.md"), text: post("category: 随笔") }];
    register();
    const text = ["---", "title: t", "published: 2026-10-17", "category:", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    const offset = text.indexOf("category:") + "category:".length;
    const items: any[] = await completion().provideCompletionItems(
      document,
      positionAt(text, offset),
    );
    expect(items[0].insertText).toBe(" 随笔");
  });

  it("标签候选按频次排序", async () => {
    state.files = [
      { uri: Uri.file(POSTS_DIR + "/a.md"), text: post("tags: [随笔, 关于]") },
      { uri: Uri.file(POSTS_DIR + "/b.md"), text: post("tags: [随笔]") },
    ];
    register();
    const text = ["---", "title: t", "published: 2026-10-17", "tags: [", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    const items: any[] = await completion().provideCompletionItems(
      document,
      positionAt(text, text.indexOf("[") + 1),
    );
    expect(items.map((item) => item.label)).toEqual(["随笔", "关于"]);
  });
});

describe("缓存失效", () => {
  async function warm(): Promise<string> {
    state.files = [{ uri: Uri.file(POSTS_DIR + "/existing.md"), text: post("category: 随笔") }];
    register();
    const text = ["---", "title: t", "published: 2026-10-17", "category: ", "---", ""].join("\n");
    await completion().provideCompletionItems(
      makeDocument(ARTICLE, text),
      positionAt(text, text.indexOf("category: ") + "category: ".length),
    );
    return text;
  }

  it("保存文章后重新扫描", async () => {
    const text = await warm();
    expect(state.findFilesCalls).toBe(1);
    const document = makeDocument(ARTICLE, text);
    state.handlers.save.forEach((handler) => handler(document));
    await completion().provideCompletionItems(
      document,
      positionAt(text, text.indexOf("category: ") + "category: ".length),
    );
    expect(state.findFilesCalls).toBe(2);
  });

  it("创建与删除文章后重新扫描", async () => {
    const text = await warm();
    const document = makeDocument(ARTICLE, text);
    const offset = text.indexOf("category: ") + "category: ".length;

    state.handlers.createFiles.forEach((handler) =>
      handler({ files: [Uri.file(POSTS_DIR + "/new.md")] }),
    );
    await completion().provideCompletionItems(document, positionAt(text, offset));
    expect(state.findFilesCalls).toBe(2);

    state.handlers.deleteFiles.forEach((handler) =>
      handler({ files: [Uri.file(POSTS_DIR + "/new.md")] }),
    );
    await completion().provideCompletionItems(document, positionAt(text, offset));
    expect(state.findFilesCalls).toBe(3);
  });

  it("保存文章时立即刷新诊断", async () => {
    register();
    const text = ["---", "title: t", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    state.handlers.save.forEach((handler) => handler(document));
    expect(state.diagnostics.get(ARTICLE)?.map((item) => item.code)).toEqual(["missing-published"]);
  });
});

describe("诊断", () => {
  it("打开文档时发布诊断，严重级别与位置正确", () => {
    const text = ["---", "title: t", "published: 2026-13-45", "foo: 1", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    state.openDocuments = [document];
    register();
    const list = state.diagnostics.get(ARTICLE) ?? [];
    expect(list.map((item) => item.code)).toEqual(["invalid-date", "unknown-key"]);
    expect(list[0].severity).toBe(0);
    expect(list[1].severity).toBe(1);
    expect(list[1].range.start.line).toBe(3);
    expect(list[0].source).toBe("firefly");
  });

  it("缺必填字段定位到 frontmatter 开头", () => {
    const text = ["---", "title: t", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    state.openDocuments = [document];
    register();
    const list = state.diagnostics.get(ARTICLE) ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].code).toBe("missing-published");
    expect(list[0].range.start.line).toBe(1);
    expect(list[0].range.start.character).toBe(0);
  });

  it("改配置后清空诊断并按新目录判定作用域", () => {
    const text = ["---", "title: t", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    state.openDocuments = [document];
    register();
    expect(state.diagnostics.size).toBe(1);

    state.configuration = { postsDir: "src/other" };
    state.handlers.configuration.forEach((handler) =>
      handler({ affectsConfiguration: (section: string) => section === "firefly.postsDir" }),
    );
    expect(state.diagnostics.size).toBe(0);
  });

  it("编辑时防抖刷新诊断", () => {
    vi.useFakeTimers();
    try {
      const text = ["---", "title: t", "---", ""].join("\n");
      const document = makeDocument(ARTICLE, text);
      register();
      expect(state.diagnostics.size).toBe(0);
      state.handlers.change.forEach((handler) => handler({ document }));
      expect(state.diagnostics.size).toBe(0);
      vi.advanceTimersByTime(300);
      expect(state.diagnostics.get(ARTICLE)?.map((item) => item.code)).toEqual([
        "missing-published",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("关闭文档时清除诊断", () => {
    const text = ["---", "title: t", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    state.openDocuments = [document];
    register();
    expect(state.diagnostics.size).toBe(1);
    state.handlers.close.forEach((handler) => handler(document));
    expect(state.diagnostics.size).toBe(0);
  });
});

describe("快速修复", () => {
  it("缺必填字段时插入缺失的行", () => {
    const text = ["---", "title: t", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    register();
    const start = positionAt(text, 4);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(start, start),
      "缺少必填字段 published",
      0,
    );
    diagnostic.code = "missing-published";
    const actions: any[] = state.codeActions[0].provider.provideCodeActions(
      document,
      new vscode.Range(start, start),
      { diagnostics: [diagnostic] },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toContain("published");
    const edits = actions[0].edit.edits;
    expect(edits).toHaveLength(1);
    expect(edits[0].newText.startsWith("published: ")).toBe(true);
    expect(edits[0].range.start.line).toBe(2);
    expect(edits[0].range.start.character).toBe(0);
  });

  it("未知键时删除整行", () => {
    const text = ["---", "title: t", "published: 2026-10-17", "foo: bar", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    register();
    const start = text.indexOf("foo: bar");
    const range = new vscode.Range(
      positionAt(text, start),
      positionAt(text, start + "foo".length),
    );
    const diagnostic = new vscode.Diagnostic(range, "未知字段 foo", 1);
    diagnostic.code = "unknown-key";
    const actions: any[] = state.codeActions[0].provider.provideCodeActions(document, range, {
      diagnostics: [diagnostic],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toContain("foo");
    const edit = actions[0].edit.edits[0];
    expect(edit.newText).toBe("");
    expect(text.slice(offsetAt(text, edit.range.start), offsetAt(text, edit.range.end))).toBe(
      "foo: bar\n",
    );
  });

  it("光标不在问题处时不提供修复", () => {
    const text = ["---", "title: t", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    register();
    const start = positionAt(text, text.indexOf("title") + 3);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(positionAt(text, 4), positionAt(text, 4)),
      "缺少必填字段 published",
      0,
    );
    diagnostic.code = "missing-published";
    const actions: any[] = state.codeActions[0].provider.provideCodeActions(
      document,
      new vscode.Range(start, start),
      { diagnostics: [diagnostic] },
    );
    expect(actions).toEqual([]);
  });
});

describe("悬停", () => {
  it("字段名悬停显示中文名、类型与必填", async () => {
    register();
    const text = ["---", "title: 你好", "published: 2026-10-17", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    const hover: any = await state.hover[0].provider.provideHover(
      document,
      positionAt(text, text.indexOf("title") + 2),
    );
    expect(hover.contents.value).toContain("标题");
    expect(hover.contents.value).toContain("字符串");
    expect(hover.contents.value).toContain("必填");
    expect(hover.range.start.line).toBe(1);
  });

  it("值悬停带上工作区使用次数", async () => {
    state.files = [{ uri: Uri.file(POSTS_DIR + "/b.md"), text: post("tags: [随笔]") }];
    register();
    const text = ["---", "title: t", "published: 2026-10-17", "tags: [随笔]", "---", ""].join("\n");
    const document = makeDocument(ARTICLE, text);
    const hover: any = await state.hover[0].provider.provideHover(
      document,
      positionAt(text, text.indexOf("随笔") + 1),
    );
    expect(hover.contents.value).toContain("当前值");
    expect(hover.contents.value).toContain("1 篇文章使用");
  });
});
