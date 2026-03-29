import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_TRANSLATION_JOB_CONCURRENCY,
  DEFAULT_TRANSLATION_TEMPLATE,
  MAX_TRANSLATION_JOB_CONCURRENCY,
  MIN_TRANSLATION_JOB_CONCURRENCY,
  isValidTranslationJobConcurrency,
  type CreateTranslationJobRequest,
  type TranslationDatasetState,
  type TranslationJobCounts,
  type TranslationWorkbenchError,
  type TranslationWorkbenchFile,
  type TranslationWorkbenchFilesResponse,
  type TranslationWorkbenchJob,
  type TranslationWorkbenchJobItem,
  type TranslationWorkbenchVersion,
  type TranslationWorkbenchVersionsResponse,
} from '../lib/translation-workbench-models'
import {
  formatGlossaryForPrompt,
  renderTranslationPrompt,
  resolveClaudeCliPath,
  resolveTranslationModel,
  resolveTranslationTemplateName,
} from './translation-template'
import { normalizeMarkdownAliases } from './translation-alias-localization'
import { validateTranslationOutput } from './translation-output-validation'
import { reconcileTranslationIntegrity } from './translation-integrity-audit'
import type { CopyLogPayload } from '../lib/translation-integrity-models'
import type {
  SourcePayload as IntegritySourcePayload,
  SyncStatusPayload as IntegritySyncStatusPayload,
  TranslationStatePayload as IntegrityTranslationStatePayload,
} from '../lib/translation-integrity-models'

export type SyncStatusItem = {
  version?: string
  bucket: string
  relativePath: string
  sourcePath: string
  sourceFile: string
  sourceSha256?: string
  translationStatus: TranslationDatasetState | 'orphanTranslation'
  translationFile: string
  syncedAt?: string
  sourceUpdatedAt?: string
  translationUpdatedAt?: string
}

type SyncStatusPayload = {
  version: string
  generatedAt?: string
  syncedAt?: string
  items: SyncStatusItem[]
}

export type SourceItem = {
  bucket: string
  relativePath: string
  sourcePath: string
  sourceFile: string
  sourceSha256?: string
  mimeType: string
  sizeBytes: number
  sourceUpdatedAt?: string
}

type SourcePayload = {
  version: string
  items: SourceItem[]
}

type GlossaryTerm = {
  source: string
  target: string
  category?: string
  status?: string
}

type GlossaryPayload = {
  version: string
  terms: GlossaryTerm[]
}

type VersionDatasetRecord = {
  version: string
  repoPath: string
  datasetPath: string
  syncStatusPath: string
  sourcePath: string
  copyLogPath: string
  glossaryPath: string
  translationStatePath: string
  integrityReportPath: string
}

type VersionDatasetBundle = {
  versionRecord: VersionDatasetRecord
  syncStatus: SyncStatusPayload
  source: SourcePayload
  copyLog: CopyLogPayload
  glossary: GlossaryPayload
  translationState: TranslationStatePayload
}

type JobItemRecord = TranslationWorkbenchJobItem & {
  bucket: string
  mimeType: string
  sourceFile: string
  sourcePath: string
  sourceSha256?: string
  absoluteSourcePath: string
  absoluteTargetPath: string
}

type JobRecord = {
  jobId: string
  version: string
  templateName: string
  concurrency: number
  createdAt: string
  updatedAt: string
  versionRecord: VersionDatasetRecord
  glossary: GlossaryPayload
  items: JobItemRecord[]
}

type QueuedItemRef = {
  jobId: string
  itemId: string
}

type TranslationStateItem = {
  bucket: string
  relativePath: string
  sourceSha256: string
  targetPath: string
  translatedAt?: string
  updatedAt?: string
}

type TranslationStatePayload = {
  version: string
  generatedAt?: string
  items: TranslationStateItem[]
}

export type TranslationExecutorInput = {
  model: string
  prompt: string
  version: string
  file: TranslationWorkbenchFile
  workingDirectory: string
}

export type TranslationExecutor = (input: TranslationExecutorInput) => Promise<string>

export type TranslationWorkbenchAdminOptions = {
  workspaceRoot: string
  env?: NodeJS.ProcessEnv
  templateName?: string
  executor?: TranslationExecutor
  claudeCliPath?: string
}

export type TranslationWorkbenchAdmin = {
  listVersions: () => Promise<TranslationWorkbenchVersionsResponse>
  listFiles: (version: string) => Promise<TranslationWorkbenchFilesResponse>
  createJob: (request: CreateTranslationJobRequest) => Promise<TranslationWorkbenchJob>
  getJob: (jobId: string) => TranslationWorkbenchJob
  retryJobItem: (jobId: string, itemId: string) => Promise<TranslationWorkbenchJob>
}

const VERSION_SUFFIX = '_zh'
const REQUIRED_DATASETS = ['sync-status.json', 'source.json', 'glossary.json'] as const

function logWorkbench(message: string, payload?: Record<string, unknown>) {
  const timestamp = new Date().toISOString()
  if (payload) {
    console.info(`[translation-workbench] ${timestamp} ${message}`, payload)
    return
  }

  console.info(`[translation-workbench] ${timestamp} ${message}`)
}

function logWorkbenchError(message: string, payload?: Record<string, unknown>) {
  const timestamp = new Date().toISOString()
  if (payload) {
    console.error(`[translation-workbench] ${timestamp} ${message}`, payload)
    return
  }

  console.error(`[translation-workbench] ${timestamp} ${message}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function createWorkbenchError(code: string, message: string, detail?: string) {
  const error = new Error(message) as Error & { workbenchError: TranslationWorkbenchError }
  error.workbenchError = { code, message, detail }
  return error
}

function toWorkbenchError(error: unknown, fallbackCode = 'translation_failed', fallbackMessage = '翻译任务失败'): TranslationWorkbenchError {
  if (error instanceof Error && 'workbenchError' in error) {
    return (error as Error & { workbenchError: TranslationWorkbenchError }).workbenchError
  }

  if (error instanceof Error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      const missingPath = readString(nodeError.path)
      if (missingPath.includes(`${path.sep}prompts${path.sep}translation${path.sep}`)) {
        return { code: 'template_not_found', message: '翻译模板缺失', detail: missingPath }
      }
      return { code: 'file_not_found', message: '工作台文件缺失', detail: missingPath || error.message }
    }

    if (nodeError.code === 'EISDIR' || nodeError.code === 'ENOTDIR') {
      return { code: 'template_unreadable', message: '翻译模板不可读', detail: readString(nodeError.path) || error.message }
    }

    return { code: fallbackCode, message: error.message || fallbackMessage }
  }

  if (isObject(error)) {
    const code = readString(error.code, fallbackCode)
    const message = readString(error.message, fallbackMessage)
    const detail = readString(error.detail)
    if (message) {
      return { code, message, detail: detail || undefined }
    }
  }

  return { code: fallbackCode, message: fallbackMessage }
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

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

function buildFileId(version: string, bucket: string, relativePath: string): string {
  return `${version}::${bucket}::${relativePath}`
}

function buildFileKey(version: string, targetPath: string): string {
  return `${version}::${targetPath}`
}

function buildJobCounts(items: TranslationWorkbenchJobItem[]): TranslationJobCounts {
  return items.reduce<TranslationJobCounts>(
    (accumulator, item) => {
      accumulator.total += 1
      accumulator[item.status] += 1
      return accumulator
    },
    {
      total: 0,
      waiting: 0,
      translating: 0,
      completed: 0,
      failed: 0,
    },
  )
}

function normalizeTranslationBody(text: string): string {
  const normalized = text.trim()
  if (!normalized) {
    throw createWorkbenchError('empty_translation_response', 'Claude 未返回可写入的译文正文')
  }

  return `${normalized}\n`
}

export function isMarkdownFile(mimeType: string, relativePath: string): boolean {
  const normalizedMimeType = mimeType.trim().toLowerCase()
  if (normalizedMimeType.startsWith('text/markdown') || normalizedMimeType.startsWith('text/x-markdown')) {
    return true
  }

  const normalizedPath = relativePath.trim().toLowerCase()
  return normalizedPath.endsWith('.md') || normalizedPath.endsWith('.markdown') || normalizedPath.endsWith('.mdx')
}

function cloneJob(record: JobRecord): TranslationWorkbenchJob {
  const items = record.items.map((item) => ({ ...item }))
  const counts = buildJobCounts(items)
  const isActive = counts.waiting > 0 || counts.translating > 0

  return {
    jobId: record.jobId,
    version: record.version,
    templateName: record.templateName,
    concurrency: record.concurrency,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    isActive,
    counts,
    items,
  }
}

function normalizeSyncStatusItem(value: unknown): SyncStatusItem | null {
  if (!isObject(value)) {
    return null
  }

  return {
    version: readString(value.version),
    bucket: readString(value.bucket),
    relativePath: readString(value.relativePath),
    sourcePath: readString(value.sourcePath),
    sourceFile: readString(value.sourceFile),
    sourceSha256: readString(value.sourceSha256) || undefined,
    translationStatus: (readString(value.translationStatus) || 'missingTranslation') as SyncStatusItem['translationStatus'],
    translationFile: readString(value.translationFile),
    syncedAt: readString(value.syncedAt),
    sourceUpdatedAt: readString(value.sourceUpdatedAt),
    translationUpdatedAt: readString(value.translationUpdatedAt),
  }
}

function normalizeSourceItem(value: unknown): SourceItem | null {
  if (!isObject(value)) {
    return null
  }

  return {
    bucket: readString(value.bucket),
    relativePath: readString(value.relativePath),
    sourcePath: readString(value.sourcePath),
    sourceFile: readString(value.sourceFile),
    sourceSha256: readString(value.sourceSha256) || undefined,
    mimeType: readString(value.mimeType, 'text/markdown'),
    sizeBytes: readNumber(value.sizeBytes),
    sourceUpdatedAt: readString(value.sourceUpdatedAt),
  }
}

function normalizeGlossaryTerm(value: unknown): GlossaryTerm | null {
  if (!isObject(value)) {
    return null
  }

  return {
    source: readString(value.source),
    target: readString(value.target),
    category: readString(value.category) || undefined,
    status: readString(value.status) || undefined,
  }
}

function normalizeSyncStatusPayload(value: SyncStatusPayload, versionFallback: string): SyncStatusPayload {
  return {
    version: readString(value.version, versionFallback),
    generatedAt: readString(value.generatedAt),
    syncedAt: readString(value.syncedAt),
    items: Array.isArray(value.items)
      ? value.items.map(normalizeSyncStatusItem).filter((item): item is SyncStatusItem => item !== null)
      : [],
  }
}

function normalizeSourcePayload(value: SourcePayload, versionFallback: string): SourcePayload {
  return {
    version: readString(value.version, versionFallback),
    items: Array.isArray(value.items)
      ? value.items.map(normalizeSourceItem).filter((item): item is SourceItem => item !== null)
      : [],
  }
}

function normalizeGlossaryPayload(value: GlossaryPayload, versionFallback: string): GlossaryPayload {
  return {
    version: readString(value.version, versionFallback),
    terms: Array.isArray(value.terms)
      ? value.terms.map(normalizeGlossaryTerm).filter((item): item is GlossaryTerm => item !== null)
      : [],
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
    targetPath: readString(value.targetPath),
    translatedAt: readString(value.translatedAt) || undefined,
    updatedAt: readString(value.updatedAt) || undefined,
  }
}

function normalizeTranslationStatePayload(value: unknown, versionFallback: string): TranslationStatePayload {
  if (!isObject(value)) {
    return {
      version: versionFallback,
      items: [],
    }
  }

  return {
    version: readString(value.version, versionFallback),
    generatedAt: readString(value.generatedAt) || undefined,
    items: Array.isArray(value.items)
      ? value.items.map(normalizeTranslationStateItem).filter((item): item is TranslationStateItem => item !== null)
      : [],
  }
}

export function resolveTranslationTargetPath(item: Pick<SyncStatusItem, 'bucket' | 'relativePath' | 'translationFile'>): string {
  if (item.translationFile) {
    return item.translationFile
  }

  return path.posix.join('translated_content', 'zh_CN', item.bucket, item.relativePath)
}

async function scanVersionDatasets(workspaceRoot: string, templateName: string): Promise<TranslationWorkbenchVersion[]> {
  const reposRoot = path.join(workspaceRoot, 'repos')
  const entries = await readdir(reposRoot, { withFileTypes: true })
  const versions: TranslationWorkbenchVersion[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(VERSION_SUFFIX)) {
      continue
    }

    const repoPath = path.join(reposRoot, entry.name)
    const datasetPath = path.join(repoPath, 'data')
    const missingRequired = await Promise.all(
      REQUIRED_DATASETS.map(async (fileName) => ({
        fileName,
        exists: await pathExists(path.join(datasetPath, fileName)),
      })),
    )

    if (missingRequired.some((item) => !item.exists)) {
      continue
    }

    const rawSyncStatus = await readJsonFile<SyncStatusPayload>(path.join(datasetPath, 'sync-status.json'))
    const rawSource = await readJsonFile<SourcePayload>(path.join(datasetPath, 'source.json'))
    const rawTranslationState = await readOptionalJsonFile<TranslationStatePayload>(path.join(datasetPath, 'translation-state.json'))
    const version = readString(rawSyncStatus.version) || entry.name.replace(/_zh$/, '')
    const syncStatus = normalizeSyncStatusPayload(rawSyncStatus, version)
    const source = normalizeSourcePayload(rawSource, version)
    const translationState = normalizeTranslationStatePayload(rawTranslationState, version)

    const files = await buildWorkbenchFiles(
      {
        version,
        repoPath,
        datasetPath,
        syncStatusPath: path.join(datasetPath, 'sync-status.json'),
        sourcePath: path.join(datasetPath, 'source.json'),
        copyLogPath: path.join(datasetPath, 'copy-log.json'),
        glossaryPath: path.join(datasetPath, 'glossary.json'),
        translationStatePath: path.join(datasetPath, 'translation-state.json'),
        integrityReportPath: path.join(datasetPath, 'integrity-report.json'),
      },
      syncStatus,
      source,
      translationState,
    )

    versions.push({
      id: syncStatus.version,
      label: syncStatus.version,
      repoPath,
      datasetPath,
      untranslatedCount: files.length,
      templateName,
    })
  }

  return versions.sort((left, right) => compareVersionsDescending(left.id, right.id))
}

async function resolveVersionDataset(workspaceRoot: string, version: string): Promise<VersionDatasetRecord> {
  const reposRoot = path.join(workspaceRoot, 'repos')
  const entries = await readdir(reposRoot, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(VERSION_SUFFIX)) {
      continue
    }

    const repoPath = path.join(reposRoot, entry.name)
    const datasetPath = path.join(repoPath, 'data')
    const syncStatusPath = path.join(datasetPath, 'sync-status.json')
    if (!(await pathExists(syncStatusPath))) {
      continue
    }

    const syncStatus = await readJsonFile<SyncStatusPayload>(syncStatusPath)
    if (syncStatus.version !== version) {
      continue
    }

    const sourcePath = path.join(datasetPath, 'source.json')
    const glossaryPath = path.join(datasetPath, 'glossary.json')
    if (!(await pathExists(sourcePath)) || !(await pathExists(glossaryPath))) {
      break
    }

    return {
      version,
      repoPath,
      datasetPath,
      syncStatusPath,
      sourcePath,
      copyLogPath: path.join(datasetPath, 'copy-log.json'),
      glossaryPath,
      translationStatePath: path.join(datasetPath, 'translation-state.json'),
      integrityReportPath: path.join(datasetPath, 'integrity-report.json'),
    }
  }

  throw createWorkbenchError('version_not_found', `未找到版本：${version}`)
}

async function loadVersionBundle(workspaceRoot: string, version: string): Promise<VersionDatasetBundle> {
  const versionRecord = await resolveVersionDataset(workspaceRoot, version)
  const [syncStatusRaw, sourceRaw, copyLogRaw, glossaryRaw] = await Promise.all([
    readJsonFile<SyncStatusPayload>(versionRecord.syncStatusPath),
    readJsonFile<SourcePayload>(versionRecord.sourcePath),
    readOptionalJsonFile<CopyLogPayload>(versionRecord.copyLogPath),
    readJsonFile<GlossaryPayload>(versionRecord.glossaryPath),
  ])
  const translationStateRaw = await readOptionalJsonFile<TranslationStatePayload>(versionRecord.translationStatePath)

  return {
    versionRecord,
    syncStatus: normalizeSyncStatusPayload(syncStatusRaw, version),
    source: normalizeSourcePayload(sourceRaw, version),
    copyLog: {
      version,
      batches: copyLogRaw?.batches ?? [],
    },
    glossary: normalizeGlossaryPayload(glossaryRaw, version),
    translationState: normalizeTranslationStatePayload(translationStateRaw, version),
  }
}

async function removeTargetFileBestEffort(absoluteTargetPath: string): Promise<boolean> {
  const existed = await pathExists(absoluteTargetPath)
  try {
    await rm(absoluteTargetPath, { force: true })
    return existed
  } catch {
    return existed
  }
}

async function resolveEffectiveDatasetState(
  repoPath: string,
  item: SyncStatusItem,
  translationStateByKey: Map<string, TranslationStateItem>,
  fallbackSyncedAt?: string,
): Promise<TranslationDatasetState | 'orphanTranslation'> {
  const targetAbsolutePath = path.join(repoPath, resolveTranslationTargetPath(item))
  const syncedAtValue = item.syncedAt || fallbackSyncedAt
  const syncedAt = syncedAtValue ? new Date(syncedAtValue) : null
  const translationState = translationStateByKey.get(`${item.bucket}::${item.relativePath}`)

  try {
    const targetStat = await stat(targetAbsolutePath)
    if (translationState?.sourceSha256 && item.sourceSha256 && translationState.sourceSha256 === item.sourceSha256) {
      return 'translated'
    }

    if (syncedAt && !Number.isNaN(syncedAt.getTime()) && targetStat.mtime.getTime() >= syncedAt.getTime()) {
      return 'translated'
    }
  } catch {
    return item.translationStatus === 'translated' ? 'missingTranslation' : item.translationStatus
  }

  return item.translationStatus
}

async function buildWorkbenchFiles(
  versionRecord: VersionDatasetRecord,
  syncStatus: SyncStatusPayload,
  source: SourcePayload,
  translationState: TranslationStatePayload,
): Promise<TranslationWorkbenchFile[]> {
  const sourceMap = new Map(source.items.map((item) => [`${item.bucket}::${item.relativePath}`, item]))
  const translationStateByKey = new Map(translationState.items.map((item) => [`${item.bucket}::${item.relativePath}`, item]))
  const files: TranslationWorkbenchFile[] = []

  for (const item of syncStatus.items) {
    const currentState = await resolveEffectiveDatasetState(versionRecord.repoPath, item, translationStateByKey, syncStatus.syncedAt)
    if (currentState !== 'missingTranslation' && currentState !== 'staleTranslation') {
      continue
    }

    const sourceItem = sourceMap.get(`${item.bucket}::${item.relativePath}`)
    const fallbackSourcePath = path.join(versionRecord.repoPath, item.sourceFile)
    let sizeBytes = sourceItem?.sizeBytes ?? 0
    let mimeType = sourceItem?.mimeType ?? 'text/markdown'

    if (sizeBytes === 0 && (await pathExists(fallbackSourcePath))) {
      sizeBytes = (await stat(fallbackSourcePath)).size
    }

    if (!mimeType) {
      mimeType = 'text/markdown'
    }

    files.push({
      id: buildFileId(versionRecord.version, item.bucket, item.relativePath),
      version: versionRecord.version,
      bucket: item.bucket,
      fileName: path.basename(item.relativePath),
      relativePath: item.relativePath,
      sourceFile: item.sourceFile,
      sourcePath: item.sourcePath,
      targetPath: resolveTranslationTargetPath(item),
      sizeBytes,
      mimeType,
      datasetState: currentState,
      syncedAt: item.syncedAt || syncStatus.syncedAt || undefined,
      sourceUpdatedAt: item.sourceUpdatedAt || sourceItem?.sourceUpdatedAt || undefined,
      translationUpdatedAt: item.translationUpdatedAt || undefined,
    })
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export function createClaudeCliExecutor(claudeCliPath = resolveClaudeCliPath(process.env)): TranslationExecutor {
  return async ({ model, prompt, workingDirectory, file, version }) =>
    new Promise<string>((resolve, reject) => {
      const args = ['-p', '--output-format', 'text', '--input-format', 'text', '--permission-mode', 'dontAsk', '--tools', '']
      if (model) {
        args.push('--model', model)
      }

      logWorkbench('调用本机 claude', {
        version,
        relativePath: file.relativePath,
        workingDirectory,
        cliPath: claudeCliPath,
        model: model || '(cli default)',
      })

      const command = spawn(claudeCliPath, args, {
        cwd: workingDirectory,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      command.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      command.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      command.on('error', (error) => {
        logWorkbenchError('claude 进程启动失败', {
          relativePath: file.relativePath,
          workingDirectory,
          error: error.message,
        })
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(createWorkbenchError('claude_cli_not_found', `未找到本机 Claude 命令：${claudeCliPath}`))
          return
        }

        reject(createWorkbenchError('claude_cli_failed', error.message))
      })
      command.on('close', (code) => {
        if (code !== 0) {
          logWorkbenchError('claude 返回非零退出码', {
            relativePath: file.relativePath,
            workingDirectory,
            code,
            stderr: stderr.trim().slice(-1200),
          })
          reject(createWorkbenchError('claude_cli_failed', stderr.trim() || `Claude 命令执行失败：${code}`))
          return
        }

        try {
          const normalized = normalizeTranslationBody(stdout)
          logWorkbench('claude 返回正文', {
            relativePath: file.relativePath,
            outputChars: normalized.length,
          })
          resolve(normalized)
        } catch (error) {
          logWorkbenchError('claude 返回内容无效', {
            relativePath: file.relativePath,
            stdout: stdout.trim().slice(0, 600),
          })
          reject(error)
        }
      })

      command.stdin.write(prompt)
      command.stdin.end()
    })
}

export function createTranslationWorkbenchAdmin(options: TranslationWorkbenchAdminOptions): TranslationWorkbenchAdmin {
  const env = options.env ?? process.env
  const templateName = options.templateName ?? resolveTranslationTemplateName(env)
  const model = resolveTranslationModel(env)
  const claudeCliPath = options.claudeCliPath ?? resolveClaudeCliPath(env)
  const executor = options.executor ?? createClaudeCliExecutor(claudeCliPath)
  const jobs = new Map<string, JobRecord>()
  const queue: QueuedItemRef[] = []
  const queuedFileKeys = new Set<string>()
  const activeItemRefs = new Set<string>()
  const datasetWriteQueues = new Map<string, Promise<unknown>>()
  let translationLaunchQueue = Promise.resolve()

  function validateRequestedConcurrency(value: number | undefined): number {
    if (value === undefined) {
      return DEFAULT_TRANSLATION_JOB_CONCURRENCY
    }

    if (!isValidTranslationJobConcurrency(value)) {
      throw createWorkbenchError(
        'invalid_concurrency',
        `并发数量仅支持 ${MIN_TRANSLATION_JOB_CONCURRENCY}-${MAX_TRANSLATION_JOB_CONCURRENCY} 的整数`,
      )
    }

    return value
  }

  function buildActiveItemKey(jobId: string, itemId: string): string {
    return `${jobId}::${itemId}`
  }

  function countActiveItemsForJob(jobId: string): number {
    let total = 0
    for (const item of jobs.get(jobId)?.items ?? []) {
      if (item.status === 'translating') {
        total += 1
      }
    }
    return total
  }

  function getJobRecord(jobId: string): JobRecord {
    const record = jobs.get(jobId)
    if (!record) {
      throw createWorkbenchError('job_not_found', `未找到任务：${jobId}`)
    }
    return record
  }

  function getJobItemRecord(job: JobRecord, itemId: string): JobItemRecord {
    const item = job.items.find((entry) => entry.id === itemId)
    if (!item) {
      throw createWorkbenchError('job_item_not_found', `未找到任务项：${itemId}`)
    }
    return item
  }

  function getNextQueuedItem(): { job: JobRecord; item: JobItemRecord } | null {
    for (let index = 0; index < queue.length; index += 1) {
      const next = queue[index]
      const job = jobs.get(next.jobId)
      if (!job) {
        queue.splice(index, 1)
        index -= 1
        continue
      }

      const item = job.items.find((entry) => entry.id === next.itemId)
      if (!item || item.status !== 'waiting') {
        queue.splice(index, 1)
        index -= 1
        continue
      }

      if (countActiveItemsForJob(job.jobId) >= job.concurrency) {
        continue
      }

      queue.splice(index, 1)
      return { job, item }
    }

    return null
  }

  function enqueueDatasetWrite<T>(datasetPath: string, task: () => Promise<T>): Promise<T> {
    const previous = datasetWriteQueues.get(datasetPath) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    datasetWriteQueues.set(datasetPath, next.catch(() => undefined))
    return next
  }

  async function persistTranslationState(versionRecord: VersionDatasetRecord, item: Pick<JobItemRecord, 'bucket' | 'relativePath' | 'targetPath' | 'sourceSha256'>) {
    if (!item.sourceSha256) {
      return
    }

    const sourceSha256 = item.sourceSha256
    await enqueueDatasetWrite(versionRecord.datasetPath, async () => {
      const current = normalizeTranslationStatePayload(
        await readOptionalJsonFile<TranslationStatePayload>(versionRecord.translationStatePath),
        versionRecord.version,
      )
      const key = `${item.bucket}::${item.relativePath}`
      const now = new Date().toISOString()
      const nextItems = current.items.filter((entry) => `${entry.bucket}::${entry.relativePath}` !== key)

      nextItems.push({
        bucket: item.bucket,
        relativePath: item.relativePath,
        sourceSha256,
        targetPath: item.targetPath,
        translatedAt: now,
        updatedAt: now,
      })

      nextItems.sort((left, right) => `${left.bucket}::${left.relativePath}`.localeCompare(`${right.bucket}::${right.relativePath}`, 'zh-CN'))

      await writeFile(
        versionRecord.translationStatePath,
        `${JSON.stringify(
          {
            version: versionRecord.version,
            generatedAt: now,
            items: nextItems,
          } satisfies TranslationStatePayload,
          null,
          2,
        )}\n`,
        'utf8',
      )
    })
  }

  async function reconcileVersionDatasets(versionRecord: VersionDatasetRecord) {
    await enqueueDatasetWrite(versionRecord.datasetPath, async () => {
      const bundle = await loadVersionBundle(options.workspaceRoot, versionRecord.version)
      const reconciled = await reconcileTranslationIntegrity({
        repoPath: bundle.versionRecord.repoPath,
        version: bundle.versionRecord.version,
        source: bundle.source as unknown as IntegritySourcePayload,
        syncStatus: bundle.syncStatus as unknown as IntegritySyncStatusPayload,
        copyLog: bundle.copyLog,
        translationState: bundle.translationState as unknown as IntegrityTranslationStatePayload,
      })

      await Promise.all([
        writeFile(bundle.versionRecord.syncStatusPath, `${JSON.stringify(reconciled.syncStatus, null, 2)}\n`, 'utf8'),
        writeFile(bundle.versionRecord.sourcePath, `${JSON.stringify(reconciled.source, null, 2)}\n`, 'utf8'),
        writeFile(bundle.versionRecord.integrityReportPath, `${JSON.stringify(reconciled.integrityReport, null, 2)}\n`, 'utf8'),
        rm(bundle.versionRecord.copyLogPath, { force: true }),
      ])
    })
  }

  async function invokeMarkdownExecutorInOrder(input: {
    job: JobRecord
    item: JobItemRecord
    file: TranslationWorkbenchFile
  }): Promise<{ sourceContent: string; translation: string }> {
    const previousLaunch = translationLaunchQueue
    let releaseLaunch!: () => void
    translationLaunchQueue = new Promise<void>((resolve) => {
      releaseLaunch = resolve
    })

    await previousLaunch
    try {
      const glossary = formatGlossaryForPrompt(input.job.glossary.terms)
      const sourceContent = await readFile(input.item.absoluteSourcePath, 'utf8')
      const prompt = await renderTranslationPrompt(
        options.workspaceRoot,
        {
          version: input.job.version,
          relativePath: input.item.relativePath,
          targetPath: input.item.targetPath,
          sourceContent,
          glossary,
        },
        input.job.templateName,
      )

      const executorPromise = executor({
        model,
        prompt,
        version: input.job.version,
        file: input.file,
        workingDirectory: input.job.versionRecord.repoPath,
      })

      releaseLaunch()

      return {
        sourceContent,
        translation: normalizeMarkdownAliases(normalizeTranslationBody(await executorPromise), input.item.targetPath),
      }
    } catch (error) {
      releaseLaunch()
      throw error
    }
  }

  function scheduleQueue() {
    while (activeItemRefs.size < MAX_TRANSLATION_JOB_CONCURRENCY) {
      const next = getNextQueuedItem()
      if (!next) {
        return
      }

      const activeKey = buildActiveItemKey(next.job.jobId, next.item.id)
      activeItemRefs.add(activeKey)
      next.item.status = 'translating'
      next.item.startedAt = new Date().toISOString()
      next.item.error = undefined
      next.job.updatedAt = next.item.startedAt
      logWorkbench('开始翻译任务项', {
        jobId: next.job.jobId,
        itemId: next.item.id,
        version: next.job.version,
        relativePath: next.item.relativePath,
        targetPath: next.item.targetPath,
        jobConcurrency: next.job.concurrency,
        activeItems: activeItemRefs.size,
      })

      void (async () => {
        try {
          const file: TranslationWorkbenchFile = {
            id: next.item.fileId,
            version: next.item.version,
            bucket: next.item.bucket,
            fileName: next.item.fileName,
            relativePath: next.item.relativePath,
            sourceFile: next.item.sourceFile,
            sourcePath: next.item.sourcePath,
            targetPath: next.item.targetPath,
            sizeBytes: next.item.sizeBytes,
            mimeType: next.item.mimeType,
            datasetState: 'missingTranslation',
          }

          let outputChars = next.item.sizeBytes

          if (isMarkdownFile(next.item.mimeType, next.item.relativePath)) {
            const { sourceContent, translation } = await invokeMarkdownExecutorInOrder({
              job: next.job,
              item: next.item,
              file,
            })
            const validation = validateTranslationOutput({
              fileId: `${next.item.bucket}/${next.item.relativePath}`,
              sourceContent,
              candidateContent: translation,
              sourcePath: next.item.sourceFile,
              targetPath: next.item.targetPath,
            })

            if (!validation.ok) {
              const removedTarget = await removeTargetFileBestEffort(next.item.absoluteTargetPath)
              logWorkbenchError('译文结构校验失败', {
                jobId: next.job.jobId,
                itemId: next.item.id,
                relativePath: next.item.relativePath,
                targetPath: next.item.absoluteTargetPath,
                removedTarget,
                rules: validation.triggeredRules,
                sourceHeadingCount: validation.sourceHeadingCount,
                targetHeadingCount: validation.targetHeadingCount,
                sourceHeadingLevels: validation.sourceHeadingLevels,
                targetHeadingLevels: validation.targetHeadingLevels,
                headingLevelMismatches: validation.headingLevelMismatches,
                diagnostic: validation.diagnosticMessage,
              })
              throw createWorkbenchError('translation_output_validation_failed', '译文结构校验失败', validation.diagnosticMessage)
            }

            await mkdir(path.dirname(next.item.absoluteTargetPath), { recursive: true })
            await writeFile(next.item.absoluteTargetPath, translation, 'utf8')
            outputChars = translation.length
          } else {
            await mkdir(path.dirname(next.item.absoluteTargetPath), { recursive: true })
            await copyFile(next.item.absoluteSourcePath, next.item.absoluteTargetPath)
            logWorkbench('复制非 Markdown 文件完成', {
              jobId: next.job.jobId,
              itemId: next.item.id,
              relativePath: next.item.relativePath,
              targetPath: next.item.absoluteTargetPath,
              mimeType: next.item.mimeType,
            })
          }

          await persistTranslationState(next.job.versionRecord, next.item)
          await reconcileVersionDatasets(next.job.versionRecord)
          logWorkbench('写入译文完成', {
            jobId: next.job.jobId,
            itemId: next.item.id,
            relativePath: next.item.relativePath,
            targetPath: next.item.absoluteTargetPath,
            outputChars,
          })

          next.item.status = 'completed'
          next.item.completedAt = new Date().toISOString()
          next.item.error = undefined
        } catch (error) {
          next.item.status = 'failed'
          next.item.completedAt = new Date().toISOString()
          next.item.error = toWorkbenchError(error)
          logWorkbenchError('翻译任务项失败', {
            jobId: next.job.jobId,
            itemId: next.item.id,
            relativePath: next.item.relativePath,
            error: next.item.error,
          })
        } finally {
          queuedFileKeys.delete(buildFileKey(next.item.version, next.item.targetPath))
          next.job.updatedAt = new Date().toISOString()
          activeItemRefs.delete(activeKey)
          scheduleQueue()
        }
      })()
    }
  }

  return {
    async listVersions() {
      const versions = await scanVersionDatasets(options.workspaceRoot, templateName)
      logWorkbench('加载版本列表', {
        versionCount: versions.length,
        versions: versions.map((item) => item.id),
      })
      return {
        versions,
        templateName,
      }
    },

    async listFiles(version) {
      const bundle = await loadVersionBundle(options.workspaceRoot, version)
      const files = await buildWorkbenchFiles(bundle.versionRecord, bundle.syncStatus, bundle.source, bundle.translationState)
      logWorkbench('加载文件列表', {
        version,
        fileCount: files.length,
      })
      return {
        version,
        generatedAt: bundle.syncStatus.generatedAt || new Date().toISOString(),
        templateName,
        files,
      }
    },

    async createJob(request) {
      if (request.fileIds.length === 0) {
        throw createWorkbenchError('empty_selection', '至少选择一个待翻译文件')
      }

      const concurrency = validateRequestedConcurrency(request.concurrency)

      const filesResponse = await this.listFiles(request.version)
      const fileMap = new Map(filesResponse.files.map((file) => [file.id, file]))
      const selectedFiles = request.fileIds.map((fileId) => fileMap.get(fileId)).filter((file): file is TranslationWorkbenchFile => file !== undefined)

      if (selectedFiles.length !== request.fileIds.length) {
        throw createWorkbenchError('invalid_selection', '存在无效或已过期的文件选择')
      }

      for (const file of selectedFiles) {
        const fileKey = buildFileKey(file.version, file.targetPath)
        if (queuedFileKeys.has(fileKey)) {
          throw createWorkbenchError('file_locked', `文件已在运行队列中：${file.relativePath}`)
        }
      }

      const createdAt = new Date().toISOString()
      const bundle = await loadVersionBundle(options.workspaceRoot, request.version)
      const sourceShaByKey = new Map(
        bundle.syncStatus.items
          .filter((item) => item.sourceSha256)
          .map((item) => [`${item.bucket}::${item.relativePath}`, item.sourceSha256 as string]),
      )
      const jobId = randomUUID()
      const items: JobItemRecord[] = selectedFiles.map((file) => ({
        id: randomUUID(),
        fileId: file.id,
        version: file.version,
        relativePath: file.relativePath,
        fileName: file.fileName,
        targetPath: file.targetPath,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        status: 'waiting',
        attempts: 1,
        bucket: file.bucket,
        sourceFile: file.sourceFile,
        sourcePath: file.sourcePath,
        sourceSha256: sourceShaByKey.get(`${file.bucket}::${file.relativePath}`),
        absoluteSourcePath: path.join(bundle.versionRecord.repoPath, file.sourceFile),
        absoluteTargetPath: path.join(bundle.versionRecord.repoPath, file.targetPath),
      }))

      jobs.set(jobId, {
        jobId,
        version: request.version,
        templateName,
        concurrency,
        createdAt,
        updatedAt: createdAt,
        versionRecord: bundle.versionRecord,
        glossary: bundle.glossary,
        items,
      })

      for (const item of items) {
        queuedFileKeys.add(buildFileKey(item.version, item.targetPath))
        queue.push({ jobId, itemId: item.id })
      }

      logWorkbench('创建翻译任务', {
        jobId,
        version: request.version,
        concurrency,
        itemCount: items.length,
        files: items.map((item) => item.relativePath),
      })

      scheduleQueue()
      return this.getJob(jobId)
    },

    getJob(jobId) {
      return cloneJob(getJobRecord(jobId))
    },

    async retryJobItem(jobId, itemId) {
      const job = getJobRecord(jobId)
      const item = getJobItemRecord(job, itemId)
      if (item.status !== 'failed') {
        throw createWorkbenchError('retry_not_allowed', '仅失败项允许重试')
      }

      const fileKey = buildFileKey(item.version, item.targetPath)
      if (queuedFileKeys.has(fileKey)) {
        throw createWorkbenchError('file_locked', `文件已在运行队列中：${item.relativePath}`)
      }

      item.status = 'waiting'
      item.error = undefined
      item.startedAt = undefined
      item.completedAt = undefined
      item.attempts += 1
      job.updatedAt = new Date().toISOString()

      queuedFileKeys.add(fileKey)
      queue.push({ jobId, itemId })
      logWorkbench('失败项重新入队', {
        jobId,
        itemId,
        relativePath: item.relativePath,
        attempts: item.attempts,
      })
      scheduleQueue()

      return this.getJob(jobId)
    },
  }
}

export function createDefaultTranslationWorkbenchAdmin(workspaceRoot: string) {
  return createTranslationWorkbenchAdmin({
    workspaceRoot,
    templateName: resolveTranslationTemplateName(process.env) || DEFAULT_TRANSLATION_TEMPLATE,
  })
}
