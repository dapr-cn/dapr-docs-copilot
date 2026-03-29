import {
  getPrWorkbenchPollInterval,
  type PrWorkbenchApiFailure,
  type PrWorkbenchApiSuccess,
  type PrWorkbenchError,
  type PrWorkbenchSession,
  type PrWorkbenchStepActionResponse,
  type PrWorkbenchVersionsResponse,
} from '@/lib/pr-workbench-models'

type JsonPayload<T> = PrWorkbenchApiSuccess<T> | PrWorkbenchApiFailure

const BASE_PATH = '/__admin/pr-workbench'

function normalizeWorkbenchError(error: PrWorkbenchError | undefined, fallback: string): Error {
  if (!error) {
    return new Error(fallback)
  }

  const messageMap: Record<string, string> = {
    invalid_version: '版本参数无效',
    version_not_found: error.message,
    route_not_found: 'PR 工作台端点不存在',
    git_not_found: '本机未找到 git 命令',
    file_not_found: error.message,
    zh_sync_failed: 'zh 仓同步校验失败',
    zh_pull_failed: error.message,
    zh_pull_not_available: error.message,
    zh_push_failed: error.message,
    zh_push_not_available: error.message,
    fork_commit_failed: error.message,
    fork_commit_not_available: error.message,
    fork_push_failed: error.message,
    fork_push_not_available: error.message,
    fork_refresh_failed: 'fork 更新失败',
    build_failed: error.message,
    build_command_missing: error.message,
  }

  return new Error(messageMap[error.code] ?? error.message ?? fallback)
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const payload = (await response.json().catch(() => ({ ok: false, error: { code: 'invalid_json', message: '服务端 JSON 无效' } }))) as JsonPayload<T>

  if (!response.ok || !payload.ok) {
    throw normalizeWorkbenchError(payload.ok ? undefined : payload.error, 'PR 工作台请求失败')
  }

  return payload.data
}

export async function fetchPrWorkbenchVersions(): Promise<PrWorkbenchVersionsResponse> {
  return requestJson<PrWorkbenchVersionsResponse>(`${BASE_PATH}/versions`)
}

export async function fetchPrWorkbenchSession(version: string): Promise<PrWorkbenchSession> {
  return requestJson<PrWorkbenchSession>(`${BASE_PATH}/sessions/${encodeURIComponent(version)}`)
}

async function postSessionAction(version: string, action: 'check-zh-sync' | 'pull-zh' | 'push-zh' | 'update-fork' | 'commit-fork' | 'push-fork' | 'verify-build'): Promise<PrWorkbenchStepActionResponse> {
  return requestJson<PrWorkbenchStepActionResponse>(`${BASE_PATH}/sessions/${encodeURIComponent(version)}/${action}`, {
    method: 'POST',
  })
}

export async function runPrWorkbenchZhSync(version: string): Promise<PrWorkbenchStepActionResponse> {
  return postSessionAction(version, 'check-zh-sync')
}

export async function runPrWorkbenchForkRefresh(version: string): Promise<PrWorkbenchStepActionResponse> {
  return postSessionAction(version, 'update-fork')
}

export async function runPrWorkbenchForkCommit(version: string): Promise<PrWorkbenchStepActionResponse> {
  return postSessionAction(version, 'commit-fork')
}

export async function runPrWorkbenchForkPush(version: string): Promise<PrWorkbenchStepActionResponse> {
  return postSessionAction(version, 'push-fork')
}

export async function runPrWorkbenchZhPull(version: string): Promise<PrWorkbenchStepActionResponse> {
  return postSessionAction(version, 'pull-zh')
}

export async function runPrWorkbenchZhPush(version: string): Promise<PrWorkbenchStepActionResponse> {
  return postSessionAction(version, 'push-zh')
}

export async function runPrWorkbenchBuildVerification(version: string): Promise<PrWorkbenchStepActionResponse> {
  return postSessionAction(version, 'verify-build')
}

export { getPrWorkbenchPollInterval }
