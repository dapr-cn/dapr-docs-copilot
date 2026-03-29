export const DEFAULT_TRANSLATION_TEMPLATE = 'claude-default.hbs'
export const TRANSLATION_WORKBENCH_POLL_INTERVAL_MS = 1500
export const DEFAULT_TRANSLATION_JOB_CONCURRENCY = 3
export const MIN_TRANSLATION_JOB_CONCURRENCY = 1
export const MAX_TRANSLATION_JOB_CONCURRENCY = 10

export const TRANSLATION_QUEUE_STATUSES = ['waiting', 'translating', 'completed', 'failed'] as const
export type TranslationQueueStatus = (typeof TRANSLATION_QUEUE_STATUSES)[number]

export const TERMINAL_TRANSLATION_QUEUE_STATUSES = ['completed', 'failed'] as const

export type TranslationDatasetState = 'translated' | 'staleTranslation' | 'missingTranslation'

export type TranslationWorkbenchError = {
  code: string
  message: string
  detail?: string
}

export type TranslationWorkbenchVersion = {
  id: string
  label: string
  repoPath: string
  datasetPath: string
  untranslatedCount: number
  templateName: string
}

export type TranslationWorkbenchFile = {
  id: string
  version: string
  bucket: string
  fileName: string
  relativePath: string
  sourceFile: string
  sourcePath: string
  targetPath: string
  sizeBytes: number
  mimeType: string
  datasetState: TranslationDatasetState
  syncedAt?: string
  sourceUpdatedAt?: string
  translationUpdatedAt?: string
}

export type TranslationJobCounts = {
  total: number
  waiting: number
  translating: number
  completed: number
  failed: number
}

export type TranslationWorkbenchJobItem = {
  id: string
  fileId: string
  version: string
  relativePath: string
  fileName: string
  targetPath: string
  sizeBytes: number
  status: TranslationQueueStatus
  attempts: number
  startedAt?: string
  completedAt?: string
  error?: TranslationWorkbenchError
}

export type TranslationWorkbenchJob = {
  jobId: string
  version: string
  templateName: string
  concurrency: number
  createdAt: string
  updatedAt: string
  isActive: boolean
  counts: TranslationJobCounts
  items: TranslationWorkbenchJobItem[]
}

export type TranslationWorkbenchVersionsResponse = {
  versions: TranslationWorkbenchVersion[]
  templateName: string
}

export type TranslationWorkbenchFilesResponse = {
  version: string
  generatedAt: string
  templateName: string
  files: TranslationWorkbenchFile[]
}

export type CreateTranslationJobRequest = {
  version: string
  fileIds: string[]
  concurrency?: number
}

export type RetryTranslationJobItemRequest = {
  jobId: string
  itemId: string
}

export function isTerminalTranslationQueueStatus(status: TranslationQueueStatus): boolean {
  return (TERMINAL_TRANSLATION_QUEUE_STATUSES as readonly string[]).includes(status)
}

export function isValidTranslationJobConcurrency(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_TRANSLATION_JOB_CONCURRENCY && value <= MAX_TRANSLATION_JOB_CONCURRENCY
}

export function isTranslationJobActive(job: TranslationWorkbenchJob | null | undefined): boolean {
  return Boolean(job?.isActive)
}
