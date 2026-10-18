//! 冻结契约：Firefly frontmatter 的 20 个字段 + 公告的 7 个字段。
//! 来源：https://docs-firefly.cuteleaf.cn/zh/guide/writing.html
//! 两个 provider 模块都只读本文件，不要改。

export type FieldType =
  | "string"
  | "date"
  | "stringArray"
  | "boolean"
  | "number"
  | "url"
  | "path"
  | "password";

export type FieldGroup = "基本" | "出处与授权" | "互动" | "系列";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  group: FieldGroup;
  doc: string;
  example?: string;
}

export const POST_FIELDS: readonly FieldDef[] = [
  { key: "title", label: "标题", type: "string", required: true, group: "基本",
    doc: "文章标题，显示在列表与页面标题中。", example: "你好，世界" },
  { key: "published", label: "发布日期", type: "date", required: true, group: "基本",
    doc: "发布日期，格式 YYYY-MM-DD。决定排序。", example: "2026-10-17" },
  { key: "updated", label: "更新日期", type: "date", required: false, group: "基本",
    doc: "更新日期，格式 YYYY-MM-DD。设置后文章底部会显示“上次编辑时间”。", example: "2026-10-20" },
  { key: "description", label: "简介", type: "string", required: false, group: "基本",
    doc: "文章摘要，用于列表卡片与 SEO 描述。" },
  { key: "image", label: "封面图", type: "path", required: false, group: "基本",
    doc: "封面图。支持 public 路径（/images/x.png）、相对当前文件的路径（./cover.avif）或完整 URL。",
    example: "./cover.avif" },
  { key: "tags", label: "标签", type: "stringArray", required: false, group: "基本",
    doc: "标签数组，如 [随笔, 关于]。也支持块状列表写法。", example: "[随笔, 关于]" },
  { key: "category", label: "分类", type: "string", required: false, group: "基本",
    doc: "分类名，单值。与标签不同，分类会生成分类页。" },
  { key: "draft", label: "草稿", type: "boolean", required: false, group: "基本",
    doc: "true 时不在正式列表展示（仍会在开发环境可见）。", example: "false" },
  { key: "pinned", label: "置顶", type: "boolean", required: false, group: "基本",
    doc: "true 时在文章列表中置顶。", example: "true" },
  { key: "slug", label: "slug", type: "string", required: false, group: "基本",
    doc: "URL 片段，决定文章路径 /posts/<slug>/。不写则用文件名。" },
  { key: "lang", label: "语言", type: "string", required: false, group: "基本",
    doc: "文章语言，如 zh_CN、en。用于多语言场景与 <html lang>。" },

  { key: "author", label: "作者", type: "string", required: false, group: "出处与授权",
    doc: "作者名。不写则回退到站点配置。" },
  { key: "sourceLink", label: "原文链接", type: "url", required: false, group: "出处与授权",
    doc: "原文出处链接，转载/翻译时使用。", example: "https://example.com/post" },
  { key: "licenseName", label: "协议名", type: "string", required: false, group: "出处与授权",
    doc: "内容协议名称，如 CC BY-NC-SA 4.0。", example: "CC BY-NC-SA 4.0" },
  { key: "licenseUrl", label: "协议链接", type: "url", required: false, group: "出处与授权",
    doc: "协议详情页链接。", example: "https://creativecommons.org/licenses/by-nc-sa/4.0/" },

  { key: "comment", label: "评论", type: "boolean", required: false, group: "互动",
    doc: "是否允许评论。不写则跟随站点默认。", example: "true" },
  { key: "password", label: "密码", type: "password", required: false, group: "互动",
    doc: "文章加密密码。设置后正文被加密，读者需输入密码。" },
  { key: "passwordHint", label: "密码提示", type: "password", required: false, group: "互动",
    doc: "给读者的密码提示。" },

  { key: "series", label: "系列", type: "string", required: false, group: "系列",
    doc: "所属系列名。同一系列的文章会互相串联。" },
  { key: "seriesOrder", label: "系列序号", type: "number", required: false, group: "系列",
    doc: "在系列中的序号，整数，决定系列内顺序。", example: "1" },
];

export const POST_FIELD_MAP: ReadonlyMap<string, FieldDef> = new Map(
  POST_FIELDS.map((f) => [f.key, f]),
);

/** 内部/派生键：不是作者手写的字段，出现时不报警。 */
export const INTERNAL_KEYS: ReadonlySet<string> = new Set([
  "prevTitle", "prevSlug", "nextTitle", "nextSlug",
]);

export const ANNOUNCE_FIELDS: readonly FieldDef[] = [
  { key: "title", label: "标题", type: "string", required: false, group: "基本",
    doc: "公告标题，留空则使用 i18n 默认标题。" },
  { key: "content", label: "内容", type: "string", required: true, group: "基本",
    doc: "公告正文，单行字符串。" },
  { key: "closable", label: "可关闭", type: "boolean", required: false, group: "基本",
    doc: "是否允许访客关闭这条公告。", example: "true" },
  { key: "link.enable", label: "启用链接", type: "boolean", required: false, group: "基本",
    doc: "是否显示公告下方的链接。", example: "true" },
  { key: "link.text", label: "链接文字", type: "string", required: false, group: "基本",
    doc: "链接显示的文字。", example: "了解更多" },
  { key: "link.url", label: "链接地址", type: "string", required: false, group: "基本",
    doc: "链接目标。站内写路径（/about/），站外写完整 URL。", example: "/about/" },
  { key: "link.external", label: "外部链接", type: "boolean", required: false, group: "基本",
    doc: "true 时按外部链接处理（新标签页打开）。", example: "false" },
];

export const ANNOUNCE_FIELD_MAP: ReadonlyMap<string, FieldDef> = new Map(
  ANNOUNCE_FIELDS.map((f) => [f.key, f]),
);
