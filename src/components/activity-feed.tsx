import type { ActivityItem } from '@/lib/mock-api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const toneClass = {
  good: 'bg-emerald-500',
  stable: 'bg-sky-500',
  warn: 'bg-amber-500',
} as const

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <Badge variant="outline" className="w-fit">Live feed</Badge>
        <CardTitle>发布脉搏</CardTitle>
        <CardDescription>聚合最近同步、评审与告警。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {items.map((item) => (
          <div key={item.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span className={cn('mt-1 size-2.5 rounded-full', toneClass[item.tone])} />
              <span className="mt-2 h-full w-px bg-border/70" />
            </div>
            <div className="space-y-1.5 pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">{item.title}</p>
                <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{item.time}</span>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">{item.detail}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
