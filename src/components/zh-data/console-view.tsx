import { AlertTriangle, Play, RefreshCcw, ShieldCheck } from 'lucide-react'
import { ZhDatasetPanel } from '@/components/zh-data/dataset-panel'
import { ZhSummaryStrip } from '@/components/zh-data/summary-strip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { GlossaryDataset, GlossaryMutationResult, GlossaryTermDraft, ZhDataVersion } from '@/lib/zh-data-models'
import { ZH_DATA_TABS, type DatasetId, type ZhConsolePayload } from '@/lib/zh-data-models'
import { cn } from '@/lib/utils'

type ZhDataConsoleViewProps = {
  payload: ZhConsolePayload
  versions: ZhDataVersion[]
  selectedVersion: string
  onSelectVersion: (nextVersion: string) => void
  defaultDatasetId?: DatasetId
  glossary?: {
    dataset: GlossaryDataset
    onCreate: (draft: GlossaryTermDraft) => Promise<GlossaryMutationResult>
    onUpdate: (termId: string, draft: GlossaryTermDraft) => Promise<GlossaryMutationResult>
    onDelete: (termId: string) => Promise<GlossaryMutationResult>
  }
  onRunSync?: () => void
  isSyncing?: boolean
  syncMessage?: string
  syncTone?: 'default' | 'good' | 'warn'
}

export function ZhDataConsoleView({
  payload,
  versions,
  selectedVersion,
  onSelectVersion,
  defaultDatasetId = 'sync-status',
  glossary,
  onRunSync,
  isSyncing = false,
  syncMessage,
  syncTone = 'default',
}: ZhDataConsoleViewProps) {
  const integrityReport = payload.integrityReport ?? {
    version: payload.version,
    generatedAt: '',
    latestBatchId: '',
    sourceSummary: { synced: 0, drift: 0, missingSource: 0 },
    translationSummary: { translated: 0, staleTranslation: 0, missingTranslation: 0, orphanTranslation: 0 },
    buckets: [],
    categories: [],
    findings: [],
    totalFindings: 0,
    status: 'stable' as const,
  }
  const hasIntegrityRisk = integrityReport.totalFindings > 0

  return (
    <div className="space-y-6">
      <ZhSummaryStrip cards={payload.summaryCards} />
      <div
        className={cn(
          'rounded-[30px] border p-5 shadow-sm',
          hasIntegrityRisk ? 'border-amber-300/70 bg-amber-50/80' : 'border-emerald-300/70 bg-emerald-50/80',
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {hasIntegrityRisk ? <AlertTriangle className="size-5 text-amber-700" /> : <ShieldCheck className="size-5 text-emerald-700" />}
              <h3 className="font-serif text-2xl tracking-tight text-foreground">{hasIntegrityRisk ? '完整性风险摘要' : '完整性状态稳定'}</h3>
              <Badge variant={hasIntegrityRisk ? 'warning' : 'success'}>{integrityReport.totalFindings} 项</Badge>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {hasIntegrityRisk
                ? '结论是，控制台只展示权威状态；下列风险来自链路审计，不再用乐观覆盖掩盖问题。'
                : '结论是，当前版本的 sync-status、source 与译文文件已对齐。'}
            </p>
          </div>
          <Badge variant="outline">{integrityReport.generatedAt ? `审计于 ${integrityReport.generatedAt}` : '未记录审计时间'}</Badge>
        </div>
        {integrityReport.categories.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {integrityReport.categories.map((category) => (
              <div key={category.id} className="rounded-[24px] border border-border/60 bg-background/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">{category.label}</p>
                  <Badge variant="warning">{category.count}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{category.hint}</p>
              </div>
            ))}
          </div>
        ) : null}
        {integrityReport.findings.length > 0 ? (
          <div className="mt-4 rounded-[24px] border border-border/60 bg-background/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">文件级差异</p>
              <Badge variant="outline">前 6 项</Badge>
            </div>
            <div className="mt-3 grid gap-3">
              {integrityReport.findings.slice(0, 6).map((finding) => (
                <div key={finding.id} className="rounded-[20px] border border-border/50 bg-card/80 px-4 py-3">
                  <p className="text-sm font-medium text-foreground">
                    {finding.bucket}
                    {finding.relativePath ? ` / ${finding.relativePath}` : ''}
                  </p>
                  <p className="mt-1 text-sm text-amber-800">{finding.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{finding.detail}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <Tabs defaultValue={defaultDatasetId} className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="font-serif text-3xl tracking-tight">数据视图</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">标签页内不做路由跳转。执行同步会先拉取原文分支，再删目标后全量复制，随后做 sha 校验，并按同步时间回判译文状态。</p>
            {syncMessage ? (
              <div className="mt-3">
                <Badge variant={syncTone === 'warn' ? 'warning' : syncTone === 'good' ? 'success' : 'secondary'}>{syncMessage}</Badge>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-3">
              <label className="grid gap-2 text-sm text-muted-foreground">
                <span>版本</span>
                <select
                  className="h-11 min-w-[180px] rounded-2xl border border-border bg-background/80 px-4 text-foreground outline-none"
                  value={selectedVersion}
                  onChange={(event) => onSelectVersion(event.currentTarget.value)}
                  disabled={isSyncing || versions.length === 0}
                >
                  <option value="">选择版本</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.label}
                    </option>
                  ))}
                </select>
              </label>
              {onRunSync ? (
                <Button variant="outline" onClick={onRunSync} disabled={isSyncing}>
                  {isSyncing ? <RefreshCcw className="size-4 animate-spin" /> : <Play className="size-4" />}
                  {isSyncing ? '同步中' : '执行同步'}
                </Button>
              ) : null}
            </div>
            <TabsList className="h-auto flex-wrap rounded-[28px] bg-muted/80 p-1.5">
              {ZH_DATA_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="rounded-[22px] px-5 py-2.5 data-[state=active]:bg-background">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>

        {payload.datasetViews.map((dataset) => (
          <TabsContent key={dataset.id} value={dataset.id}>
            <ZhDatasetPanel dataset={dataset} glossary={dataset.id === 'glossary' ? glossary : undefined} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
