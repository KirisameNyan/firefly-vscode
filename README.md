# Firefly (VS Code 扩展)

给 [Firefly](https://github.com/CuteLeaf/Firefly) 博客的 **frontmatter 语言支持** —— 没有面板、没有侧边栏，全部在编辑器里完成，风格对标 *HTML CSS Support*。

## 它做什么

**文章**（`src/content/posts/**/*.{md,mdx}` 的 frontmatter）：

- **字段名补全**：20 个字段，已写过的自动不提示；每项带中文名、类型、是否必填
- **值补全**：
  - `tags` / `category` / `series` / `lang` —— 从**整个工作区的文章**里收集已有取值，按使用篇数排序（补全你自己用过的标签，而不是一份死列表）
  - `draft` / `pinned` / `comment` → `true` / `false`
  - `licenseName` → 常见协议预设
- **悬停文档**：停在字段名或值上，看说明、类型、示例
- **诊断**：未知字段、缺 `title`/`published`、日期不是 `YYYY-MM-DD`、`seriesOrder` 非整数、布尔字段写了别的、重复键
- **快速修复**：一键补齐必填字段，或删掉未知字段那一行

**公告**（`src/config/announcementConfig.ts`）：同样有字段补全、悬停文档与诊断（缺 `content`、未知键、布尔值不合法）。

**命令**（`Ctrl+Shift+P`）：

| 命令 | 作用 |
| --- | --- |
| `Firefly: 新建文章` | 依次问标题 → slug → 日期，建文件并打开；frontmatter 与上游 `scripts/new-post.js` 逐行一致 |
| `Firefly: 打开公告配置` | 直接跳到公告配置文件 |
| `Firefly: 校验全部文章` | 扫描全部文章 + 公告，问题汇总到输出面板，位置可点击跳转 |

## 设置

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| `firefly.postsDir` | `src/content/posts` | 文章目录（相对工作区根） |
| `firefly.announcementFile` | `src/config/announcementConfig.ts` | 公告配置路径 |

在博客仓库根目录打开 VS Code 即自动激活（`workspaceContains:src/content/posts`）。

## 支持哪些字段

与[官方文档](https://docs-firefly.cuteleaf.cn/zh/guide/writing.html)对齐的 20 个：
`title` `published` `updated` `description` `image` `tags` `category` `draft` `pinned` `slug` `lang` `author` `sourceLink` `licenseName` `licenseUrl` `comment` `password` `passwordHint` `series` `seriesOrder`

不在表里的键（如内部使用的 `prevTitle`/`nextSlug`）不会误报。

## 设计取舍

- **只读不改写**：扩展不提供"保存时重排 frontmatter"这类功能 —— 你手写的键顺序、注释、空行全部原样保留。新建文章与快速修复才会插入/删除行。
- **纯函数 + 单测**：所有解析与判断都在不依赖 `vscode` 的模块里（`src/providers/postCore.ts`、`src/core/*`），115 个 vitest 用例覆盖；provider 层只做类型转换。
- **缓存**：工作区索引只在保存/新建/删除/重命名/配置变更时失效，不在每次按键时扫盘。

## 开发

```bash
pnpm install
pnpm test          # 115 个用例
pnpm build         # tsc + esbuild -> dist/extension.js
pnpm package       # 打出 .vsix
```

## 已知限制

- 行级解析，不处理复杂 YAML（多行 folded 标量、锚点）；这类结构建议手写。
- 新建文章照抄上游模板，标题里含 `:` 时需要自己加引号（上游同样如此）。
- 多根工作区只作用于第一个文件夹。

MIT License.
