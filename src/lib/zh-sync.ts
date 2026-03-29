export type ZhSyncResponse = {
  ok?: boolean
  error?: string
  stdout?: string
  stderr?: string
}

export async function runZhDataSync(version: string): Promise<ZhSyncResponse> {
  const response = await fetch(`/__admin/zh-data/sync?version=${encodeURIComponent(version)}`, {
    method: 'POST',
  })

  const payload = (await response.json().catch(() => ({ error: 'invalid_response' }))) as ZhSyncResponse
  if (!response.ok) {
    const message = payload.error === 'sync_in_progress' ? '同步进行中' : payload.stderr || payload.error || '执行同步失败'
    throw new Error(message)
  }

  return payload
}
