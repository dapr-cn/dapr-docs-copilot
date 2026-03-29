import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

type SpawnResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

type RunningProcess = {
  child: ReturnType<typeof spawn>
  completed: Promise<SpawnResult>
  readStdout: () => string
  readStderr: () => string
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')
const TSX_BIN = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', 'tsx')
const BRIDGE_SCRIPT = path.join(PACKAGE_ROOT, 'scripts', 'start-local-docs-verification.ts')
const RENDER_SCRIPT = path.join(WORKSPACE_ROOT, 'repos', 'v1.17_zh', 'scripts', 'render-local-docs-verification-config.mjs')
const RUNNER_SCRIPT = path.join(WORKSPACE_ROOT, 'repos', 'v1.17_zh', 'scripts', 'run-local-docs-verification-site.mjs')

async function createWorkspace() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'local-docs-verification-'))
  const workspaceRoot = path.join(tempRoot, 'workspace')
  const sourceRepo = path.join(workspaceRoot, 'repos', 'v1.17')
  const zhRepo = path.join(workspaceRoot, 'repos', 'v1.17_zh')
  const nodeModulesLink = path.join(workspaceRoot, 'node_modules')
  const scriptsDir = path.join(zhRepo, 'scripts')
  const zhDocPath = path.join(zhRepo, 'translated_content', 'zh_CN', 'docs', '_index.md')
  const sourceDocPath = path.join(sourceRepo, 'daprdocs', 'content', 'en', '_index.md')
  const fakeHugoPath = path.join(tempRoot, 'fake-hugo.mjs')

  await mkdir(path.dirname(sourceDocPath), { recursive: true })
  await mkdir(path.dirname(zhDocPath), { recursive: true })
  await mkdir(scriptsDir, { recursive: true })
  await symlink(path.join(WORKSPACE_ROOT, 'node_modules'), nodeModulesLink, 'dir')

  await writeFile(
    path.join(sourceRepo, 'hugo.yaml'),
    [
      'baseURL: https://example.test',
      'title: Demo Docs',
      'publishDir: daprdocs/public',
      'languages:',
      '  en:',
      '    languageName: English',
      '    contentDir: daprdocs/content/en',
      '  zh-hans:',
      '    languageName: 简体中文',
      '    contentDir: daprdocs/content/zh-hans',
      'module:',
      '  imports:',
      '    - path: github.com/google/docsy',
      '  mounts:',
      '    - source: daprdocs/content/en',
      '      target: content',
      '      lang: en',
      '    - source: daprdocs/layouts',
      '      target: layouts',
      '    - source: daprdocs/assets',
      '      target: assets',
      '    - source: translations/docs-zh/translated_content/zh_CN/docs',
      '      target: content',
      '      lang: zh-hans',
    ].join('\n'),
    'utf8',
  )

  await writeFile(sourceDocPath, '# English\n', 'utf8')
  await writeFile(zhDocPath, '# 中文\n', 'utf8')
  await copyFile(RENDER_SCRIPT, path.join(scriptsDir, 'render-local-docs-verification-config.mjs'))
  await copyFile(RUNNER_SCRIPT, path.join(scriptsDir, 'run-local-docs-verification-site.mjs'))

  await writeFile(
    fakeHugoPath,
    [
      '#!/usr/bin/env node',
      "import { appendFileSync, existsSync, statSync } from 'node:fs'",
      '',
      'const args = process.argv.slice(2)',
      "if (args[0] === 'version') {",
      "  console.log('hugo v0.150.0')",
      '  process.exit(0)',
      '}',
      '',
      "const getArg = (name) => {",
      '  const index = args.indexOf(name)',
      '  return index >= 0 ? args[index + 1] : undefined',
      '}',
      '',
      "const host = getArg('--bind') ?? '127.0.0.1'",
      "const port = getArg('--port') ?? '1313'",
      "const configPath = getArg('--config')",
      "const cacheDir = getArg('--cacheDir')",
      "const logFile = getArg('--logFile')",
      "console.log(`[fake-hugo] cwd=${process.cwd()}`)",
      "console.log(`[fake-hugo] config=${configPath}`)",
      "console.log(`[fake-hugo] cacheDir=${cacheDir}`)",
      "console.log(`[fake-hugo] preview=http://${host}:${port}/zh-hans/`)",
      'if (logFile) {',
      "  appendFileSync(logFile, 'fake hugo started\\n')",
      '}',
      "const watchFile = process.env.SMOKE_WATCH_FILE",
      'if (!watchFile) {',
      '  process.exit(0)',
      '}',
      'if (!existsSync(watchFile)) {',
      "  console.error(`[fake-hugo] watch-file-missing=${watchFile}`)",
      '  process.exit(2)',
      '}',
      'const startMtime = statSync(watchFile).mtimeMs',
      "console.log(`[fake-hugo] watch-ready=${watchFile}`)",
      'const startedAt = Date.now()',
      'const timer = setInterval(() => {',
      '  const currentMtime = statSync(watchFile).mtimeMs',
      '  if (currentMtime !== startMtime) {',
      "    console.log(`[fake-hugo] change=${watchFile}`)",
      '    clearInterval(timer)',
      '    process.exit(0)',
      '  }',
      '  if (Date.now() - startedAt > 5000) {',
      "    console.error('[fake-hugo] timeout waiting for change')",
      '    clearInterval(timer)',
      '    process.exit(3)',
      '  }',
      '}, 100)',
    ].join('\n'),
    'utf8',
  )
  await chmod(fakeHugoPath, 0o755)

  return {
    tempRoot,
    workspaceRoot,
    sourceRepo,
    zhRepo,
    sourceDocPath,
    zhDocPath,
    fakeHugoPath,
    async cleanup() {
      await rm(tempRoot, { recursive: true, force: true })
    },
  }
}

function runBridge(args: string[], env: NodeJS.ProcessEnv = {}): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, ['--tsconfig', 'tsconfig.node.json', BRIDGE_SCRIPT, ...args], {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr })
    })
  })
}

function startBridge(args: string[], env: NodeJS.ProcessEnv = {}): RunningProcess {
  const child = spawn(TSX_BIN, ['--tsconfig', 'tsconfig.node.json', BRIDGE_SCRIPT, ...args], {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  return {
    child,
    completed: new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (exitCode) => {
        resolve({ exitCode, stdout, stderr })
      })
    }),
    readStdout: () => stdout,
    readStderr: () => stderr,
  }
}

async function waitForOutput(readOutput: () => string, matcher: RegExp, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (matcher.test(readOutput())) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error(`等待输出超时：${matcher}`)
}

async function validateConfigRewriteAndStableOutput() {
  const workspace = await createWorkspace()
  try {
    const result = await runBridge([
      '--workspace-root',
      workspace.workspaceRoot,
      '--host',
      '127.0.0.1',
      '--port',
      '1417',
      '--hugo-bin',
      workspace.fakeHugoPath,
      '--dry-run',
    ])

    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, new RegExp(`sourceRepo=${workspace.sourceRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(result.stdout, new RegExp(`zhRepo=${workspace.zhRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(result.stdout, /generatedConfig=.*site\/\.generated\/hugo\.verification\.yaml/)
    assert.match(result.stdout, /cacheDir=.*site\/\.cache/)
    assert.match(result.stdout, /previewUrl=http:\/\/127\.0\.0\.1:1417\/zh-hans\//)
    assert.match(result.stdout, /mode=dry-run/)

    const generatedConfigPath = path.join(workspace.zhRepo, 'site', '.generated', 'hugo.verification.yaml')
    assert.equal(existsSync(generatedConfigPath), true)

    const generatedConfig = yaml.load(await readFile(generatedConfigPath, 'utf8')) as {
      module?: { imports?: Array<{ path?: string }>; mounts?: Array<{ source?: string; target?: string; lang?: string }> }
      languages?: Record<string, unknown>
      publishDir?: string
      resourceDir?: string
    }
    const mounts = generatedConfig.module?.mounts ?? []
    const zhMount = mounts.find((item) => item.lang === 'zh-hans')
    const enMount = mounts.find((item) => item.lang === 'en')

    assert.ok(zhMount)
    assert.ok(enMount)
    assert.equal(zhMount?.source, path.join(workspace.zhRepo, 'translated_content', 'zh_CN', 'docs').split(path.sep).join('/'))
    assert.equal(zhMount?.target, 'content')
    assert.equal(enMount?.source, 'daprdocs/content/en')
    assert.equal(generatedConfig.module?.imports?.[0]?.path, 'github.com/google/docsy')
    assert.ok(generatedConfig.languages?.['zh-hans'])
    assert.equal(generatedConfig.publishDir, path.join(workspace.zhRepo, 'site', 'tmp', 'public').split(path.sep).join('/'))
    assert.equal(generatedConfig.resourceDir, path.join(workspace.zhRepo, 'site', 'tmp', 'resources').split(path.sep).join('/'))
  } finally {
    await workspace.cleanup()
  }
}

async function validateMissingDependencyError() {
  const workspace = await createWorkspace()
  try {
    const missingBinary = path.join(workspace.tempRoot, 'missing-hugo')
    const result = await runBridge([
      '--workspace-root',
      workspace.workspaceRoot,
      '--hugo-bin',
      missingBinary,
      '--dry-run',
    ])

    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /hugo 可执行文件不可用/)
    assert.match(result.stderr, /--hugo-bin/)
  } finally {
    await workspace.cleanup()
  }
}

async function validateSmokeLaunch() {
  const workspace = await createWorkspace()
  try {
    const beforeSourceStat = await stat(path.join(workspace.sourceRepo, 'hugo.yaml'))
    const running = startBridge(
      [
        '--workspace-root',
        workspace.workspaceRoot,
        '--version',
        'v1.17',
        '--hugo-bin',
        workspace.fakeHugoPath,
        '--host',
        '127.0.0.1',
        '--port',
        '1517',
      ],
      {
        SMOKE_WATCH_FILE: workspace.zhDocPath,
      },
    )

    await waitForOutput(running.readStdout, /\[fake-hugo\] watch-ready=/, 5000)
    await appendFile(workspace.zhDocPath, '\n<!-- updated -->\n', 'utf8')

    const result = await running.completed
    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, new RegExp(`\\[fake-hugo\\] cwd=${workspace.sourceRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(result.stdout, new RegExp(`\\[fake-hugo\\] change=${workspace.zhDocPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(result.stdout, /\[fake-hugo\] preview=http:\/\/127\.0\.0\.1:1517\/zh-hans\//)

    const afterSourceStat = await stat(path.join(workspace.sourceRepo, 'hugo.yaml'))
    assert.equal(afterSourceStat.mtimeMs, beforeSourceStat.mtimeMs)
    assert.equal(await readFile(workspace.sourceDocPath, 'utf8'), '# English\n')
    assert.match(
      await readFile(path.join(workspace.zhRepo, 'site', 'logs', 'hugo.verification.log'), 'utf8'),
      /\[fake-hugo\] preview=http:\/\/127\.0\.0\.1:1517\/zh-hans\//,
    )
  } finally {
    await workspace.cleanup()
  }
}

await validateConfigRewriteAndStableOutput()
await validateMissingDependencyError()
await validateSmokeLaunch()

console.log('validated local docs verification contracts')
