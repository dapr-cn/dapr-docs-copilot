import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type SpawnResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TSX_BIN = path.join(PACKAGE_ROOT, '..', '..', 'node_modules', '.bin', 'tsx')

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'translation-output-cli-'))
  const repoRoot = path.join(workspaceRoot, 'repos', 'v9.99_zh')
  const dataRoot = path.join(repoRoot, 'data')
  const sourceRoot = path.join(repoRoot, 'data', 'source', 'docs')
  const targetRoot = path.join(repoRoot, 'translated_content', 'zh_CN', 'docs')

  await mkdir(sourceRoot, { recursive: true })
  await mkdir(targetRoot, { recursive: true })

  const syncStatus = {
    version: 'v9.99',
    items: [
      {
        bucket: 'docs',
        relativePath: 'alpha.md',
        sourcePath: 'docs/alpha.md',
        sourceFile: 'data/source/docs/alpha.md',
        translationFile: 'translated_content/zh_CN/docs/alpha.md',
        translationStatus: 'translated',
      },
      {
        bucket: 'docs',
        relativePath: 'beta.md',
        sourcePath: 'docs/beta.md',
        sourceFile: 'data/source/docs/beta.md',
        translationFile: 'translated_content/zh_CN/docs/beta.md',
        translationStatus: 'translated',
      },
    ],
  }

  const source = {
    version: 'v9.99',
    items: [
      {
        bucket: 'docs',
        relativePath: 'alpha.md',
        sourcePath: 'docs/alpha.md',
        sourceFile: 'data/source/docs/alpha.md',
        mimeType: 'text/markdown',
        sizeBytes: 64,
      },
      {
        bucket: 'docs',
        relativePath: 'beta.md',
        sourcePath: 'docs/beta.md',
        sourceFile: 'data/source/docs/beta.md',
        mimeType: 'text/markdown',
        sizeBytes: 64,
      },
    ],
  }

  await writeFile(path.join(dataRoot, 'sync-status.json'), JSON.stringify(syncStatus, null, 2), 'utf8')
  await writeFile(path.join(dataRoot, 'source.json'), JSON.stringify(source, null, 2), 'utf8')

  await writeFile(
    path.join(sourceRoot, 'alpha.md'),
    ['---', 'title: Alpha', 'aliases:', '  - /docs/alpha', '---', 'Alpha body', ''].join('\n'),
    'utf8',
  )
  await writeFile(path.join(targetRoot, 'alpha.md'), ['---', 'title: Alpha CN', 'aliases:', '  - /docs/alpha', '---', 'Alpha CN body', ''].join('\n'), 'utf8')
  await writeFile(path.join(sourceRoot, 'beta.md'), ['---', 'title: Beta', 'aliases:', '  - /docs/beta', '---', 'Beta body', ''].join('\n'), 'utf8')
  await writeFile(path.join(targetRoot, 'beta.md'), ['---', 'title: Beta CN', '---', 'Broken beta body', ''].join('\n'), 'utf8')

  return {
    workspaceRoot,
    repoRoot,
    async cleanup() {
      await rm(workspaceRoot, { recursive: true, force: true })
    },
  }
}

async function runCli(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const command = spawn(
      TSX_BIN,
      ['--tsconfig', 'tsconfig.node.json', 'scripts/validate-translation-output.ts', ...args],
      {
        cwd: PACKAGE_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    command.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    command.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    command.on('error', reject)
    command.on('close', (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      })
    })
  })
}

async function validateExplicitModeFailure() {
  const workspace = await createWorkspace()
  try {
    const result = await runCli([
      '--workspace-root',
      workspace.workspaceRoot,
      '--source',
      path.join(workspace.repoRoot, 'data', 'source', 'docs', 'beta.md'),
      '--target',
      path.join(workspace.repoRoot, 'translated_content', 'zh_CN', 'docs', 'beta.md'),
    ])

    assert.equal(result.exitCode, 1)
    assert.match(result.stdout, /FAIL repos\/v9\.99_zh\/translated_content\/zh_CN\/docs\/beta\.md/)
    assert.match(result.stdout, /"failed":1/)
    assert.match(result.stderr, /missingFrontmatterKeys=aliases/)
    assert.match(result.stderr, /candidateContent:/)
  } finally {
    await workspace.cleanup()
  }
}

async function validateBatchModeSummary() {
  const workspace = await createWorkspace()
  try {
    const result = await runCli([
      '--workspace-root',
      workspace.workspaceRoot,
      '--version',
      'v9.99',
      '--bucket',
      'docs',
      '--relative-path',
      'alpha.md',
      '--relative-path',
      'beta.md',
    ])

    assert.equal(result.exitCode, 1)
    assert.match(result.stdout, /PASS docs\/alpha\.md/)
    assert.match(result.stdout, /FAIL docs\/beta\.md/)
    assert.match(result.stdout, /"total":2/)
    assert.match(result.stdout, /"passed":1/)
    assert.match(result.stdout, /"failed":1/)
    assert.match(result.stderr, /file: docs\/beta\.md/)
  } finally {
    await workspace.cleanup()
  }
}

await validateExplicitModeFailure()
await validateBatchModeSummary()

console.log('validated translation output cli contracts')
