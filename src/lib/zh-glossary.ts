import type { GlossaryDataset, GlossaryMutationResult, GlossaryTermDraft } from '@/lib/zh-data-models'
import {
  createReadOnlyGlossaryState,
  normalizeGlossaryDataset,
  sanitizeGlossaryDraft,
  validateGlossaryDraft,
} from '@/lib/zh-glossary-core'

let GLOSSARY_MODULES: Record<string, unknown> = {}

try {
  GLOSSARY_MODULES = import.meta.glob('../../../*_zh/data/glossary.json', {
    eager: true,
    import: 'default',
  })
} catch {
  GLOSSARY_MODULES = {}
}

function readStaticGlossaryRaw(version: string): unknown | undefined {
  const suffix = `/${version}_zh/data/glossary.json`
  const entry = Object.entries(GLOSSARY_MODULES).find(([key]) => key.endsWith(suffix))
  return entry?.[1]
}

function readOnlyFallback(version: string, reason: string): GlossaryDataset {
  const raw = readStaticGlossaryRaw(version)

  if (!raw) {
    throw new Error(`缺少数据集：${version}/glossary.json`)
  }

  return normalizeGlossaryDataset(raw, {
    readOnlyState: createReadOnlyGlossaryState(reason),
  })
}

async function parseGlossaryResponse(response: Response): Promise<GlossaryMutationResult> {
  const payload = (await response.json().catch(() => ({ error: 'invalid_response' }))) as
    | GlossaryMutationResult
    | { error?: string }

  if (!response.ok) {
    throw new Error('error' in payload ? payload.error || '术语请求失败' : '术语请求失败')
  }

  if (!('dataset' in payload)) {
    throw new Error('术语响应格式异常')
  }

  return payload
}

async function mutateGlossary(url: string, method: 'POST' | 'PATCH' | 'DELETE', draft?: GlossaryTermDraft): Promise<GlossaryMutationResult> {
  const response = await fetch(url, {
    method,
    headers: draft ? { 'Content-Type': 'application/json' } : undefined,
    body: draft ? JSON.stringify(sanitizeGlossaryDraft(draft)) : undefined,
  })

  return parseGlossaryResponse(response)
}

function withVersionQuery(url: string, version: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}version=${encodeURIComponent(version)}`
}

export async function fetchGlossaryDataset(version: string): Promise<GlossaryDataset> {
  try {
    const response = await fetch(withVersionQuery('/__admin/zh-data/glossary', version))

    if (response.ok) {
      const payload = await parseGlossaryResponse(response)
      return payload.dataset
    }

    if (response.status === 404 || response.status === 405) {
      return readOnlyFallback(version, '当前运行环境未启用术语写入端点。')
    }

    await parseGlossaryResponse(response)
    throw new Error('术语读取失败')
  } catch (error) {
    if (error instanceof Error && error.message !== 'Failed to fetch') {
      throw error
    }

    return readOnlyFallback(version, '当前运行环境为只读，暂不可新增、编辑或删除术语。')
  }
}

export function validateGlossaryTermDraft(draft: GlossaryTermDraft, dataset: GlossaryDataset, currentId?: string) {
  return validateGlossaryDraft(draft, dataset.terms, currentId)
}

export async function createGlossaryTerm(version: string, draft: GlossaryTermDraft): Promise<GlossaryMutationResult> {
  return mutateGlossary(withVersionQuery('/__admin/zh-data/glossary', version), 'POST', draft)
}

export async function updateGlossaryTerm(version: string, termId: string, draft: GlossaryTermDraft): Promise<GlossaryMutationResult> {
  return mutateGlossary(withVersionQuery(`/__admin/zh-data/glossary/${termId}`, version), 'PATCH', draft)
}

export async function deleteGlossaryTerm(version: string, termId: string): Promise<GlossaryMutationResult> {
  return mutateGlossary(withVersionQuery(`/__admin/zh-data/glossary/${termId}`, version), 'DELETE')
}
