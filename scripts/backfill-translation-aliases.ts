import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backfillTranslatedAliases } from '../src/server/translation-alias-backfill'

type CliOptions = {
  dryRun: boolean
  versions: string[]
  workspaceRoot: string
}

function parseArgs(argv: string[]): CliOptions {
  const defaultWorkspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const options: CliOptions = {
    dryRun: false,
    versions: [],
    workspaceRoot: defaultWorkspaceRoot,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (value === '--version') {
      const version = argv[index + 1]
      if (!version) {
        throw new Error('`--version` 缺少值')
      }
      options.versions.push(version)
      index += 1
      continue
    }

    if (value === '--workspace-root') {
      const workspaceRoot = argv[index + 1]
      if (!workspaceRoot) {
        throw new Error('`--workspace-root` 缺少值')
      }
      options.workspaceRoot = path.resolve(workspaceRoot)
      index += 1
      continue
    }

    throw new Error(`不支持的参数：${value}`)
  }

  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = await backfillTranslatedAliases(options)

  console.info(
    `[translation-alias-backfill] mode=${result.dryRun ? 'dry-run' : 'write'} scanned=${result.scannedFiles} updated=${result.updatedFiles}`,
  )

  for (const repo of result.repos) {
    console.info(
      `[translation-alias-backfill] version=${repo.version} scanned=${repo.scannedFiles} updated=${repo.updatedFiles} repo=${repo.repoPath}`,
    )
  }
}

void main().catch((error) => {
  console.error('[translation-alias-backfill] failed', error)
  process.exitCode = 1
})
