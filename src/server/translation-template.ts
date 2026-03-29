import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Handlebars from 'handlebars'
import { DEFAULT_TRANSLATION_TEMPLATE } from '../lib/translation-workbench-models'

export const TRANSLATION_WORKBENCH_ENV = {
  cliPath: 'TRANSLATION_WORKBENCH_CLAUDE_BIN',
  model: 'TRANSLATION_WORKBENCH_CLAUDE_MODEL',
  template: 'TRANSLATION_WORKBENCH_TEMPLATE',
} as const

export type TranslationPromptContext = {
  version: string
  relativePath: string
  targetPath: string
  sourceContent: string
  glossary: string
}

const templateCache = new Map<string, Handlebars.TemplateDelegate<TranslationPromptContext>>()

export function resolveTranslationTemplateName(env = process.env): string {
  const value = env[TRANSLATION_WORKBENCH_ENV.template]?.trim()
  return value || DEFAULT_TRANSLATION_TEMPLATE
}

export function resolveTranslationModel(env = process.env): string {
  return env[TRANSLATION_WORKBENCH_ENV.model]?.trim() || ''
}

export function resolveClaudeCliPath(env = process.env): string {
  return env[TRANSLATION_WORKBENCH_ENV.cliPath]?.trim() || 'claude'
}

export function resolvePromptTemplatePath(workspaceRoot: string, templateName = resolveTranslationTemplateName()): string {
  return path.join(workspaceRoot, 'repos', 'dapr-docs-copilot', 'prompts', 'translation', templateName)
}

export async function loadTranslationPromptTemplate(workspaceRoot: string, templateName = resolveTranslationTemplateName()) {
  const templatePath = resolvePromptTemplatePath(workspaceRoot, templateName)
  const cacheKey = `${templatePath}`
  const cached = templateCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const source = await readFile(templatePath, 'utf8')
  const compiled = Handlebars.compile<TranslationPromptContext>(source, { noEscape: true })
  templateCache.set(cacheKey, compiled)
  return compiled
}

export function formatGlossaryForPrompt(
  terms: Array<{ source: string; target: string; category?: string; status?: string }>,
): string {
  if (terms.length === 0) {
    return '- （空）'
  }

  return terms
    .map((term) => {
      const suffix = [term.category, term.status].filter(Boolean).join(' / ')
      return suffix ? `- ${term.source} => ${term.target} (${suffix})` : `- ${term.source} => ${term.target}`
    })
    .join('\n')
}

export async function renderTranslationPrompt(
  workspaceRoot: string,
  context: TranslationPromptContext,
  templateName = resolveTranslationTemplateName(),
): Promise<string> {
  const template = await loadTranslationPromptTemplate(workspaceRoot, templateName)
  return template(context)
}
