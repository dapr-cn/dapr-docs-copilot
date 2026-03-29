import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type SummaryCard = {
  label: string
  value: string
  detail: string
  tone: 'stable' | 'good' | 'warn'
}

const toneClass = {
  stable: 'text-sky-700',
  good: 'text-emerald-700',
  warn: 'text-amber-700',
} as const

const badgeVariant = {
  stable: 'secondary',
  good: 'success',
  warn: 'warning',
} as const

export function ZhSummaryStrip({ cards }: { cards: SummaryCard[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="relative overflow-hidden border-border/70 bg-card/90">
          <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
          <CardHeader className="space-y-4 pb-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">{card.label}</p>
              <Badge variant={badgeVariant[card.tone]}>{card.tone === 'warn' ? 'attention' : 'ready'}</Badge>
            </div>
            <div>
              <p className="font-serif text-4xl tracking-tight text-foreground">{card.value}</p>
              <p className={cn('mt-3 text-sm font-medium', toneClass[card.tone])}>{card.detail}</p>
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-sm leading-6 text-muted-foreground">版本、内容桶、术语与复制批次统一落在同一条数据面上。</CardContent>
        </Card>
      ))}
    </div>
  )
}
