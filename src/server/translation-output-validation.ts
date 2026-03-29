export type TranslationOutputValidationRule =
  | 'source_frontmatter_unterminated'
  | 'target_frontmatter_unterminated'
  | 'missing_frontmatter_keys'
  | 'unexpected_frontmatter_keys'
  | 'heading_count_mismatch'
  | 'heading_level_mismatch'

export type TranslationOutputValidationInput = {
  fileId: string
  sourceContent: string
  candidateContent: string
  sourcePath?: string
  targetPath?: string
}

export type HeadingLevelMismatch = {
  index: number
  sourceLevel: number | null
  targetLevel: number | null
}

export type TranslationOutputValidationResult = {
  ok: boolean
  fileId: string
  sourcePath?: string
  targetPath?: string
  sourceFrontmatterKeys: string[]
  targetFrontmatterKeys: string[]
  missingFrontmatterKeys: string[]
  unexpectedFrontmatterKeys: string[]
  sourceHeadingCount: number
  targetHeadingCount: number
  sourceHeadingLevels: number[]
  targetHeadingLevels: number[]
  headingLevelMismatches: HeadingLevelMismatch[]
  triggeredRules: TranslationOutputValidationRule[]
  candidateContent: string
  summaryMessage: string
  diagnosticMessage: string
}

type FrontmatterInspection = {
  hasFrontmatter: boolean
  keys: string[]
  errorRule?: TranslationOutputValidationRule
  errorDetail?: string
}

const FRONTMATTER_BLOCK_PATTERN = /^(---\r?\n)([\s\S]*?)(\r?\n---)(?:\r?\n|$)/
const TOP_LEVEL_FRONTMATTER_KEY_PATTERN = /^([A-Za-z0-9_-]+)\s*:/
const ATX_HEADING_PATTERN = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/
const SETEXT_HEADING_PATTERN = /^ {0,3}(=+|-+)[ \t]*$/
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/

function normalizeLineEndings(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function formatList(values: Array<string | number>): string {
  return values.length > 0 ? values.join(',') : '(none)'
}

function formatHeadingMismatches(mismatches: HeadingLevelMismatch[]): string {
  if (mismatches.length === 0) {
    return '(none)'
  }

  return mismatches
    .map((mismatch) => `#${mismatch.index}:${mismatch.sourceLevel ?? 'missing'}->${mismatch.targetLevel ?? 'missing'}`)
    .join(',')
}

function inspectFrontmatter(text: string, unterminatedRule: TranslationOutputValidationRule): FrontmatterInspection {
  const normalized = normalizeLineEndings(text)
  const match = normalized.match(FRONTMATTER_BLOCK_PATTERN)
  if (!match) {
    if (normalized.startsWith('---\n')) {
      return {
        hasFrontmatter: true,
        keys: [],
        errorRule: unterminatedRule,
        errorDetail: 'frontmatter block starts with --- but has no closing delimiter',
      }
    }

    return {
      hasFrontmatter: false,
      keys: [],
    }
  }

  const seenKeys = new Set<string>()
  const keys: string[] = []
  for (const line of match[2].split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) {
      continue
    }

    const keyMatch = line.match(TOP_LEVEL_FRONTMATTER_KEY_PATTERN)
    if (!keyMatch) {
      continue
    }

    const key = keyMatch[1]
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      keys.push(key)
    }
  }

  return {
    hasFrontmatter: true,
    keys,
  }
}

function stripFrontmatter(text: string): string {
  const normalized = normalizeLineEndings(text)
  const match = normalized.match(FRONTMATTER_BLOCK_PATTERN)
  if (!match) {
    return normalized
  }

  return normalized.slice(match[0].length)
}

export function extractMarkdownHeadingLevels(text: string): number[] {
  const body = stripFrontmatter(text)
  const lines = body.split('\n')
  const headingLevels: number[] = []
  let activeFence: { marker: '`' | '~'; length: number } | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(FENCE_PATTERN)
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      const length = fenceMatch[1].length
      if (!activeFence) {
        activeFence = { marker, length }
        continue
      }

      if (activeFence.marker === marker && length >= activeFence.length) {
        activeFence = null
      }
      continue
    }

    if (activeFence) {
      continue
    }

    const atxHeading = line.match(ATX_HEADING_PATTERN)
    if (atxHeading) {
      headingLevels.push(atxHeading[1].length)
      continue
    }

    const nextLine = lines[index + 1]
    if (!line.trim() || nextLine === undefined) {
      continue
    }

    const setextHeading = nextLine.match(SETEXT_HEADING_PATTERN)
    if (!setextHeading) {
      continue
    }

    headingLevels.push(setextHeading[1].startsWith('=') ? 1 : 2)
    index += 1
  }

  return headingLevels
}

export function formatTranslationOutputValidationDiagnostic(result: TranslationOutputValidationResult): string {
  const lines = [
    `[translation-output-validation] ${result.ok ? 'PASSED' : 'FAILED'}`,
    `file: ${result.fileId}`,
    `source: ${result.sourcePath ?? '(unspecified)'}`,
    `target: ${result.targetPath ?? '(unspecified)'}`,
    `rules: ${formatList(result.triggeredRules)}`,
    `summary: ${result.summaryMessage}`,
    `sourceFrontmatterKeys: ${formatList(result.sourceFrontmatterKeys)}`,
    `targetFrontmatterKeys: ${formatList(result.targetFrontmatterKeys)}`,
    `missingFrontmatterKeys: ${formatList(result.missingFrontmatterKeys)}`,
    `unexpectedFrontmatterKeys: ${formatList(result.unexpectedFrontmatterKeys)}`,
    `sourceHeadingCount: ${result.sourceHeadingCount}`,
    `targetHeadingCount: ${result.targetHeadingCount}`,
    `sourceHeadingLevels: ${formatList(result.sourceHeadingLevels)}`,
    `targetHeadingLevels: ${formatList(result.targetHeadingLevels)}`,
    `headingLevelMismatches: ${formatHeadingMismatches(result.headingLevelMismatches)}`,
    'candidateContent:',
    result.candidateContent,
  ]

  return lines.join('\n')
}

export function validateTranslationOutput(input: TranslationOutputValidationInput): TranslationOutputValidationResult {
  const sourceFrontmatter = inspectFrontmatter(input.sourceContent, 'source_frontmatter_unterminated')
  const targetFrontmatter = inspectFrontmatter(input.candidateContent, 'target_frontmatter_unterminated')
  const sourceHeadingLevels = extractMarkdownHeadingLevels(input.sourceContent)
  const targetHeadingLevels = extractMarkdownHeadingLevels(input.candidateContent)
  const missingFrontmatterKeys = sourceFrontmatter.keys.filter((key) => !targetFrontmatter.keys.includes(key))
  const unexpectedFrontmatterKeys = targetFrontmatter.keys.filter((key) => !sourceFrontmatter.keys.includes(key))
  const headingLevelMismatches: HeadingLevelMismatch[] = []
  const comparedHeadingCount = Math.max(sourceHeadingLevels.length, targetHeadingLevels.length)

  for (let index = 0; index < comparedHeadingCount; index += 1) {
    const sourceLevel = sourceHeadingLevels[index] ?? null
    const targetLevel = targetHeadingLevels[index] ?? null
    if (sourceLevel !== targetLevel) {
      headingLevelMismatches.push({
        index: index + 1,
        sourceLevel,
        targetLevel,
      })
    }
  }

  const triggeredRules: TranslationOutputValidationRule[] = []
  const summaryParts: string[] = []

  if (sourceFrontmatter.errorRule) {
    triggeredRules.push(sourceFrontmatter.errorRule)
    summaryParts.push(`sourceFrontmatter=${sourceFrontmatter.errorDetail}`)
  }

  if (targetFrontmatter.errorRule) {
    triggeredRules.push(targetFrontmatter.errorRule)
    summaryParts.push(`targetFrontmatter=${targetFrontmatter.errorDetail}`)
  }

  if (missingFrontmatterKeys.length > 0) {
    triggeredRules.push('missing_frontmatter_keys')
    summaryParts.push(`missingFrontmatterKeys=${missingFrontmatterKeys.join(',')}`)
  }

  if (unexpectedFrontmatterKeys.length > 0) {
    triggeredRules.push('unexpected_frontmatter_keys')
    summaryParts.push(`unexpectedFrontmatterKeys=${unexpectedFrontmatterKeys.join(',')}`)
  }

  if (sourceHeadingLevels.length !== targetHeadingLevels.length) {
    triggeredRules.push('heading_count_mismatch')
    summaryParts.push(`headingCountMismatch=${sourceHeadingLevels.length}:${targetHeadingLevels.length}`)
  }

  if (headingLevelMismatches.length > 0) {
    triggeredRules.push('heading_level_mismatch')
    summaryParts.push(`headingLevelMismatchAt=${formatHeadingMismatches(headingLevelMismatches)}`)
  }

  const summaryMessage = summaryParts.length > 0 ? summaryParts.join(' ; ') : 'validation passed'
  const baseResult = {
    ok: triggeredRules.length === 0,
    fileId: input.fileId,
    sourcePath: input.sourcePath,
    targetPath: input.targetPath,
    sourceFrontmatterKeys: sourceFrontmatter.keys,
    targetFrontmatterKeys: targetFrontmatter.keys,
    missingFrontmatterKeys,
    unexpectedFrontmatterKeys,
    sourceHeadingCount: sourceHeadingLevels.length,
    targetHeadingCount: targetHeadingLevels.length,
    sourceHeadingLevels,
    targetHeadingLevels,
    headingLevelMismatches,
    triggeredRules,
    candidateContent: input.candidateContent,
    summaryMessage,
  }

  return {
    ...baseResult,
    diagnosticMessage: formatTranslationOutputValidationDiagnostic({
      ...baseResult,
      diagnosticMessage: '',
    }),
  }
}
