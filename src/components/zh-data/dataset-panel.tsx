import { AlertTriangle, DatabaseZap, PackageOpen } from 'lucide-react'
import { GlossaryTable } from '@/components/zh-data/glossary-table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { GlossaryDataset, GlossaryMutationResult, GlossaryTermDraft, ZhDatasetView } from '@/lib/zh-data-models'
import { cn } from '@/lib/utils'

const rowToneClass = {
  default: 'text-foreground',
  good: 'text-emerald-800',
  warn: 'text-amber-800',
} as const

type ZhDatasetPanelProps = {
  dataset: ZhDatasetView
  glossary?: {
    dataset: GlossaryDataset
    onCreate: (draft: GlossaryTermDraft) => Promise<GlossaryMutationResult>
    onUpdate: (termId: string, draft: GlossaryTermDraft) => Promise<GlossaryMutationResult>
    onDelete: (termId: string) => Promise<GlossaryMutationResult>
  }
}

export function ZhDatasetPanel({ dataset, glossary }: ZhDatasetPanelProps) {
  if (dataset.id === 'glossary' && glossary) {
    return (
      <GlossaryTable
        dataset={dataset}
        glossary={glossary.dataset}
        onCreate={glossary.onCreate}
        onUpdate={glossary.onUpdate}
        onDelete={glossary.onDelete}
      />
    )
  }

  if (dataset.state === 'error') {
    return (
      <StateCard
        icon={AlertTriangle}
        title="数据缺失"
        description={dataset.errorMessage ?? '未能装载数据文件。'}
        badgeLabel="error"
        badgeVariant="warning"
      />
    )
  }

  if (dataset.state === 'empty') {
    return (
      <StateCard
        icon={PackageOpen}
        title="暂无记录"
        description={dataset.emptyMessage ?? '数据集为空。'}
        badgeLabel="empty"
        badgeVariant="secondary"
      />
    )
  }

  return (
    <div>
      <Card className="border-border/70 bg-card/90">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit">{dataset.fileName}</Badge>
            <div>
              <CardTitle>{dataset.label}</CardTitle>
              <CardDescription className="mt-2 max-w-2xl">{dataset.description}</CardDescription>
            </div>
          </div>
          <Badge variant="secondary">{dataset.infoLabel}</Badge>
        </CardHeader>
        <CardContent className="overflow-hidden">
          <div className="max-h-[min(68vh,52rem)] overflow-auto rounded-[24px] border border-border/70 bg-background/55">
            <Table>
            <TableHeader>
              <TableRow>
                {dataset.columns.map((column) => (
                  <TableHead key={column} className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataset.rows.map((row) => (
                <TableRow key={row.id}>
                  {row.cells.map((cell, index) => (
                    <TableCell key={`${row.id}:${index}`} className={cn(index === row.cells.length - 1 && 'font-mono text-xs', rowToneClass[row.tone ?? 'default'])}>
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

type StateCardProps = {
  icon: typeof AlertTriangle
  title: string
  description: string
  badgeLabel: string
  badgeVariant: 'warning' | 'secondary'
}

function StateCard({ icon: Icon, title, description, badgeLabel, badgeVariant }: StateCardProps) {
  return (
    <Card className="border-border/70 bg-card/90">
      <CardHeader>
        <Badge variant={badgeVariant} className="w-fit">{badgeLabel}</Badge>
        <CardTitle className="flex items-center gap-3">
          <DatabaseZap className="size-5 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-[24px] border border-dashed border-border/70 bg-background/75 p-6 text-sm leading-7 text-muted-foreground">
          <div className="flex items-center gap-3 font-medium text-foreground">
            <Icon className="size-4" />
            当前标签页保留显式反馈，避免空表格误导维护者。
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
