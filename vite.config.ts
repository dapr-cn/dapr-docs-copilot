import path from 'node:path'
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {
  createGlossaryTermInFile,
  deleteGlossaryTermInFile,
  readGlossaryDataset,
  resolveGlossaryFilePath,
  updateGlossaryTermInFile,
} from './src/lib/zh-glossary-admin'
import { createDefaultPrWorkbenchAdmin } from './src/server/pr-workbench-admin'
import { createDefaultTranslationWorkbenchAdmin } from './src/server/translation-workbench-admin'

type ErrorResponse = {
  error: {
    code: string
    message: string
    detail?: string
  }
}

type ApiSuccess<T> = {
  ok: true
  data: T
}

type ApiFailure = {
  ok: false
  error: ErrorResponse['error']
}

type JsonRecord = Record<string, unknown>

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function sendApiSuccess<T>(res: ServerResponse, statusCode: number, data: T) {
  sendJson(res, statusCode, { ok: true, data } satisfies ApiSuccess<T>)
}

function sendApiFailure(res: ServerResponse, statusCode: number, error: ErrorResponse['error']) {
  sendJson(res, statusCode, { ok: false, error } satisfies ApiFailure)
}

function isObject(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isSafeVersion(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value)
}

function readVersionParam(url: URL, fallback = 'v1.17'): string {
  const version = url.searchParams.get('version') || fallback
  if (!isSafeVersion(version)) {
    throw new Error('invalid_version')
  }
  return version
}

function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk.toString()
    })
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid_json'))
      }
    })
    req.on('error', reject)
  })
}

function toWorkbenchErrorPayload(error: unknown): ErrorResponse['error'] {
  if (error instanceof Error && 'workbenchError' in error) {
    return (error as Error & { workbenchError: ErrorResponse['error'] }).workbenchError
  }

  if (error instanceof Error && error.message === 'invalid_json') {
    return { code: 'invalid_json', message: '请求体 JSON 无效' }
  }

  if (error instanceof Error && error.message === 'invalid_version') {
    return { code: 'invalid_version', message: 'version 参数无效' }
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return {
      code: 'unknown_error',
      message: String((error as { message: unknown }).message),
    }
  }

  return { code: 'unknown_error', message: '工作台端点执行失败' }
}

function statusCodeForError(code: string): number {
  if (code === 'file_locked') {
    return 409
  }

  if (code === 'version_not_found' || code === 'job_not_found' || code === 'job_item_not_found') {
    return 404
  }

  if (
    code === 'invalid_json' ||
    code === 'invalid_version' ||
    code === 'invalid_selection' ||
    code === 'empty_selection' ||
    code === 'retry_not_allowed' ||
    code === 'invalid_concurrency'
  ) {
    return 400
  }

  if (
    code === 'prerequisite_failed' ||
    code === 'session_stale' ||
    code === 'zh_dirty' ||
    code === 'zh_diverged' ||
    code === 'zh_pull_failed' ||
    code === 'zh_pull_not_available' ||
    code === 'zh_push_failed' ||
    code === 'zh_push_not_available' ||
    code === 'fork_commit_failed' ||
    code === 'fork_commit_not_available' ||
    code === 'fork_dirty' ||
    code === 'fork_fast_forward_failed' ||
    code === 'fork_push_failed' ||
    code === 'fork_push_not_available' ||
    code === 'build_failed' ||
    code === 'build_command_missing'
  ) {
    return 409
  }

  return 500
}

function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
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
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      })
    })
  })
}

function createZhSyncPlugin(): Plugin {
  const gitCommand = process.platform === 'win32' ? 'git.exe' : 'git'
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  let running = false

  return {
    name: 'zh-sync-dev-endpoint',
    configureServer(server: ViteDevServer) {
      const workspaceRoot = path.resolve(__dirname, '..', '..')

      server.middlewares.use('/__admin/zh-data/sync', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method_not_allowed' })
          return
        }

        const url = new URL(req.url ?? '/__admin/zh-data/sync', 'http://localhost')
        let version = 'v1.17'
        try {
          version = readVersionParam(url)
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : 'invalid_version' })
          return
        }

        if (running) {
          sendJson(res, 409, { error: 'sync_in_progress' })
          return
        }

        running = true

        try {
          const sourceRepoPath = path.join(workspaceRoot, 'repos', version)
          const pullResult = await runCommand(gitCommand, ['pull', '--ff-only'], sourceRepoPath, process.env)
          if (pullResult.code !== 0) {
            sendJson(res, 500, {
              error: 'source_pull_failed',
              stdout: pullResult.stdout,
              stderr: pullResult.stderr,
            })
            return
          }

          const syncResult = await runCommand(
            pnpmCommand,
            ['run', 'zh:data:sync', '--source-repo', `repos/${version}`, '--zh-repo', `repos/${version}_zh`, '--version', version],
            workspaceRoot,
            process.env,
          )

          if (syncResult.code === 0) {
            await rm(path.join(workspaceRoot, 'repos', `${version}_zh`, 'data', 'copy-log.json'), { force: true })
            server.ws.send({ type: 'full-reload', path: '*' })
            sendJson(res, 200, {
              ok: true,
              stdout: `${pullResult.stdout}${syncResult.stdout}`,
              stderr: `${pullResult.stderr}${syncResult.stderr}`,
            })
            return
          }

          sendJson(res, 500, {
            error: 'sync_failed',
            stdout: `${pullResult.stdout}${syncResult.stdout}`,
            stderr: `${pullResult.stderr}${syncResult.stderr}`,
          })
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : 'sync_failed' })
        } finally {
          running = false
        }
      })
    },
  }
}

function createGlossaryAdminPlugin(): Plugin {
  let glossaryWriteQueue = Promise.resolve()

  return {
    name: 'zh-glossary-dev-endpoints',
    configureServer(server: ViteDevServer) {
      const workspaceRoot = path.resolve(__dirname, '..', '..')

      const enqueueGlossaryWrite = async <T>(task: () => Promise<T>) => {
        const nextTask = glossaryWriteQueue.then(task, task)
        glossaryWriteQueue = nextTask.then(
          () => undefined,
          () => undefined,
        )
        return nextTask
      }

      server.middlewares.use('/__admin/zh-data/glossary', (req, res) => {
        void (async () => {
          try {
            const url = new URL(req.url ?? '/__admin/zh-data/glossary', 'http://localhost')
            const version = readVersionParam(url)
            const strippedPath = url.pathname === '/' ? '' : url.pathname.replace(/^\/+/, '')
            const termId = strippedPath || undefined
            const glossaryFilePath = resolveGlossaryFilePath(workspaceRoot, version)

            if (req.method === 'GET') {
              if (termId) {
                sendJson(res, 404, { error: '未找到对应术语' })
                return
              }

              sendJson(res, 200, { dataset: await readGlossaryDataset(glossaryFilePath) })
              return
            }

            if (req.method === 'POST') {
              if (termId) {
                sendJson(res, 404, { error: '未找到对应术语' })
                return
              }

              const payload = await readRequestBody(req)
              if (!isObject(payload)) {
                sendJson(res, 400, { error: '请求体必须为 JSON 对象' })
                return
              }

              const result = await enqueueGlossaryWrite(() =>
                createGlossaryTermInFile(glossaryFilePath, {
                  source: readString(payload.source),
                  target: readString(payload.target),
                  notes: readString(payload.notes),
                }),
              )
              sendJson(res, 201, result)
              return
            }

            if (req.method === 'PATCH') {
              if (!termId) {
                sendJson(res, 400, { error: '缺少术语 id' })
                return
              }

              const payload = await readRequestBody(req)
              if (!isObject(payload)) {
                sendJson(res, 400, { error: '请求体必须为 JSON 对象' })
                return
              }

              const result = await enqueueGlossaryWrite(() =>
                updateGlossaryTermInFile(glossaryFilePath, termId, {
                  source: readString(payload.source),
                  target: readString(payload.target),
                  notes: readString(payload.notes),
                }),
              )
              sendJson(res, 200, result)
              return
            }

            if (req.method === 'DELETE') {
              if (!termId) {
                sendJson(res, 400, { error: '缺少术语 id' })
                return
              }

              const result = await enqueueGlossaryWrite(() => deleteGlossaryTermInFile(glossaryFilePath, termId))
              sendJson(res, 200, result)
              return
            }

            sendJson(res, 405, { error: 'method_not_allowed' })
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : '术语请求失败' })
          }
        })()
      })
    },
  }
}


function createPrWorkbenchPlugin(): Plugin {
  return {
    name: 'pr-workbench-dev-endpoints',
    configureServer(server: ViteDevServer) {
      const workspaceRoot = path.resolve(__dirname, '..', '..')
      const admin = createDefaultPrWorkbenchAdmin(workspaceRoot)

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__admin/pr-workbench')) {
          next()
          return
        }

        const url = new URL(req.url, 'http://localhost')
        const pathname = url.pathname

        try {
          if (req.method === 'GET' && pathname === '/__admin/pr-workbench/versions') {
            sendApiSuccess(res, 200, await admin.listVersions())
            return
          }

          const sessionMatch = pathname.match(/^\/__admin\/pr-workbench\/sessions\/([^/]+)$/)
          if (req.method === 'GET' && sessionMatch) {
            sendApiSuccess(res, 200, await admin.getSession(decodeURIComponent(sessionMatch[1])))
            return
          }

          const actionMatch = pathname.match(/^\/__admin\/pr-workbench\/sessions\/([^/]+)\/(check-zh-sync|pull-zh|push-zh|update-fork|commit-fork|push-fork|verify-build)$/)
          if (req.method === 'POST' && actionMatch) {
            const version = decodeURIComponent(actionMatch[1])
            const action = actionMatch[2]
            if (action === 'check-zh-sync') {
              sendApiSuccess(res, 200, await admin.checkZhSync(version))
              return
            }
            if (action === 'pull-zh') {
              sendApiSuccess(res, 200, await admin.pullZh(version))
              return
            }
            if (action === 'push-zh') {
              sendApiSuccess(res, 200, await admin.pushZh(version))
              return
            }
            if (action === 'update-fork') {
              sendApiSuccess(res, 200, await admin.updateFork(version))
              return
            }
            if (action === 'commit-fork') {
              sendApiSuccess(res, 200, await admin.commitFork(version))
              return
            }
            if (action === 'push-fork') {
              sendApiSuccess(res, 200, await admin.pushFork(version))
              return
            }
            sendApiSuccess(res, 200, await admin.verifyBuild(version))
            return
          }

          sendApiFailure(res, 404, { code: 'route_not_found', message: 'PR 工作台端点不存在' })
        } catch (error) {
          const payload = toWorkbenchErrorPayload(error)
          sendApiFailure(res, statusCodeForError(payload.code), payload)
        }
      })
    },
  }
}

function createTranslationWorkbenchPlugin(): Plugin {
  return {
    name: 'translation-workbench-dev-endpoints',
    configureServer(server: ViteDevServer) {
      const workspaceRoot = path.resolve(__dirname, '..', '..')
      const admin = createDefaultTranslationWorkbenchAdmin(workspaceRoot)

      const logRequest = (message: string, payload?: Record<string, unknown>) => {
        const timestamp = new Date().toISOString()
        if (payload) {
          console.info(`[translation-workbench-api] ${timestamp} ${message}`, payload)
          return
        }
        console.info(`[translation-workbench-api] ${timestamp} ${message}`)
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__admin/translation-workbench')) {
          next()
          return
        }

        const url = new URL(req.url, 'http://localhost')
        const pathname = url.pathname

        try {
          logRequest('收到请求', {
            method: req.method,
            pathname,
            search: url.search,
          })

          if (req.method === 'GET' && pathname === '/__admin/translation-workbench/versions') {
            sendJson(res, 200, await admin.listVersions())
            return
          }

          if (req.method === 'GET' && pathname === '/__admin/translation-workbench/files') {
            const version = url.searchParams.get('version')
            if (!version) {
              sendJson(res, 400, { error: { code: 'version_required', message: '缺少 version 参数' } })
              return
            }

            sendJson(res, 200, await admin.listFiles(version))
            return
          }

          if (req.method === 'POST' && pathname === '/__admin/translation-workbench/jobs') {
            const payload = (await readRequestBody(req)) as { version?: string; fileIds?: string[]; concurrency?: number }
            sendJson(
              res,
              200,
              await admin.createJob({
                version: typeof payload.version === 'string' ? payload.version : '',
                fileIds: Array.isArray(payload.fileIds) ? payload.fileIds.filter((item): item is string => typeof item === 'string') : [],
                concurrency: typeof payload.concurrency === 'number' ? payload.concurrency : undefined,
              }),
            )
            return
          }

          const jobMatch = pathname.match(/^\/__admin\/translation-workbench\/jobs\/([^/]+)$/)
          if (req.method === 'GET' && jobMatch) {
            sendJson(res, 200, admin.getJob(jobMatch[1]))
            return
          }

          const retryMatch = pathname.match(/^\/__admin\/translation-workbench\/jobs\/([^/]+)\/items\/([^/]+)\/retry$/)
          if (req.method === 'POST' && retryMatch) {
            sendJson(res, 200, await admin.retryJobItem(retryMatch[1], retryMatch[2]))
            return
          }

          sendJson(res, 404, { error: { code: 'route_not_found', message: '端点不存在' } })
        } catch (error) {
          const payload = toWorkbenchErrorPayload(error)
          sendJson(res, statusCodeForError(payload.code), { error: payload })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), createZhSyncPlugin(), createGlossaryAdminPlugin(), createTranslationWorkbenchPlugin(), createPrWorkbenchPlugin()],
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
