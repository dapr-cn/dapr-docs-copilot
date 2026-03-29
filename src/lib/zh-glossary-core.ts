import type {
  GlossaryDataset,
  GlossaryMutationResult,
  GlossaryReadOnlyState,
  GlossaryTerm,
  GlossaryTermDraft,
  GlossaryValidationErrors,
} from './zh-data-models'

type UnknownRecord = Record<string, unknown>

type NormalizeGlossaryOptions = {
  readOnlyState?: GlossaryReadOnlyState
  fallbackVersion?: string
  fallbackGeneratedAt?: string
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function trimField(value: unknown): string {
  return readString(value).trim()
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createLegacyGlossaryId(term: GlossaryTermDraft, index: number): string {
  const identity = `${term.source}\u0000${term.target}\u0000${term.notes}\u0000${index}`
  return `term-${hashString(identity)}`
}

export function sanitizeGlossaryDraft(draft: GlossaryTermDraft): GlossaryTermDraft {
  return {
    source: draft.source.trim(),
    target: draft.target.trim(),
    notes: draft.notes.trim(),
  }
}

export function normalizeGlossaryTerm(term: unknown, index: number): GlossaryTerm | null {
  if (!isObject(term)) {
    return null
  }

  const normalized = sanitizeGlossaryDraft({
    source: trimField(term.source),
    target: trimField(term.target),
    notes: trimField(term.notes),
  })

  if (!normalized.source || !normalized.target) {
    return null
  }

  const id = trimField(term.id) || createLegacyGlossaryId(normalized, index)
  const updatedAt = trimField(term.updatedAt)

  return {
    id,
    source: normalized.source,
    target: normalized.target,
    notes: normalized.notes,
    updatedAt: updatedAt || undefined,
  }
}

export function normalizeGlossaryDataset(raw: unknown, options: NormalizeGlossaryOptions = {}): GlossaryDataset {
  const readOnlyState = options.readOnlyState ?? { mode: 'writable' }

  if (!isObject(raw)) {
    return {
      version: options.fallbackVersion ?? 'v1.17',
      generatedAt: options.fallbackGeneratedAt ?? '',
      terms: [],
      readOnlyState,
    }
  }

  const terms = readArray<unknown>(raw.terms)
    .map((term, index) => normalizeGlossaryTerm(term, index))
    .filter((term): term is GlossaryTerm => Boolean(term))

  return {
    version: readString(raw.version, options.fallbackVersion ?? 'v1.17'),
    generatedAt: readString(raw.generatedAt, options.fallbackGeneratedAt ?? ''),
    terms,
    readOnlyState,
  }
}

function normalizeSourceKey(source: string): string {
  return source.trim().toLocaleLowerCase('en-US')
}

export function validateGlossaryDraft(
  draft: GlossaryTermDraft,
  terms: GlossaryTerm[],
  currentId?: string,
): GlossaryValidationErrors {
  const normalized = sanitizeGlossaryDraft(draft)
  const errors: GlossaryValidationErrors = {}

  if (!normalized.source) {
    errors.source = '英文术语必填'
  }

  if (!normalized.target) {
    errors.target = '中文术语必填'
  }

  if (normalized.source) {
    const sourceKey = normalizeSourceKey(normalized.source)
    const duplicated = terms.some((term) => term.id !== currentId && normalizeSourceKey(term.source) === sourceKey)

    if (duplicated) {
      errors.source = '英文术语重复'
    }
  }

  return errors
}

export function hasGlossaryValidationError(errors: GlossaryValidationErrors): boolean {
  return Object.values(errors).some(Boolean)
}

export function createReadOnlyGlossaryState(reason: string): GlossaryReadOnlyState {
  return {
    mode: 'read-only',
    reason,
  }
}

export function buildGlossaryMutationResult(
  dataset: GlossaryDataset,
  options: { message?: string; term?: GlossaryTerm; deletedId?: string } = {},
): GlossaryMutationResult {
  return {
    dataset,
    message: options.message,
    term: options.term,
    deletedId: options.deletedId,
  }
}
