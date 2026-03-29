import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createTranslationWorkbenchAdmin } from '../src/server/translation-workbench-admin'

type WorkspaceOptions = {
  withTemplate?: boolean
  docs?: Array<{
    relativePath: string
    sizeBytes: number
    body: string | Buffer
    mimeType?: string
  }>
}

function sha256Text(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function createWorkspace({ withTemplate = true, docs }: WorkspaceOptions = {}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'translation-workbench-'))
  const appPromptDir = path.join(workspaceRoot, 'repos', 'dapr-docs-copilot', 'prompts', 'translation')
  const repoRoot = path.join(workspaceRoot, 'repos', 'v9.99_zh')
  const dataRoot = path.join(repoRoot, 'data')
  const sourceRoot = path.join(repoRoot, 'data', 'source', 'docs')
  const targetRoot = path.join(repoRoot, 'translated_content', 'zh_CN', 'docs')
  const defaultDocs = [
    { relativePath: 'alpha.md', sizeBytes: 12, body: '# Alpha\nworkflow\n' },
    { relativePath: 'beta.md', sizeBytes: 10, body: '# Beta\nworkflow\n' },
    { relativePath: 'gamma.md', sizeBytes: 14, body: '# Gamma\nworkflow\n' },
    { relativePath: 'delta.md', sizeBytes: 16, body: '# Delta\nworkflow\n' },
  ]
  const effectiveDocs = docs ?? defaultDocs

  await mkdir(sourceRoot, { recursive: true })
  await mkdir(targetRoot, { recursive: true })
  if (withTemplate) {
    await mkdir(appPromptDir, { recursive: true })
    await writeFile(path.join(appPromptDir, 'claude-default.hbs'), '目标：{{targetPath}}\n{{glossary}}\n{{sourceContent}}\n', 'utf8')
  }

  const syncStatus = {
    version: 'v9.99',
    generatedAt: '2026-03-28T00:00:00.000Z',
    syncedAt: '2026-03-28T00:00:00.000Z',
    items: effectiveDocs.map((doc) => ({
      version: 'v9.99',
      bucket: 'docs',
      relativePath: doc.relativePath,
      sourcePath: `docs/${doc.relativePath}`,
      sourceFile: `data/source/docs/${doc.relativePath}`,
      sourceSha256: sha256Text(doc.body),
      translationStatus: 'missingTranslation',
      translationFile: `translated_content/zh_CN/docs/${doc.relativePath}`,
      syncedAt: '2026-03-28T00:00:00.000Z',
    })),
  }

  const source = {
    version: 'v9.99',
    items: effectiveDocs.map((doc) => ({
      bucket: 'docs',
      relativePath: doc.relativePath,
      sourcePath: `docs/${doc.relativePath}`,
      sourceFile: `data/source/docs/${doc.relativePath}`,
      sourceSha256: sha256Text(doc.body),
      mimeType: doc.mimeType ?? 'text/markdown',
      sizeBytes: doc.sizeBytes,
    })),
  }

  const glossary = {
    version: 'v9.99',
    terms: [
      {
        source: 'workflow',
        target: '工作流',
        category: 'product',
        status: 'approved',
      },
    ],
  }

  await mkdir(dataRoot, { recursive: true })
  await writeFile(path.join(dataRoot, 'sync-status.json'), JSON.stringify(syncStatus, null, 2), 'utf8')
  await writeFile(path.join(dataRoot, 'source.json'), JSON.stringify(source, null, 2), 'utf8')
  await writeFile(path.join(dataRoot, 'glossary.json'), JSON.stringify(glossary, null, 2), 'utf8')
  await Promise.all(effectiveDocs.map((doc) => writeFile(path.join(sourceRoot, doc.relativePath), doc.body)))

  return {
    workspaceRoot,
    async cleanup() {
      await rm(workspaceRoot, { recursive: true, force: true })
    },
  }
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

function createTranslatedMarkdown(label: string): string {
  return [`# ${label}`, '', 'workflow zh', ''].join('\n')
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

async function waitForCondition(check: () => boolean, label: string) {
  for (let index = 0; index < 100; index += 1) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error(`condition timeout: ${label}`)
}

async function validateEmptySelection() {
  const workspace = await createWorkspace()
  try {
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async () => 'noop',
    })

    await assert.rejects(
      () => admin.createJob({ version: 'v9.99', fileIds: [] }),
      (error: unknown) => error instanceof Error && error.message === '至少选择一个待翻译文件',
    )
  } finally {
    await workspace.cleanup()
  }
}

async function validateMissingTemplate() {
  const workspace = await createWorkspace({ withTemplate: false })
  try {
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async () => 'never-used',
    })

    const files = await admin.listFiles('v9.99')
    const job = await admin.createJob({ version: 'v9.99', fileIds: [files.files[0].id] })
    const completed = await waitForJobToStop(admin, job.jobId)
    assert.equal(completed.items[0].status, 'failed')
    assert.equal(completed.items[0].error?.code, 'template_not_found')
  } finally {
    await workspace.cleanup()
  }
}

async function validateInvalidConcurrency() {
  const workspace = await createWorkspace()
  try {
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async () => 'noop',
    })

    const files = await admin.listFiles('v9.99')
    await assert.rejects(
      () => admin.createJob({ version: 'v9.99', fileIds: [files.files[0].id], concurrency: 0 }),
      (error: unknown) => error instanceof Error && error.message === '并发数量仅支持 1-10 的整数',
    )
    await assert.rejects(
      () => admin.createJob({ version: 'v9.99', fileIds: [files.files[0].id], concurrency: 1.5 }),
      (error: unknown) => error instanceof Error && error.message === '并发数量仅支持 1-10 的整数',
    )
  } finally {
    await workspace.cleanup()
  }
}

async function validateRetrySingleFile() {
  const workspace = await createWorkspace()
  try {
    const attempts = new Map<string, number>()
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async ({ file }) => {
        const nextAttempt = (attempts.get(file.id) ?? 0) + 1
        attempts.set(file.id, nextAttempt)
        if (nextAttempt === 1) {
          throw new Error('first failure')
        }
        return createTranslatedMarkdown(`translated:${file.relativePath}`)
      },
    })

    const files = await admin.listFiles('v9.99')
    const job = await admin.createJob({ version: 'v9.99', fileIds: [files.files[0].id] })
    const failed = await waitForJobToStop(admin, job.jobId)
    assert.equal(failed.items[0].status, 'failed')

    const retried = await admin.retryJobItem(job.jobId, failed.items[0].id)
    assert.equal(retried.concurrency, 3)
    assert.equal(retried.items[0].attempts, 2)
    assert.ok(['waiting', 'translating'].includes(retried.items[0].status))
    const completed = await waitForJobToStop(admin, job.jobId)
    assert.equal(completed.items[0].status, 'completed')
    assert.equal(completed.items[0].attempts, 2)

    const output = await readFile(path.join(workspace.workspaceRoot, 'repos', 'v9.99_zh', completed.items[0].targetPath), 'utf8')
    assert.match(output, /# translated:alpha\.md/)
  } finally {
    await workspace.cleanup()
  }
}

async function validateDefaultConcurrencyFlow() {
  const workspace = await createWorkspace()
  try {
    const gate = createDeferred()
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async ({ file }) => {
        order.push(`start:${file.relativePath}`)
        active += 1
        maxActive = Math.max(maxActive, active)
        await gate.promise
        active -= 1
        order.push(`end:${file.relativePath}`)
        return createTranslatedMarkdown(`done:${file.relativePath}`)
      },
    })

    const files = await admin.listFiles('v9.99')
    const created = await admin.createJob({ version: 'v9.99', fileIds: files.files.map((file) => file.id) })
    assert.equal(created.concurrency, 3)
    assert.equal(created.counts.translating, 3)
    assert.equal(created.counts.waiting, files.files.length - 3)
    await waitForCondition(() => maxActive === 3, 'default concurrency reaches 3 active workers')
    assert.equal(maxActive, 3)
    assert.deepEqual(order.slice(0, 3), ['start:alpha.md', 'start:beta.md', 'start:delta.md'])

    gate.resolve()
    const finished = await waitForJobToStop(admin, created.jobId)
    assert.equal(finished.counts.completed, files.files.length)
    assert.equal(finished.counts.failed, 0)
  } finally {
    await workspace.cleanup()
  }
}

async function validateConfiguredConcurrencyFlow() {
  const workspace = await createWorkspace()
  try {
    const gate = createDeferred()
    let active = 0
    let maxActive = 0
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async ({ file }) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await gate.promise
        active -= 1
        return createTranslatedMarkdown(`done:${file.relativePath}`)
      },
    })

    const files = await admin.listFiles('v9.99')
    const created = await admin.createJob({
      version: 'v9.99',
      fileIds: files.files.slice(0, 3).map((file) => file.id),
      concurrency: 2,
    })
    assert.equal(created.concurrency, 2)
    assert.equal(created.counts.translating, 2)
    assert.equal(created.counts.waiting, 1)
    await waitForCondition(() => maxActive === 2, 'custom concurrency reaches 2 active workers')
    assert.equal(maxActive, 2)

    gate.resolve()
    const finished = await waitForJobToStop(admin, created.jobId)
    assert.equal(finished.counts.completed, 3)
  } finally {
    await workspace.cleanup()
  }
}

async function validateShaMatchedTranslationSurvivesResync() {
  const workspace = await createWorkspace()
  try {
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async () => 'noop',
    })
    const repoRoot = path.join(workspace.workspaceRoot, 'repos', 'v9.99_zh')
    const dataRoot = path.join(repoRoot, 'data')
    const targetPath = path.join(repoRoot, 'translated_content', 'zh_CN', 'docs', 'alpha.md')
    const alphaBody = '# Alpha\nworkflow\n'
    const alphaSha = sha256Text(alphaBody)

    await writeFile(targetPath, '# Alpha CN\n工作流\n', 'utf8')
    await writeFile(
      path.join(dataRoot, 'translation-state.json'),
      JSON.stringify(
        {
          version: 'v9.99',
          generatedAt: '2099-01-01T00:00:00.000Z',
          items: [
            {
              bucket: 'docs',
              relativePath: 'alpha.md',
              sourceSha256: alphaSha,
              targetPath: 'translated_content/zh_CN/docs/alpha.md',
              translatedAt: '2026-03-28T01:00:00.000Z',
              updatedAt: '2026-03-28T01:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const syncStatusPath = path.join(dataRoot, 'sync-status.json')
    const syncStatus = JSON.parse(await readFile(syncStatusPath, 'utf8')) as {
      syncedAt: string
      items: Array<Record<string, unknown>>
    }
    syncStatus.syncedAt = '2099-01-01T00:00:00.000Z'
    syncStatus.items = syncStatus.items.map((item) =>
      item.relativePath === 'alpha.md'
        ? {
            ...item,
            translationStatus: 'staleTranslation',
            syncedAt: '2099-01-01T00:00:00.000Z',
          }
        : item,
    )
    await writeFile(syncStatusPath, JSON.stringify(syncStatus, null, 2), 'utf8')

    const files = await admin.listFiles('v9.99')
    assert.ok(!files.files.some((file) => file.relativePath === 'alpha.md'))

    const versions = await admin.listVersions()
    assert.equal(versions.versions[0]?.untranslatedCount, 3)
  } finally {
    await workspace.cleanup()
  }
}

async function validateTranslationRunPersistsSourceSha() {
  const workspace = await createWorkspace()
  try {
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async ({ file }) => createTranslatedMarkdown(`translated:${file.relativePath}`),
    })

    const files = await admin.listFiles('v9.99')
    const created = await admin.createJob({ version: 'v9.99', fileIds: [files.files[0].id] })
    await waitForJobToStop(admin, created.jobId)

    const translationState = JSON.parse(
      await readFile(path.join(workspace.workspaceRoot, 'repos', 'v9.99_zh', 'data', 'translation-state.json'), 'utf8'),
    ) as {
      items: Array<Record<string, unknown>>
    }

    assert.equal(translationState.items[0]?.relativePath, 'alpha.md')
    assert.equal(translationState.items[0]?.sourceSha256, sha256Text('# Alpha\nworkflow\n'))
  } finally {
    await workspace.cleanup()
  }
}

async function validateWorkingDirectory() {
  const workspace = await createWorkspace()
  try {
    const seen: string[] = []
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async ({ workingDirectory, file }) => {
        seen.push(`${workingDirectory}::${file.relativePath}`)
        return createTranslatedMarkdown(`cwd:${file.relativePath}`)
      },
    })

    const files = await admin.listFiles('v9.99')
    const created = await admin.createJob({ version: 'v9.99', fileIds: [files.files[0].id] })
    await waitForJobToStop(admin, created.jobId)

    assert.equal(seen.length, 1)
    assert.equal(seen[0], `${path.join(workspace.workspaceRoot, 'repos', 'v9.99_zh')}::alpha.md`)
  } finally {
    await workspace.cleanup()
  }
}

async function validateCopyNonMarkdownFile() {
  const binary = Buffer.from([0x00, 0x01, 0x02, 0xff])
  const workspace = await createWorkspace({
    docs: [{ relativePath: 'diagram.png', sizeBytes: binary.length, body: binary, mimeType: 'image/png' }],
  })
  try {
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async () => {
        throw new Error('non-markdown file should not invoke translator')
      },
    })

    const files = await admin.listFiles('v9.99')
    assert.equal(files.files.length, 1)
    assert.equal(files.files[0].mimeType, 'image/png')

    const created = await admin.createJob({ version: 'v9.99', fileIds: [files.files[0].id] })
    const finished = await waitForJobToStop(admin, created.jobId)
    assert.equal(finished.items[0].status, 'completed')

    const output = await readFile(path.join(workspace.workspaceRoot, 'repos', 'v9.99_zh', finished.items[0].targetPath))
    assert.deepEqual(output, binary)

    const translationState = JSON.parse(
      await readFile(path.join(workspace.workspaceRoot, 'repos', 'v9.99_zh', 'data', 'translation-state.json'), 'utf8'),
    ) as {
      items: Array<Record<string, unknown>>
    }
    assert.equal(translationState.items[0]?.relativePath, 'diagram.png')
    assert.equal(translationState.items[0]?.sourceSha256, sha256Text(binary))

    const refreshed = await admin.listFiles('v9.99')
    assert.equal(refreshed.files.length, 0)
  } finally {
    await workspace.cleanup()
  }
}

async function validateMarkdownAliasLocalization() {
  const workspace = await createWorkspace({
    docs: [
      {
        relativePath: 'alpha.md',
        sizeBytes: 68,
        body: ['---', 'title: "Alpha"', 'aliases:', '  - "/operations/components/setup-bindings/supported-bindings/rethinkdb/"', '---', 'Alpha', 'workflow', ''].join('\n'),
      },
      {
        relativePath: 'beta.md',
        sizeBytes: 54,
        body: ['---', 'title: "Beta"', 'aliases:', '  - "/reference/api/actors-runtime-config/"', '---', 'Beta', 'workflow', ''].join('\n'),
      },
      {
        relativePath: 'gamma.md',
        sizeBytes: 31,
        body: ['---', 'title: "Gamma"', '---', 'Gamma', 'workflow', ''].join('\n'),
      },
    ],
  })
  try {
    const translations = new Map<string, string>([
      [
        'alpha.md',
        [
          '---',
          'title: "Alpha"',
          'aliases:',
          '  - "/operations/components/setup-bindings/supported-bindings/rethinkdb/"',
          '  - "https://example.com/docs/"',
          '---',
          'Alpha CN',
        ].join('\n'),
      ],
      [
        'beta.md',
        [
          '---',
          'title: "Beta"',
          'aliases:',
          '  - "/zh-hans/reference/api/actors-runtime-config/"',
          '---',
          'Beta CN',
        ].join('\n'),
      ],
      [
        'gamma.md',
        [
          '---',
          'title: "Gamma"',
          '---',
          'Gamma CN',
        ].join('\n'),
      ],
    ])
    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async ({ file }) => translations.get(file.relativePath) ?? '',
    })

    const files = await admin.listFiles('v9.99')
    const created = await admin.createJob({ version: 'v9.99', fileIds: files.files.map((file) => file.id) })
    const finished = await waitForJobToStop(admin, created.jobId)
    assert.equal(finished.counts.completed, 3)

    const repoRoot = path.join(workspace.workspaceRoot, 'repos', 'v9.99_zh', 'translated_content', 'zh_CN', 'docs')
    const [alphaOutput, betaOutput, gammaOutput] = await Promise.all([
      readFile(path.join(repoRoot, 'alpha.md'), 'utf8'),
      readFile(path.join(repoRoot, 'beta.md'), 'utf8'),
      readFile(path.join(repoRoot, 'gamma.md'), 'utf8'),
    ])

    assert.equal(
      alphaOutput,
      [
        '---',
        'title: "Alpha"',
        'aliases:',
        '  - "/zh-hans/operations/components/setup-bindings/supported-bindings/rethinkdb/"',
        '  - "https://example.com/docs/"',
        '---',
        'Alpha CN',
        '',
      ].join('\n'),
    )
    assert.equal(
      betaOutput,
      [
        '---',
        'title: "Beta"',
        'aliases:',
        '  - "/zh-hans/reference/api/actors-runtime-config/"',
        '---',
        'Beta CN',
        '',
      ].join('\n'),
    )
    assert.equal(
      gammaOutput,
      [
        '---',
        'title: "Gamma"',
        '---',
        'Gamma CN',
        '',
      ].join('\n'),
    )
  } finally {
    await workspace.cleanup()
  }
}

async function validateInvalidMarkdownFailurePath() {
  const sourceBody = ['---', 'title: "Alpha"', 'aliases:', '  - "/docs/alpha/"', '---', '# Alpha', '', '## Install', '', '## Verify', ''].join('\n')
  const invalidCandidate = ['---', 'title: "Alpha CN"', '---', '# Alpha CN', '', '### Install CN', ''].join('\n')
  const workspace = await createWorkspace({
    docs: [{ relativePath: 'alpha.md', sizeBytes: sourceBody.length, body: sourceBody }],
  })
  const repoRoot = path.join(workspace.workspaceRoot, 'repos', 'v9.99_zh')
  const dataRoot = path.join(repoRoot, 'data')
  const targetPath = path.join(repoRoot, 'translated_content', 'zh_CN', 'docs', 'alpha.md')
  const syncStatusPath = path.join(dataRoot, 'sync-status.json')
  const sourcePath = path.join(dataRoot, 'source.json')
  const copyLogPath = path.join(dataRoot, 'copy-log.json')
  const originalError = console.error
  const errorMessages: string[] = []

  console.error = (...args: unknown[]) => {
    errorMessages.push(
      args
        .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
        .join(' '),
    )
  }

  try {
    await writeFile(
      copyLogPath,
      JSON.stringify(
        {
          version: 'v9.99',
          batches: [
            {
              batchId: 'seed',
              executedAt: '2026-03-28T00:00:00.000Z',
              copiedCount: 1,
              skippedCount: 0,
              removedCount: 0,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )
    const syncStatus = JSON.parse(await readFile(syncStatusPath, 'utf8')) as {
      syncedAt?: string
      items: Array<Record<string, unknown>>
    }
    syncStatus.syncedAt = '2099-01-01T00:00:00.000Z'
    syncStatus.items = syncStatus.items.map((item) => ({
      ...item,
      syncedAt: '2099-01-01T00:00:00.000Z',
      translationStatus: 'missingTranslation',
    }))
    await writeFile(syncStatusPath, JSON.stringify(syncStatus, null, 2), 'utf8')
    const beforeSyncStatus = await readFile(syncStatusPath, 'utf8')
    const beforeSource = await readFile(sourcePath, 'utf8')
    const beforeCopyLog = await readFile(copyLogPath, 'utf8')

    const admin = createTranslationWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      executor: async () => invalidCandidate,
    })

    const files = await admin.listFiles('v9.99')
    assert.equal(files.files.length, 1)
    await writeFile(targetPath, 'stale-invalid-output\n', 'utf8')
    const created = await admin.createJob({ version: 'v9.99', fileIds: [files.files[0].id] })
    const finished = await waitForJobToStop(admin, created.jobId)

    assert.equal(finished.items[0].status, 'failed')
    assert.equal(finished.items[0].error?.code, 'translation_output_validation_failed')
    assert.match(finished.items[0].error?.detail ?? '', /missingFrontmatterKeys=aliases/)
    assert.match(finished.items[0].error?.detail ?? '', /headingCountMismatch=3:2/)
    assert.match(finished.items[0].error?.detail ?? '', /headingLevelMismatchAt=#2:2->3,#3:2->missing/)
    assert.match(finished.items[0].error?.detail ?? '', /candidateContent:\n---\ntitle: "Alpha CN"/)

    await assert.rejects(
      () => readFile(targetPath, 'utf8'),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    )
    await assert.rejects(
      () => readFile(path.join(dataRoot, 'translation-state.json'), 'utf8'),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    )
    assert.equal(await readFile(syncStatusPath, 'utf8'), beforeSyncStatus)
    assert.equal(await readFile(sourcePath, 'utf8'), beforeSource)
    assert.equal(await readFile(copyLogPath, 'utf8'), beforeCopyLog)
    assert.ok(errorMessages.some((message) => message.includes('译文结构校验失败')))
    assert.ok(errorMessages.some((message) => message.includes('candidateContent:')))
  } finally {
    console.error = originalError
    await workspace.cleanup()
  }
}

await validateEmptySelection()
await validateMissingTemplate()
await validateInvalidConcurrency()
await validateRetrySingleFile()
await validateDefaultConcurrencyFlow()
await validateConfiguredConcurrencyFlow()
await validateShaMatchedTranslationSurvivesResync()
await validateTranslationRunPersistsSourceSha()
await validateWorkingDirectory()
await validateCopyNonMarkdownFile()
await validateMarkdownAliasLocalization()
await validateInvalidMarkdownFailurePath()

console.log('validated translation workbench admin contracts')
