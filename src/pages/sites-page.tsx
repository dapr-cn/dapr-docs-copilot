import { useQuery } from '@tanstack/react-query'
import { BarChart3, GitBranch, ShieldEllipsis } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { SitesTable } from '@/components/sites-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchSites } from '@/lib/mock-api'

export function SitesPage() {
  const { data } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
  })

  const healthyCount = data?.filter((item) => item.status === 'healthy').length ?? 0
  const reviewCount = data?.filter((item) => item.status === 'review').length ?? 0
  const queuedCount = data?.filter((item) => item.status === 'queued').length ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sites"
        badge="TanStack Table"
        title="统一站点矩阵。"
        description="分支、语言、责任人、覆盖度一屏并列。后续接入真实 API 时，只需替换 queryFn。"
        actions={
          <>
            <Button variant="outline">导出矩阵</Button>
            <Button>新增站点</Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <Badge variant="outline" className="w-fit">healthy</Badge>
            <CardTitle className="mt-2 text-3xl">{healthyCount}</CardTitle>
            <CardDescription>同步与状态均稳定。</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Badge variant="warning" className="w-fit">review</Badge>
            <CardTitle className="mt-2 text-3xl">{reviewCount}</CardTitle>
            <CardDescription>需校审或规则确认。</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Badge variant="secondary" className="w-fit">queued</Badge>
            <CardTitle className="mt-2 text-3xl">{queuedCount}</CardTitle>
            <CardDescription>处于排队或待接入阶段。</CardDescription>
          </CardHeader>
        </Card>
      </div>

      {data ? <SitesTable data={data} /> : <div className="h-96 animate-pulse rounded-[28px] bg-muted" />}

      <div className="grid gap-6 lg:grid-cols-3">
        {[
          { icon: GitBranch, title: '分支策略', desc: '保持 upstream / fork / zh 三线可追踪。' },
          { icon: BarChart3, title: '观察指标', desc: '同步时延、覆盖度、回归数可直接挂进图表。' },
          { icon: ShieldEllipsis, title: '质量兜底', desc: '把术语与目录映射沉淀为规则，而非散落脚本。' },
        ].map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.title}>
              <CardHeader>
                <Icon className="size-5 text-muted-foreground" />
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.desc}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">结论是，此页已具备接业务数据的骨架。</CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
