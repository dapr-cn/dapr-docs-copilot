import {
  TRANSLATION_WORKBENCH_POLL_INTERVAL_MS,
  type CreateTranslationJobRequest,
  type TranslationWorkbenchError,
  type TranslationWorkbenchFilesResponse,
  type TranslationWorkbenchJob,
  type TranslationWorkbenchVersionsResponse,
  isTranslationJobActive,
} from '@/lib/translation-workbench-models'

type ErrorPayload = {
  error?: TranslationWorkbenchError
}

const BASE_PATH = '/__admin/translation-workbench'

function mapWorkbenchError(error: TranslationWorkbenchError | undefined, fallback: string): Error {
  if (!error) {
    return new Error(fallback)
  }

  const messageMap: Record<string, string> = {
    empty_selection: '至少选择一个待翻译文件',
    invalid_selection: '所选文件已失效，请刷新列表',
    invalid_concurrency: '并发数量仅支持 1-10 的整数',
    file_locked: error.message,
    version_not_found: '目标版本不存在',
    job_not_found: '翻译任务不存在',
    job_item_not_found: '翻译任务项不存在',
    retry_not_allowed: '仅失败项允许重试',
    template_not_found: '模板缺失，无法发起翻译',
    template_unreadable: '模板不可读，请检查 prompts/translation',
    claude_cli_not_found: '本机未找到 claude 命令',
    claude_cli_failed: error.message,
  }

  return new Error(messageMap[error.code] ?? error.message ?? fallback)
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload

  if (!response.ok) {
    throw mapWorkbenchError(payload.error, '工作台请求失败')
  }

  return payload
}

export async function fetchTranslationWorkbenchVersions(): Promise<TranslationWorkbenchVersionsResponse> {
  return requestJson<TranslationWorkbenchVersionsResponse>(`${BASE_PATH}/versions`)
}

export async function fetchTranslationWorkbenchFiles(version: string): Promise<TranslationWorkbenchFilesResponse> {
  const url = new URL(`${BASE_PATH}/files`, window.location.origin)
  url.searchParams.set('version', version)
  return requestJson<TranslationWorkbenchFilesResponse>(url.pathname + url.search)
}

export async function createTranslationWorkbenchJob(payload: CreateTranslationJobRequest): Promise<TranslationWorkbenchJob> {
  return requestJson<TranslationWorkbenchJob>(`${BASE_PATH}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function fetchTranslationWorkbenchJob(jobId: string): Promise<TranslationWorkbenchJob> {
  return requestJson<TranslationWorkbenchJob>(`${BASE_PATH}/jobs/${jobId}`)
}

export async function retryTranslationWorkbenchItem(jobId: string, itemId: string): Promise<TranslationWorkbenchJob> {
  return requestJson<TranslationWorkbenchJob>(`${BASE_PATH}/jobs/${jobId}/items/${itemId}/retry`, {
    method: 'POST',
  })
}

export function shouldPollTranslationWorkbenchJob(job: TranslationWorkbenchJob | undefined): boolean {
  return isTranslationJobActive(job)
}

export function getTranslationWorkbenchPollInterval(job: TranslationWorkbenchJob | undefined): number | false {
  return shouldPollTranslationWorkbenchJob(job) ? TRANSLATION_WORKBENCH_POLL_INTERVAL_MS : false
}
