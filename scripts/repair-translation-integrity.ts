import path from 'node:path'
import { parseArgs } from 'node:util'
import { auditTranslationIntegrity, readTranslationIntegrityBundle, repairTranslationIntegrity } from '../src/server/translation-integrity-audit'

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string', default: 'v1.17' },
      repo: { type: 'string' },
      mode: { type: 'string', default: 'repair' },
      timestamp: { type: 'string' },
    },
  })

  const version = values.version ?? 'v1.17'
  const repo = values.repo ?? path.join('..', `${version}_zh`)
  const mode = values.mode === 'audit' ? 'audit' : 'repair'
  return {
    version,
    repoPath: path.resolve(process.cwd(), repo),
    mode,
    generatedAt: values.timestamp,
  }
}

async function main() {
  const options = parseCliArgs()
  const action = options.mode === 'audit' ? auditTranslationIntegrity : repairTranslationIntegrity
  const result = await action(options.repoPath, options.version, { generatedAt: options.generatedAt })
  const current = await readTranslationIntegrityBundle(options.repoPath, options.version)

  console.log(
    JSON.stringify(
      {
        mode: options.mode,
        version: options.version,
        repoPath: options.repoPath,
        generatedAt: result.integrityReport.generatedAt,
        totalFindings: result.integrityReport.totalFindings,
        categories: result.integrityReport.categories,
        sourceSummary: current.syncStatus.sourceSummary,
        translationSummary: current.syncStatus.translationSummary,
      },
      null,
      2,
    ),
  )
}

void main()
