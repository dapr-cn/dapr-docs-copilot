export const PR_WORKBENCH_POLL_INTERVAL_MS = 1500
export const PR_WORKBENCH_SUBMODULE_PATH = 'translations/docs-zh'
export const PR_WORKBENCH_BUILD_SCRIPT = 'build'
export const PR_WORKBENCH_STEP_ORDER = ['zhSync', 'forkRefresh', 'buildVerification'] as const
export const PR_WORKBENCH_STEP_STATUSES = ['idle', 'running', 'passed', 'failed', 'stale', 'blocked'] as const

export type PrWorkbenchStepId = (typeof PR_WORKBENCH_STEP_ORDER)[number]
export type PrWorkbenchStepStatus = (typeof PR_WORKBENCH_STEP_STATUSES)[number]

export type PrWorkbenchError = {
  code: string
  message: string
  detail?: string
}

export type PrWorkbenchCommandLog = {
  id: string
  scope: PrWorkbenchStepId
  title: string
  summary: string
  command?: string
  cwd?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  startedAt: string
  finishedAt?: string
}

export type PrWorkbenchVersionWorkspace = {
  version: string
  label: string
  zhRepoPath: string
  forkRepoPath: string
  zhBranch: string
  forkBranch: string
  zhRemote: string
  forkUpstreamRemote: string
  submodulePath: string
  buildScriptName: string
  buildCommandLabel: string
  buildScript?: string
}

export type PrWorkbenchVersionsResponse = {
  versions: PrWorkbenchVersionWorkspace[]
}

export type ZhSyncStepResult = {
  checkedAt: string
  zhHeadSha: string
  upstreamRef?: string
  aheadCount: number
  behindCount: number
  dirtyEntries: string[]
  dirtyFiles: string[]
}

export type ForkRefreshStepResult = {
  checkedAt: string
  zhHeadSha: string
  upstreamRef: string
  forkHeadSha: string
  previousForkHeadSha: string
  submodulePath: string
  submoduleSha: string
  dirtyEntries: string[]
}

export type BuildVerificationStepResult = {
  startedAt: string
  finishedAt: string
  command: string[]
  commandLabel: string
  exitCode: number
  succeeded: boolean
  stdout: string
  stderr: string
  forkHeadSha: string
  submoduleSha: string
}

export type ReadySummary = {
  version: string
  zhHeadSha: string
  forkHeadSha: string
  submoduleSha: string
  buildVerifiedAt: string
  buildCommandLabel: string
}

export type PrWorkbenchStepSnapshot<T> = {
  id: PrWorkbenchStepId
  title: string
  status: PrWorkbenchStepStatus
  description: string
  lastUpdatedAt?: string
  blockedReason?: string
  staleReason?: string
  error?: PrWorkbenchError
  result?: T
  logs: PrWorkbenchCommandLog[]
}

export type PrWorkbenchSession = {
  version: string
  workspace: PrWorkbenchVersionWorkspace
  ready: boolean
  readySummary?: ReadySummary
  lastUpdatedAt: string
  steps: {
    zhSync: PrWorkbenchStepSnapshot<ZhSyncStepResult>
    forkRefresh: PrWorkbenchStepSnapshot<ForkRefreshStepResult>
    buildVerification: PrWorkbenchStepSnapshot<BuildVerificationStepResult>
  }
}

export type PrWorkbenchStepActionResponse = {
  session: PrWorkbenchSession
}

export type PrWorkbenchApiSuccess<T> = {
  ok: true
  data: T
}

export type PrWorkbenchApiFailure = {
  ok: false
  error: PrWorkbenchError
}

export function isRunningPrWorkbenchSession(session: PrWorkbenchSession | undefined): boolean {
  if (!session) {
    return false
  }

  return PR_WORKBENCH_STEP_ORDER.some((stepId) => session.steps[stepId].status === 'running')
}

export function getPrWorkbenchPollInterval(session: PrWorkbenchSession | undefined): number | false {
  return isRunningPrWorkbenchSession(session) ? PR_WORKBENCH_POLL_INTERVAL_MS : false
}

export function isPrWorkbenchStepPassed(status: PrWorkbenchStepStatus): boolean {
  return status === 'passed'
}
