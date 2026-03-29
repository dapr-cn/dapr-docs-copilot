import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizeMarkdownAliases } from './translation-alias-localization'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown'])
const VERSION_SUFFIX = '_zh'

export type TranslationAliasBackfillOptions = {
  workspaceRoot: string
  versions?: string[]
  dryRun?: boolean
}

export type TranslationAliasBackfillRepoResult = {
  version: string
  repoPath: string
  scannedFiles: number
  updatedFiles: number
}

export type TranslationAliasBackfillResult = {
  dryRun: boolean
  repos: TranslationAliasBackfillRepoResult[]
  scannedFiles: number
  updatedFiles: number
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep)
}

async function collectMarkdownFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(absolutePath)))
      continue
    }

    if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath)
    }
  }

  return files.sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

async function resolveTargetRepos(workspaceRoot: string, versions?: string[]): Promise<Array<{ version: string; repoPath: string }>> {
  const reposRoot = path.join(workspaceRoot, 'repos')
  const entries = await readdir(reposRoot, { withFileTypes: true })
  const versionFilter = versions && versions.length > 0 ? new Set(versions) : null

  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(VERSION_SUFFIX))
    .map((entry) => ({
      version: entry.name.slice(0, -VERSION_SUFFIX.length),
      repoPath: path.join(reposRoot, entry.name),
    }))
    .filter((entry) => (versionFilter ? versionFilter.has(entry.version) : true))
    .sort((left, right) => left.version.localeCompare(right.version, 'zh-CN'))
}

export async function backfillTranslatedAliases(options: TranslationAliasBackfillOptions): Promise<TranslationAliasBackfillResult> {
  const repos = await resolveTargetRepos(options.workspaceRoot, options.versions)
  const results: TranslationAliasBackfillRepoResult[] = []
  let scannedFiles = 0
  let updatedFiles = 0

  for (const repo of repos) {
    const translatedRoot = path.join(repo.repoPath, 'translated_content', 'zh_CN')
    let repoScannedFiles = 0
    let repoUpdatedFiles = 0

    try {
      const markdownFiles = await collectMarkdownFiles(translatedRoot)
      for (const filePath of markdownFiles) {
        repoScannedFiles += 1
        const source = await readFile(filePath, 'utf8')
        const targetPath = toPosixPath(path.relative(repo.repoPath, filePath))
        const normalized = normalizeMarkdownAliases(source, targetPath)
        if (normalized === source) {
          continue
        }

        repoUpdatedFiles += 1
        if (!options.dryRun) {
          await writeFile(filePath, normalized, 'utf8')
        }
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code !== 'ENOENT') {
        throw error
      }
    }

    scannedFiles += repoScannedFiles
    updatedFiles += repoUpdatedFiles
    results.push({
      version: repo.version,
      repoPath: repo.repoPath,
      scannedFiles: repoScannedFiles,
      updatedFiles: repoUpdatedFiles,
    })
  }

  return {
    dryRun: options.dryRun ?? false,
    repos: results,
    scannedFiles,
    updatedFiles,
  }
}
