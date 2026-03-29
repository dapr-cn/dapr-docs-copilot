import { RefreshCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { LogPanel } from '@/components/pr-workbench/log-panel'
import { StepCard } from '@/components/pr-workbench/step-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type BuildVerificationStepResult,
  type ForkRefreshStepResult,
  type PrWorkbenchCommandLog,
  type PrWorkbenchSession,
  type PrWorkbenchVersionWorkspace,
  type ZhSyncStepResult,
} from '@/lib/pr-workbench-models'

type PrWorkbenchViewProps = {
  isDev: boolean
  versions: PrWorkbenchVersionWorkspace[]
  selectedVersion: string
  session?: PrWorkbenchSession
  isLoadingVersions?: boolean
  isLoadingSession?: boolean
  isMutating?: boolean
  bannerMessage?: string
  bannerTone?: 'default' | 'good' | 'warn'
  versionsErrorMessage?: string
  sessionErrorMessage?: string
  onSelectVersion: (version: string) => void
  onRefresh: () => void
  onCheckZhSync: () => void
  onPullZh: () => void
  onPushZh: () => void
  onRefreshFork: () => void
  onCommitFork: () => void
  onVerifyBuild: () => void
  onPushFork: () => void
}

function formatSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 8) : '未记录'
}

function collectLogs(session: PrWorkbenchSession | undefined): PrWorkbenchCommandLog[] {
  if (!session) {
    return []
  }

  return [session.steps.buildVerification, session.steps.forkRefresh, session.steps.zhSync]
    .flatMap((step) => step.logs)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

function renderZhSummary(result: ZhSyncStepResult | undefined) {
  if (!result) {
    return <p className="text-sm leading-6 text-muted-foreground">未执行。通过后才可进入 fork 更新。</p>
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <InfoBlock label="zh HEAD" value={formatSha(result.zhHeadSha)} hint={result.upstreamRef ?? '未配置 upstream'} />
      <InfoBlock label="ahead" value={String(result.aheadCount)} hint="相对 upstream" />
      <InfoBlock label="behind" value={String(result.behindCount)} hint="相对 upstream" />
      <InfoBlock label="dirty" value={String(result.dirtyFiles.length)} hint={result.dirtyFiles[0] ?? '工作区干净'} />
    </div>
  )
}

function renderForkSummary(result: ForkRefreshStepResult | undefined) {
  if (!result) {
    return <p className="text-sm leading-6 text-muted-foreground">未执行。需先拿到通过的 zh HEAD。</p>
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <InfoBlock label="upstream" value={result.upstreamRef} hint={`from ${formatSha(result.previousForkHeadSha)}`} />
      <InfoBlock label="fork HEAD" value={formatSha(result.forkHeadSha)} hint="fast-forward 结果" />
      <InfoBlock label="docs-zh" value={formatSha(result.submoduleSha)} hint={result.submodulePath} />
      <InfoBlock label="绑定 zh" value={formatSha(result.zhHeadSha)} hint="通过校验的提交" />
    </div>
  )
}

function renderBuildSummary(result: BuildVerificationStepResult | undefined) {
  if (!result) {
    return <p className="text-sm leading-6 text-muted-foreground">未执行。构建通过前，不给 Ready 结论。</p>
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <InfoBlock label="命令" value={result.commandLabel} hint={result.command.join(' ')} />
      <InfoBlock label="exit code" value={String(result.exitCode)} hint={result.succeeded ? '构建成功' : '构建失败'} />
      <InfoBlock label="fork HEAD" value={formatSha(result.forkHeadSha)} hint={result.startedAt} />
      <InfoBlock label="docs-zh" value={formatSha(result.submoduleSha)} hint={result.finishedAt} />
    </div>
  )
}

type InfoBlockProps = {
  label: string
  value: string
  hint: string
}

function InfoBlock({ label, value, hint }: InfoBlockProps) {
  return (
    <div className="rounded-[22px] border border-border/70 bg-background/80 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
      <p className="mt-3 break-all font-mono text-sm text-foreground">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
  )
}

export function PrWorkbenchView({
  isDev,
  versions,
  selectedVersion,
  session,
  isLoadingVersions = false,
  isLoadingSession = false,
  isMutating = false,
  bannerMessage,
  bannerTone = 'default',
  versionsErrorMessage,
  sessionErrorMessage,
  onSelectVersion,
  onRefresh,
  onCheckZhSync,
  onPullZh,
  onPushZh,
  onRefreshFork,
  onCommitFork,
  onVerifyBuild,
  onPushFork,
}: PrWorkbenchViewProps) {
  const logs = collectLogs(session)
  const readySummary = session?.readySummary
  const zhResult = session?.steps.zhSync.result
  const canRunZhSync = Boolean(isDev && selectedVersion && !isMutating)
  const canRunForkRefresh = Boolean(isDev && selectedVersion && session && session.steps.zhSync.status === 'passed' && !isMutating)
  const canCommitFork = Boolean(isDev && selectedVersion && session && session.steps.forkRefresh.status === 'passed' && !isMutating)
  const canRunBuild = Boolean(isDev && selectedVersion && session && session.steps.forkRefresh.status === 'passed' && !isMutating)
  const canPushFork = Boolean(isDev && selectedVersion && session && session.steps.buildVerification.status === 'passed' && !isMutating)
  const canPullZh = Boolean(isDev && selectedVersion && zhResult && zhResult.dirtyFiles.length === 0 && zhResult.aheadCount === 0 && zhResult.behindCount > 0 && !isMutating)
  const canPushZh = Boolean(isDev && selectedVersion && zhResult && zhResult.dirtyFiles.length === 0 && zhResult.behindCount === 0 && zhResult.aheadCount > 0 && !isMutating)
  const noVersion = versions.length === 0

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/90">
        <CardHeader className="gap-4 border-b border-border/70 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">PR 工作台</Badge>
              <Badge variant={readySummary ? 'success' : 'secondary'}>{readySummary ? 'Ready for PR' : '待校验'}</Badge>
              {session?.workspace ? <Badge variant="secondary">{session.workspace.buildCommandLabel}</Badge> : null}
            </div>
            <div>
              <CardTitle>先锁版本，再给 PR 放行。</CardTitle>
              <CardDescription>重点是：版本、fork、submodule、build 同屏闭环。前一步不过，后一步不许动。</CardDescription>
            </div>
            {bannerMessage ? (
              <Badge variant={bannerTone === 'warn' ? 'warning' : bannerTone === 'good' ? 'success' : 'secondary'} className="w-fit">
                {bannerMessage}
              </Badge>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(220px,260px)_auto]">
            <label className="grid gap-2 text-sm text-muted-foreground">
              <span>版本</span>
              <select
                className="h-11 rounded-2xl border border-border bg-background/80 px-4 text-foreground outline-none"
                value={selectedVersion}
                disabled={isLoadingVersions || isMutating || noVersion}
                onChange={(event) => onSelectVersion(event.currentTarget.value)}
              >
                <option value="">选择版本</option>
                {versions.map((version) => (
                  <option key={version.version} value={version.version}>
                    {version.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap items-end gap-3">
              <Button variant="outline" onClick={onRefresh} disabled={isLoadingVersions || isLoadingSession || isMutating}>
                <RefreshCcw className="size-4" />
                刷新状态
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <InfoBlock label="zh 仓" value={session?.workspace.zhRepoPath ?? '未锁定'} hint={session?.workspace.zhBranch ?? '等待选择版本'} />
            <InfoBlock label="fork 仓" value={session?.workspace.forkRepoPath ?? '未锁定'} hint={session?.workspace.forkBranch ?? '等待选择版本'} />
            <InfoBlock label="docs-zh" value={session?.workspace.submodulePath ?? '未锁定'} hint={session?.workspace.forkUpstreamRemote ?? '默认 source'} />
          </div>

          <Card className="bg-background/75">
            <CardHeader>
              <Badge variant={readySummary ? 'success' : 'outline'} className="w-fit gap-2">
                {readySummary ? <ShieldCheck className="size-3.5" /> : <Sparkles className="size-3.5" />}
                {readySummary ? 'Ready 摘要' : 'Ready 未就绪'}
              </Badge>
              <CardTitle>{readySummary ? '当前版本可进入 PR 准备' : '结论未成立'}</CardTitle>
              <CardDescription>
                {readySummary
                  ? `zh=${formatSha(readySummary.zhHeadSha)} / fork=${formatSha(readySummary.forkHeadSha)} / docs-zh=${formatSha(readySummary.submoduleSha)}`
                  : '需依次通过 zh 校验、fork 更新、构建验证，方可给出 Ready。'}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 text-sm leading-6 text-muted-foreground">
              {readySummary ? `build 于 ${readySummary.buildVerifiedAt} 通过。命令：${readySummary.buildCommandLabel}` : '逻辑有问题的地方，会直接落到步骤卡与日志面板。'}
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      {!isDev ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <Badge variant="warning" className="w-fit">开发态限制</Badge>
            <CardTitle>PR 工作台仅在 Vite 开发态挂本地 Git/构建端点。</CardTitle>
            <CardDescription>生产构建只保留页面壳，不执行本机命令。</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {versionsErrorMessage ? <p className="text-sm leading-6 text-amber-700">{versionsErrorMessage}</p> : null}
      {sessionErrorMessage ? <p className="text-sm leading-6 text-amber-700">{sessionErrorMessage}</p> : null}
      {noVersion ? <p className="text-sm leading-6 text-muted-foreground">未发现同时具备 `repos/&lt;version&gt;_zh` 与 `repos/fork-&lt;version&gt;` 的版本。</p> : null}

      <StepCard
        index={1}
        step={session?.steps.zhSync ?? { id: 'zhSync', title: 'zh 仓同步校验', description: '等待版本选择。', status: 'idle', logs: [] }}
        actionLabel="执行检查"
        actionDisabled={!canRunZhSync}
        disabledReason={!selectedVersion ? '先选版本。' : undefined}
        isPending={isMutating && session?.steps.zhSync.status === 'running'}
        onAction={onCheckZhSync}
      >
        <div className="space-y-4">
          {renderZhSummary(session?.steps.zhSync.result)}
          {zhResult ? (
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={onPullZh} disabled={!canPullZh}>
                直接拉取 zh
              </Button>
              <Button variant="outline" size="sm" onClick={onPushZh} disabled={!canPushZh}>
                直接推送 zh
              </Button>
            </div>
          ) : null}
          {zhResult?.dirtyFiles.length ? <p className="text-sm leading-6 text-muted-foreground">存在未提交文件时，不直拉不直推。</p> : null}
          {zhResult && zhResult.aheadCount > 0 && zhResult.behindCount > 0 ? (
            <p className="text-sm leading-6 text-muted-foreground">当前分支已分叉。逻辑有问题，宜回终端手工处理。</p>
          ) : null}
        </div>
      </StepCard>

      <StepCard
        index={2}
        step={session?.steps.forkRefresh ?? { id: 'forkRefresh', title: '更新 fork 与 submodule', description: '等待版本选择。', status: 'blocked', logs: [] }}
        actionLabel="执行更新"
        actionDisabled={!canRunForkRefresh}
        disabledReason={selectedVersion && session?.steps.zhSync.status !== 'passed' ? '需先通过步骤 1。' : undefined}
        isPending={isMutating && session?.steps.forkRefresh.status === 'running'}
        onAction={onRefreshFork}
      >
        <div className="space-y-4">
          {renderForkSummary(session?.steps.forkRefresh.result)}
          {session?.steps.forkRefresh.result ? (
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={onCommitFork} disabled={!canCommitFork}>
                提交 fork 变更
              </Button>
            </div>
          ) : null}
        </div>
      </StepCard>

      <StepCard
        index={3}
        step={session?.steps.buildVerification ?? { id: 'buildVerification', title: '本地构建验证', description: '等待版本选择。', status: 'blocked', logs: [] }}
        actionLabel="执行构建"
        actionDisabled={!canRunBuild}
        disabledReason={selectedVersion && session?.steps.forkRefresh.status !== 'passed' ? '需先通过步骤 2。' : undefined}
        isPending={isMutating && session?.steps.buildVerification.status === 'running'}
        onAction={onVerifyBuild}
      >
        <div className="space-y-4">
          {renderBuildSummary(session?.steps.buildVerification.result)}
          {session?.steps.buildVerification.result ? (
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={onPushFork} disabled={!canPushFork}>
                推送 fork
              </Button>
            </div>
          ) : null}
        </div>
      </StepCard>

      <LogPanel logs={logs} />
    </div>
  )
}
