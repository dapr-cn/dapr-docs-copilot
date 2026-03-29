import { spawn } from 'node:child_process'

export type CommandResult = {
  command: string[]
  cwd: string
  stdout: string
  stderr: string
  exitCode: number
  startedAt: string
  finishedAt: string
}

export type RunCommandOptions = {
  cwd: string
  env?: NodeJS.ProcessEnv
  maxOutputChars?: number
}

const DEFAULT_MAX_OUTPUT_CHARS = 20000

function appendLimited(current: string, next: string, maxChars: number): string {
  const merged = `${current}${next}`
  if (merged.length <= maxChars) {
    return merged
  }

  return merged.slice(merged.length - maxChars)
}

export async function runCommand(command: string, args: string[], { cwd, env, maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS }: RunCommandOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString()
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout = appendLimited(stdout, chunk.toString(), maxOutputChars)
    })
    child.stderr.on('data', (chunk) => {
      stderr = appendLimited(stderr, chunk.toString(), maxOutputChars)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({
        command: [command, ...args],
        cwd,
        stdout,
        stderr,
        exitCode: code ?? 1,
        startedAt,
        finishedAt: new Date().toISOString(),
      })
    })
  })
}
