import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, DatabaseZap, RefreshCcw } from 'lucide-react'
import { ActivityFeed } from '@/components/activity-feed'
import { FocusGrid } from '@/components/focus-grid'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchDashboard } from '@/lib/mock-api'

export function DashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
  })

  if (!data) {
    return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-[28px] bg-muted" />)}</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="中文数据总览"
        badge="repos/v1.17_zh/data"
        title="先看数据面，再决定翻译动作。"
        description="结论是，首页只保留四类真实信号：原文同步、译文状态、术语规则与复制批次。逻辑有问题的地方，先在数据层暴露。"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/zh-data">
                <DatabaseZap className="size-4" />
                打开数据页
              </Link>
            </Button>
            <Button>
              <RefreshCcw className="size-4" />
              刷新摘要
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.label} metric={metric} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <ActivityFeed items={data.activities} />
        <FocusGrid items={data.focus} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-border/70 bg-card/90">
          <CardHeader>
            <Badge variant="outline" className="w-fit">Decision lane</Badge>
            <CardTitle>本轮处理顺序</CardTitle>
            <CardDescription>重点是先解决 drift 面最大、缺译最多、术语未冻结三类问题。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {[
              ['01', '先跑全量同步', '目标先删后拷，保证 source 镜像为最新全量。'],
              ['02', '再判译文', '译文存在且时间晚于同步时间，方可记为已翻译。'],
              ['03', '最后固化术语', '原文与译文状态稳定后，再回写 glossary.json。'],
            ].map(([step, title, detail]) => (
              <div key={step} className="rounded-[24px] border border-border/70 bg-background/80 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">{step}</p>
                <p className="mt-4 font-medium text-foreground">{title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/90">
          <CardHeader>
            <Badge variant="secondary" className="w-fit">Next move</Badge>
            <CardTitle>直接进入数据视图</CardTitle>
            <CardDescription>中文数据页内含三个标签：同步状态、术语表、源文清单。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              '同步状态：逐文件显示原文同步与译文状态。',
              '术语表：核对源词、目标词与备注，并可直接行内维护。',
              '源文清单：看内容桶体量与 source 镜像文件。',
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-[24px] border border-border/70 bg-background/80 p-4 text-sm leading-6 text-muted-foreground">
                <ArrowRight className="mt-1 size-4 shrink-0 text-foreground" />
                <span>{item}</span>
              </div>
            ))}
            <Button asChild className="w-full rounded-full">
              <Link to="/zh-data">
                查看全部数据
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
