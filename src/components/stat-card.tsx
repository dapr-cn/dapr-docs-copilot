import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react'
import type { Metric } from '@/lib/mock-api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const toneMap = {
  good: 'text-emerald-700',
  stable: 'text-sky-700',
  warn: 'text-amber-700',
} as const

export function StatCard({ metric }: { metric: Metric }) {
  const TrendIcon = metric.tone === 'warn' ? TrendingDown : TrendingUp

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
      <CardHeader className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">{metric.label}</p>
        <div className="flex items-end justify-between gap-4">
          <CardTitle className="text-4xl font-semibold tracking-tight">{metric.value}</CardTitle>
          <div className={cn('flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em]', toneMap[metric.tone])}>
            <TrendIcon className="size-3.5" />
            {metric.delta}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Signal updated</span>
        <ArrowRight className="size-4" />
      </CardContent>
    </Card>
  )
}
