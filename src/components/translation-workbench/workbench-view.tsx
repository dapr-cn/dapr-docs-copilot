import { RefreshCcw, Send } from 'lucide-react'
import { FileQueueTable } from '@/components/translation-workbench/file-queue-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  DEFAULT_TRANSLATION_JOB_CONCURRENCY,
  MAX_TRANSLATION_JOB_CONCURRENCY,
  MIN_TRANSLATION_JOB_CONCURRENCY,
  type TranslationWorkbenchFile,
  type TranslationWorkbenchJob,
  type TranslationWorkbenchJobItem,
  type TranslationWorkbenchVersion,
} from '@/lib/translation-workbench-models'

type WorkbenchViewProps = {
  isDev: boolean
  versions: TranslationWorkbenchVersion[]
  selectedVersion: string
  templateName: string
  files: TranslationWorkbenchFile[]
  job?: TranslationWorkbenchJob
  selectedFileIds: string[]
  concurrencyValue: string
  concurrencyError?: string
  isLoadingVersions?: boolean
  isLoadingFiles?: boolean
  isSubmitting?: boolean
  isRetrying?: boolean
  isQueueLocked?: boolean
  bannerMessage?: string
  bannerTone?: 'default' | 'good' | 'warn'
  filesErrorMessage?: string
  onSelectVersion: (nextVersion: string) => void
  onChangeConcurrency: (nextValue: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onRefresh: () => void
  onTranslate: () => void
  onToggleFile: (fileId: string) => void
  onToggleAll: (checked: boolean) => void
  onRetry: (item: TranslationWorkbenchJobItem) => void
}

type SummaryCardProps = {
  label: string
  value: number
  detail: string
}

function SummaryCard({ label, value, detail }: SummaryCardProps) {
  return (
    <Card className="bg-background/75">
      <CardHeader>
        <Badge variant="outline" className="w-fit">{label}</Badge>
        <CardTitle className="mt-2 text-3xl">{value}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
    </Card>
  )
}

export function TranslationWorkbenchView({
  isDev,
  versions,
  selectedVersion,
  templateName,
  files,
  job,
  selectedFileIds,
  concurrencyValue,
  concurrencyError,
  isLoadingVersions = false,
  isLoadingFiles = false,
  isSubmitting = false,
  isRetrying = false,
  isQueueLocked = false,
  bannerMessage,
  bannerTone = 'default',
  filesErrorMessage,
  onSelectVersion,
  onChangeConcurrency,
  onSelectAll,
  onClearSelection,
  onRefresh,
  onTranslate,
  onToggleFile,
  onToggleAll,
  onRetry,
}: WorkbenchViewProps) {
  const waitingCount = job?.counts.waiting ?? 0
  const translatingCount = job?.counts.translating ?? 0
  const completedCount = job?.counts.completed ?? 0
  const failedCount = job?.counts.failed ?? 0
  const concurrencyHint = job?.concurrency ?? Number(concurrencyValue || DEFAULT_TRANSLATION_JOB_CONCURRENCY)
  const selectionLocked = !isDev || isQueueLocked
  const canSubmit = isDev && !isSubmitting && !isQueueLocked && !concurrencyError

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/88">
        <CardHeader className="gap-4 border-b border-border/70 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">翻译工作台</Badge>
              <Badge variant="secondary">{templateName}</Badge>
              <Badge variant={isQueueLocked ? 'warning' : 'secondary'}>{isQueueLocked ? '队列运行中' : '队列空闲'}</Badge>
            </div>
            <div>
              <CardTitle>版本、队列、落盘，同屏处理。</CardTitle>
              <CardDescription>重点是：并发可控。运行中锁版本、锁选择、锁并发输入；写入仍受开发态约束。</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={onRefresh} disabled={isLoadingFiles || isLoadingVersions}>
              <RefreshCcw className="size-4" />
              刷新列表
            </Button>
            <Button onClick={onTranslate} disabled={!canSubmit}>
              <Send className="size-4" />
              {isSubmitting ? '提交中' : 'AI 翻译'}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="待翻译文件" value={files.length} detail="当前版本仍需处理的文档数。" />
        <SummaryCard label="等待中" value={waitingCount} detail="已入队，尚未轮到。" />
        <SummaryCard label="翻译中" value={translatingCount} detail={`当前并行执行中文件数；上限 ${concurrencyHint || 0}。`} />
        <SummaryCard label="翻译完成" value={completedCount} detail="已写入目标译文文件。" />
        <SummaryCard label="翻译失败" value={failedCount} detail="可单项重试，不必重建整队。" />
      </div>

      <Card>
        <CardHeader className="gap-4 border-b border-border/70 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div>
              <CardTitle>先定版本，再决定文件批次。</CardTitle>
              <CardDescription>
                队列运行时锁定版本切换、文件勾选、重复提交与并发编辑。失败项保留原位，可单独重试。
              </CardDescription>
            </div>
            {bannerMessage ? (
              <Badge variant={bannerTone === 'warn' ? 'warning' : bannerTone === 'good' ? 'success' : 'secondary'} className="w-fit">
                {bannerMessage}
              </Badge>
            ) : null}
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,220px)_minmax(0,220px)_auto_auto]">
            <label className="grid gap-2 text-sm text-muted-foreground">
              <span>版本</span>
              <select
                className="h-11 rounded-2xl border border-border bg-background/80 px-4 text-foreground outline-none"
                value={selectedVersion}
                onChange={(event) => onSelectVersion(event.currentTarget.value)}
                disabled={isQueueLocked || isLoadingVersions || versions.length === 0}
              >
                <option value="">选择版本</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label} · {version.untranslatedCount} 篇
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm text-muted-foreground">
              <span>并发数量</span>
              <div className="space-y-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={MIN_TRANSLATION_JOB_CONCURRENCY}
                  max={MAX_TRANSLATION_JOB_CONCURRENCY}
                  step={1}
                  value={concurrencyValue}
                  onChange={(event) => onChangeConcurrency(event.currentTarget.value)}
                  disabled={isQueueLocked}
                  aria-invalid={concurrencyError ? 'true' : 'false'}
                  className={concurrencyError ? 'border-amber-500 text-amber-700 focus-visible:ring-amber-500/40' : undefined}
                />
                <div className={concurrencyError ? 'text-xs text-amber-700' : 'text-xs text-muted-foreground'}>
                  {concurrencyError ?? '1-10，默认 3。并发越高，请求压力越大。'}
                </div>
              </div>
            </label>

            <div className="flex flex-wrap gap-3 sm:items-end">
              <Button variant="outline" onClick={onSelectAll} disabled={selectionLocked || files.length === 0}>
                全选
              </Button>
              <Button variant="outline" onClick={onClearSelection} disabled={selectionLocked || selectedFileIds.length === 0}>
                清空
              </Button>
            </div>

            <Card className="min-w-[180px] bg-background/80">
              <CardContent className="p-4 text-sm leading-6 text-muted-foreground">
                已选 <span className="font-semibold text-foreground">{selectedFileIds.length}</span> 篇
                <br />
                当前模板：<span className="font-mono text-xs text-foreground">{templateName}</span>
                <br />
                目标并发：<span className="font-semibold text-foreground">{concurrencyHint}</span>
              </CardContent>
            </Card>
          </div>
        </CardHeader>
      </Card>

      {!isDev ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <Badge variant="warning" className="w-fit">开发态限制</Badge>
            <CardTitle>工作台仅在 Vite 开发态可写。</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            结论是，生产构建不挂载本地文件写入端点。开发态需可直接调用本机 `claude`。
          </CardContent>
        </Card>
      ) : null}

      <FileQueueTable
        files={files}
        job={job}
        selectedFileIds={selectedFileIds}
        disabled={!isDev || isQueueLocked}
        isRetrying={isRetrying}
        isLoading={isLoadingFiles}
        errorMessage={filesErrorMessage}
        onToggleFile={onToggleFile}
        onToggleAll={onToggleAll}
        onRetry={onRetry}
      />
    </div>
  )
}
