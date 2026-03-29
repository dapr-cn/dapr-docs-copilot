import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { access, readFile, readdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  type SourceItem,
  type SyncStatusItem,
  isMarkdownFile,
  resolveTranslationTargetPath,
} from '../src/server/translation-workbench-admin'
import { validateTranslationOutput } from '../src/server/translation-output-validation'

type SyncStatusPayload = {
  version?: string
  items?: SyncStatusItem[]
}

type SourcePayload = {
  version?: string
  items?: SourceItem[]
}

type ValidationPair = {
  fileId: string
  sourcePath: string
  targetPath: string
  sourceDisplayPath: string
  targetDisplayPath: string
}

type ExplicitMode = {
  mode: 'explicit'
  workspaceRoot: string
  sourcePath: string
  targetPath: string
}

type BatchMode = {
  mode: 'batch'
  workspaceRoot: string
  version: string
  buckets: string[]
  relativePaths: string[]
}

type CliMode = ExplicitMode | BatchMode

class CliUsageError extends Error {}

function printUsage() {
  console.log(`用法:
  单文件: validate-translation-output --source <path> --target <path>
  批量版: validate-translation-output --version <id> [--bucket <name>] [--relative-path <path>]...

可选:
  --workspace-root <path>   指定 monorepo 根目录，默认按脚本位置回推
  --help                    显示帮助`)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

function resolveDefaultWorkspaceRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

function toDisplayPath(filePath: string, workspaceRoot: string): string {
  const relativePath = path.relative(workspaceRoot, filePath)
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath.split(path.sep).join('/')
  }

  return filePath.split(path.sep).join('/')
}

function parseCli(argv: string[]): CliMode | null {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      version: { type: 'string' },
      bucket: { type: 'string', multiple: true },
      'relative-path': { type: 'string', multiple: true },
      'workspace-root': { type: 'string' },
      help: { type: 'boolean' },
    },
  })

  if (values.help) {
    return null
  }

  if (positionals.length > 0) {
    throw new CliUsageError(`存在未识别参数：${positionals.join(' ')}`)
  }

  const workspaceRoot = path.resolve(values['workspace-root'] ?? resolveDefaultWorkspaceRoot())
  const hasExplicit = Boolean(values.source || values.target)
  const hasBatch = Boolean(values.version)

  if (hasExplicit && hasBatch) {
    throw new CliUsageError('`--source/--target` 与 `--version` 不可并用')
  }

  if (hasExplicit) {
    if (!values.source || !values.target) {
      throw new CliUsageError('单文件模式必须同时提供 `--source` 与 `--target`')
    }

    return {
      mode: 'explicit',
      workspaceRoot,
      sourcePath: path.resolve(values.source),
      targetPath: path.resolve(values.target),
    }
  }

  if (hasBatch && values.version) {
    return {
      mode: 'batch',
      workspaceRoot,
      version: values.version,
      buckets: values.bucket ?? [],
      relativePaths: values['relative-path'] ?? [],
    }
  }

  throw new CliUsageError('需提供 `--source/--target` 或 `--version`')
}

async function resolveVersionRepoPath(workspaceRoot: string, version: string): Promise<string> {
  const reposRoot = path.join(workspaceRoot, 'repos')
  const entries = await readdir(reposRoot, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('_zh')) {
      continue
    }

    const repoPath = path.join(reposRoot, entry.name)
    const syncStatusPath = path.join(repoPath, 'data', 'sync-status.json')
    if (!(await pathExists(syncStatusPath))) {
      continue
    }

    const syncStatus = await readJsonFile<SyncStatusPayload>(syncStatusPath)
    if (syncStatus.version === version) {
      return repoPath
    }
  }

  throw new CliUsageError(`未找到版本：${version}`)
}

async function resolveBatchPairs(mode: BatchMode): Promise<ValidationPair[]> {
  const repoPath = await resolveVersionRepoPath(mode.workspaceRoot, mode.version)
  const dataRoot = path.join(repoPath, 'data')
  const [source, syncStatus] = await Promise.all([
    readJsonFile<SourcePayload>(path.join(dataRoot, 'source.json')),
    readJsonFile<SyncStatusPayload>(path.join(dataRoot, 'sync-status.json')),
  ])
  const syncStatusMap = new Map(
    (syncStatus.items ?? []).map((item) => [`${item.bucket}::${item.relativePath}`, item] satisfies [string, SyncStatusItem]),
  )
  const bucketFilter = new Set(mode.buckets)
  const relativePathFilter = new Set(mode.relativePaths)
  const pairs: ValidationPair[] = []

  for (const item of source.items ?? []) {
    if (mode.buckets.length > 0 && !bucketFilter.has(item.bucket)) {
      continue
    }

    if (mode.relativePaths.length > 0 && !relativePathFilter.has(item.relativePath)) {
      continue
    }

    if (!isMarkdownFile(item.mimeType, item.relativePath)) {
      continue
    }

    const syncItem =
      syncStatusMap.get(`${item.bucket}::${item.relativePath}`) ??
      ({
        bucket: item.bucket,
        relativePath: item.relativePath,
        sourcePath: item.sourcePath,
        sourceFile: item.sourceFile,
        translationFile: '',
        translationStatus: 'missingTranslation',
      } satisfies SyncStatusItem)

    const sourceDisplayPath = item.sourceFile || path.posix.join('data', 'source', item.bucket, item.relativePath)
    const targetDisplayPath = resolveTranslationTargetPath(syncItem)
    const sourcePath = path.join(repoPath, sourceDisplayPath)
    const targetPath = path.join(repoPath, targetDisplayPath)

    if (!(await pathExists(targetPath))) {
      continue
    }

    pairs.push({
      fileId: `${item.bucket}/${item.relativePath}`,
      sourcePath,
      targetPath,
      sourceDisplayPath,
      targetDisplayPath,
    })
  }

  if (pairs.length === 0) {
    const filters = [
      mode.buckets.length > 0 ? `bucket=${mode.buckets.join(',')}` : '',
      mode.relativePaths.length > 0 ? `relativePath=${mode.relativePaths.join(',')}` : '',
    ]
      .filter(Boolean)
      .join(' ')
    throw new CliUsageError(`未解析到可校验的 Markdown 译文${filters ? `：${filters}` : ''}`)
  }

  return pairs.sort((left, right) => left.fileId.localeCompare(right.fileId, 'zh-CN'))
}

async function resolvePairs(mode: CliMode): Promise<ValidationPair[]> {
  if (mode.mode === 'explicit') {
    return [
      {
        fileId: toDisplayPath(mode.targetPath, mode.workspaceRoot),
        sourcePath: mode.sourcePath,
        targetPath: mode.targetPath,
        sourceDisplayPath: toDisplayPath(mode.sourcePath, mode.workspaceRoot),
        targetDisplayPath: toDisplayPath(mode.targetPath, mode.workspaceRoot),
      },
    ]
  }

  return resolveBatchPairs(mode)
}

async function validatePair(pair: ValidationPair) {
  const [sourceContent, candidateContent] = await Promise.all([
    readFile(pair.sourcePath, 'utf8'),
    readFile(pair.targetPath, 'utf8'),
  ])

  return validateTranslationOutput({
    fileId: pair.fileId,
    sourceContent,
    candidateContent,
    sourcePath: pair.sourceDisplayPath,
    targetPath: pair.targetDisplayPath,
  })
}

async function main() {
  const mode = parseCli(process.argv.slice(2))
  if (!mode) {
    printUsage()
    return
  }

  const pairs = await resolvePairs(mode)
  let passed = 0
  let failed = 0

  for (const pair of pairs) {
    const result = await validatePair(pair)
    if (result.ok) {
      passed += 1
      console.log(`PASS ${pair.fileId}`)
      continue
    }

    failed += 1
    console.log(`FAIL ${pair.fileId}`)
    console.error(result.diagnosticMessage)
  }

  const exitCode = failed > 0 ? 1 : 0
  console.log(
    `SUMMARY ${JSON.stringify({
      mode: mode.mode,
      version: mode.mode === 'batch' ? mode.version : undefined,
      total: pairs.length,
      passed,
      failed,
      exitCode,
    })}`,
  )
  process.exitCode = exitCode
}

try {
  await main()
} catch (error) {
  if (error instanceof CliUsageError) {
    console.error(error.message)
    printUsage()
    process.exitCode = 2
  } else if (error instanceof Error) {
    console.error(error.message)
    process.exitCode = 2
  } else {
    console.error('未知错误')
    process.exitCode = 2
  }
}
