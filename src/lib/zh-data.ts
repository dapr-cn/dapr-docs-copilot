import { fetchGlossaryDataset } from '@/lib/zh-glossary'
import { ZH_DATA_TABS, type DatasetId, type GlossaryDataset, type ZhConsolePayload, type ZhDatasetView, type ZhDataVersion } from '@/lib/zh-data-models'
import type { IntegrityAuditPayload } from '@/lib/translation-integrity-models'

let DATASET_MODULES: Record<string, unknown> = {}

try {
  DATASET_MODULES = import.meta.glob('../../../*_zh/data/{sync-status,glossary,source,translation-state,integrity-report}.json', {
    eager: true,
    import: 'default',
  })
} catch {
  DATASET_MODULES = {}
}

const WAIT_MS = 140
const PREVIEW_SPACE = 2

type SourceSyncStatus = 'synced' | 'drift' | 'missingSource'

type TranslationStatus = 'translated' | 'staleTranslation' | 'missingTranslation' | 'orphanTranslation'

type SyncStatusItem = {
  bucket: string
  relativePath: string
  sourcePath: string
  sourceFile: string
  sourceSha256: string
  mirroredSha256?: string | null
  status: SourceSyncStatus
  sourceStatus: SourceSyncStatus
  translationStatus: TranslationStatus
  translationFile: string
  translationUpdatedAt?: string
  sourceUpdatedAt?: string
  syncedAt?: string
  lastCheckedAt?: string
}

type SourceBucket = {
  id: string
  targetMount: string
  sourceDirectory: string
  documentCount: number
  driftCount: number
  missingSourceCount: number
  syncedCount: number
  translatedCount: number
  staleTranslationCount: number
  missingTranslationCount: number
  orphanTranslationCount: number
}

type SourceItem = {
  bucket: string
  relativePath: string
  sourcePath: string
  sourceFile: string
  mimeType: string
  sizeBytes: number
  sourceUpdatedAt?: string
}

type DatasetRegistryEntry = {
  id: DatasetId
  fileName: string
  label: string
  description: string
}

type TableCellTone = 'default' | 'good' | 'warn'

type SyncStatusOverview = {
  items: SyncStatusItem[]
  sourceSummary: {
    synced: number
    drift: number
    missingSource: number
  }
  translationSummary: {
    translated: number
    staleTranslation: number
    missingTranslation: number
    orphanTranslation: number
  }
  buckets: SourceBucket[]
}

const DATASET_FILE_MAP: Record<DatasetId, string> = {
  'sync-status': 'sync-status.json',
  glossary: 'glossary.json',
  source: 'source.json',
}

const DATASET_REGISTRY: readonly DatasetRegistryEntry[] = ZH_DATA_TABS.map((entry) => ({
  ...entry,
  fileName: DATASET_FILE_MAP[entry.id],
}))

function versionSortValue(version: string): number[] {
  const raw = version.replace(/^[^\d]+/, '')
  return raw
    .split('.')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
}

function compareVersionsDescending(left: string, right: string): number {
  const leftParts = versionSortValue(left)
  const rightParts = versionSortValue(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }

  return right.localeCompare(left)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeSyncStatusItem(value: unknown): SyncStatusItem | null {
  if (!isObject(value)) {
    return null
  }

  return {
    bucket: readString(value.bucket),
    relativePath: readString(value.relativePath),
    sourcePath: readString(value.sourcePath),
    sourceFile: readString(value.sourceFile),
    sourceSha256: readString(value.sourceSha256),
    mirroredSha256: readString(value.mirroredSha256) || null,
    status: (readString(value.status) as SourceSyncStatus) || 'missingSource',
    sourceStatus: (readString(value.sourceStatus) as SourceSyncStatus) || 'missingSource',
    translationStatus: (readString(value.translationStatus) as TranslationStatus) || 'missingTranslation',
    translationFile: readString(value.translationFile),
    translationUpdatedAt: readString(value.translationUpdatedAt) || undefined,
    sourceUpdatedAt: readString(value.sourceUpdatedAt) || undefined,
    syncedAt: readString(value.syncedAt) || undefined,
    lastCheckedAt: readString(value.lastCheckedAt) || undefined,
  }
}

export function buildEffectiveSyncStatusOverview(rawSyncStatus: unknown): SyncStatusOverview | null {
  if (!isObject(rawSyncStatus)) {
    return null
  }

  const items = readArray<unknown>(rawSyncStatus.items).map(normalizeSyncStatusItem).filter((item): item is SyncStatusItem => item !== null)

  const sourceSummary = {
    synced: 0,
    drift: 0,
    missingSource: 0,
  }
  const translationSummary = {
    translated: 0,
    staleTranslation: 0,
    missingTranslation: 0,
    orphanTranslation: 0,
  }
  const bucketMap = new Map<string, SourceBucket>()

  for (const item of items) {
    sourceSummary[item.sourceStatus] += 1
    translationSummary[item.translationStatus] += 1

    const bucket =
      bucketMap.get(item.bucket) ??
      {
        id: item.bucket,
        targetMount: '',
        sourceDirectory: '',
        documentCount: 0,
        driftCount: 0,
        missingSourceCount: 0,
        syncedCount: 0,
        translatedCount: 0,
        staleTranslationCount: 0,
        missingTranslationCount: 0,
        orphanTranslationCount: 0,
      }

    bucket.documentCount += 1

    if (item.sourceStatus === 'synced') {
      bucket.syncedCount += 1
    } else if (item.sourceStatus === 'drift') {
      bucket.driftCount += 1
    } else {
      bucket.missingSourceCount += 1
    }

    if (item.translationStatus === 'translated') {
      bucket.translatedCount += 1
    } else if (item.translationStatus === 'staleTranslation') {
      bucket.staleTranslationCount += 1
    } else if (item.translationStatus === 'missingTranslation') {
      bucket.missingTranslationCount += 1
    } else {
      bucket.orphanTranslationCount += 1
    }

    bucketMap.set(item.bucket, bucket)
  }

  return {
    items,
    sourceSummary,
    translationSummary,
    buckets: [...bucketMap.values()].sort((left, right) => left.id.localeCompare(right.id, 'zh-CN')),
  }
}

function formatDateTime(value: string): string {
  if (!value) {
    return '未知'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function formatDateOnly(value: string | undefined): string {
  if (!value) {
    return '未知'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(parsed)
}

function sourceStatusLabel(status: SourceSyncStatus): string {
  if (status === 'synced') {
    return '已同步'
  }
  if (status === 'drift') {
    return '校验失败'
  }
  return '缺失原文'
}

function translationStatusLabel(status: TranslationStatus): string {
  if (status === 'translated') {
    return '已翻译'
  }
  if (status === 'staleTranslation') {
    return '待翻译'
  }
  if (status === 'missingTranslation') {
    return '未翻译'
  }
  return '孤儿译文'
}

function sourceStatusTone(status: SourceSyncStatus): TableCellTone {
  return status === 'synced' ? 'good' : 'warn'
}

function translationStatusTone(status: TranslationStatus): TableCellTone {
  return status === 'translated' ? 'good' : 'warn'
}

function buildPreview(payload: unknown, limit = 3): string {
  if (!isObject(payload)) {
    return JSON.stringify(payload, null, PREVIEW_SPACE)
  }

  const preview: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    preview[key] = Array.isArray(value) ? value.slice(0, limit) : value
  }

  return JSON.stringify(preview, null, PREVIEW_SPACE)
}

function parseVersionFromModuleKey(key: string): string | null {
  const match = key.match(/\/([^/]+)_zh\/data\//)
  return match ? match[1] : null
}

function listAvailableVersions(): ZhDataVersion[] {
  const versions = new Set<string>()
  for (const key of Object.keys(DATASET_MODULES)) {
    const version = parseVersionFromModuleKey(key)
    if (version) {
      versions.add(version)
    }
  }

  return [...versions]
    .sort(compareVersionsDescending)
    .map((version) => ({
      id: version,
      label: version,
    }))
}

function resolveRequestedVersion(requestedVersion?: string): string {
  const versions = listAvailableVersions()
  if (requestedVersion && versions.some((version) => version.id === requestedVersion)) {
    return requestedVersion
  }

  return versions[0]?.id ?? 'v1.17'
}

function readDatasetModule(version: string, fileName: string): unknown | undefined {
  const suffix = `/${version}_zh/data/${fileName}`
  const entry = Object.entries(DATASET_MODULES).find(([key]) => key.endsWith(suffix))
  return entry?.[1]
}

async function wait(ms = WAIT_MS) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function missingDatasetView(entry: DatasetRegistryEntry): ZhDatasetView {
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    fileName: entry.fileName,
    state: 'error',
    recordCount: 0,
    infoLabel: '缺少数据文件',
    columns: [],
    rows: [],
    preview: '{}',
    errorMessage: `缺少数据集：${entry.fileName}`,
  }
}

function invalidDatasetView(entry: DatasetRegistryEntry): ZhDatasetView {
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    fileName: entry.fileName,
    state: 'error',
    recordCount: 0,
    infoLabel: '数据格式错误',
    columns: [],
    rows: [],
    preview: '{}',
    errorMessage: `数据集格式异常：${entry.fileName}`,
  }
}

function emptyDatasetView(entry: DatasetRegistryEntry, raw: unknown, message: string): ZhDatasetView {
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    fileName: entry.fileName,
    state: 'empty',
    recordCount: 0,
    infoLabel: '暂无记录',
    columns: [],
    rows: [],
    preview: buildPreview(raw),
    emptyMessage: message,
  }
}

function normalizeIntegrityReport(raw: unknown, version: string): IntegrityAuditPayload {
  if (!isObject(raw)) {
    return {
      version,
      generatedAt: '',
      latestBatchId: '',
      sourceSummary: { synced: 0, drift: 0, missingSource: 0 },
      translationSummary: { translated: 0, staleTranslation: 0, missingTranslation: 0, orphanTranslation: 0 },
      buckets: [],
      categories: [],
      findings: [],
      totalFindings: 0,
      status: 'stable',
    }
  }

  return raw as IntegrityAuditPayload
}

function normalizeSyncStatus(version: string, entry: DatasetRegistryEntry, integrityReport: IntegrityAuditPayload): ZhDatasetView {
  const raw = readDatasetModule(version, entry.fileName)
  if (!raw) {
    return missingDatasetView(entry)
  }
  if (!isObject(raw)) {
    return invalidDatasetView(entry)
  }

  const overview = buildEffectiveSyncStatusOverview(raw)
  const items = overview?.items ?? []
  const findingByKey = new Map(
    integrityReport.findings
      .filter((finding) => finding.relativePath)
      .map((finding) => [`${finding.bucket}:${finding.relativePath}`, finding]),
  )

  if (items.length === 0) {
    return emptyDatasetView(entry, raw, '已读取同步状态文件，但当前没有可展示的记录。')
  }

  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    fileName: entry.fileName,
    state: 'ready',
    recordCount: items.length,
    infoLabel: integrityReport.totalFindings > 0 ? `${items.length} 条文件状态 / ${integrityReport.totalFindings} 条审计风险` : `${items.length} 条文件状态`,
    columns: ['内容桶', '相对路径', '原文同步', '翻译状态', '冲突', '翻译时间'],
    rows: items.map((item) => ({
      id: `${item.bucket}:${item.relativePath}`,
      tone: findingByKey.has(`${item.bucket}:${item.relativePath}`)
        ? 'warn'
        : item.sourceStatus === 'synced'
          ? translationStatusTone(item.translationStatus)
          : sourceStatusTone(item.sourceStatus),
      cells: [
        item.bucket,
        item.relativePath,
        sourceStatusLabel(item.sourceStatus),
        translationStatusLabel(item.translationStatus),
        findingByKey.get(`${item.bucket}:${item.relativePath}`)?.title ?? '—',
        formatDateOnly(item.translationUpdatedAt),
      ],
    })),
    preview: buildPreview({
      version: readString(raw.version),
      generatedAt: readString(raw.generatedAt),
      syncedAt: readString(raw.syncedAt),
      summary: overview?.sourceSummary,
      sourceSummary: overview?.sourceSummary,
      translationSummary: overview?.translationSummary,
      integrity: {
        status: integrityReport.status,
        totalFindings: integrityReport.totalFindings,
        categories: integrityReport.categories,
      },
      items,
    }),
  }
}

function normalizeGlossary(entry: DatasetRegistryEntry, glossaryDataset: GlossaryDataset): ZhDatasetView {
  if (glossaryDataset.terms.length === 0) {
    return {
      id: entry.id,
      label: entry.label,
      description: entry.description,
      fileName: entry.fileName,
      state: 'empty',
      recordCount: 0,
      infoLabel: '暂无记录',
      columns: ['英文', '中文', '备注'],
      rows: [],
      preview: buildPreview({
        version: glossaryDataset.version,
        generatedAt: glossaryDataset.generatedAt,
        readOnlyState: glossaryDataset.readOnlyState,
        terms: glossaryDataset.terms,
      }),
      emptyMessage: '术语文件存在，但尚未录入任何术语。',
    }
  }

  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    fileName: entry.fileName,
    state: 'ready',
    recordCount: glossaryDataset.terms.length,
    infoLabel: `${glossaryDataset.terms.length} 条术语规则`,
    columns: ['英文', '中文', '备注'],
    rows: glossaryDataset.terms.map((term) => ({
      id: term.id,
      tone: term.notes ? 'good' : 'default',
      cells: [term.source, term.target, term.notes || '—'],
    })),
    preview: buildPreview({
      version: glossaryDataset.version,
      generatedAt: glossaryDataset.generatedAt,
      readOnlyState: glossaryDataset.readOnlyState,
      terms: glossaryDataset.terms,
    }),
  }
}

function normalizeSource(version: string, entry: DatasetRegistryEntry): ZhDatasetView {
  const raw = readDatasetModule(version, entry.fileName)
  if (!raw) {
    return missingDatasetView(entry)
  }
  if (!isObject(raw)) {
    return invalidDatasetView(entry)
  }

  const buckets = readArray<unknown>(raw.buckets)
    .filter(isObject)
    .map<SourceBucket>((bucket) => ({
      id: readString(bucket.id),
      targetMount: readString(bucket.targetMount),
      sourceDirectory: readString(bucket.sourceDirectory),
      documentCount: readNumber(bucket.documentCount),
      driftCount: readNumber(bucket.driftCount),
      missingSourceCount: readNumber(bucket.missingSourceCount),
      syncedCount: readNumber(bucket.syncedCount),
      translatedCount: readNumber(bucket.translatedCount),
      staleTranslationCount: readNumber(bucket.staleTranslationCount),
      missingTranslationCount: readNumber(bucket.missingTranslationCount),
      orphanTranslationCount: readNumber(bucket.orphanTranslationCount),
    }))
  const items = readArray<unknown>(raw.items)
    .filter(isObject)
    .map<SourceItem>((item) => ({
      bucket: readString(item.bucket),
      relativePath: readString(item.relativePath),
      sourcePath: readString(item.sourcePath),
      sourceFile: readString(item.sourceFile),
      mimeType: readString(item.mimeType),
      sizeBytes: readNumber(item.sizeBytes),
      sourceUpdatedAt: readString(item.sourceUpdatedAt),
    }))

  if (items.length === 0) {
    return emptyDatasetView(entry, raw, '源文清单存在，但尚未生成任何源文元数据。')
  }

  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    fileName: entry.fileName,
    state: 'ready',
    recordCount: items.length,
    infoLabel: `${items.length} 篇源文`,
    columns: ['内容桶', '相对路径', '大小', '源文文件'],
    rows: items.map((item) => ({
      id: `${item.bucket}:${item.relativePath}`,
      tone: item.sourceUpdatedAt ? 'good' : 'default',
      cells: [item.bucket, item.relativePath, `${item.sizeBytes} B`, item.sourceFile],
    })),
    preview: buildPreview({
      version: readString(raw.version),
      sourceRepo: readString(raw.sourceRepo),
      sourceBranch: readString(raw.sourceBranch),
      copiedAt: readString(raw.copiedAt),
      sourceRoot: readString(raw.sourceRoot),
      buckets,
      items,
    }),
  }
}

function glossaryErrorView(entry: DatasetRegistryEntry, message: string): ZhDatasetView {
  return {
    ...invalidDatasetView(entry),
    errorMessage: message,
  }
}

async function getDatasetViews(version: string, glossaryDataset: GlossaryDataset | null, integrityReport: IntegrityAuditPayload, glossaryError?: string): Promise<ZhDatasetView[]> {
  return DATASET_REGISTRY.map((entry) => {
    if (entry.id === 'sync-status') {
      return normalizeSyncStatus(version, entry, integrityReport)
    }
    if (entry.id === 'glossary') {
      if (glossaryDataset) {
        return normalizeGlossary(entry, glossaryDataset)
      }

      return glossaryError ? glossaryErrorView(entry, glossaryError) : missingDatasetView(entry)
    }
    if (entry.id === 'source') {
      return normalizeSource(version, entry)
    }
    return missingDatasetView(entry)
  })
}

function buildSummaryCards(version: string, glossaryDataset: GlossaryDataset | null, integrityReport: IntegrityAuditPayload): ZhConsolePayload['summaryCards'] {
  const syncRaw = readDatasetModule(version, 'sync-status.json')
  const overview = buildEffectiveSyncStatusOverview(syncRaw)

  const sourceSummary = overview?.sourceSummary ?? { synced: 0, drift: 0, missingSource: 0 }
  const translationSummary = overview?.translationSummary ?? { translated: 0, staleTranslation: 0, missingTranslation: 0, orphanTranslation: 0 }
  const glossaryTerms = glossaryDataset?.terms ?? []

  return [
    {
      label: '原文已同步',
      value: String(readNumber(sourceSummary.synced)),
      detail: `${readNumber(sourceSummary.drift)} 校验失败 / ${readNumber(sourceSummary.missingSource)} 缺失原文`,
      tone: readNumber(sourceSummary.drift) + readNumber(sourceSummary.missingSource) > 0 ? 'warn' : 'good',
    },
    {
      label: '已翻译',
      value: String(readNumber(translationSummary.translated)),
      detail: `${readNumber(translationSummary.staleTranslation)} 待翻译 / ${readNumber(translationSummary.missingTranslation)} 未翻译 / ${readNumber(translationSummary.orphanTranslation)} 孤儿`,
      tone:
        readNumber(translationSummary.staleTranslation) +
          readNumber(translationSummary.missingTranslation) +
          readNumber(translationSummary.orphanTranslation) >
        0
          ? 'warn'
          : 'good',
    },
    {
      label: '术语规则',
      value: String(glossaryTerms.length),
      detail:
        glossaryDataset?.readOnlyState.mode === 'read-only'
          ? `只读模式 · ${glossaryDataset.readOnlyState.reason}`
          : glossaryDataset
            ? `最近刷新 ${formatDateTime(glossaryDataset.generatedAt)}`
            : '术语数据暂不可用',
      tone: !glossaryDataset ? 'warn' : glossaryDataset.readOnlyState.mode === 'read-only' ? 'warn' : 'good',
    },
    {
      label: '完整性风险',
      value: String(integrityReport.totalFindings),
      detail:
        integrityReport.totalFindings > 0
          ? integrityReport.categories.slice(0, 2).map((item) => `${item.label} ${item.count}`).join(' / ')
          : '审计结果一致',
      tone: integrityReport.totalFindings > 0 ? 'warn' : 'good',
    },
  ]
}

function buildActivities(version: string, integrityReport: IntegrityAuditPayload): ZhConsolePayload['activities'] {
  const syncRaw = readDatasetModule(version, 'sync-status.json')
  const overview = buildEffectiveSyncStatusOverview(syncRaw)
  const worstBucket = [...(overview?.buckets ?? [])].sort((left, right) => {
    const rightScore =
      right.driftCount + right.missingSourceCount + right.staleTranslationCount + right.missingTranslationCount + right.orphanTranslationCount
    const leftScore =
      left.driftCount + left.missingSourceCount + left.staleTranslationCount + left.missingTranslationCount + left.orphanTranslationCount
    return rightScore - leftScore
  })[0]
  const sourceSummary = overview?.sourceSummary ?? { synced: 0, drift: 0, missingSource: 0 }
  const translationSummary = overview?.translationSummary ?? { translated: 0, staleTranslation: 0, missingTranslation: 0, orphanTranslation: 0 }

  return [
    worstBucket
      ? {
          id: 'drift-focus',
          title: `${readString(worstBucket.id)} 同步风险最高`,
          detail: `${readNumber(worstBucket.driftCount)} 校验失败 / ${readNumber(worstBucket.missingSourceCount)} 缺失原文 / ${readNumber(worstBucket.missingTranslationCount)} 未翻译 / ${readNumber(worstBucket.orphanTranslationCount)} 孤儿译文。`,
          time: '当前焦点',
          tone:
            readNumber(worstBucket.driftCount) > 0 ||
            readNumber(worstBucket.missingSourceCount) > 0 ||
            readNumber(worstBucket.missingTranslationCount) > 0 ||
            readNumber(worstBucket.orphanTranslationCount) > 0
              ? 'warn'
              : 'stable',
        }
      : {
          id: 'drift-empty',
          title: '尚无源文清单',
          detail: '缺少 source.json 时无法定位风险桶。',
          time: '等待中',
          tone: 'warn',
        },
    {
      id: 'sync-summary',
      title: '同步状态摘要',
      detail: `${readNumber(sourceSummary.synced)} 原文已同步 / ${readNumber(translationSummary.translated)} 已翻译 / ${readNumber(translationSummary.missingTranslation)} 未翻译 / ${readNumber(translationSummary.orphanTranslation)} 孤儿译文。`,
      time: '摘要',
      tone:
        readNumber(sourceSummary.drift) > 0 ||
        readNumber(sourceSummary.missingSource) > 0 ||
        readNumber(translationSummary.missingTranslation) > 0 ||
        readNumber(translationSummary.orphanTranslation) > 0
          ? 'warn'
          : 'good',
    },
    {
      id: 'integrity-summary',
      title: integrityReport.totalFindings > 0 ? '完整性审计发现风险' : '完整性审计通过',
      detail:
        integrityReport.totalFindings > 0
          ? integrityReport.categories.slice(0, 2).map((item) => `${item.label} ${item.count}`).join(' / ')
          : '当前版本的 sync-status、source 与译文文件已对齐。',
      time: integrityReport.generatedAt ? formatDateTime(integrityReport.generatedAt) : '摘要',
      tone: integrityReport.totalFindings > 0 ? 'warn' : 'good',
    },
  ]
}

function buildFocus(version: string, datasetViews: ZhDatasetView[]): string[] {
  const overview = buildEffectiveSyncStatusOverview(readDatasetModule(version, 'sync-status.json'))
  const orderedBuckets = [...(overview?.buckets ?? [])]
    .sort(
      (left, right) =>
        right.driftCount + right.missingSourceCount + right.staleTranslationCount + right.missingTranslationCount + right.orphanTranslationCount -
        (left.driftCount + left.missingSourceCount + left.staleTranslationCount + left.missingTranslationCount + left.orphanTranslationCount),
    )
    .slice(0, 4)
    .map(
      (bucket) =>
        `${bucket.id}：${bucket.driftCount} 校验失败 / ${bucket.missingSourceCount} 缺失原文 / ${bucket.missingTranslationCount} 未翻译 / ${bucket.orphanTranslationCount} 孤儿`,
    )

  if (orderedBuckets.length === 0) {
    return datasetViews
      .filter((dataset) => dataset.state !== 'ready')
      .map((dataset) => `${dataset.label}：${dataset.infoLabel}`)
      .slice(0, 4)
  }

  return orderedBuckets
}

export async function fetchZhConsole(requestedVersion?: string): Promise<ZhConsolePayload> {
  await wait()
  const versions = listAvailableVersions()
  const version = resolveRequestedVersion(requestedVersion)
  const integrityReport = normalizeIntegrityReport(readDatasetModule(version, 'integrity-report.json'), version)

  let glossaryDataset: GlossaryDataset | null = null
  let glossaryError: string | undefined

  try {
    glossaryDataset = await fetchGlossaryDataset(version)
  } catch (error) {
    glossaryError = error instanceof Error ? error.message : '术语数据加载失败'
  }

  const datasetViews = await getDatasetViews(version, glossaryDataset, integrityReport, glossaryError)
  const syncRaw = readDatasetModule(version, 'sync-status.json')
  const payloadVersion = isObject(syncRaw) ? readString(syncRaw.version, version) : version
  const generatedAt = isObject(syncRaw) ? readString(syncRaw.generatedAt) : ''

  return {
    version: payloadVersion,
    versions,
    generatedAt,
    integrityReport,
    datasetViews,
    summaryCards: buildSummaryCards(version, glossaryDataset, integrityReport),
    activities: buildActivities(version, integrityReport),
    focus: buildFocus(version, datasetViews),
  }
}

export async function fetchZhDashboardView(version?: string) {
  const payload = await fetchZhConsole(version)

  return {
    metrics: payload.summaryCards.map((card) => ({
      label: card.label,
      value: card.value,
      delta: card.detail,
      tone: card.tone,
    })),
    activities: payload.activities,
    focus: payload.focus,
  }
}

export { ZH_DATA_TABS } from '@/lib/zh-data-models'
export type { DatasetId, ZhConsolePayload, ZhDatasetView, ZhDataVersion } from '@/lib/zh-data-models'
