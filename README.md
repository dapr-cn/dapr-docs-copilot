# Dapr Docs Translation Console

中文翻译管理台。结论是：数据台继续核对 JSON，工作台负责选版本、选文件、直调本机 `claude`、看队列。

## 页面结构

- `/translation-workbench`：翻译工作台
  - 扫描 `repos/*_zh/data` 可用版本
  - 读取未翻译 / 待翻译文件
  - 批量建队、有界并发翻译、失败重试
- `/pr-workbench`：PR 工作台
  - 扫描同时具备 `repos/<version>_zh` 与 `repos/fork-<version>` 的版本
  - 校验 zh 仓 dirty / upstream / ahead-behind
  - fast-forward fork、切换 `translations/docs-zh` submodule、执行本地 build
- `/zh-data`：中文数据台
  - `同步状态`
  - `术语表`
  - `源文清单`
- `/`：总览页
- `/sites`：站点矩阵占位页
- `/settings`：策略与环境变量占位页

## 前提

翻译工作台仅在 Vite 开发态挂本地管理端点，并要求本机可直接执行 `claude`。

- `TRANSLATION_WORKBENCH_CLAUDE_MODEL`：可选；不设则直接使用本机 `claude` 的当前默认模型
- `TRANSLATION_WORKBENCH_CLAUDE_BIN`：可选；默认 `claude`
- `TRANSLATION_WORKBENCH_TEMPLATE`：可选；默认 `claude-default.hbs`

默认模板目录：`repos/dapr-docs-copilot/prompts/translation/`

## 启动

```bash
npm install
npm run dev
```

开发模式会直接读取同级仓：

- `repos/*_zh/data/sync-status.json`
- `repos/*_zh/data/source.json`
- `repos/*_zh/data/glossary.json`
- `repos/*_zh/data/source/**`
- `repos/*_zh/translated_content/zh_CN/**`

`/zh-data` 下的术语表行内 CRUD 也只在 Vite 开发态可写，依赖本地 `GET/POST/PATCH/DELETE /__admin/zh-data/glossary` 端点；若未通过 `npm run dev` 启动，术语表会自动降级为只读。

如需最新数据，先回到仓库根目录执行：

```bash
npm run zh:data:sync -- \
  --source-repo repos/v1.17 \
  --zh-repo repos/v1.17_zh \
  --version v1.17
```


## PR 工作台前提

重点是：此页只做 PR 前门禁，不代替 `git push`、提交或创建 GitHub PR。

- zh 仓约定：`repos/<version>_zh`，当前工作分支需已跟踪 upstream（通常为 `origin/<branch>`）
- fork 仓约定：`repos/fork-<version>`，当前工作分支需存在 upstream remote `source`
- docs-zh submodule 路径固定：`translations/docs-zh`
- 默认构建入口：fork 仓 `package.json` 的 `scripts.build`，页面执行命令为 `npm run build`
- 任何会改工作树的步骤前，目标仓必须干净；否则工作台直接阻断

常见阻断原因：

- zh 仓有未提交文件，或当前分支未配置 upstream
- zh 仓相对 upstream 存在 ahead / behind 差异，说明未 push 或未 pull
- 若仅 `ahead` 或仅 `behind` 且工作区干净，可直接点页面内 `直接推送 zh` / `直接拉取 zh`
- fork 仓有未提交文件，无法安全 fast-forward
- fork 分支已分叉，`merge --ff-only` 失败
- `translations/docs-zh` 尚未初始化，或目标 zh SHA 无法从 submodule remote 获取
- fork 仓缺少 `scripts.build`，或 `npm run build` 返回非零退出码

## 本地文档验证站点

重点是：管理台仓现可直接桥接 zh 仓 runner，无须手动再切到 `repos/v1.17_zh`。

默认启动：

```bash
npm run docs:verify
```

仅做预检与配置生成：

```bash
npm run docs:verify -- --dry-run
```

常见参数：

```bash
npm run docs:verify -- \
  --version v1.17 \
  --host 127.0.0.1 \
  --port 1417
```

如需覆盖路径：

```bash
npm run docs:verify -- \
  --source-repo /abs/path/to/repos/v1.17 \
  --zh-repo /abs/path/to/repos/v1.17_zh \
  --hugo-bin /usr/bin/hugo
```

命令会直接透传 zh 仓 runner 的 stdout/stderr。成功时可看到：

- `sourceRepo=<resolved path>`
- `zhRepo=<resolved path>`
- `generatedConfig=<zhRepo/site/.generated/hugo.verification.yaml>`
- `cacheDir=<zhRepo/site/.cache>`
- `previewUrl=http://127.0.0.1:1313/zh-hans/`

若依赖缺失或路径错误，命令会在启动前直接失败，并指出缺失的 `hugo`、`sourceRepo/hugo.yaml` 或 `zhRepo/translated_content/zh_CN`。


## PR 工作台使用

1. 打开 `/pr-workbench`
2. 选择版本，确认 `zh / fork / docs-zh` 路径锁定
3. 执行 `zh 仓同步校验`；若仅 ahead 或仅 behind，可直接点 `直接推送 zh` / `直接拉取 zh`
4. 执行 `更新 fork 与 submodule`，确认 fork HEAD 与 docs-zh SHA
5. 点 `提交 fork 变更`，将 docs-zh 指针写入 fork 当前分支
6. 执行 `本地构建验证`，成功后读取 Ready 摘要
7. 点 `推送 fork`，将已验证分支推至 `origin`

结论是：Ready 仅绑定当前 zh SHA、fork SHA 与 docs-zh SHA。其间任一仓状态变化，后续步骤会自动失效，需重跑。

## 工作台使用

1. 打开 `/translation-workbench`
2. 选择版本
3. 设定 `并发数量`
4. 勾选待翻译文件
5. 点击 `AI 翻译`
6. 观察 `等待中 / 翻译中 / 翻译完成 / 翻译失败` 四态
7. 若失败，点该行 `重试`

重点是：并发默认 `3`，最小 `1`，最大 `10`；队列运行中会锁定版本切换、并发编辑与重复提交；失败项可单独重试，不必重建整队。
并发越高，请求压力越大；若本机 `claude`、网络或速率限制已接近上限，宜先降并发再重试。
翻译执行时，工作目录会切到对应版本仓根，例如 `repos/v1.17_zh`，以保证本机 `claude` 对仓内路径解析正确。
若 Markdown front matter 含 `aliases`，简体中文译文写入 `translated_content/zh_CN/**` 前会自动将站内路径本地化为 `/zh-hans/` 前缀；已带此前缀者保持不变，不会重复拼接。
Markdown 成功路径现为“归一化 -> 结构校验 -> 写入”；若 frontmatter key 丢失、出现额外 key、或 Markdown 标题数目/层级与原文不一一对应，任务项会直接进 `failed`，并阻断 `translation-state.json`、`sync-status.json`、`source.json` 与 `integrity-report.json` 的回写。
校验失败时，工作台会 best-effort 删除目标译文文件，并在错误详情/服务端日志中输出命中文件、规则、标题结构指标与完整候选译文内容，便于复盘。

## 独立校验命令

重点是：工作台外亦可单独复用同一套规则。

单文件显式模式：

```bash
npm run translation-output:validate -- \
  --source repos/v1.17_zh/data/source/docs/getting-started/quickstart.md \
  --target repos/v1.17_zh/translated_content/zh_CN/docs/getting-started/quickstart.md
```

版本批量模式：

```bash
npm run translation-output:validate -- \
  --version v1.17 \
  --bucket docs \
  --relative-path getting-started/quickstart.md
```

批量模式默认只校验当前版本下已存在的 Markdown 译文文件；可重复追加 `--relative-path` 细化范围。
退出码固定：全部通过为 `0`，存在任一失败为 `1`，参数/环境错误为 `2`。
失败输出会打印聚合摘要，并把完整候选译文内容写入 `stderr`。

## 构建与校验

```bash
npm run build
npm run docs:verify:test
npm run zh:data:test
npm run translation-workbench:test
npm run pr-workbench:test
npm run translation-output:test
../../node_modules/.bin/tsx --tsconfig tsconfig.app.json scripts/validate-zh-data-ui.tsx
../../node_modules/.bin/tsx scripts/validate-zh-glossary-admin.ts
```

## 模板说明

默认模板文件：`repos/dapr-docs-copilot/prompts/translation/claude-default.hbs`

模板固定接收以下变量：

- `sourceContent`
- `glossary`
- `targetPath`
- `version`
- `relativePath`

若模板缺失、`claude` 不在 PATH、或本机 `claude` 调用失败，对应任务项会直接进入失败态。

## 已翻译文件回填

重点是：上述 `aliases` 本地化只自动覆盖新写入译文。若仓内已有历史译文，宜先执行一次回填：

```bash
npm run translation-workbench:backfill-aliases
```

若只想预览将改多少文件，可先跑：

```bash
npm run translation-workbench:backfill-aliases -- --dry-run
```

若只处理单一版本，可追加：

```bash
npm run translation-workbench:backfill-aliases -- --version v1.17
```

## 术语表 CRUD

- 打开 `/zh-data` 的 `术语表` 标签，可搜索现有术语，并在表格内直接新增、编辑、删除。
- 保存前会校验 `source`、`target` 必填，且 `source` 在当前术语集中必须唯一。
- 写入失败仅影响当前行；其余行仍可继续浏览或编辑。
- 写入成功后，会同步刷新 `术语规则` 摘要卡、术语表记录数与当前标签内容。

## glossary.json 字段演进

- 历史术语仍可读取：即便旧记录缺少 `id`，或仍保留 `status`、`category`，前端仍会先兼容装载。
- 首次成功执行术语新增、编辑或删除后，写回链路会为旧记录补齐稳定 `id`。
- 新写回的术语项只保留 `id`、`source`、`target`、`notes` 与可选 `updatedAt`。
- 顶层 `generatedAt` 会在每次成功写入后刷新，历史 `status`、`category` 字段会在持久化时清理。
