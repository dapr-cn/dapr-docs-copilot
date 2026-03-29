import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildIntegrityKey,
  emptySourceSummary,
  emptyTranslationSummary,
  integrityCategoryHint,
  integrityCategoryLabel,
  summarizeIntegrityCategories,
  type CopyBatch,
  type CopyLogPayload,
  type IntegrityAuditPayload,
  type IntegrityFinding,
  type SourceBucketSummary,
  type SourceItem,
  type SourcePayload,
  type SourceSummary,
  type SourceSyncStatus,
  type SyncStatusItem,
  type SyncStatusPayload,
  type TranslationStateItem,
  type TranslationStatePayload,
  type TranslationStatus,
  type TranslationSummary,
} from '../lib/translation-integrity-models'

const TRANSLATION_ROOT_PREFIX = 'translated_content/zh_CN'

export const DATASET_FILE_NAMES = {
  syncStatus: 'sync-status.json',
  source: 'source.json',
  copyLog: 'copy-log.json',
  translationState: 'translation-state.json',
  integrityReport: 'integrity-report.json',
} as const

type JsonRecord = Record<string, unknown>

type TranslationFileObservation = {
  bucket: string
  relativePath: string
  translationFile: string
  translationUpdatedAt: string
}

type ReconciledRecord = {
  item: SyncStatusItem
  isSourceDocument: boolean
}

export type TranslationIntegrityBundle = {
  syncStatus: SyncStatusPayload
  source: SourcePayload
  copyLog: CopyLogPayload
  translationState: TranslationStatePayload
  integrityReport: IntegrityAuditPayload
}

export type ReconcileTranslationIntegrityOptions = {
  repoPath: string
  version: string
  generatedAt?: string
  auditAgainstInput?: boolean
  syncStatus?: SyncStatusPayload | null
  source: SourcePayload
  copyLog?: CopyLogPayload | null
  translationState?: TranslationStatePayload | null
  batchSeed?: Partial<CopyBatch>
}

function isObject(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function toPosix(value: string): string {
  return value.replaceAll('\\', '/')
}

function stableLocaleCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN')
}

function compareIsoTime(left: string | null | undefined, right: string | null | undefined): number {
  if (!left || !right) {
    return Number.NaN
  }

  const leftTime = new Date(left).getTime()
  const rightTime = new Date(right).getTime()
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return Number.NaN
  }

  return leftTime - rightTime
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  return hash.digest('hex')
}

async function walkFiles(rootPath: string): Promise<string[]> {
  if (!(await pathExists(rootPath))) {
    return []
  }

  const result: string[] = []
  const stack = [rootPath]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        result.push(fullPath)
      }
    }
  }

  result.sort(stableLocaleCompare)
  return result
}

function normalizeSourceSummary(value: unknown): SourceSummary {
  if (!isObject(value)) {
    return emptySourceSummary()
  }

  return {
    synced: readNumber(value.synced),
    drift: readNumber(value.drift),
    missingSource: readNumber(value.missingSource),
  }
}

function normalizeTranslationSummary(value: unknown): TranslationSummary {
  if (!isObject(value)) {
    return emptyTranslationSummary()
  }

  return {
    translated: readNumber(value.translated),
    staleTranslation: readNumber(value.staleTranslation),
    missingTranslation: readNumber(value.missingTranslation),
    orphanTranslation: readNumber(value.orphanTranslation),
  }
}

function createEmptyBucketSummary(bucket: string): SourceBucketSummary {
  return {
    id: bucket,
    targetMount: '',
    sourceRoots: [],
    translationRoot: `${TRANSLATION_ROOT_PREFIX}/${bucket}`,
    sourceDirectory: `data/source/${bucket}`,
    documentCount: 0,
    syncedCount: 0,
    driftCount: 0,
    missingSourceCount: 0,
    translatedCount: 0,
    staleTranslationCount: 0,
    missingTranslationCount: 0,
    orphanTranslationCount: 0,
  }
}

function normalizeBucketSummary(value: unknown): SourceBucketSummary | null {
  if (!isObject(value)) {
    return null
  }

  const id = readString(value.id)
  if (!id) {
    return null
  }

  return {
    ...createEmptyBucketSummary(id),
    targetMount: readString(value.targetMount),
    sourceRoots: readArray<unknown>(value.sourceRoots).map((item) => readString(item)).filter(Boolean),
    translationRoot: readString(value.translationRoot, `${TRANSLATION_ROOT_PREFIX}/${id}`),
    sourceDirectory: readString(value.sourceDirectory, `data/source/${id}`),
    documentCount: readNumber(value.documentCount),
    syncedCount: readNumber(value.syncedCount),
    driftCount: readNumber(value.driftCount),
    missingSourceCount: readNumber(value.missingSourceCount),
    translatedCount: readNumber(value.translatedCount),
    staleTranslationCount: readNumber(value.staleTranslationCount),
    missingTranslationCount: readNumber(value.missingTranslationCount),
    orphanTranslationCount: readNumber(value.orphanTranslationCount),
  }
}

function normalizeSourceItem(value: unknown): SourceItem | null {
  if (!isObject(value)) {
    return null
  }

  const bucket = readString(value.bucket)
  const relativePath = readString(value.relativePath)
  const sourcePath = readString(value.sourcePath)
  const sourceFile = readString(value.sourceFile)
  const sourceSha256 = readString(value.sourceSha256)
  if (!bucket || !relativePath || !sourcePath || !sourceFile || !sourceSha256) {
    return null
  }

  return {
    bucket,
    relativePath,
    sourcePath,
    sourceFile,
    sourceSha256,
    targetMount: readString(value.targetMount) || undefined,
    mimeType: readString(value.mimeType, 'text/markdown'),
    sizeBytes: readNumber(value.sizeBytes),
    copiedAt: readString(value.copiedAt) || undefined,
    sourceUpdatedAt: readString(value.sourceUpdatedAt) || undefined,
  }
}

function normalizeSourcePayload(value: SourcePayload | null | undefined, versionFallback: string): SourcePayload {
  const raw = isObject(value) ? value : {}
  const items = readArray<unknown>(raw.items).map(normalizeSourceItem).filter((item): item is SourceItem => item !== null)
  const buckets = readArray<unknown>(raw.buckets).map(normalizeBucketSummary).filter((item): item is SourceBucketSummary => item !== null)
  const bucketMap = new Map(buckets.map((bucket) => [bucket.id, bucket]))

  for (const item of items) {
    if (!bucketMap.has(item.bucket)) {
      bucketMap.set(item.bucket, createEmptyBucketSummary(item.bucket))
    }
  }

  return {
    version: readString(raw.version, versionFallback),
    generatedAt: readString(raw.generatedAt) || undefined,
    sourceRepo: readString(raw.sourceRepo) || undefined,
    sourceBranch: readString(raw.sourceBranch) || undefined,
    copiedAt: readString(raw.copiedAt) || undefined,
    sourceRoot: readString(raw.sourceRoot) || undefined,
    documentCount: readNumber(raw.documentCount, items.length),
    bucketCount: readNumber(raw.bucketCount, bucketMap.size),
    buckets: [...bucketMap.values()].sort((left, right) => stableLocaleCompare(left.id, right.id)),
    items: items.sort((left, right) => stableLocaleCompare(buildIntegrityKey(left.bucket, left.relativePath), buildIntegrityKey(right.bucket, right.relativePath))),
  }
}

function normalizeSyncStatusItem(value: unknown): SyncStatusItem | null {
  if (!isObject(value)) {
    return null
  }

  const bucket = readString(value.bucket)
  const relativePath = readString(value.relativePath)
  if (!bucket || !relativePath) {
    return null
  }

  return {
    version: readString(value.version) || undefined,
    bucket,
    relativePath,
    sourcePath: readString(value.sourcePath) || null,
    sourceFile: readString(value.sourceFile) || null,
    sourceSha256: readString(value.sourceSha256) || null,
    mirroredSha256: readString(value.mirroredSha256) || null,
    status: readString(value.status, 'missingSource') as SourceSyncStatus,
    sourceStatus: readString(value.sourceStatus, readString(value.status, 'missingSource')) as SourceSyncStatus,
    translationStatus: readString(value.translationStatus, 'missingTranslation') as TranslationStatus,
    translationFile: readString(value.translationFile) || null,
    translationUpdatedAt: readString(value.translationUpdatedAt) || null,
    sourceUpdatedAt: readString(value.sourceUpdatedAt) || null,
    syncedAt: readString(value.syncedAt) || undefined,
    lastCheckedAt: readString(value.lastCheckedAt) || undefined,
  }
}

function normalizeSyncStatusPayload(value: SyncStatusPayload | null | undefined, versionFallback: string): SyncStatusPayload {
  const raw = isObject(value) ? value : {}
  return {
    version: readString(raw.version, versionFallback),
    generatedAt: readString(raw.generatedAt) || undefined,
    syncedAt: readString(raw.syncedAt) || undefined,
    summary: normalizeSourceSummary(raw.summary),
    sourceSummary: normalizeSourceSummary(raw.sourceSummary ?? raw.summary),
    translationSummary: normalizeTranslationSummary(raw.translationSummary),
    items: readArray<unknown>(raw.items).map(normalizeSyncStatusItem).filter((item): item is SyncStatusItem => item !== null),
  }
}

function normalizeTranslationStateItem(value: unknown): TranslationStateItem | null {
  if (!isObject(value)) {
    return null
  }

  const bucket = readString(value.bucket)
  const relativePath = readString(value.relativePath)
  const sourceSha256 = readString(value.sourceSha256)
  if (!bucket || !relativePath || !sourceSha256) {
    return null
  }

  return {
    bucket,
    relativePath,
    sourceSha256,
    targetPath: readString(value.targetPath, `${TRANSLATION_ROOT_PREFIX}/${bucket}/${relativePath}`),
    translatedAt: readString(value.translatedAt) || undefined,
    updatedAt: readString(value.updatedAt) || undefined,
  }
}

function normalizeTranslationStatePayload(value: TranslationStatePayload | null | undefined, versionFallback: string): TranslationStatePayload {
  const raw = isObject(value) ? value : {}
  return {
    version: readString(raw.version, versionFallback),
    generatedAt: readString(raw.generatedAt) || undefined,
    items: readArray<unknown>(raw.items).map(normalizeTranslationStateItem).filter((item): item is TranslationStateItem => item !== null),
  }
}

function normalizeCopyBatch(value: unknown): CopyBatch | null {
  if (!isObject(value)) {
    return null
  }

  const id = readString(value.id)
  if (!id) {
    return null
  }

  return {
    id,
    sourceRepo: readString(value.sourceRepo),
    sourceBranch: readString(value.sourceBranch),
    copiedAt: readString(value.copiedAt),
    documentCount: readNumber(value.documentCount),
    bucketCount: readNumber(value.bucketCount),
    failureCount: readNumber(value.failureCount),
    statusSummary: normalizeSourceSummary(value.statusSummary),
    translationSummary: normalizeTranslationSummary(value.translationSummary),
    status: readString(value.status, 'completed'),
    failures: readArray<unknown>(value.failures),
  }
}

function normalizeCopyLogPayload(value: CopyLogPayload | null | undefined, versionFallback: string): CopyLogPayload {
  const raw = isObject(value) ? value : {}
  return {
    version: readString(raw.version, versionFallback),
    generatedAt: readString(raw.generatedAt) || undefined,
    batches: readArray<unknown>(raw.batches).map(normalizeCopyBatch).filter((item): item is CopyBatch => item !== null),
  }
}

function cloneBucketSummary(bucket: SourceBucketSummary): SourceBucketSummary {
  return {
    ...bucket,
    sourceRoots: [...bucket.sourceRoots],
  }
}

function collectBucketMetadata(source: SourcePayload, syncStatus: SyncStatusPayload, translationState: TranslationStatePayload) {
  const bucketMap = new Map<string, SourceBucketSummary>()

  for (const bucket of source.buckets) {
    bucketMap.set(bucket.id, cloneBucketSummary(bucket))
  }

  const ensureBucket = (bucketId: string) => {
    if (!bucketMap.has(bucketId)) {
      bucketMap.set(bucketId, createEmptyBucketSummary(bucketId))
    }

    return bucketMap.get(bucketId)!
  }

  for (const item of source.items) {
    const bucket = ensureBucket(item.bucket)
    if (!bucket.targetMount && item.targetMount) {
      bucket.targetMount = item.targetMount
    }
  }

  for (const item of syncStatus.items) {
    const bucket = ensureBucket(item.bucket)
    if (!bucket.translationRoot && item.translationFile) {
      const translationFile = toPosix(item.translationFile)
      if (translationFile.startsWith(`${TRANSLATION_ROOT_PREFIX}/`)) {
        bucket.translationRoot = translationFile.slice(0, translationFile.length - item.relativePath.length - 1)
      }
    }
  }

  for (const item of translationState.items) {
    const bucket = ensureBucket(item.bucket)
    if (!bucket.translationRoot) {
      bucket.translationRoot = `${TRANSLATION_ROOT_PREFIX}/${item.bucket}`
    }
  }

  return bucketMap
}

function resolveTranslationRoots(bucketMap: Map<string, SourceBucketSummary>) {
  return [...bucketMap.values()]
    .map((bucket) => ({ bucket: bucket.id, translationRoot: toPosix(bucket.translationRoot || `${TRANSLATION_ROOT_PREFIX}/${bucket.id}`) }))
    .sort((left, right) => right.translationRoot.length - left.translationRoot.length)
}

function resolveBucketFromTranslationFile(filePath: string, roots: Array<{ bucket: string; translationRoot: string }>): { bucket: string; relativePath: string } {
  const normalizedFilePath = toPosix(filePath)
  for (const root of roots) {
    const prefix = `${root.translationRoot}/`
    if (normalizedFilePath.startsWith(prefix)) {
      return {
        bucket: root.bucket,
        relativePath: normalizedFilePath.slice(prefix.length),
      }
    }
  }

  const fallback = normalizedFilePath.replace(`${TRANSLATION_ROOT_PREFIX}/`, '')
  const segments = fallback.split('/')
  return {
    bucket: segments[0] || 'docs',
    relativePath: segments.slice(1).join('/'),
  }
}

async function scanTranslationFiles(repoPath: string, bucketMap: Map<string, SourceBucketSummary>): Promise<TranslationFileObservation[]> {
  const translationRoot = path.join(repoPath, TRANSLATION_ROOT_PREFIX)
  const roots = resolveTranslationRoots(bucketMap)
  const files = await walkFiles(translationRoot)
  const observations: TranslationFileObservation[] = []

  for (const filePath of files) {
    const relativeFile = toPosix(path.relative(repoPath, filePath))
    const resolved = resolveBucketFromTranslationFile(relativeFile, roots)
    if (!resolved.bucket || !resolved.relativePath) {
      continue
    }

    const fileStat = await stat(filePath)
    observations.push({
      bucket: resolved.bucket,
      relativePath: resolved.relativePath,
      translationFile: relativeFile,
      translationUpdatedAt: new Date(fileStat.mtimeMs).toISOString(),
    })
  }

  return observations.sort((left, right) => stableLocaleCompare(buildIntegrityKey(left.bucket, left.relativePath), buildIntegrityKey(right.bucket, right.relativePath)))
}

function resolveTranslationStatus(args: {
  sourceSha256: string | null
  syncedAt?: string
  translationState?: TranslationStateItem
  translationFile?: TranslationFileObservation
}): { status: TranslationStatus; updatedAt: string | null } {
  const updatedAt = args.translationState?.updatedAt ?? args.translationState?.translatedAt ?? args.translationFile?.translationUpdatedAt ?? null
  const hasTarget = Boolean(args.translationFile)
  const hasShaMatch = Boolean(args.translationState?.sourceSha256 && args.sourceSha256 && args.translationState.sourceSha256 === args.sourceSha256)

  if (hasTarget && hasShaMatch) {
    return { status: 'translated', updatedAt }
  }

  if (hasTarget) {
    const compareResult = compareIsoTime(updatedAt, args.syncedAt)
    if (!Number.isNaN(compareResult) && compareResult >= 0) {
      return { status: 'translated', updatedAt }
    }

    return { status: 'staleTranslation', updatedAt }
  }

  return { status: 'missingTranslation', updatedAt }
}

async function resolveSourceMirrorStatus(repoPath: string, item: SourceItem): Promise<{ sourceStatus: SourceSyncStatus; mirroredSha256: string | null }> {
  const mirrorPath = path.join(repoPath, item.sourceFile)
  if (!(await pathExists(mirrorPath))) {
    return {
      sourceStatus: 'missingSource',
      mirroredSha256: null,
    }
  }

  const mirroredSha256 = await sha256File(mirrorPath)
  return {
    sourceStatus: mirroredSha256 === item.sourceSha256 ? 'synced' : 'drift',
    mirroredSha256,
  }
}

function pushFinding(findings: IntegrityFinding[], finding: Omit<IntegrityFinding, 'id'>) {
  findings.push({
    ...finding,
    id: `${finding.type}:${finding.bucket}:${finding.relativePath || 'summary'}`,
  })
}

function summarizeSourceBucket(bucket: SourceBucketSummary): SourceSummary {
  return {
    synced: bucket.syncedCount,
    drift: bucket.driftCount,
    missingSource: bucket.missingSourceCount,
  }
}

function summarizeTranslationBucket(bucket: SourceBucketSummary): TranslationSummary {
  return {
    translated: bucket.translatedCount,
    staleTranslation: bucket.staleTranslationCount,
    missingTranslation: bucket.missingTranslationCount,
    orphanTranslation: bucket.orphanTranslationCount,
  }
}

function sameSummary(left: SourceSummary | TranslationSummary | undefined, right: SourceSummary | TranslationSummary | undefined, keys: string[]) {
  return keys.every((key) => readNumber((left as JsonRecord | undefined)?.[key]) === readNumber((right as JsonRecord | undefined)?.[key]))
}

async function buildReconciledRecords(options: ReconcileTranslationIntegrityOptions) {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const source = normalizeSourcePayload(options.source, options.version)
  const syncStatus = normalizeSyncStatusPayload(options.syncStatus, options.version)
  const translationState = normalizeTranslationStatePayload(options.translationState, options.version)
  const copyLog = normalizeCopyLogPayload(options.copyLog, options.version)
  const bucketMap = collectBucketMetadata(source, syncStatus, translationState)
  const translationFiles = await scanTranslationFiles(options.repoPath, bucketMap)
  const translationFileByKey = new Map(translationFiles.map((item) => [buildIntegrityKey(item.bucket, item.relativePath), item]))
  const syncItemByKey = new Map(syncStatus.items.map((item) => [buildIntegrityKey(item.bucket, item.relativePath), item]))
  const translationStateByKey = new Map(translationState.items.map((item) => [buildIntegrityKey(item.bucket, item.relativePath), item]))
  const sourceItemByKey = new Map(source.items.map((item) => [buildIntegrityKey(item.bucket, item.relativePath), item]))
  const findings: IntegrityFinding[] = []
  const reconciled: ReconciledRecord[] = []

  for (const sourceItem of source.items) {
    const key = buildIntegrityKey(sourceItem.bucket, sourceItem.relativePath)
    const currentSync = syncItemByKey.get(key)
    const translationFile = translationFileByKey.get(key)
    const translationStateItem = translationStateByKey.get(key)
    const sourceMirror = await resolveSourceMirrorStatus(options.repoPath, sourceItem)
    const translation = resolveTranslationStatus({
      sourceSha256: sourceItem.sourceSha256,
      syncedAt: syncStatus.syncedAt ?? generatedAt,
      translationState: translationStateItem,
      translationFile,
    })

    const item: SyncStatusItem = {
      version: options.version,
      bucket: sourceItem.bucket,
      relativePath: sourceItem.relativePath,
      sourcePath: sourceItem.sourcePath,
      sourceFile: sourceItem.sourceFile,
      sourceSha256: sourceItem.sourceSha256,
      mirroredSha256: sourceMirror.mirroredSha256,
      status: sourceMirror.sourceStatus,
      sourceStatus: sourceMirror.sourceStatus,
      translationStatus: translation.status,
      translationFile: translationFile?.translationFile ?? currentSync?.translationFile ?? translationStateItem?.targetPath ?? `${TRANSLATION_ROOT_PREFIX}/${sourceItem.bucket}/${sourceItem.relativePath}`,
      translationUpdatedAt: translation.updatedAt,
      sourceUpdatedAt: sourceItem.sourceUpdatedAt ?? currentSync?.sourceUpdatedAt ?? null,
      syncedAt: syncStatus.syncedAt ?? generatedAt,
      lastCheckedAt: generatedAt,
    }

    reconciled.push({ item, isSourceDocument: true })

    if (options.auditAgainstInput && currentSync && (currentSync.sourceStatus !== item.sourceStatus || currentSync.translationStatus !== item.translationStatus)) {
      pushFinding(findings, {
        type: 'syncStatusConflict',
        version: options.version,
        bucket: item.bucket,
        relativePath: item.relativePath,
        sourceFile: item.sourceFile,
        translationFile: item.translationFile,
        conflictStage: 'sync-status',
        title: integrityCategoryLabel('syncStatusConflict'),
        detail: integrityCategoryHint('syncStatusConflict'),
        observed: {
          sourceStatus: currentSync?.sourceStatus ?? 'missing',
          translationStatus: currentSync?.translationStatus ?? 'missing',
        },
        expected: {
          sourceStatus: item.sourceStatus,
          translationStatus: item.translationStatus,
        },
      })
    }

    if (translationStateItem && !translationFile) {
      pushFinding(findings, {
        type: 'translationStateMissingTarget',
        version: options.version,
        bucket: item.bucket,
        relativePath: item.relativePath,
        sourceFile: item.sourceFile,
        translationFile: translationStateItem.targetPath,
        conflictStage: 'translation-state',
        title: integrityCategoryLabel('translationStateMissingTarget'),
        detail: integrityCategoryHint('translationStateMissingTarget'),
        observed: {
          translationStateSha: translationStateItem.sourceSha256,
          targetExists: 'false',
        },
        expected: {
          targetExists: 'true',
          authorityTranslationStatus: 'translated',
        },
      })
    }

    if (translationStateItem && translationFile && sourceItem.sourceSha256 !== translationStateItem.sourceSha256) {
      pushFinding(findings, {
        type: 'translationStateShaMismatch',
        version: options.version,
        bucket: item.bucket,
        relativePath: item.relativePath,
        sourceFile: item.sourceFile,
        translationFile: translationFile.translationFile,
        conflictStage: 'translation-state',
        title: integrityCategoryLabel('translationStateShaMismatch'),
        detail: integrityCategoryHint('translationStateShaMismatch'),
        observed: {
          translationStateSha: translationStateItem.sourceSha256,
          sourceSha256: sourceItem.sourceSha256,
        },
        expected: {
          translationStateSha: sourceItem.sourceSha256,
        },
      })
    }
  }

  for (const translationFile of translationFiles) {
    const key = buildIntegrityKey(translationFile.bucket, translationFile.relativePath)
    if (sourceItemByKey.has(key)) {
      continue
    }

    const currentSync = syncItemByKey.get(key)
    const translationStateItem = translationStateByKey.get(key)
    const item: SyncStatusItem = {
      version: options.version,
      bucket: translationFile.bucket,
      relativePath: translationFile.relativePath,
      sourcePath: currentSync?.sourcePath ?? null,
      sourceFile: currentSync?.sourceFile ?? null,
      sourceSha256: currentSync?.sourceSha256 ?? null,
      mirroredSha256: currentSync?.mirroredSha256 ?? null,
      status: 'missingSource',
      sourceStatus: 'missingSource',
      translationStatus: 'orphanTranslation',
      translationFile: translationFile.translationFile,
      translationUpdatedAt: translationStateItem?.updatedAt ?? translationStateItem?.translatedAt ?? translationFile.translationUpdatedAt,
      sourceUpdatedAt: currentSync?.sourceUpdatedAt ?? null,
      syncedAt: syncStatus.syncedAt ?? generatedAt,
      lastCheckedAt: generatedAt,
    }

    reconciled.push({ item, isSourceDocument: false })
    pushFinding(findings, {
      type: 'orphanTranslation',
      version: options.version,
      bucket: item.bucket,
      relativePath: item.relativePath,
      sourceFile: item.sourceFile,
      translationFile: item.translationFile,
      conflictStage: 'filesystem',
      title: integrityCategoryLabel('orphanTranslation'),
      detail: integrityCategoryHint('orphanTranslation'),
      observed: {
        targetExists: 'true',
        sourceExists: 'false',
      },
      expected: {
        sourceExists: 'true',
      },
    })
  }

  reconciled.sort((left, right) => stableLocaleCompare(buildIntegrityKey(left.item.bucket, left.item.relativePath), buildIntegrityKey(right.item.bucket, right.item.relativePath)))
  return {
    generatedAt,
    source,
    syncStatus,
    copyLog,
    translationState,
    bucketMap,
    findings,
    reconciled,
  }
}

function buildBucketSummaries(source: SourcePayload, bucketMap: Map<string, SourceBucketSummary>, reconciled: ReconciledRecord[]) {
  const nextBuckets = new Map<string, SourceBucketSummary>()
  for (const [bucketId, bucket] of bucketMap.entries()) {
    nextBuckets.set(bucketId, {
      ...createEmptyBucketSummary(bucketId),
      targetMount: bucket.targetMount,
      sourceRoots: [...bucket.sourceRoots],
      translationRoot: bucket.translationRoot,
      sourceDirectory: bucket.sourceDirectory,
    })
  }

  for (const item of source.items) {
    const bucket = nextBuckets.get(item.bucket) ?? createEmptyBucketSummary(item.bucket)
    bucket.documentCount += 1
    if (!bucket.targetMount && item.targetMount) {
      bucket.targetMount = item.targetMount
    }
    nextBuckets.set(item.bucket, bucket)
  }

  for (const record of reconciled) {
    const bucket = nextBuckets.get(record.item.bucket) ?? createEmptyBucketSummary(record.item.bucket)
    if (record.item.sourceStatus === 'synced') {
      bucket.syncedCount += 1
    } else if (record.item.sourceStatus === 'drift') {
      bucket.driftCount += 1
    } else {
      bucket.missingSourceCount += 1
    }

    if (record.item.translationStatus === 'translated') {
      bucket.translatedCount += 1
    } else if (record.item.translationStatus === 'staleTranslation') {
      bucket.staleTranslationCount += 1
    } else if (record.item.translationStatus === 'missingTranslation') {
      bucket.missingTranslationCount += 1
    } else {
      bucket.orphanTranslationCount += 1
    }

    nextBuckets.set(record.item.bucket, bucket)
  }

  return [...nextBuckets.values()].sort((left, right) => stableLocaleCompare(left.id, right.id))
}

function buildSummary(items: SyncStatusItem[]): { sourceSummary: SourceSummary; translationSummary: TranslationSummary } {
  const sourceSummary = emptySourceSummary()
  const translationSummary = emptyTranslationSummary()

  for (const item of items) {
    sourceSummary[item.sourceStatus] += 1
    translationSummary[item.translationStatus] += 1
  }

  return { sourceSummary, translationSummary }
}

function buildLatestBatch(
  options: ReconcileTranslationIntegrityOptions,
  copyLog: CopyLogPayload,
  sourceSummary: SourceSummary,
  translationSummary: TranslationSummary,
  bucketCount: number,
  documentCount: number,
  generatedAt: string,
): CopyBatch {
  const current = copyLog.batches[0]
  return {
    id: options.batchSeed?.id ?? current?.id ?? `integrity-${generatedAt.replaceAll(':', '').replaceAll('-', '').replaceAll('.', '')}`,
    sourceRepo: options.batchSeed?.sourceRepo ?? current?.sourceRepo ?? options.source.sourceRepo ?? '',
    sourceBranch: options.batchSeed?.sourceBranch ?? current?.sourceBranch ?? options.source.sourceBranch ?? '',
    copiedAt: options.batchSeed?.copiedAt ?? current?.copiedAt ?? options.source.copiedAt ?? generatedAt,
    documentCount: options.batchSeed?.documentCount ?? current?.documentCount ?? documentCount,
    bucketCount: options.batchSeed?.bucketCount ?? current?.bucketCount ?? bucketCount,
    failureCount: options.batchSeed?.failureCount ?? current?.failureCount ?? 0,
    statusSummary: sourceSummary,
    translationSummary,
    status: options.batchSeed?.status ?? current?.status ?? 'completed',
    failures: options.batchSeed?.failures ?? current?.failures ?? [],
  }
}

function buildSourceSummaryFindings(version: string, sourceBuckets: SourceBucketSummary[], rawSource: SourcePayload, findings: IntegrityFinding[]) {
  const rawBuckets = new Map(rawSource.buckets.map((bucket) => [bucket.id, bucket]))

  for (const bucket of sourceBuckets) {
    const rawBucket = rawBuckets.get(bucket.id)
    const expectedSource = summarizeSourceBucket(bucket)
    const expectedTranslation = summarizeTranslationBucket(bucket)
    const observedSource = rawBucket ? summarizeSourceBucket(rawBucket) : emptySourceSummary()
    const observedTranslation = rawBucket ? summarizeTranslationBucket(rawBucket) : emptyTranslationSummary()

    if (
      sameSummary(observedSource, expectedSource, ['synced', 'drift', 'missingSource']) &&
      sameSummary(observedTranslation, expectedTranslation, ['translated', 'staleTranslation', 'missingTranslation', 'orphanTranslation'])
    ) {
      continue
    }

    pushFinding(findings, {
      type: 'sourceSummaryMismatch',
      version,
      bucket: bucket.id,
      relativePath: '',
      sourceFile: null,
      translationFile: null,
      conflictStage: 'source-summary',
      title: integrityCategoryLabel('sourceSummaryMismatch'),
      detail: integrityCategoryHint('sourceSummaryMismatch'),
      observed: {
        synced: String(observedSource.synced),
        drift: String(observedSource.drift),
        missingSource: String(observedSource.missingSource),
        translated: String(observedTranslation.translated),
        staleTranslation: String(observedTranslation.staleTranslation),
        missingTranslation: String(observedTranslation.missingTranslation),
        orphanTranslation: String(observedTranslation.orphanTranslation),
      },
      expected: {
        synced: String(expectedSource.synced),
        drift: String(expectedSource.drift),
        missingSource: String(expectedSource.missingSource),
        translated: String(expectedTranslation.translated),
        staleTranslation: String(expectedTranslation.staleTranslation),
        missingTranslation: String(expectedTranslation.missingTranslation),
        orphanTranslation: String(expectedTranslation.orphanTranslation),
      },
    })
  }
}

function buildCopyLogFinding(version: string, latestBatch: CopyBatch, rawCopyLog: CopyLogPayload, sourceSummary: SourceSummary, translationSummary: TranslationSummary, findings: IntegrityFinding[]) {
  const current = rawCopyLog.batches[0]
  if (
    current &&
    sameSummary(current.statusSummary, sourceSummary, ['synced', 'drift', 'missingSource']) &&
    sameSummary(current.translationSummary, translationSummary, ['translated', 'staleTranslation', 'missingTranslation', 'orphanTranslation'])
  ) {
    return
  }

  pushFinding(findings, {
    type: 'copyLogSummaryMismatch',
    version,
    bucket: latestBatch.id,
    relativePath: '',
    sourceFile: null,
    translationFile: null,
    conflictStage: 'copy-log',
    title: integrityCategoryLabel('copyLogSummaryMismatch'),
    detail: integrityCategoryHint('copyLogSummaryMismatch'),
    observed: {
      synced: String(readNumber(current?.statusSummary?.synced)),
      drift: String(readNumber(current?.statusSummary?.drift)),
      missingSource: String(readNumber(current?.statusSummary?.missingSource)),
      translated: String(readNumber(current?.translationSummary?.translated)),
      staleTranslation: String(readNumber(current?.translationSummary?.staleTranslation)),
      missingTranslation: String(readNumber(current?.translationSummary?.missingTranslation)),
      orphanTranslation: String(readNumber(current?.translationSummary?.orphanTranslation)),
    },
    expected: {
      synced: String(sourceSummary.synced),
      drift: String(sourceSummary.drift),
      missingSource: String(sourceSummary.missingSource),
      translated: String(translationSummary.translated),
      staleTranslation: String(translationSummary.staleTranslation),
      missingTranslation: String(translationSummary.missingTranslation),
      orphanTranslation: String(translationSummary.orphanTranslation),
    },
  })
}

export async function reconcileTranslationIntegrity(options: ReconcileTranslationIntegrityOptions): Promise<TranslationIntegrityBundle> {
  const built = await buildReconciledRecords(options)
  const syncItems = built.reconciled.map((record) => record.item)
  const summaries = buildSummary(syncItems)
  const buckets = buildBucketSummaries(built.source, built.bucketMap, built.reconciled)
  if (options.auditAgainstInput) {
    buildSourceSummaryFindings(options.version, buckets, built.source, built.findings)
  }

  const latestBatch = buildLatestBatch(
    options,
    built.copyLog,
    summaries.sourceSummary,
    summaries.translationSummary,
    buckets.length,
    built.source.items.length,
    built.generatedAt,
  )
  if (options.auditAgainstInput) {
    buildCopyLogFinding(options.version, latestBatch, built.copyLog, summaries.sourceSummary, summaries.translationSummary, built.findings)
  }

  const nextSyncStatus: SyncStatusPayload = {
    version: options.version,
    generatedAt: built.generatedAt,
    syncedAt: built.syncStatus.syncedAt ?? built.generatedAt,
    summary: summaries.sourceSummary,
    sourceSummary: summaries.sourceSummary,
    translationSummary: summaries.translationSummary,
    items: syncItems,
  }

  const nextSource: SourcePayload = {
    ...built.source,
    version: options.version,
    generatedAt: built.generatedAt,
    copiedAt: built.source.copiedAt ?? built.generatedAt,
    documentCount: built.source.items.length,
    bucketCount: buckets.length,
    buckets,
  }

  const nextCopyLog: CopyLogPayload = {
    version: options.version,
    generatedAt: built.generatedAt,
    batches: [latestBatch, ...built.copyLog.batches.slice(1)],
  }

  const categories = summarizeIntegrityCategories(built.findings)
  const integrityReport: IntegrityAuditPayload = {
    version: options.version,
    generatedAt: built.generatedAt,
    latestBatchId: latestBatch.id,
    sourceSummary: summaries.sourceSummary,
    translationSummary: summaries.translationSummary,
    buckets,
    categories,
    findings: built.findings.sort((left, right) => stableLocaleCompare(left.id, right.id)),
    totalFindings: built.findings.length,
    status: built.findings.length > 0 ? 'warn' : 'stable',
  }

  return {
    syncStatus: nextSyncStatus,
    source: nextSource,
    copyLog: nextCopyLog,
    translationState: built.translationState,
    integrityReport,
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

async function readOptionalJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function writeJsonFile(filePath: string, payload: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

export async function readTranslationIntegrityBundle(repoPath: string, version: string): Promise<TranslationIntegrityBundle> {
  const dataDir = path.join(repoPath, 'data')
  const source = await readJsonFile<SourcePayload>(path.join(dataDir, DATASET_FILE_NAMES.source))
  const syncStatus = await readOptionalJsonFile<SyncStatusPayload>(path.join(dataDir, DATASET_FILE_NAMES.syncStatus))
  const copyLog = await readOptionalJsonFile<CopyLogPayload>(path.join(dataDir, DATASET_FILE_NAMES.copyLog))
  const translationState = await readOptionalJsonFile<TranslationStatePayload>(path.join(dataDir, DATASET_FILE_NAMES.translationState))
  const integrityReport = await readOptionalJsonFile<IntegrityAuditPayload>(path.join(dataDir, DATASET_FILE_NAMES.integrityReport))

  return {
    source: normalizeSourcePayload(source, version),
    syncStatus: normalizeSyncStatusPayload(syncStatus, version),
    copyLog: normalizeCopyLogPayload(copyLog, version),
    translationState: normalizeTranslationStatePayload(translationState, version),
    integrityReport:
      integrityReport && isObject(integrityReport)
        ? (integrityReport as IntegrityAuditPayload)
        : {
            version,
            generatedAt: '',
            latestBatchId: '',
            sourceSummary: emptySourceSummary(),
            translationSummary: emptyTranslationSummary(),
            buckets: [],
            categories: [],
            findings: [],
            totalFindings: 0,
            status: 'stable',
          },
  }
}

export async function auditTranslationIntegrity(repoPath: string, version: string, options?: { generatedAt?: string }) {
  const bundle = await readTranslationIntegrityBundle(repoPath, version)
  return reconcileTranslationIntegrity({
    repoPath,
    version,
    generatedAt: options?.generatedAt,
    auditAgainstInput: true,
    source: bundle.source,
    syncStatus: bundle.syncStatus,
    copyLog: bundle.copyLog,
    translationState: bundle.translationState,
  })
}

export async function repairTranslationIntegrity(repoPath: string, version: string, options?: { generatedAt?: string; batchSeed?: Partial<CopyBatch> }) {
  const bundle = await readTranslationIntegrityBundle(repoPath, version)
  const reconciled = await reconcileTranslationIntegrity({
    repoPath,
    version,
    generatedAt: options?.generatedAt,
    auditAgainstInput: false,
    source: bundle.source,
    syncStatus: bundle.syncStatus,
    copyLog: bundle.copyLog,
    translationState: bundle.translationState,
    batchSeed: options?.batchSeed,
  })

  const dataDir = path.join(repoPath, 'data')
  await Promise.all([
    writeJsonFile(path.join(dataDir, DATASET_FILE_NAMES.syncStatus), reconciled.syncStatus),
    writeJsonFile(path.join(dataDir, DATASET_FILE_NAMES.source), reconciled.source),
    writeJsonFile(path.join(dataDir, DATASET_FILE_NAMES.integrityReport), reconciled.integrityReport),
    rm(path.join(dataDir, DATASET_FILE_NAMES.copyLog), { force: true }),
  ])

  return reconciled
}
