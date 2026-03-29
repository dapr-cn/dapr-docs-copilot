import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type CliOptions = {
  version: string
  workspaceRoot: string
  sourceRepo?: string
  zhRepo?: string
  host: string
  port: number
  hugoBin?: string
  dryRun: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const defaultWorkspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const options: CliOptions = {
    version: 'v1.17',
    workspaceRoot: defaultWorkspaceRoot,
    host: '127.0.0.1',
    port: 1313,
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === '--version') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('`--version` 缺少值')
      }
      options.version = nextValue
      index += 1
      continue
    }

    if (value === '--workspace-root') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('`--workspace-root` 缺少值')
      }
      options.workspaceRoot = path.resolve(nextValue)
      index += 1
      continue
    }

    if (value === '--source-repo') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('`--source-repo` 缺少值')
      }
      options.sourceRepo = path.resolve(nextValue)
      index += 1
      continue
    }

    if (value === '--zh-repo') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('`--zh-repo` 缺少值')
      }
      options.zhRepo = path.resolve(nextValue)
      index += 1
      continue
    }

    if (value === '--host') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('`--host` 缺少值')
      }
      options.host = nextValue
      index += 1
      continue
    }

    if (value === '--port') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('`--port` 缺少值')
      }
      options.port = Number.parseInt(nextValue, 10)
      index += 1
      continue
    }

    if (value === '--hugo-bin') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('`--hugo-bin` 缺少值')
      }
      options.hugoBin = path.resolve(nextValue)
      index += 1
      continue
    }

    if (value === '--dry-run') {
      options.dryRun = true
      continue
    }

    throw new Error(`不支持的参数：${value}`)
  }

  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error(`端口不合法：${options.port}`)
  }

  return options
}

function resolveRepoPaths(options: CliOptions) {
  const sourceRepo = options.sourceRepo ?? path.join(options.workspaceRoot, 'repos', options.version)
  const zhRepo = options.zhRepo ?? path.join(options.workspaceRoot, 'repos', `${options.version}_zh`)
  const runnerPath = path.join(zhRepo, 'scripts', 'run-local-docs-verification-site.mjs')

  if (!existsSync(runnerPath)) {
    throw new Error(`未找到 zh 仓 runner：${runnerPath}`)
  }

  return {
    sourceRepo,
    zhRepo,
    runnerPath,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const resolved = resolveRepoPaths(options)
  const childArgs = [
    resolved.runnerPath,
    '--source-repo',
    resolved.sourceRepo,
    '--zh-repo',
    resolved.zhRepo,
    '--host',
    options.host,
    '--port',
    String(options.port),
  ]

  if (options.hugoBin) {
    childArgs.push('--hugo-bin', options.hugoBin)
  }

  if (options.dryRun) {
    childArgs.push('--dry-run')
  }

  const child = spawn(process.execPath, childArgs, {
    cwd: options.workspaceRoot,
    stdio: 'inherit',
  })

  await new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => {
      process.exitCode = code ?? 1
      resolve()
    })
  })
}

void main().catch((error) => {
  console.error('[docs:verify] failed', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
