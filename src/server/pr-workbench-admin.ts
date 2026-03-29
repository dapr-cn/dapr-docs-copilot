import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  PR_WORKBENCH_BUILD_SCRIPT,
  PR_WORKBENCH_SUBMODULE_PATH,
  type BuildVerificationStepResult,
  type ForkRefreshStepResult,
  type PrWorkbenchCommandLog,
  type PrWorkbenchError,
  type PrWorkbenchSession,
  type PrWorkbenchStepActionResponse,
  type PrWorkbenchStepId,
  type PrWorkbenchStepSnapshot,
  type PrWorkbenchStepStatus,
  type PrWorkbenchVersionWorkspace,
  type PrWorkbenchVersionsResponse,
  type ReadySummary,
  type ZhSyncStepResult,
} from '../lib/pr-workbench-models'
import { runCommand, type CommandResult } from './git-runner'

export type PrWorkbenchAdminOptions = {
  workspaceRoot: string
  env?: NodeJS.ProcessEnv
}

export type PrWorkbenchAdmin = {
  listVersions: () => Promise<PrWorkbenchVersionsResponse>
  getSession: (version: string) => Promise<PrWorkbenchSession>
  checkZhSync: (version: string) => Promise<PrWorkbenchStepActionResponse>
  pullZh: (version: string) => Promise<PrWorkbenchStepActionResponse>
  pushZh: (version: string) => Promise<PrWorkbenchStepActionResponse>
  updateFork: (version: string) => Promise<PrWorkbenchStepActionResponse>
  commitFork: (version: string) => Promise<PrWorkbenchStepActionResponse>
  pushFork: (version: string) => Promise<PrWorkbenchStepActionResponse>
  verifyBuild: (version: string) => Promise<PrWorkbenchStepActionResponse>
}

type StepFailure = {
  status?: 'failed' | 'stale'
  error: PrWorkbenchError
  result?: ZhSyncStepResult | ForkRefreshStepResult | BuildVerificationStepResult
  logs: PrWorkbenchCommandLog[]
}

type UpstreamRef = {
  full: string
  remote: string
  branch: string
}

const ZH_REPO_SUFFIX = '_zh'
const FORK_REPO_PREFIX = 'fork-'
const SESSION_FAILURE_CODES = new Set([
  'prerequisite_failed',
  'session_stale',
  'zh_dirty',
  'zh_upstream_missing',
  'zh_diverged',
  'zh_fetch_failed',
  'zh_pull_failed',
  'zh_pull_not_available',
  'zh_push_failed',
  'zh_push_not_available',
  'fork_commit_failed',
  'fork_commit_not_available',
  'fork_dirty',
  'fork_fetch_failed',
  'fork_fast_forward_failed',
  'fork_push_failed',
  'fork_push_not_available',
  'submodule_init_failed',
  'submodule_fetch_failed',
  'submodule_checkout_failed',
  'submodule_sha_mismatch',
  'build_command_missing',
  'build_failed',
  'build_state_changed',
])

const STEP_TITLES: Record<PrWorkbenchStepId, string> = {
  zhSync: 'zh 仓同步校验',
  forkRefresh: '更新 fork 与 submodule',
  buildVerification: '本地构建验证',
}

const STEP_DESCRIPTIONS: Record<PrWorkbenchStepId, string> = {
  zhSync: '检查 zh 仓工作区是否干净、是否配置 upstream，以及与远端 ahead/behind 是否归零。',
  forkRefresh: '以 fast-forward-only 拉齐 fork 上游分支，并将 docs-zh submodule 切到已校验 zh HEAD。',
  buildVerification: '在 fork 仓执行 build 脚本，记录退出码、日志与 Ready 所绑定的 SHA 快照。',
}

function createWorkbenchError(code: string, message: string, detail?: string) {
  const error = new Error(message) as Error & { workbenchError: PrWorkbenchError }
  error.workbenchError = { code, message, detail }
  return error
}

function toWorkbenchError(error: unknown, fallbackCode: string, fallbackMessage: string): PrWorkbenchError {
  if (error instanceof Error && 'workbenchError' in error) {
    return (error as Error & { workbenchError: PrWorkbenchError }).workbenchError
  }

  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return {
      code: 'file_not_found',
      message: fallbackMessage,
      detail: (error as NodeJS.ErrnoException).path,
    }
  }

  if (error instanceof Error) {
    return { code: fallbackCode, message: error.message || fallbackMessage }
  }

  return { code: fallbackCode, message: fallbackMessage }
}

function cloneSession(session: PrWorkbenchSession): PrWorkbenchSession {
  return structuredClone(session)
}

function formatCommand(result: CommandResult): string {
  return result.command.join(' ')
}

function trimOutput(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function toLog(scope: PrWorkbenchStepId, title: string, summary: string, result: CommandResult): PrWorkbenchCommandLog {
  return {
    id: `${scope}:${title}:${result.startedAt}`,
    scope,
    title,
    summary,
    command: formatCommand(result),
    cwd: result.cwd,
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  }
}

function isStepPassed(status: PrWorkbenchStepStatus): boolean {
  return status === 'passed'
}

function createStep<T>(id: PrWorkbenchStepId): PrWorkbenchStepSnapshot<T> {
  return {
    id,
    title: STEP_TITLES[id],
    description: STEP_DESCRIPTIONS[id],
    status: id === 'zhSync' ? 'idle' : 'blocked',
    blockedReason: id === 'zhSync' ? undefined : id === 'forkRefresh' ? '需先通过 zh 仓同步校验' : '需先完成 fork 更新与 submodule 对齐',
    logs: [],
  }
}

function createSession(workspace: PrWorkbenchVersionWorkspace): PrWorkbenchSession {
  const now = new Date().toISOString()
  return {
    version: workspace.version,
    workspace,
    ready: false,
    lastUpdatedAt: now,
    steps: {
      zhSync: createStep<ZhSyncStepResult>('zhSync'),
      forkRefresh: createStep<ForkRefreshStepResult>('forkRefresh'),
      buildVerification: createStep<BuildVerificationStepResult>('buildVerification'),
    },
  }
}

function touchSession(session: PrWorkbenchSession) {
  session.lastUpdatedAt = new Date().toISOString()
}

function clearReady(session: PrWorkbenchSession) {
  session.ready = false
  session.readySummary = undefined
}

function ensureStepBlockedState(session: PrWorkbenchSession) {
  if (!isStepPassed(session.steps.zhSync.status)) {
    if (session.steps.forkRefresh.status === 'idle' || session.steps.forkRefresh.status === 'blocked') {
      session.steps.forkRefresh.status = 'blocked'
      session.steps.forkRefresh.blockedReason = '需先通过 zh 仓同步校验'
    }
  } else if (session.steps.forkRefresh.status === 'blocked') {
    session.steps.forkRefresh.status = 'idle'
    session.steps.forkRefresh.blockedReason = undefined
  }

  if (!isStepPassed(session.steps.forkRefresh.status)) {
    if (session.steps.buildVerification.status === 'idle' || session.steps.buildVerification.status === 'blocked') {
      session.steps.buildVerification.status = 'blocked'
      session.steps.buildVerification.blockedReason = '需先完成 fork 更新与 submodule 对齐'
    }
  } else if (session.steps.buildVerification.status === 'blocked') {
    session.steps.buildVerification.status = 'idle'
    session.steps.buildVerification.blockedReason = undefined
  }
}

function setStepRunning<T>(step: PrWorkbenchStepSnapshot<T>) {
  step.status = 'running'
  step.blockedReason = undefined
  step.staleReason = undefined
  step.error = undefined
  step.lastUpdatedAt = new Date().toISOString()
}

function setStepPassed<T>(step: PrWorkbenchStepSnapshot<T>, result: T, logs: PrWorkbenchCommandLog[]) {
  step.status = 'passed'
  step.result = result
  step.logs = logs
  step.error = undefined
  step.blockedReason = undefined
  step.staleReason = undefined
  step.lastUpdatedAt = new Date().toISOString()
}

function setStepFailure<T>(step: PrWorkbenchStepSnapshot<T>, failure: StepFailure) {
  step.status = failure.status === 'stale' ? 'stale' : 'failed'
  step.error = failure.error
  step.logs = failure.logs
  step.lastUpdatedAt = new Date().toISOString()
  step.blockedReason = undefined
  step.staleReason = failure.status === 'stale' ? failure.error.message : undefined
  if (failure.result !== undefined) {
    step.result = failure.result as T
  }
}

function setStepStale<T>(step: PrWorkbenchStepSnapshot<T>, reason: string) {
  if (step.status === 'idle' || step.status === 'blocked') {
    return
  }

  step.status = 'stale'
  step.error = undefined
  step.blockedReason = undefined
  step.staleReason = reason
  step.lastUpdatedAt = new Date().toISOString()
}

function invalidateDownstream(session: PrWorkbenchSession, stepId: PrWorkbenchStepId, reason: string) {
  if (stepId === 'zhSync') {
    setStepStale(session.steps.forkRefresh, reason)
    setStepStale(session.steps.buildVerification, reason)
  }

  if (stepId === 'forkRefresh') {
    setStepStale(session.steps.buildVerification, reason)
  }

  clearReady(session)
  ensureStepBlockedState(session)
}

function relativeToWorkspace(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join('/')
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

function versionSortValue(version: string): number[] {
  return version
    .replace(/^[^\d]+/, '')
    .split('.')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
}

function compareVersionsDescending(left: string, right: string): number {
  const leftParts = versionSortValue(left)
  const rightParts = versionSortValue(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }

  return right.localeCompare(left)
}

function parseUpstreamRef(value: string): UpstreamRef {
  const trimmed = value.trim()
  const separatorIndex = trimmed.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    throw createWorkbenchError('zh_upstream_missing', '当前分支未配置 upstream tracking 分支', trimmed)
  }

  return {
    full: trimmed,
    remote: trimmed.slice(0, separatorIndex),
    branch: trimmed.slice(separatorIndex + 1),
  }
}

function parseDirtyFiles(entries: string[]): string[] {
  return entries
    .map((entry) => entry.slice(3).split(' -> ').pop()?.trim() ?? '')
    .filter(Boolean)
}

function parseAheadBehind(stdout: string): { aheadCount: number; behindCount: number } {
  const [aheadRaw, behindRaw] = stdout.trim().split(/\s+/)
  return {
    aheadCount: Number(aheadRaw ?? 0) || 0,
    behindCount: Number(behindRaw ?? 0) || 0,
  }
}

async function readTrackingRef(repoPath: string, scope: PrWorkbenchStepId, title: string, runGit: (args: string[], cwd: string) => Promise<CommandResult>) {
  const result = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repoPath)
  if (result.exitCode !== 0) {
    return {
      log: toLog(scope, title, '当前分支未配置 upstream', result),
    }
  }

  const upstream = parseUpstreamRef(result.stdout)
  return {
    upstream,
    log: toLog(scope, title, `tracking ${upstream.full}`, result),
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

export function createPrWorkbenchAdmin({ workspaceRoot, env = process.env }: PrWorkbenchAdminOptions): PrWorkbenchAdmin {
  const gitCommand = process.platform === 'win32' ? 'git.exe' : 'git'
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const sessions = new Map<string, PrWorkbenchSession>()
  let gitReadyPromise: Promise<void> | null = null

  async function ensureGitReady() {
    if (!gitReadyPromise) {
      gitReadyPromise = runCommand(gitCommand, ['--version'], { cwd: workspaceRoot, env })
        .then((result) => {
          if (result.exitCode !== 0) {
            throw createWorkbenchError('git_not_found', '本机未找到 git 命令', result.stderr || result.stdout)
          }
        })
        .catch((error) => {
          throw createWorkbenchError('git_not_found', '本机未找到 git 命令', error instanceof Error ? error.message : undefined)
        })
    }

    return gitReadyPromise
  }

  async function runGit(args: string[], cwd: string): Promise<CommandResult> {
    await ensureGitReady()
    try {
      return await runCommand(gitCommand, args, { cwd, env })
    } catch (error) {
      throw createWorkbenchError('git_not_found', '本机未找到 git 命令', error instanceof Error ? error.message : undefined)
    }
  }

  async function runNpm(args: string[], cwd: string): Promise<CommandResult> {
    try {
      return await runCommand(npmCommand, args, { cwd, env })
    } catch (error) {
      throw createWorkbenchError('build_failed', '构建命令启动失败', error instanceof Error ? error.message : undefined)
    }
  }

  async function readHeadSha(repoPath: string): Promise<string> {
    const result = await runGit(['rev-parse', 'HEAD'], repoPath)
    if (result.exitCode !== 0) {
      throw createWorkbenchError('git_state_failed', '读取仓库 HEAD 失败', result.stderr || result.stdout)
    }

    return result.stdout.trim()
  }

  async function readCurrentBranch(repoPath: string): Promise<string> {
    const result = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
    if (result.exitCode !== 0) {
      throw createWorkbenchError('git_state_failed', '读取当前分支失败', result.stderr || result.stdout)
    }

    return result.stdout.trim()
  }

  async function readSubmoduleSha(forkRepoPath: string, submodulePath: string): Promise<string | undefined> {
    const absoluteSubmodulePath = path.join(forkRepoPath, submodulePath)
    if (!(await pathExists(absoluteSubmodulePath))) {
      return undefined
    }

    const result = await runGit(['rev-parse', 'HEAD'], absoluteSubmodulePath)
    if (result.exitCode !== 0) {
      return undefined
    }

    return result.stdout.trim() || undefined
  }

  async function resolveVersionWorkspace(version: string): Promise<PrWorkbenchVersionWorkspace> {
    const reposRoot = path.join(workspaceRoot, 'repos')
    const zhRepoPath = path.join(reposRoot, `${version}${ZH_REPO_SUFFIX}`)
    const forkRepoPath = path.join(reposRoot, `${FORK_REPO_PREFIX}${version}`)

    if (!(await pathExists(zhRepoPath))) {
      throw createWorkbenchError('version_not_found', `未找到 zh 仓：repos/${version}_zh`, zhRepoPath)
    }

    if (!(await pathExists(forkRepoPath))) {
      throw createWorkbenchError('version_not_found', `未找到 fork 仓：repos/fork-${version}`, forkRepoPath)
    }

    const [zhBranch, forkBranch] = await Promise.all([readCurrentBranch(zhRepoPath), readCurrentBranch(forkRepoPath)])
    const packageJsonPath = path.join(forkRepoPath, 'package.json')
    let buildScript: string | undefined
    if (await pathExists(packageJsonPath)) {
      const packageJson = await readJsonFile<{ scripts?: Record<string, string> }>(packageJsonPath)
      buildScript = packageJson.scripts?.[PR_WORKBENCH_BUILD_SCRIPT]
    }

    return {
      version,
      label: version,
      zhRepoPath: relativeToWorkspace(workspaceRoot, zhRepoPath),
      forkRepoPath: relativeToWorkspace(workspaceRoot, forkRepoPath),
      zhBranch,
      forkBranch,
      zhRemote: 'origin',
      forkUpstreamRemote: 'source',
      submodulePath: PR_WORKBENCH_SUBMODULE_PATH,
      buildScriptName: PR_WORKBENCH_BUILD_SCRIPT,
      buildCommandLabel: `npm run ${PR_WORKBENCH_BUILD_SCRIPT}`,
      buildScript,
    }
  }

  async function refreshSessionState(session: PrWorkbenchSession) {
    const zhRepoPath = path.join(workspaceRoot, session.workspace.zhRepoPath)
    const forkRepoPath = path.join(workspaceRoot, session.workspace.forkRepoPath)

    if (session.steps.zhSync.result?.zhHeadSha) {
      const currentZhHeadSha = await readHeadSha(zhRepoPath)
      if (currentZhHeadSha !== session.steps.zhSync.result.zhHeadSha) {
        setStepStale(session.steps.zhSync, 'zh HEAD 已变化，需重新校验。')
        invalidateDownstream(session, 'zhSync', 'zh HEAD 已变化，后续结果作废。')
      }
    }

    if (session.steps.forkRefresh.result?.forkHeadSha) {
      const [currentForkHeadSha, currentSubmoduleSha] = await Promise.all([
        readHeadSha(forkRepoPath),
        readSubmoduleSha(forkRepoPath, session.workspace.submodulePath),
      ])
      if (currentForkHeadSha !== session.steps.forkRefresh.result.forkHeadSha || currentSubmoduleSha !== session.steps.forkRefresh.result.submoduleSha) {
        setStepStale(session.steps.forkRefresh, 'fork HEAD 或 docs-zh submodule 已变化，需重新执行。')
        invalidateDownstream(session, 'forkRefresh', 'fork HEAD 或 docs-zh submodule 已变化。')
      }
    }

    if (session.steps.buildVerification.result?.forkHeadSha) {
      const [currentForkHeadSha, currentSubmoduleSha] = await Promise.all([
        readHeadSha(forkRepoPath),
        readSubmoduleSha(forkRepoPath, session.workspace.submodulePath),
      ])
      if (currentForkHeadSha !== session.steps.buildVerification.result.forkHeadSha || currentSubmoduleSha !== session.steps.buildVerification.result.submoduleSha) {
        setStepStale(session.steps.buildVerification, '构建所绑定的 SHA 已失效，需重跑构建。')
        clearReady(session)
      }
    }

    ensureStepBlockedState(session)
    touchSession(session)
  }

  async function listVersions(): Promise<PrWorkbenchVersionsResponse> {
    await ensureGitReady()
    const reposRoot = path.join(workspaceRoot, 'repos')
    const entries = await readdir(reposRoot, { withFileTypes: true })
    const names = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
    const versions = Array.from(names)
      .filter((name) => name.endsWith(ZH_REPO_SUFFIX))
      .map((name) => name.slice(0, -ZH_REPO_SUFFIX.length))
      .filter((version) => names.has(`${FORK_REPO_PREFIX}${version}`))
      .sort(compareVersionsDescending)

    return {
      versions: await Promise.all(versions.map((version) => resolveVersionWorkspace(version))),
    }
  }

  async function ensureSession(version: string): Promise<PrWorkbenchSession> {
    const workspace = await resolveVersionWorkspace(version)
    const existing = sessions.get(version)

    if (!existing) {
      const session = createSession(workspace)
      sessions.set(version, session)
      return session
    }

    existing.workspace = workspace
    await refreshSessionState(existing)
    return existing
  }

  async function readUpstream(repoPath: string): Promise<{ upstream?: UpstreamRef; log: PrWorkbenchCommandLog }> {
    return readTrackingRef(repoPath, 'zhSync', '读取 zh upstream', runGit)
  }

  async function inspectZhSync(session: PrWorkbenchSession): Promise<{ result?: ZhSyncStepResult; logs: PrWorkbenchCommandLog[]; failure?: PrWorkbenchError }> {
    const zhRepoPath = path.join(workspaceRoot, session.workspace.zhRepoPath)
    const logs: PrWorkbenchCommandLog[] = []

    const statusResult = await runGit(['status', '--porcelain'], zhRepoPath)
    logs.push(
      toLog(
        'zhSync',
        '读取 zh 工作区状态',
        statusResult.stdout.trim() ? `发现 ${statusResult.stdout.trim().split(/\n+/).length} 条 dirty 记录` : '工作区干净',
        statusResult,
      ),
    )
    if (statusResult.exitCode !== 0) {
      throw createWorkbenchError('zh_status_failed', '读取 zh 仓状态失败', statusResult.stderr || statusResult.stdout)
    }

    const headResult = await runGit(['rev-parse', 'HEAD'], zhRepoPath)
    logs.push(toLog('zhSync', '读取 zh HEAD', `HEAD=${headResult.stdout.trim()}`, headResult))
    if (headResult.exitCode !== 0) {
      throw createWorkbenchError('zh_head_failed', '读取 zh HEAD 失败', headResult.stderr || headResult.stdout)
    }

    const dirtyEntries = statusResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
    const dirtyFiles = parseDirtyFiles(dirtyEntries)
    const zhHeadSha = headResult.stdout.trim()
    const upstreamState = await readUpstream(zhRepoPath)
    logs.push(upstreamState.log)
    if (!upstreamState.upstream) {
      return {
        logs,
        result: {
          checkedAt: new Date().toISOString(),
          zhHeadSha,
          aheadCount: 0,
          behindCount: 0,
          dirtyEntries,
          dirtyFiles,
        },
        failure: {
          code: 'zh_upstream_missing',
          message: '当前分支未配置 upstream tracking 分支',
        },
      }
    }

    const fetchResult = await runGit(['fetch', upstreamState.upstream.remote, upstreamState.upstream.branch], zhRepoPath)
    logs.push(toLog('zhSync', '抓取 zh upstream', `fetch ${upstreamState.upstream.full}`, fetchResult))
    if (fetchResult.exitCode !== 0) {
      return {
        logs,
        result: {
          checkedAt: new Date().toISOString(),
          zhHeadSha,
          upstreamRef: upstreamState.upstream.full,
          aheadCount: 0,
          behindCount: 0,
          dirtyEntries,
          dirtyFiles,
        },
        failure: {
          code: 'zh_fetch_failed',
          message: '获取 zh upstream 最新状态失败',
          detail: fetchResult.stderr || fetchResult.stdout,
        },
      }
    }

    const aheadBehindResult = await runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], zhRepoPath)
    logs.push(toLog('zhSync', '比较 zh ahead/behind', aheadBehindResult.stdout.trim(), aheadBehindResult))
    if (aheadBehindResult.exitCode !== 0) {
      return {
        logs,
        result: {
          checkedAt: new Date().toISOString(),
          zhHeadSha,
          upstreamRef: upstreamState.upstream.full,
          aheadCount: 0,
          behindCount: 0,
          dirtyEntries,
          dirtyFiles,
        },
        failure: {
          code: 'zh_diverged',
          message: '比较 zh 与 upstream 差异失败',
          detail: aheadBehindResult.stderr || aheadBehindResult.stdout,
        },
      }
    }

    const { aheadCount, behindCount } = parseAheadBehind(aheadBehindResult.stdout)
    const result: ZhSyncStepResult = {
      checkedAt: new Date().toISOString(),
      zhHeadSha,
      upstreamRef: upstreamState.upstream.full,
      aheadCount,
      behindCount,
      dirtyEntries,
      dirtyFiles,
    }

    if (dirtyEntries.length > 0) {
      return {
        logs,
        result,
        failure: {
          code: 'zh_dirty',
          message: 'zh 仓存在未提交或未跟踪变更',
          detail: dirtyEntries.join('\n'),
        },
      }
    }

    if (aheadCount !== 0 || behindCount !== 0) {
      return {
        logs,
        result,
        failure: {
          code: 'zh_diverged',
          message: `zh 分支与 ${upstreamState.upstream.full} 未对齐（ahead ${aheadCount} / behind ${behindCount}）`,
        },
      }
    }

    return { result, logs }
  }

  function applyExpectedFailure<T>(session: PrWorkbenchSession, stepId: PrWorkbenchStepId, failure: StepFailure) {
    const step = session.steps[stepId] as PrWorkbenchStepSnapshot<T>
    setStepFailure(step, failure)
    clearReady(session)
    ensureStepBlockedState(session)
    touchSession(session)
  }

  async function executeZhSync(version: string): Promise<PrWorkbenchStepActionResponse> {
    const session = await ensureSession(version)
    const previousZhHead = session.steps.zhSync.result?.zhHeadSha
    setStepRunning(session.steps.zhSync)
    clearReady(session)
    touchSession(session)

    try {
      const { result, logs, failure } = await inspectZhSync(session)
      if (failure) {
        applyExpectedFailure<ZhSyncStepResult>(session, 'zhSync', {
          status: failure.code === 'session_stale' ? 'stale' : 'failed',
          error: failure,
          result,
          logs,
        })
        invalidateDownstream(session, 'zhSync', failure.message)
        return { session: cloneSession(session) }
      }

      if (!result) {
        throw createWorkbenchError('zh_sync_failed', 'zh 仓同步校验失败')
      }

      setStepPassed(session.steps.zhSync, result, logs)
      if (previousZhHead && previousZhHead !== result.zhHeadSha) {
        invalidateDownstream(session, 'zhSync', 'zh HEAD 已变化，需重跑 fork 更新与构建。')
      }
      ensureStepBlockedState(session)
      touchSession(session)
      return { session: cloneSession(session) }
    } catch (error) {
      const normalized = toWorkbenchError(error, 'zh_sync_failed', 'zh 仓同步校验失败')
      if (!SESSION_FAILURE_CODES.has(normalized.code)) {
        throw createWorkbenchError(normalized.code, normalized.message, normalized.detail)
      }

      applyExpectedFailure<ZhSyncStepResult>(session, 'zhSync', {
        status: normalized.code === 'session_stale' ? 'stale' : 'failed',
        error: normalized,
        result: session.steps.zhSync.result,
        logs: session.steps.zhSync.logs,
      })
      invalidateDownstream(session, 'zhSync', normalized.message)
      return { session: cloneSession(session) }
    }
  }

  async function executeZhRemoteAction(version: string, action: 'pull' | 'push'): Promise<PrWorkbenchStepActionResponse> {
    const session = await ensureSession(version)
    const previousZhHead = session.steps.zhSync.result?.zhHeadSha
    setStepRunning(session.steps.zhSync)
    clearReady(session)
    touchSession(session)

    const zhRepoPath = path.join(workspaceRoot, session.workspace.zhRepoPath)
    const logs: PrWorkbenchCommandLog[] = []

    try {
      const inspected = await inspectZhSync(session)
      logs.push(...inspected.logs)

      if (!inspected.result) {
        throw createWorkbenchError('zh_sync_failed', 'zh 仓同步校验失败')
      }

      const syncResult = inspected.result
      if (syncResult.dirtyEntries.length > 0) {
        throw createWorkbenchError('zh_dirty', 'zh 仓存在未提交或未跟踪变更', syncResult.dirtyEntries.join('\n'))
      }

      if (!syncResult.upstreamRef) {
        throw createWorkbenchError('zh_upstream_missing', '当前分支未配置 upstream tracking 分支')
      }

      const upstream = parseUpstreamRef(syncResult.upstreamRef)
      if (action === 'pull') {
        if (syncResult.behindCount <= 0 || syncResult.aheadCount !== 0) {
          throw createWorkbenchError('zh_pull_not_available', '当前 zh 仓不可直接拉取；需保持工作区干净且仅 behind。')
        }

        const pullResult = await runGit(['pull', '--ff-only', upstream.remote, upstream.branch], zhRepoPath)
        logs.push(toLog('zhSync', '拉取 zh upstream', `git pull --ff-only ${upstream.full}`, pullResult))
        if (pullResult.exitCode !== 0) {
          throw createWorkbenchError('zh_pull_failed', '拉取 zh upstream 失败', pullResult.stderr || pullResult.stdout)
        }
      } else {
        if (syncResult.aheadCount <= 0 || syncResult.behindCount !== 0) {
          throw createWorkbenchError('zh_push_not_available', '当前 zh 仓不可直接推送；需保持工作区干净且仅 ahead。')
        }

        const pushResult = await runGit(['push', upstream.remote, `HEAD:${upstream.branch}`], zhRepoPath)
        logs.push(toLog('zhSync', '推送 zh upstream', `git push ${upstream.remote} HEAD:${upstream.branch}`, pushResult))
        if (pushResult.exitCode !== 0) {
          throw createWorkbenchError('zh_push_failed', '推送 zh upstream 失败', pushResult.stderr || pushResult.stdout)
        }
      }

      const refreshed = await inspectZhSync(session)
      logs.push(...refreshed.logs)
      if (refreshed.failure) {
        applyExpectedFailure<ZhSyncStepResult>(session, 'zhSync', {
          error: refreshed.failure,
          result: refreshed.result,
          logs,
        })
        invalidateDownstream(session, 'zhSync', refreshed.failure.message)
        return { session: cloneSession(session) }
      }

      if (!refreshed.result) {
        throw createWorkbenchError('zh_sync_failed', 'zh 仓同步校验失败')
      }

      setStepPassed(session.steps.zhSync, refreshed.result, logs)
      if (previousZhHead && previousZhHead !== refreshed.result.zhHeadSha) {
        invalidateDownstream(session, 'zhSync', 'zh HEAD 已变化，需重跑 fork 更新与构建。')
      }
      ensureStepBlockedState(session)
      touchSession(session)
      return { session: cloneSession(session) }
    } catch (error) {
      const fallbackCode = action === 'pull' ? 'zh_pull_failed' : 'zh_push_failed'
      const fallbackMessage = action === 'pull' ? '拉取 zh upstream 失败' : '推送 zh upstream 失败'
      const normalized = toWorkbenchError(error, fallbackCode, fallbackMessage)
      if (!SESSION_FAILURE_CODES.has(normalized.code)) {
        throw createWorkbenchError(normalized.code, normalized.message, normalized.detail)
      }

      applyExpectedFailure<ZhSyncStepResult>(session, 'zhSync', {
        error: normalized,
        result: session.steps.zhSync.result,
        logs: logs.length > 0 ? logs : session.steps.zhSync.logs,
      })
      invalidateDownstream(session, 'zhSync', normalized.message)
      return { session: cloneSession(session) }
    }
  }

  async function executeForkRefresh(version: string): Promise<PrWorkbenchStepActionResponse> {
    const session = await ensureSession(version)
    const zhResult = session.steps.zhSync.result
    if (session.steps.zhSync.status !== 'passed' || !zhResult) {
      applyExpectedFailure<ForkRefreshStepResult>(session, 'forkRefresh', {
        error: { code: 'prerequisite_failed', message: '需先通过 zh 仓同步校验' },
        logs: session.steps.forkRefresh.logs,
        result: session.steps.forkRefresh.result,
      })
      return { session: cloneSession(session) }
    }

    setStepRunning(session.steps.forkRefresh)
    clearReady(session)
    touchSession(session)

    const zhRepoPath = path.join(workspaceRoot, session.workspace.zhRepoPath)
    const forkRepoPath = path.join(workspaceRoot, session.workspace.forkRepoPath)
    const submodulePath = session.workspace.submodulePath
    const logs: PrWorkbenchCommandLog[] = []

    try {
      const currentZhHeadSha = await readHeadSha(zhRepoPath)
      if (currentZhHeadSha !== zhResult.zhHeadSha) {
        setStepStale(session.steps.zhSync, 'zh HEAD 已变化，需重新校验。')
        invalidateDownstream(session, 'zhSync', 'zh HEAD 已变化。')
        throw createWorkbenchError('session_stale', 'zh HEAD 已变化，需先重新执行步骤 1')
      }

      const dirtyResult = await runGit(['status', '--porcelain', '--ignore-submodules=none'], forkRepoPath)
      logs.push(toLog('forkRefresh', '读取 fork 工作区状态', dirtyResult.stdout.trim() ? 'fork 工作区存在 dirty 记录' : 'fork 工作区干净', dirtyResult))
      if (dirtyResult.exitCode !== 0) {
        throw createWorkbenchError('fork_status_failed', '读取 fork 仓状态失败', dirtyResult.stderr || dirtyResult.stdout)
      }

      const dirtyEntries = dirtyResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
      if (dirtyEntries.length > 0) {
        throw createWorkbenchError('fork_dirty', 'fork 仓存在未提交或未跟踪变更', dirtyEntries.join('\n'))
      }

      const previousForkHeadSha = await readHeadSha(forkRepoPath)
      const fetchResult = await runGit(['fetch', session.workspace.forkUpstreamRemote, session.workspace.forkBranch], forkRepoPath)
      logs.push(toLog('forkRefresh', '抓取 fork upstream', `fetch ${session.workspace.forkUpstreamRemote}/${session.workspace.forkBranch}`, fetchResult))
      if (fetchResult.exitCode !== 0) {
        throw createWorkbenchError('fork_fetch_failed', '抓取 fork upstream 失败', fetchResult.stderr || fetchResult.stdout)
      }

      const mergeResult = await runGit(['merge', '--ff-only', `${session.workspace.forkUpstreamRemote}/${session.workspace.forkBranch}`], forkRepoPath)
      logs.push(toLog('forkRefresh', 'fast-forward fork', `merge --ff-only ${session.workspace.forkUpstreamRemote}/${session.workspace.forkBranch}`, mergeResult))
      if (mergeResult.exitCode !== 0) {
        throw createWorkbenchError('fork_fast_forward_failed', 'fork 分支无法 fast-forward 到 upstream', mergeResult.stderr || mergeResult.stdout)
      }

      const initResult = await runGit(['submodule', 'update', '--init', '--', submodulePath], forkRepoPath)
      logs.push(toLog('forkRefresh', '初始化 docs-zh submodule', `git submodule update --init -- ${submodulePath}`, initResult))
      if (initResult.exitCode !== 0) {
        throw createWorkbenchError('submodule_init_failed', '初始化 docs-zh submodule 失败', initResult.stderr || initResult.stdout)
      }

      const absoluteSubmodulePath = path.join(forkRepoPath, submodulePath)
      const submoduleFetchResult = await runGit(['fetch', 'origin', zhResult.zhHeadSha], absoluteSubmodulePath)
      logs.push(toLog('forkRefresh', '抓取目标 zh SHA', `git fetch origin ${zhResult.zhHeadSha}`, submoduleFetchResult))
      if (submoduleFetchResult.exitCode !== 0) {
        throw createWorkbenchError('submodule_fetch_failed', '抓取 docs-zh 目标提交失败', submoduleFetchResult.stderr || submoduleFetchResult.stdout)
      }

      const checkoutResult = await runGit(['checkout', '--detach', zhResult.zhHeadSha], absoluteSubmodulePath)
      logs.push(toLog('forkRefresh', '切换 docs-zh SHA', `git checkout --detach ${zhResult.zhHeadSha}`, checkoutResult))
      if (checkoutResult.exitCode !== 0) {
        throw createWorkbenchError('submodule_checkout_failed', '切换 docs-zh 到目标 SHA 失败', checkoutResult.stderr || checkoutResult.stdout)
      }

      const [forkHeadSha, submoduleSha] = await Promise.all([readHeadSha(forkRepoPath), readHeadSha(absoluteSubmodulePath)])
      if (submoduleSha !== zhResult.zhHeadSha) {
        throw createWorkbenchError('submodule_sha_mismatch', 'docs-zh submodule 未对齐到已校验 zh SHA')
      }

      const result: ForkRefreshStepResult = {
        checkedAt: new Date().toISOString(),
        zhHeadSha: zhResult.zhHeadSha,
        upstreamRef: `${session.workspace.forkUpstreamRemote}/${session.workspace.forkBranch}`,
        forkHeadSha,
        previousForkHeadSha,
        submodulePath,
        submoduleSha,
        dirtyEntries,
      }
      setStepPassed(session.steps.forkRefresh, result, logs)
      ensureStepBlockedState(session)
      touchSession(session)
      return { session: cloneSession(session) }
    } catch (error) {
      const normalized = toWorkbenchError(error, 'fork_refresh_failed', 'fork 更新失败')
      if (!SESSION_FAILURE_CODES.has(normalized.code)) {
        throw createWorkbenchError(normalized.code, normalized.message, normalized.detail)
      }

      applyExpectedFailure<ForkRefreshStepResult>(session, 'forkRefresh', {
        status: normalized.code === 'session_stale' ? 'stale' : 'failed',
        error: normalized,
        result: session.steps.forkRefresh.result,
        logs,
      })
      invalidateDownstream(session, 'forkRefresh', normalized.message)
      return { session: cloneSession(session) }
    }
  }

  async function executeForkCommit(version: string): Promise<PrWorkbenchStepActionResponse> {
    const session = await ensureSession(version)
    const forkResult = session.steps.forkRefresh.result
    if (session.steps.forkRefresh.status !== 'passed' || !forkResult) {
      applyExpectedFailure<ForkRefreshStepResult>(session, 'forkRefresh', {
        error: { code: 'prerequisite_failed', message: '需先完成 fork 更新与 submodule 对齐' },
        logs: session.steps.forkRefresh.logs,
        result: session.steps.forkRefresh.result,
      })
      return { session: cloneSession(session) }
    }

    const forkRepoPath = path.join(workspaceRoot, session.workspace.forkRepoPath)
    const absoluteSubmodulePath = path.join(forkRepoPath, session.workspace.submodulePath)
    const logs = [...session.steps.forkRefresh.logs]

    try {
      const [currentForkHeadSha, currentSubmoduleSha] = await Promise.all([
        readHeadSha(forkRepoPath),
        readSubmoduleSha(forkRepoPath, session.workspace.submodulePath),
      ])
      if (currentForkHeadSha !== forkResult.forkHeadSha || currentSubmoduleSha !== forkResult.submoduleSha) {
        setStepStale(session.steps.forkRefresh, 'fork HEAD 或 docs-zh submodule 已变化，需重新执行。')
        invalidateDownstream(session, 'forkRefresh', 'fork HEAD 或 docs-zh submodule 已变化。')
        throw createWorkbenchError('session_stale', 'fork HEAD 或 docs-zh submodule 已变化，需先重跑步骤 2')
      }

      const statusResult = await runGit(['status', '--porcelain', '--ignore-submodules=none'], forkRepoPath)
      logs.push(toLog('forkRefresh', '读取 fork 待提交状态', statusResult.stdout.trim() ? 'fork 存在待提交变更' : 'fork 无待提交变更', statusResult))
      if (statusResult.exitCode !== 0) {
        throw createWorkbenchError('fork_commit_failed', '读取 fork 待提交状态失败', statusResult.stderr || statusResult.stdout)
      }

      const dirtyEntries = statusResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
      if (dirtyEntries.length === 0) {
        throw createWorkbenchError('fork_commit_not_available', 'fork 当前无待提交变更。')
      }

      const dirtyFiles = parseDirtyFiles(dirtyEntries)
      const allowedPaths = new Set([session.workspace.submodulePath])
      if (dirtyFiles.some((filePath) => !allowedPaths.has(filePath))) {
        throw createWorkbenchError('fork_commit_not_available', 'fork 存在非 docs-zh 的待提交变更，宜回终端手工处理。', dirtyEntries.join('\n'))
      }

      const addResult = await runGit(['add', '--', session.workspace.submodulePath], forkRepoPath)
      logs.push(toLog('forkRefresh', '暂存 docs-zh 指针', `git add -- ${session.workspace.submodulePath}`, addResult))
      if (addResult.exitCode !== 0) {
        throw createWorkbenchError('fork_commit_failed', '暂存 docs-zh 指针失败', addResult.stderr || addResult.stdout)
      }

      const commitMessage = `chore(docs-zh): sync ${session.version} to ${forkResult.submoduleSha.slice(0, 8)}`
      const commitResult = await runGit(['commit', '-m', commitMessage], forkRepoPath)
      logs.push(toLog('forkRefresh', '提交 fork 变更', `git commit -m "${commitMessage}"`, commitResult))
      if (commitResult.exitCode !== 0) {
        throw createWorkbenchError('fork_commit_failed', '提交 fork 变更失败', commitResult.stderr || commitResult.stdout)
      }

      const [forkHeadSha, submoduleSha] = await Promise.all([readHeadSha(forkRepoPath), readHeadSha(absoluteSubmodulePath)])
      const result: ForkRefreshStepResult = {
        checkedAt: new Date().toISOString(),
        zhHeadSha: forkResult.zhHeadSha,
        upstreamRef: forkResult.upstreamRef,
        forkHeadSha,
        previousForkHeadSha: forkResult.forkHeadSha,
        submodulePath: forkResult.submodulePath,
        submoduleSha,
        dirtyEntries: [],
      }
      setStepPassed(session.steps.forkRefresh, result, logs)
      invalidateDownstream(session, 'forkRefresh', 'fork 已生成新提交，需重跑构建。')
      ensureStepBlockedState(session)
      touchSession(session)
      return { session: cloneSession(session) }
    } catch (error) {
      const normalized = toWorkbenchError(error, 'fork_commit_failed', '提交 fork 变更失败')
      if (!SESSION_FAILURE_CODES.has(normalized.code)) {
        throw createWorkbenchError(normalized.code, normalized.message, normalized.detail)
      }

      applyExpectedFailure<ForkRefreshStepResult>(session, 'forkRefresh', {
        status: normalized.code === 'session_stale' ? 'stale' : 'failed',
        error: normalized,
        result: session.steps.forkRefresh.result,
        logs,
      })
      invalidateDownstream(session, 'forkRefresh', normalized.message)
      return { session: cloneSession(session) }
    }
  }

  async function executeForkPush(version: string): Promise<PrWorkbenchStepActionResponse> {
    const session = await ensureSession(version)
    const buildResult = session.steps.buildVerification.result
    if (session.steps.buildVerification.status !== 'passed' || !buildResult) {
      applyExpectedFailure<BuildVerificationStepResult>(session, 'buildVerification', {
        error: { code: 'prerequisite_failed', message: '需先完成本地构建验证' },
        logs: session.steps.buildVerification.logs,
        result: session.steps.buildVerification.result,
      })
      return { session: cloneSession(session) }
    }

    const forkRepoPath = path.join(workspaceRoot, session.workspace.forkRepoPath)
    const logs = [...session.steps.buildVerification.logs]

    try {
      const [currentForkHeadSha, currentSubmoduleSha] = await Promise.all([
        readHeadSha(forkRepoPath),
        readSubmoduleSha(forkRepoPath, session.workspace.submodulePath),
      ])
      if (currentForkHeadSha !== buildResult.forkHeadSha || currentSubmoduleSha !== buildResult.submoduleSha) {
        setStepStale(session.steps.buildVerification, '构建所绑定的 SHA 已失效，需重跑构建。')
        clearReady(session)
        throw createWorkbenchError('session_stale', 'fork HEAD 或 docs-zh submodule 已变化，需先重跑构建')
      }

      const trackingState = await readTrackingRef(forkRepoPath, 'buildVerification', '读取 fork upstream', runGit)
      logs.push(trackingState.log)
      if (!trackingState.upstream) {
        throw createWorkbenchError('fork_push_not_available', 'fork 当前分支未配置 upstream tracking 分支。')
      }

      const statusResult = await runGit(['status', '--porcelain', '--ignore-submodules=none'], forkRepoPath)
      logs.push(toLog('buildVerification', '读取 fork 推送状态', statusResult.stdout.trim() ? 'fork 工作区存在未提交变更' : 'fork 工作区干净', statusResult))
      if (statusResult.exitCode !== 0) {
        throw createWorkbenchError('fork_push_failed', '读取 fork 推送状态失败', statusResult.stderr || statusResult.stdout)
      }
      if (statusResult.stdout.trim()) {
        throw createWorkbenchError('fork_push_not_available', 'fork 工作区存在未提交变更，暂不可推送。', statusResult.stdout.trim())
      }

      const fetchResult = await runGit(['fetch', trackingState.upstream.remote, trackingState.upstream.branch], forkRepoPath)
      logs.push(toLog('buildVerification', '抓取 fork origin', `fetch ${trackingState.upstream.full}`, fetchResult))
      if (fetchResult.exitCode !== 0) {
        throw createWorkbenchError('fork_push_failed', '抓取 fork origin 失败', fetchResult.stderr || fetchResult.stdout)
      }

      const aheadBehindResult = await runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], forkRepoPath)
      logs.push(toLog('buildVerification', '比较 fork ahead/behind', aheadBehindResult.stdout.trim(), aheadBehindResult))
      if (aheadBehindResult.exitCode !== 0) {
        throw createWorkbenchError('fork_push_failed', '比较 fork 与 upstream 差异失败', aheadBehindResult.stderr || aheadBehindResult.stdout)
      }

      const { aheadCount, behindCount } = parseAheadBehind(aheadBehindResult.stdout)
      if (behindCount > 0 || aheadCount === 0) {
        throw createWorkbenchError('fork_push_not_available', behindCount > 0 ? 'fork 分支已落后或分叉，暂不可直接推送。' : 'fork 当前无可推送提交。')
      }

      const pushResult = await runGit(['push', trackingState.upstream.remote, `HEAD:${trackingState.upstream.branch}`], forkRepoPath)
      logs.push(toLog('buildVerification', '推送 fork 分支', `git push ${trackingState.upstream.remote} HEAD:${trackingState.upstream.branch}`, pushResult))
      if (pushResult.exitCode !== 0) {
        throw createWorkbenchError('fork_push_failed', '推送 fork 分支失败', pushResult.stderr || pushResult.stdout)
      }

      setStepPassed(session.steps.buildVerification, buildResult, logs)
      session.readySummary = buildReadySummary(session)
      session.ready = Boolean(session.readySummary)
      touchSession(session)
      return { session: cloneSession(session) }
    } catch (error) {
      const normalized = toWorkbenchError(error, 'fork_push_failed', '推送 fork 分支失败')
      if (!SESSION_FAILURE_CODES.has(normalized.code)) {
        throw createWorkbenchError(normalized.code, normalized.message, normalized.detail)
      }

      applyExpectedFailure<BuildVerificationStepResult>(session, 'buildVerification', {
        status: normalized.code === 'session_stale' ? 'stale' : 'failed',
        error: normalized,
        result: session.steps.buildVerification.result,
        logs,
      })
      return { session: cloneSession(session) }
    }
  }

  function buildReadySummary(session: PrWorkbenchSession): ReadySummary | undefined {
    const zhResult = session.steps.zhSync.result
    const forkResult = session.steps.forkRefresh.result
    const buildResult = session.steps.buildVerification.result
    if (!zhResult || !forkResult || !buildResult || session.steps.buildVerification.status !== 'passed') {
      return undefined
    }

    return {
      version: session.version,
      zhHeadSha: zhResult.zhHeadSha,
      forkHeadSha: forkResult.forkHeadSha,
      submoduleSha: forkResult.submoduleSha,
      buildVerifiedAt: buildResult.finishedAt,
      buildCommandLabel: buildResult.commandLabel,
    }
  }

  async function executeBuildVerification(version: string): Promise<PrWorkbenchStepActionResponse> {
    const session = await ensureSession(version)
    const forkResult = session.steps.forkRefresh.result
    if (session.steps.forkRefresh.status !== 'passed' || !forkResult) {
      applyExpectedFailure<BuildVerificationStepResult>(session, 'buildVerification', {
        error: { code: 'prerequisite_failed', message: '需先完成 fork 更新与 submodule 对齐' },
        logs: session.steps.buildVerification.logs,
        result: session.steps.buildVerification.result,
      })
      return { session: cloneSession(session) }
    }

    setStepRunning(session.steps.buildVerification)
    clearReady(session)
    touchSession(session)

    const forkRepoPath = path.join(workspaceRoot, session.workspace.forkRepoPath)
    const absoluteSubmodulePath = path.join(forkRepoPath, session.workspace.submodulePath)
    const logs: PrWorkbenchCommandLog[] = []

    try {
      if (!session.workspace.buildScript) {
        throw createWorkbenchError('build_command_missing', 'fork 仓未定义 package.json scripts.build，无法执行本地构建')
      }

      const [currentForkHeadSha, currentSubmoduleSha] = await Promise.all([
        readHeadSha(forkRepoPath),
        readSubmoduleSha(forkRepoPath, session.workspace.submodulePath),
      ])
      if (currentForkHeadSha !== forkResult.forkHeadSha || currentSubmoduleSha !== forkResult.submoduleSha) {
        setStepStale(session.steps.forkRefresh, 'fork HEAD 或 submodule 已变化，需重新执行步骤 2。')
        invalidateDownstream(session, 'forkRefresh', 'fork HEAD 或 docs-zh submodule 已变化。')
        throw createWorkbenchError('session_stale', 'fork HEAD 或 docs-zh submodule 已变化，需先重跑步骤 2')
      }

      const buildResult = await runNpm(['run', session.workspace.buildScriptName], forkRepoPath)
      logs.push(toLog('buildVerification', '执行本地构建', session.workspace.buildCommandLabel, buildResult))

      const [refreshedForkHeadSha, refreshedSubmoduleSha] = await Promise.all([readHeadSha(forkRepoPath), readHeadSha(absoluteSubmodulePath)])
      const result: BuildVerificationStepResult = {
        startedAt: buildResult.startedAt,
        finishedAt: buildResult.finishedAt,
        command: buildResult.command,
        commandLabel: session.workspace.buildCommandLabel,
        exitCode: buildResult.exitCode,
        succeeded: buildResult.exitCode === 0,
        stdout: buildResult.stdout,
        stderr: buildResult.stderr,
        forkHeadSha: refreshedForkHeadSha,
        submoduleSha: refreshedSubmoduleSha,
      }

      if (refreshedForkHeadSha !== forkResult.forkHeadSha || refreshedSubmoduleSha !== forkResult.submoduleSha) {
        throw createWorkbenchError('build_state_changed', '构建前后 fork HEAD 或 docs-zh submodule 已变化，Ready 结果无效')
      }

      if (buildResult.exitCode !== 0) {
        throw createWorkbenchError('build_failed', '本地构建失败，请查看最近日志')
      }

      setStepPassed(session.steps.buildVerification, result, logs)
      session.readySummary = buildReadySummary(session)
      session.ready = Boolean(session.readySummary)
      touchSession(session)
      return { session: cloneSession(session) }
    } catch (error) {
      const normalized = toWorkbenchError(error, 'build_failed', '本地构建失败')
      if (!SESSION_FAILURE_CODES.has(normalized.code)) {
        throw createWorkbenchError(normalized.code, normalized.message, normalized.detail)
      }

      applyExpectedFailure<BuildVerificationStepResult>(session, 'buildVerification', {
        status: normalized.code === 'session_stale' || normalized.code === 'build_state_changed' ? 'stale' : 'failed',
        error: normalized,
        result: session.steps.buildVerification.result,
        logs,
      })
      return { session: cloneSession(session) }
    }
  }

  return {
    listVersions,
    async getSession(version: string) {
      const session = await ensureSession(version)
      return cloneSession(session)
    },
    checkZhSync: executeZhSync,
    pullZh: async (version) => executeZhRemoteAction(version, 'pull'),
    pushZh: async (version) => executeZhRemoteAction(version, 'push'),
    updateFork: executeForkRefresh,
    commitFork: executeForkCommit,
    pushFork: executeForkPush,
    verifyBuild: executeBuildVerification,
  }
}

export function createDefaultPrWorkbenchAdmin(workspaceRoot: string) {
  return createPrWorkbenchAdmin({ workspaceRoot })
}
