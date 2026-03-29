import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, RefreshCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { TranslationWorkbenchFile, TranslationWorkbenchJob, TranslationWorkbenchJobItem } from '@/lib/translation-workbench-models'
import { cn } from '@/lib/utils'

type FileQueueTableProps = {
  files: TranslationWorkbenchFile[]
  job?: TranslationWorkbenchJob
  selectedFileIds: string[]
  disabled?: boolean
  isRetrying?: boolean
  isLoading?: boolean
  errorMessage?: string
  onToggleFile: (fileId: string) => void
  onToggleAll: (checked: boolean) => void
  onRetry: (item: TranslationWorkbenchJobItem) => void
}

type QueuePresentation = {
  label: string
  variant: 'outline' | 'secondary' | 'success' | 'warning'
  icon: typeof Clock3
  detail?: string
  actionLabel?: string
  actionDisabled?: boolean
  actionKind?: 'retry'
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  }
  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }
  return `${sizeBytes} B`
}

function buildPresentation(file: TranslationWorkbenchFile, jobItem: TranslationWorkbenchJobItem | undefined): QueuePresentation {
  if (jobItem?.status === 'waiting') {
    return {
      label: '等待中',
      variant: 'secondary',
      icon: Clock3,
      actionLabel: '排队中',
      actionDisabled: true,
    }
  }

  if (jobItem?.status === 'translating') {
    return {
      label: '翻译中',
      variant: 'warning',
      icon: LoaderCircle,
      actionLabel: '处理中',
      actionDisabled: true,
    }
  }

  if (jobItem?.status === 'completed') {
    return {
      label: '翻译完成',
      variant: 'success',
      icon: CheckCircle2,
      actionLabel: '已写入',
      actionDisabled: true,
    }
  }

  if (jobItem?.status === 'failed') {
    return {
      label: '翻译失败',
      variant: 'warning',
      icon: AlertTriangle,
      detail: jobItem.error?.message,
      actionLabel: '重试',
      actionKind: 'retry',
    }
  }

  return {
    label: file.datasetState === 'staleTranslation' ? '待翻译' : '未翻译',
    variant: 'outline',
    icon: Clock3,
    detail: file.targetPath,
    actionLabel: '待入队',
    actionDisabled: true,
  }
}

export function FileQueueTable({
  files,
  job,
  selectedFileIds,
  disabled = false,
  isRetrying = false,
  isLoading = false,
  errorMessage,
  onToggleFile,
  onToggleAll,
  onRetry,
}: FileQueueTableProps) {
  const selectedSet = new Set(selectedFileIds)
  const jobItemMap = new Map(job?.items.map((item) => [item.fileId, item]) ?? [])
  const allSelected = files.length > 0 && selectedFileIds.length === files.length

  if (errorMessage) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <Badge variant="warning" className="w-fit">请求失败</Badge>
          <CardTitle>文件列表未加载</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">{errorMessage}</CardContent>
      </Card>
    )
  }

  if (!isLoading && files.length === 0) {
    return (
      <Card>
        <CardHeader>
          <Badge variant="success" className="w-fit">空队列</Badge>
          <CardTitle>当前版本无待翻译文件</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          结论是，此版本已无 `missingTranslation` / `staleTranslation` 项。若刚写入译文，可刷新后再核对。
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 border-b border-border/70 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="outline" className="w-fit">文件队列</Badge>
          <CardTitle className="mt-3">批量选择，再入有界并发队列。</CardTitle>
        </div>
        <label className="flex items-center gap-3 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border-border text-foreground"
            checked={allSelected}
            onChange={(event) => onToggleAll(event.currentTarget.checked)}
            disabled={disabled || files.length === 0}
          />
          全选当前版本
        </label>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">选择</TableHead>
              <TableHead className="w-40">状态</TableHead>
              <TableHead>文件</TableHead>
              <TableHead className="w-28">大小</TableHead>
              <TableHead className="w-36">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={`loading-${index}`}>
                    <TableCell colSpan={5}>
                      <div className="h-10 animate-pulse rounded-2xl bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : files.map((file) => {
                  const jobItem = jobItemMap.get(file.id)
                  const presentation = buildPresentation(file, jobItem)
                  const Icon = presentation.icon
                  const isSelected = selectedSet.has(file.id)

                  return (
                    <TableRow key={file.id} className={cn(jobItem?.status === 'failed' && 'bg-amber-500/5')}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="size-4 rounded border-border text-foreground"
                          checked={isSelected}
                          onChange={() => onToggleFile(file.id)}
                          disabled={disabled}
                          aria-label={`选择 ${file.relativePath}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={presentation.variant} className="gap-2 tracking-[0.18em]">
                          <Icon className={cn('size-3.5', jobItem?.status === 'translating' && 'animate-spin')} />
                          {presentation.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1.5">
                          <div className="font-medium text-foreground">{file.fileName}</div>
                          <div className="text-xs text-muted-foreground">{file.relativePath}</div>
                          <div className="text-xs text-muted-foreground">目标：{file.targetPath}</div>
                          {presentation.detail ? <div className="text-xs text-amber-700">{presentation.detail}</div> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatBytes(file.sizeBytes)}</TableCell>
                      <TableCell>
                        {presentation.actionKind === 'retry' && jobItem ? (
                          <Button size="sm" variant="outline" onClick={() => onRetry(jobItem)} disabled={disabled || isRetrying}>
                            <RefreshCcw className={cn('size-4', isRetrying && 'animate-spin')} />
                            {presentation.actionLabel}
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled>
                            {presentation.actionLabel}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
