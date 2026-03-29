export const SOURCE_SYNC_STATES = ['synced', 'drift', 'missingSource'] as const
export type SourceSyncStatus = (typeof SOURCE_SYNC_STATES)[number]

export const TRANSLATION_STATES = ['translated', 'staleTranslation', 'missingTranslation', 'orphanTranslation'] as const
export type TranslationStatus = (typeof TRANSLATION_STATES)[number]

export const INTEGRITY_FINDING_TYPES = [
  'syncStatusConflict',
  'translationStateMissingTarget',
  'translationStateShaMismatch',
  'sourceSummaryMismatch',
  'copyLogSummaryMismatch',
  'orphanTranslation',
] as const
export type IntegrityFindingType = (typeof INTEGRITY_FINDING_TYPES)[number]

export type SourceSummary = {
  synced: number
  drift: number
  missingSource: number
}

export type TranslationSummary = {
  translated: number
  staleTranslation: number
  missingTranslation: number
  orphanTranslation: number
}

export type SourceBucketSummary = {
  id: string
  targetMount: string
  sourceRoots: string[]
  translationRoot: string
  sourceDirectory: string
  documentCount: number
  syncedCount: number
  driftCount: number
  missingSourceCount: number
  translatedCount: number
  staleTranslationCount: number
  missingTranslationCount: number
  orphanTranslationCount: number
}

export type SourceItem = {
  bucket: string
  relativePath: string
  sourcePath: string
  sourceFile: string
  sourceSha256: string
  targetMount?: string
  mimeType: string
  sizeBytes: number
  copiedAt?: string
  sourceUpdatedAt?: string | null
}

export type SourcePayload = {
  version: string
  generatedAt?: string
  sourceRepo?: string
  sourceBranch?: string
  copiedAt?: string
  sourceRoot?: string
  documentCount?: number
  bucketCount?: number
  buckets: SourceBucketSummary[]
  items: SourceItem[]
}

export type SyncStatusItem = {
  version?: string
  bucket: string
  relativePath: string
  sourcePath: string | null
  sourceFile: string | null
  sourceSha256: string | null
  mirroredSha256: string | null
  status: SourceSyncStatus
  sourceStatus: SourceSyncStatus
  translationStatus: TranslationStatus
  translationFile: string | null
  translationUpdatedAt?: string | null
  sourceUpdatedAt?: string | null
  syncedAt?: string
  lastCheckedAt?: string
}

export type SyncStatusPayload = {
  version: string
  generatedAt?: string
  syncedAt?: string
  summary?: SourceSummary
  sourceSummary?: SourceSummary
  translationSummary?: TranslationSummary
  items: SyncStatusItem[]
}

export type TranslationStateItem = {
  bucket: string
  relativePath: string
  sourceSha256: string
  targetPath: string
  translatedAt?: string
  updatedAt?: string
}

export type TranslationStatePayload = {
  version: string
  generatedAt?: string
  items: TranslationStateItem[]
}

export type CopyBatch = {
  id: string
  sourceRepo: string
  sourceBranch: string
  copiedAt: string
  documentCount: number
  bucketCount: number
  failureCount: number
  statusSummary?: SourceSummary
  translationSummary?: TranslationSummary
  status: string
  failures?: unknown[]
}

export type CopyLogPayload = {
  version: string
  generatedAt?: string
  batches: CopyBatch[]
}

export type IntegrityCategorySummary = {
  id: IntegrityFindingType
  label: string
  hint: string
  count: number
  tone: 'stable' | 'warn'
}

export type IntegrityFinding = {
  id: string
  type: IntegrityFindingType
  version: string
  bucket: string
  relativePath: string
  sourceFile: string | null
  translationFile: string | null
  conflictStage: 'sync-status' | 'translation-state' | 'source-summary' | 'copy-log' | 'filesystem'
  title: string
  detail: string
  observed: Record<string, string>
  expected: Record<string, string>
}

export type IntegrityAuditPayload = {
  version: string
  generatedAt: string
  latestBatchId: string
  sourceSummary: SourceSummary
  translationSummary: TranslationSummary
  buckets: SourceBucketSummary[]
  categories: IntegrityCategorySummary[]
  findings: IntegrityFinding[]
  totalFindings: number
  status: 'stable' | 'warn'
}

export function buildIntegrityKey(bucket: string, relativePath: string): string {
  return `${bucket}::${relativePath}`
}

export function emptySourceSummary(): SourceSummary {
  return {
    synced: 0,
    drift: 0,
    missingSource: 0,
  }
}

export function emptyTranslationSummary(): TranslationSummary {
  return {
    translated: 0,
    staleTranslation: 0,
    missingTranslation: 0,
    orphanTranslation: 0,
  }
}

export function integrityCategoryLabel(type: IntegrityFindingType): string {
  switch (type) {
    case 'syncStatusConflict':
      return 'sync-status 与权威判定冲突'
    case 'translationStateMissingTarget':
      return 'translation-state 命中但译文文件缺失'
    case 'translationStateShaMismatch':
      return 'translation-state 的 sha 与当前源文不匹配'
    case 'sourceSummaryMismatch':
      return 'source.json 桶汇总失真'
    case 'copyLogSummaryMismatch':
      return '最新批次汇总失真'
    case 'orphanTranslation':
      return '存在孤儿译文'
  }
}

export function integrityCategoryHint(type: IntegrityFindingType): string {
  switch (type) {
    case 'syncStatusConflict':
      return '宜重建 sync-status/source，勿仅改前端展示。'
    case 'translationStateMissingTarget':
      return '宜检查工作台写入链路或历史文件丢失。'
    case 'translationStateShaMismatch':
      return '宜重译或等待下一次同步后再判定。'
    case 'sourceSummaryMismatch':
      return '宜按文件级真值回填 source.json 桶统计。'
    case 'copyLogSummaryMismatch':
      return '宜按当前权威计数重写最新批次摘要。'
    case 'orphanTranslation':
      return '宜核对源文是否删除，或清理孤儿译文。'
  }
}

export function summarizeIntegrityCategories(findings: IntegrityFinding[]): IntegrityCategorySummary[] {
  const counts = new Map<IntegrityFindingType, number>()
  for (const finding of findings) {
    counts.set(finding.type, (counts.get(finding.type) ?? 0) + 1)
  }

  return INTEGRITY_FINDING_TYPES.map((type) => ({
    id: type,
    label: integrityCategoryLabel(type),
    hint: integrityCategoryHint(type),
    count: counts.get(type) ?? 0,
    tone: (counts.get(type) ?? 0) > 0 ? 'warn' : 'stable',
  })).filter((item) => item.count > 0)
}
