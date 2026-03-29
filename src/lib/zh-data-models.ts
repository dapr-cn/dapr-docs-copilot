import type { IntegrityAuditPayload } from '@/lib/translation-integrity-models'

export type DatasetId = 'sync-status' | 'glossary' | 'source'

export type ZhDatasetRow = {
  id: string
  cells: string[]
  tone?: 'default' | 'good' | 'warn'
}

export type GlossaryTerm = {
  id: string
  source: string
  target: string
  notes: string
  updatedAt?: string
}

export type GlossaryTermDraft = {
  source: string
  target: string
  notes: string
}

export type GlossaryValidationErrors = Partial<Record<'source' | 'target' | 'notes' | 'form', string>>

export type GlossaryEditorState = {
  mode: 'idle' | 'create' | 'edit' | 'saving' | 'error'
  termId?: string
  errors?: GlossaryValidationErrors
  message?: string
}

export type GlossaryReadOnlyState =
  | {
      mode: 'writable'
    }
  | {
      mode: 'read-only'
      reason: string
    }

export type GlossaryDataset = {
  version: string
  generatedAt: string
  terms: GlossaryTerm[]
  readOnlyState: GlossaryReadOnlyState
}

export type GlossaryMutationResult = {
  dataset: GlossaryDataset
  message?: string
  term?: GlossaryTerm
  deletedId?: string
}

export type ZhDatasetView = {
  id: DatasetId
  label: string
  description: string
  fileName: string
  state: 'ready' | 'empty' | 'error'
  recordCount: number
  infoLabel: string
  columns: string[]
  rows: ZhDatasetRow[]
  preview: string
  errorMessage?: string
  emptyMessage?: string
}

export type ZhDataVersion = {
  id: string
  label: string
}

export type ZhConsolePayload = {
  version: string
  versions: ZhDataVersion[]
  generatedAt: string
  integrityReport: IntegrityAuditPayload
  datasetViews: ZhDatasetView[]
  summaryCards: Array<{
    label: string
    value: string
    detail: string
    tone: 'stable' | 'good' | 'warn'
  }>
  activities: Array<{
    id: string
    title: string
    detail: string
    time: string
    tone: 'good' | 'warn' | 'stable'
  }>
  focus: string[]
}

export const ZH_DATA_TABS: Array<{ id: DatasetId; label: string; description: string }> = [
  {
    id: 'sync-status',
    label: '同步状态',
    description: '逐文件校验原文镜像，并判断译文是否晚于最近同步时间。',
  },
  {
    id: 'glossary',
    label: '术语表',
    description: '搜索并维护英中文术语映射，可在表格内直接新增、编辑与删除。',
  },
  {
    id: 'source',
    label: '源文清单',
    description: '记录源文元数据与 data/source 下的镜像文件路径。',
  },
]
