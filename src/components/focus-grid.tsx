import { Radar, ScanSearch, ShieldCheck, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const iconMap = [Sparkles, Radar, ScanSearch, ShieldCheck]

export function FocusGrid({ items }: { items: string[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>当前关注面</CardTitle>
        <CardDescription>把工作台聚焦在本周最值钱的四件事。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {items.map((item, index) => {
          const Icon = iconMap[index % iconMap.length]
          return (
            <div key={item} className="rounded-[24px] border border-border/70 bg-background/80 p-4">
              <Icon className="size-5 text-muted-foreground" />
              <p className="mt-6 font-medium text-foreground">{item}</p>
              <p className="mt-2 text-sm text-muted-foreground">流程、数据、质量三线联动。</p>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
