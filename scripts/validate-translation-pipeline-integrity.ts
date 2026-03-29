import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { buildPipeline } from '../../../scripts/zh-data/sync_source_documents.ts'
import { createTranslationWorkbenchAdmin } from '../src/server/translation-workbench-admin'
import { auditTranslationIntegrity, readTranslationIntegrityBundle, repairTranslationIntegrity } from '../src/server/translation-integrity-audit'

async function writeText(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'translation-pipeline-'))
  const sourceRepo = path.join(workspaceRoot, 'repos', 'v9.99')
  const zhRepo = path.join(workspaceRoot, 'repos', 'v9.99_zh')
  const promptDir = path.join(workspaceRoot, 'repos', 'dapr-docs-copilot', 'prompts', 'translation')

  await writeText(
    path.join(sourceRepo, 'hugo.yaml'),
    [
      'module:',
      '  mounts:',
      '    - source: daprdocs/content/en',
      '      target: content',
      '      lang: en',
      '    - source: translations/docs-zh/translated_content/zh_CN/docs',
      '      target: content',
      '      lang: zh-hans',
    ].join('\n'),
  )
  await writeText(path.join(sourceRepo, 'daprdocs/content/en/alpha.md'), '# Alpha\nworkflow\n')
  await writeText(path.join(promptDir, 'claude-default.hbs'), '目标：{{targetPath}}\n{{glossary}}\n{{sourceContent}}\n')
  await mkdir(path.join(zhRepo, 'translated_content', 'zh_CN', 'docs'), { recursive: true })

  return {
    workspaceRoot,
    sourceRepo,
    zhRepo,
    version: 'v9.99',
    async cleanup() {
      await rm(workspaceRoot, { recursive: true, force: true })
    },
  }
}

async function waitForJobToStop(admin: ReturnType<typeof createTranslationWorkbenchAdmin>, jobId: string) {
  for (let index = 0; index < 100; index += 1) {
    const job = admin.getJob(jobId)
    if (!job.isActive) {
      return job
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error(`job timeout: ${jobId}`)
}

async function main() {
  const workspace = await createWorkspace()
  try {
    await buildPipeline({
      sourceRepo: workspace.sourceRepo,
      zhRepo: workspace.zhRepo,
      hugoConfigPath: path.join(workspace.sourceRepo, 'hugo.yaml'),
      version: workspace.version,
      generatedAt: '2026-03-29T00:00:00.000Z',
    })

    let bundle = await readTranslationIntegrityBundle(workspace.zhRepo, workspace.version)
    assert.equal(bundle.syncStatus.items[0]?.translationStatus, 'missingTranslation')
    assert.equal(bundle.integrityReport.totalFindings, 0)

    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async () => '# Alpha\nworkflow zh\n',
    })
    const files = await admin.listFiles(workspace.version)
    const created = await admin.createJob({ version: workspace.version, fileIds: files.files.map((file) => file.id) })
    const finished = await waitForJobToStop(admin, created.jobId)
    assert.equal(finished.counts.completed, 1)

    bundle = await readTranslationIntegrityBundle(workspace.zhRepo, workspace.version)
    assert.equal(bundle.syncStatus.items[0]?.translationStatus, 'translated')
    assert.equal(bundle.source.buckets[0]?.translatedCount, 1)
    assert.equal(bundle.copyLog.batches.length, 0)
    assert.equal(bundle.integrityReport.totalFindings, 0)
    await assert.rejects(
      () => readFile(path.join(workspace.zhRepo, 'data', 'copy-log.json'), 'utf8'),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    )

    await buildPipeline({
      sourceRepo: workspace.sourceRepo,
      zhRepo: workspace.zhRepo,
      hugoConfigPath: path.join(workspace.sourceRepo, 'hugo.yaml'),
      version: workspace.version,
      generatedAt: '2026-03-29T01:00:00.000Z',
    })

    bundle = await readTranslationIntegrityBundle(workspace.zhRepo, workspace.version)
    assert.equal(bundle.syncStatus.items[0]?.translationStatus, 'translated')
    assert.equal(bundle.copyLog.batches.length, 0)
    await assert.rejects(
      () => readFile(path.join(workspace.zhRepo, 'data', 'copy-log.json'), 'utf8'),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    )

    const syncStatusPath = path.join(workspace.zhRepo, 'data', 'sync-status.json')
    const sourcePath = path.join(workspace.zhRepo, 'data', 'source.json')
    const copyLogPath = path.join(workspace.zhRepo, 'data', 'copy-log.json')

    const syncStatus = JSON.parse(await readFile(syncStatusPath, 'utf8')) as { items: Array<Record<string, unknown>> }
    syncStatus.items[0] = { ...syncStatus.items[0], translationStatus: 'staleTranslation' }
    await writeFile(syncStatusPath, `${JSON.stringify(syncStatus, null, 2)}\n`, 'utf8')

    const source = JSON.parse(await readFile(sourcePath, 'utf8')) as { buckets: Array<Record<string, unknown>> }
    source.buckets[0] = { ...source.buckets[0], translatedCount: 0, staleTranslationCount: 1 }
    await writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`, 'utf8')

    await writeFile(
      copyLogPath,
      `${JSON.stringify(
        {
          version: workspace.version,
          generatedAt: '2026-03-29T01:00:00.000Z',
          batches: [
            {
              id: 'batch-seeded',
              sourceRepo: 'repos/v9.99',
              sourceBranch: workspace.version,
              copiedAt: '2026-03-29T01:00:00.000Z',
              documentCount: 1,
              bucketCount: 1,
              failureCount: 0,
              status: 'completed',
              statusSummary: {
                synced: 1,
                drift: 0,
                missingSource: 0,
              },
              translationSummary: {
                translated: 0,
                staleTranslation: 1,
                missingTranslation: 0,
                orphanTranslation: 0,
              },
              failures: [],
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const audited = await auditTranslationIntegrity(workspace.zhRepo, workspace.version)
    assert.ok(audited.integrityReport.totalFindings >= 3)
    assert.ok(audited.integrityReport.findings.some((finding) => finding.type === 'syncStatusConflict'))
    assert.ok(audited.integrityReport.findings.some((finding) => finding.type === 'sourceSummaryMismatch'))
    assert.ok(audited.integrityReport.findings.some((finding) => finding.type === 'copyLogSummaryMismatch'))

    await repairTranslationIntegrity(workspace.zhRepo, workspace.version)
    bundle = await readTranslationIntegrityBundle(workspace.zhRepo, workspace.version)
    assert.equal(bundle.syncStatus.items[0]?.translationStatus, 'translated')
    assert.equal(bundle.source.buckets[0]?.translatedCount, 1)
    assert.equal(bundle.copyLog.batches.length, 0)
    assert.equal(bundle.integrityReport.totalFindings, 0)
    await assert.rejects(
      () => readFile(copyLogPath, 'utf8'),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    )

    console.log('validated translation pipeline integrity path')
  } finally {
    await workspace.cleanup()
  }
}

void main()
