import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { GlossaryDataset, GlossaryMutationResult, GlossaryTerm, GlossaryTermDraft } from './zh-data-models'
import {
  buildGlossaryMutationResult,
  hasGlossaryValidationError,
  normalizeGlossaryDataset,
  sanitizeGlossaryDraft,
  validateGlossaryDraft,
} from './zh-glossary-core'

export function buildGlossaryFileRelativePath(version = 'v1.17'): string {
  return `repos/${version}_zh/data/glossary.json`
}

function readGlossaryError(message: string): Error {
  return new Error(message)
}

async function readGlossaryRaw(filePath: string): Promise<unknown> {
  let text = ''

  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    throw readGlossaryError(error instanceof Error ? error.message : '读取 glossary.json 失败')
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw readGlossaryError(error instanceof Error ? `glossary.json 解析失败：${error.message}` : 'glossary.json 解析失败')
  }
}

function serializeTerm(term: GlossaryTerm): Record<string, string> {
  const payload: Record<string, string> = {
    id: term.id,
    source: term.source,
    target: term.target,
    notes: term.notes,
  }

  if (term.updatedAt) {
    payload.updatedAt = term.updatedAt
  }

  return payload
}

async function persistGlossaryDataset(filePath: string, dataset: GlossaryDataset): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        version: dataset.version,
        generatedAt: dataset.generatedAt,
        terms: dataset.terms.map((term) => serializeTerm(term)),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

function sortTerms(terms: GlossaryTerm[]): GlossaryTerm[] {
  return [...terms].sort((left, right) => left.source.localeCompare(right.source, 'en-US'))
}

function applyMutation(
  dataset: GlossaryDataset,
  nextTerms: GlossaryTerm[],
  options: { message: string; term?: GlossaryTerm; deletedId?: string },
): GlossaryMutationResult {
  const nextDataset: GlossaryDataset = {
    ...dataset,
    generatedAt: new Date().toISOString(),
    terms: sortTerms(nextTerms),
  }

  return buildGlossaryMutationResult(nextDataset, options)
}

export function resolveGlossaryFilePath(workspaceRoot: string, version = 'v1.17'): string {
  return path.resolve(workspaceRoot, buildGlossaryFileRelativePath(version))
}

export async function readGlossaryDataset(filePath: string): Promise<GlossaryDataset> {
  const raw = await readGlossaryRaw(filePath)
  return normalizeGlossaryDataset(raw)
}

export async function createGlossaryTermInFile(filePath: string, draft: GlossaryTermDraft): Promise<GlossaryMutationResult> {
  const dataset = await readGlossaryDataset(filePath)
  const normalizedDraft = sanitizeGlossaryDraft(draft)
  const errors = validateGlossaryDraft(normalizedDraft, dataset.terms)

  if (hasGlossaryValidationError(errors)) {
    throw readGlossaryError(errors.source || errors.target || errors.form || '术语校验失败')
  }

  const term: GlossaryTerm = {
    id: `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ...normalizedDraft,
    updatedAt: new Date().toISOString(),
  }
  const result = applyMutation(dataset, [...dataset.terms, term], {
    message: '术语已创建',
    term,
  })

  await persistGlossaryDataset(filePath, result.dataset)
  return result
}

export async function updateGlossaryTermInFile(
  filePath: string,
  termId: string,
  draft: GlossaryTermDraft,
): Promise<GlossaryMutationResult> {
  const dataset = await readGlossaryDataset(filePath)
  const currentTerm = dataset.terms.find((term) => term.id === termId)

  if (!currentTerm) {
    throw readGlossaryError('未找到对应术语')
  }

  const normalizedDraft = sanitizeGlossaryDraft(draft)
  const errors = validateGlossaryDraft(normalizedDraft, dataset.terms, termId)

  if (hasGlossaryValidationError(errors)) {
    throw readGlossaryError(errors.source || errors.target || errors.form || '术语校验失败')
  }

  const updatedTerm: GlossaryTerm = {
    ...currentTerm,
    ...normalizedDraft,
    updatedAt: new Date().toISOString(),
  }
  const result = applyMutation(
    dataset,
    dataset.terms.map((term) => (term.id === termId ? updatedTerm : term)),
    {
      message: '术语已更新',
      term: updatedTerm,
    },
  )

  await persistGlossaryDataset(filePath, result.dataset)
  return result
}

export async function deleteGlossaryTermInFile(filePath: string, termId: string): Promise<GlossaryMutationResult> {
  const dataset = await readGlossaryDataset(filePath)
  const exists = dataset.terms.some((term) => term.id === termId)

  if (!exists) {
    throw readGlossaryError('未找到对应术语')
  }

  const result = applyMutation(
    dataset,
    dataset.terms.filter((term) => term.id !== termId),
    {
      message: '术语已删除',
      deletedId: termId,
    },
  )

  await persistGlossaryDataset(filePath, result.dataset)
  return result
}
