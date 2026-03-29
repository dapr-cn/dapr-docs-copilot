import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TranslationWorkbenchView } from '../src/components/translation-workbench/workbench-view'
import { GlossaryTable } from '../src/components/zh-data/glossary-table'
import { ZhDataConsoleView } from '../src/components/zh-data/console-view'
import { ZhDatasetPanel } from '../src/components/zh-data/dataset-panel'
import { PRIMARY_NAVIGATION } from '../src/lib/primary-navigation'
import type { TranslationWorkbenchFile, TranslationWorkbenchJob, TranslationWorkbenchVersion } from '../src/lib/translation-workbench-models'
import {
  ZH_DATA_TABS,
  type GlossaryDataset,
  type ZhConsolePayload,
  type ZhDataVersion,
  type ZhDatasetView,
} from '../src/lib/zh-data-models'

const glossaryDatasetView: ZhDatasetView = {
  id: 'glossary',
  label: '术语表',
  description: '术语规则。',
  fileName: 'glossary.json',
  state: 'ready',
  recordCount: 2,
  infoLabel: '2 条术语规则',
  columns: ['英文', '中文', '备注'],
  rows: [
    { id: 'term-a', cells: ['workflow', '工作流', 'API 术语'], tone: 'good' },
    { id: 'term-b', cells: ['sidecar', '边车', '沿用译法'], tone: 'good' },
  ],
  preview: '{"terms":[{"source":"workflow"}]}',
}

const readyDatasets: ZhDatasetView[] = [
  {
    id: 'sync-status',
    label: '同步状态',
    description: '逐文件原文与译文状态。',
    fileName: 'sync-status.json',
    state: 'ready',
    recordCount: 2,
    infoLabel: '2 条文件状态',
    columns: ['内容桶', '相对路径', '原文同步', '翻译状态', '翻译时间'],
    rows: [
      { id: 'docs:a.md', cells: ['docs', 'a.md', '已同步', '已翻译', '03/28'], tone: 'good' },
      { id: 'docs:b.md', cells: ['docs', 'b.md', '校验失败', '未翻译', '03/28'], tone: 'warn' },
    ],
    preview: '{"sourceSummary":{"synced":1,"drift":1},"translationSummary":{"translated":1,"missingTranslation":1}}',
  },
  glossaryDatasetView,
  {
    id: 'source',
    label: '源文清单',
    description: '源文元数据。',
    fileName: 'source.json',
    state: 'ready',
    recordCount: 2,
    infoLabel: '2 篇源文',
    columns: ['内容桶', '相对路径', '大小', '源文文件'],
    rows: [{ id: 'docs:a.md', cells: ['docs', 'a.md', '120 B', 'data/source/docs/a.md'], tone: 'good' }],
    preview: '{"items":[{"bucket":"docs","relativePath":"a.md"}]}',
  },
]

const writableGlossary: GlossaryDataset = {
  version: 'v1.17',
  generatedAt: '2026-03-28T15:22:20+08:00',
  readOnlyState: { mode: 'writable' },
  terms: [
    { id: 'term-a', source: 'workflow', target: '工作流', notes: 'API 术语', updatedAt: '2026-03-28T15:22:20+08:00' },
    { id: 'term-b', source: 'sidecar', target: '边车', notes: '沿用译法', updatedAt: '2026-03-28T15:24:20+08:00' },
  ],
}

const readOnlyGlossary: GlossaryDataset = {
  ...writableGlossary,
  readOnlyState: {
    mode: 'read-only',
    reason: '当前运行环境为只读，暂不可新增、编辑或删除术语。',
  },
}

const payload: ZhConsolePayload = {
  version: 'v1.17',
  versions: [
    { id: 'v1.17', label: 'v1.17' },
    { id: 'v1.15', label: 'v1.15' },
  ],
  generatedAt: '2026-03-28T15:22:20+08:00',
  integrityReport: {
    version: 'v1.17',
    generatedAt: '2026-03-29T10:00:00.000Z',
    latestBatchId: 'batch-1',
    sourceSummary: { synced: 1, drift: 1, missingSource: 0 },
    translationSummary: { translated: 1, staleTranslation: 0, missingTranslation: 1, orphanTranslation: 0 },
    buckets: [],
    categories: [
      {
        id: 'syncStatusConflict',
        label: 'sync-status 与权威判定冲突',
        hint: '宜重建 sync-status/source，勿仅改前端展示。',
        count: 1,
        tone: 'warn',
      },
    ],
    findings: [
      {
        id: 'syncStatusConflict:docs:a.md',
        type: 'syncStatusConflict',
        version: 'v1.17',
        bucket: 'docs',
        relativePath: 'a.md',
        sourceFile: 'data/source/docs/a.md',
        translationFile: 'translated_content/zh_CN/docs/a.md',
        conflictStage: 'sync-status',
        title: 'sync-status 与权威判定冲突',
        detail: '宜重建 sync-status/source，勿仅改前端展示。',
        observed: { translationStatus: 'missingTranslation' },
        expected: { translationStatus: 'translated' },
      },
    ],
    totalFindings: 1,
    status: 'warn',
  },
  datasetViews: readyDatasets,
  summaryCards: [
    { label: '原文已同步', value: '1', detail: '1 校验失败 / 0 缺失原文', tone: 'warn' },
    { label: '已翻译', value: '1', detail: '0 待翻译 / 1 未翻译 / 0 孤儿', tone: 'warn' },
    { label: '术语规则', value: '2', detail: '最近刷新 2026/03/28 15:22', tone: 'good' },
    { label: '完整性风险', value: '1', detail: 'sync-status 与权威判定冲突 1', tone: 'warn' },
  ],
  activities: [
    { id: 'a1', title: 'docs 风险', detail: '1 校验失败 / 1 未翻译。', time: '当前焦点', tone: 'warn' },
    { id: 'a2', title: '状态摘要', detail: '1 原文已同步 / 1 已翻译 / 1 未翻译。', time: '摘要', tone: 'stable' },
    { id: 'a3', title: '完整性审计发现风险', detail: 'sync-status 与权威判定冲突 1', time: '2026/03/29 10:00', tone: 'warn' },
  ],
  focus: ['docs：1 校验失败 / 0 缺失原文 / 1 未翻译 / 0 孤儿'],
}

const zhDataVersions: ZhDataVersion[] = payload.versions

const emptyDataset: ZhDatasetView = {
  ...glossaryDatasetView,
  state: 'empty',
  recordCount: 0,
  infoLabel: '暂无记录',
  rows: [],
  preview: '{}',
  emptyMessage: '术语文件存在，但尚未录入任何术语。',
}

const errorDataset: ZhDatasetView = {
  id: 'source',
  label: '源文清单',
  description: '缺失源文索引。',
  fileName: 'source.json',
  state: 'error',
  recordCount: 0,
  infoLabel: '缺少数据文件',
  columns: [],
  rows: [],
  preview: '{}',
  errorMessage: '缺少数据集：source.json',
}

const noopMutation = async () => ({ dataset: writableGlossary })

const workbenchVersions: TranslationWorkbenchVersion[] = [
  {
    id: 'v1.17',
    label: 'v1.17',
    repoPath: 'repos/v1.17_zh',
    datasetPath: 'repos/v1.17_zh/data',
    untranslatedCount: 2,
    templateName: 'claude-default.hbs',
  },
]

const workbenchFiles: TranslationWorkbenchFile[] = [
  {
    id: 'v1.17::docs::alpha.md',
    version: 'v1.17',
    bucket: 'docs',
    fileName: 'alpha.md',
    relativePath: 'docs/alpha.md',
    sourceFile: 'data/source/docs/alpha.md',
    sourcePath: 'docs/alpha.md',
    targetPath: 'translated_content/zh_CN/docs/alpha.md',
    sizeBytes: 1200,
    mimeType: 'text/markdown',
    datasetState: 'missingTranslation',
  },
  {
    id: 'v1.17::docs::beta.md',
    version: 'v1.17',
    bucket: 'docs',
    fileName: 'beta.md',
    relativePath: 'docs/beta.md',
    sourceFile: 'data/source/docs/beta.md',
    sourcePath: 'docs/beta.md',
    targetPath: 'translated_content/zh_CN/docs/beta.md',
    sizeBytes: 2400,
    mimeType: 'text/markdown',
    datasetState: 'staleTranslation',
  },
]

const runningJob: TranslationWorkbenchJob = {
  jobId: 'job-running',
  version: 'v1.17',
  templateName: 'claude-default.hbs',
  concurrency: 4,
  createdAt: '2026-03-28T15:22:20+08:00',
  updatedAt: '2026-03-28T15:22:20+08:00',
  isActive: true,
  counts: {
    total: 2,
    waiting: 0,
    translating: 2,
    completed: 0,
    failed: 0,
  },
  items: [
    {
      id: 'item-1',
      fileId: 'v1.17::docs::alpha.md',
      version: 'v1.17',
      relativePath: 'docs/alpha.md',
      fileName: 'alpha.md',
      targetPath: 'translated_content/zh_CN/docs/alpha.md',
      sizeBytes: 1200,
      status: 'translating',
      attempts: 1,
    },
    {
      id: 'item-2',
      fileId: 'v1.17::docs::beta.md',
      version: 'v1.17',
      relativePath: 'docs/beta.md',
      fileName: 'beta.md',
      targetPath: 'translated_content/zh_CN/docs/beta.md',
      sizeBytes: 2400,
      status: 'translating',
      attempts: 1,
    },
  ],
}

const failedJob: TranslationWorkbenchJob = {
  jobId: 'job-failed',
  version: 'v1.17',
  templateName: 'claude-default.hbs',
  concurrency: 3,
  createdAt: '2026-03-28T15:22:20+08:00',
  updatedAt: '2026-03-28T15:42:20+08:00',
  isActive: false,
  counts: {
    total: 1,
    waiting: 0,
    translating: 0,
    completed: 0,
    failed: 1,
  },
  items: [
    {
      id: 'item-failed',
      fileId: 'v1.17::docs::alpha.md',
      version: 'v1.17',
      relativePath: 'docs/alpha.md',
      fileName: 'alpha.md',
      targetPath: 'translated_content/zh_CN/docs/alpha.md',
      sizeBytes: 1200,
      status: 'failed',
      attempts: 1,
      error: {
        code: 'template_not_found',
        message: '模板缺失',
      },
    },
  ],
}

assert.equal(PRIMARY_NAVIGATION[0].label, '翻译工作台')
assert.equal(PRIMARY_NAVIGATION[1].label, 'PR 工作台')
assert.equal(PRIMARY_NAVIGATION[2].label, '中文数据')
assert.ok(PRIMARY_NAVIGATION.every((item) => item.label !== 'Copilot'))
assert.deepEqual(
  ZH_DATA_TABS.map((tab) => tab.id),
  ['sync-status', 'glossary', 'source'],
)

for (const tab of ZH_DATA_TABS) {
  const html = renderToStaticMarkup(
    <ZhDataConsoleView
      payload={payload}
      versions={zhDataVersions}
      selectedVersion="v1.17"
      onSelectVersion={() => {}}
      defaultDatasetId={tab.id}
      glossary={{
        dataset: writableGlossary,
        onCreate: async () => noopMutation(),
        onUpdate: async () => noopMutation(),
        onDelete: async () => noopMutation(),
      }}
    />,
  )
  assert.ok(html.includes(tab.label), `missing tab label: ${tab.label}`)
}

const versionSelectorHtml = renderToStaticMarkup(
  <ZhDataConsoleView
    payload={payload}
    versions={zhDataVersions}
    selectedVersion="v1.15"
    onSelectVersion={() => {}}
    glossary={{
      dataset: writableGlossary,
      onCreate: async () => noopMutation(),
      onUpdate: async () => noopMutation(),
      onDelete: async () => noopMutation(),
    }}
  />,
)
assert.ok(versionSelectorHtml.includes('选择版本'))
assert.ok(versionSelectorHtml.includes('v1.15'))

const defaultGlossaryHtml = renderToStaticMarkup(
  <GlossaryTable
    dataset={glossaryDatasetView}
    glossary={writableGlossary}
    onCreate={async () => noopMutation()}
    onUpdate={async () => noopMutation()}
    onDelete={async () => noopMutation()}
  />,
)
assert.ok(defaultGlossaryHtml.includes('workflow'))
assert.ok(defaultGlossaryHtml.includes('新增术语'))

const editingGlossaryHtml = renderToStaticMarkup(
  <GlossaryTable
    dataset={glossaryDatasetView}
    glossary={writableGlossary}
    onCreate={async () => noopMutation()}
    onUpdate={async () => noopMutation()}
    onDelete={async () => noopMutation()}
    initialState={{
      drafts: {
        'term-a': {
          source: 'workflow',
          target: '工作流编排',
          notes: '待确认新译法',
        },
      },
      pendingRows: {
        'term-a': 'save',
      },
    }}
  />,
)
assert.ok(editingGlossaryHtml.includes('工作流编排'))
assert.ok(editingGlossaryHtml.includes('保存中'))

const creatingGlossaryHtml = renderToStaticMarkup(
  <GlossaryTable
    dataset={emptyDataset}
    glossary={{ ...writableGlossary, terms: [] }}
    onCreate={async () => noopMutation()}
    onUpdate={async () => noopMutation()}
    onDelete={async () => noopMutation()}
    initialState={{
      createDraft: {
        source: '',
        target: '工作流',
        notes: '',
      },
      createErrors: {
        source: '英文术语必填',
      },
    }}
  />,
)
assert.ok(creatingGlossaryHtml.includes('创建'))
assert.ok(creatingGlossaryHtml.includes('英文术语必填'))

const errorGlossaryHtml = renderToStaticMarkup(
  <GlossaryTable
    dataset={glossaryDatasetView}
    glossary={writableGlossary}
    onCreate={async () => noopMutation()}
    onUpdate={async () => noopMutation()}
    onDelete={async () => noopMutation()}
    initialState={{
      drafts: {
        'term-b': {
          source: 'sidecar',
          target: '边车',
          notes: '沿用译法',
        },
      },
      rowErrors: {
        'term-b': {
          form: '术语请求失败',
        },
      },
    }}
  />,
)
assert.ok(errorGlossaryHtml.includes('术语请求失败'))

const readOnlyGlossaryHtml = renderToStaticMarkup(
  <GlossaryTable
    dataset={glossaryDatasetView}
    glossary={readOnlyGlossary}
    onCreate={async () => noopMutation()}
    onUpdate={async () => noopMutation()}
    onDelete={async () => noopMutation()}
  />,
)
assert.ok(readOnlyGlossaryHtml.includes('只读降级'))
assert.ok(readOnlyGlossaryHtml.includes(readOnlyGlossary.readOnlyState.reason))

const emptyHtml = renderToStaticMarkup(
  <ZhDatasetPanel
    dataset={emptyDataset}
    glossary={{
      dataset: { ...writableGlossary, terms: [] },
      onCreate: async () => noopMutation(),
      onUpdate: async () => noopMutation(),
      onDelete: async () => noopMutation(),
    }}
  />,
)
assert.ok(emptyHtml.includes('暂无记录'))
assert.ok(emptyHtml.includes('术语文件存在，但尚未录入任何术语。'))

const errorHtml = renderToStaticMarkup(<ZhDatasetPanel dataset={errorDataset} />)
assert.ok(errorHtml.includes('数据缺失'))
assert.ok(errorHtml.includes('缺少数据集：source.json'))

const workbenchDefaultHtml = renderToStaticMarkup(
  <TranslationWorkbenchView
    isDev
    versions={workbenchVersions}
    selectedVersion="v1.17"
    templateName="claude-default.hbs"
    files={workbenchFiles}
    selectedFileIds={['v1.17::docs::alpha.md']}
    concurrencyValue="3"
    onSelectVersion={() => {}}
    onChangeConcurrency={() => {}}
    onSelectAll={() => {}}
    onClearSelection={() => {}}
    onRefresh={() => {}}
    onTranslate={() => {}}
    onToggleFile={() => {}}
    onToggleAll={() => {}}
    onRetry={() => {}}
  />,
)
assert.ok(workbenchDefaultHtml.includes('翻译工作台'))
assert.ok(workbenchDefaultHtml.includes('AI 翻译'))
assert.ok(workbenchDefaultHtml.includes('待翻译'))
assert.ok(workbenchDefaultHtml.includes('未翻译'))
assert.ok(workbenchDefaultHtml.includes('并发数量'))
assert.ok(workbenchDefaultHtml.includes('1-10，默认 3。并发越高，请求压力越大。'))

const workbenchRunningHtml = renderToStaticMarkup(
  <TranslationWorkbenchView
    isDev
    versions={workbenchVersions}
    selectedVersion="v1.17"
    templateName="claude-default.hbs"
    files={workbenchFiles}
    job={runningJob}
    selectedFileIds={[]}
    concurrencyValue="4"
    isQueueLocked
    onSelectVersion={() => {}}
    onChangeConcurrency={() => {}}
    onSelectAll={() => {}}
    onClearSelection={() => {}}
    onRefresh={() => {}}
    onTranslate={() => {}}
    onToggleFile={() => {}}
    onToggleAll={() => {}}
    onRetry={() => {}}
  />,
)
assert.ok(workbenchRunningHtml.includes('翻译中'))
assert.ok(workbenchRunningHtml.includes('队列运行中'))
assert.ok(workbenchRunningHtml.includes('当前并行执行中文件数；上限 4。'))
assert.ok(workbenchRunningHtml.includes('disabled=""'))

const workbenchFailedHtml = renderToStaticMarkup(
  <TranslationWorkbenchView
    isDev
    versions={workbenchVersions}
    selectedVersion="v1.17"
    templateName="claude-default.hbs"
    files={workbenchFiles.slice(0, 1)}
    job={failedJob}
    selectedFileIds={[]}
    concurrencyValue="3"
    onSelectVersion={() => {}}
    onChangeConcurrency={() => {}}
    onSelectAll={() => {}}
    onClearSelection={() => {}}
    onRefresh={() => {}}
    onTranslate={() => {}}
    onToggleFile={() => {}}
    onToggleAll={() => {}}
    onRetry={() => {}}
  />,
)
assert.ok(workbenchFailedHtml.includes('翻译失败'))
assert.ok(workbenchFailedHtml.includes('重试'))

const workbenchConcurrencyErrorHtml = renderToStaticMarkup(
  <TranslationWorkbenchView
    isDev
    versions={workbenchVersions}
    selectedVersion="v1.17"
    templateName="claude-default.hbs"
    files={workbenchFiles}
    selectedFileIds={['v1.17::docs::alpha.md']}
    concurrencyValue="12"
    concurrencyError="并发数量仅支持 1-10 的整数"
    onSelectVersion={() => {}}
    onChangeConcurrency={() => {}}
    onSelectAll={() => {}}
    onClearSelection={() => {}}
    onRefresh={() => {}}
    onTranslate={() => {}}
    onToggleFile={() => {}}
    onToggleAll={() => {}}
    onRetry={() => {}}
  />,
)
assert.ok(workbenchConcurrencyErrorHtml.includes('并发数量仅支持 1-10 的整数'))
assert.ok(workbenchConcurrencyErrorHtml.includes('aria-invalid="true"'))

const workbenchEmptyHtml = renderToStaticMarkup(
  <TranslationWorkbenchView
    isDev
    versions={workbenchVersions}
    selectedVersion="v1.17"
    templateName="claude-default.hbs"
    files={[]}
    selectedFileIds={[]}
    concurrencyValue="3"
    onSelectVersion={() => {}}
    onChangeConcurrency={() => {}}
    onSelectAll={() => {}}
    onClearSelection={() => {}}
    onRefresh={() => {}}
    onTranslate={() => {}}
    onToggleFile={() => {}}
    onToggleAll={() => {}}
    onRetry={() => {}}
  />,
)
assert.ok(workbenchEmptyHtml.includes('当前版本无待翻译文件'))

console.log('validated zh data UI contracts')
