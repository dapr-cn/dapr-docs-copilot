import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, GitPullRequest, RefreshCcw } from 'lucide-react'
import { ActivityFeed } from '@/components/activity-feed'
import { FocusGrid } from '@/components/focus-grid'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
        eyebrow="Overview"
        badge="单一站点 / 管理台"
        title="把文档、翻译、Copilot 收束为一套指挥面板。"
        description="重点是先把可观测、可操作、可扩展三件事钉住。此脚手架采用 TanStack Router + Query + Table，控件主体采用 shadcn/ui 风格组件。"
        actions={
          <>
            <Button variant="outline">
              <RefreshCcw className="size-4" />
              立即同步
            </Button>
            <Button>
              <GitPullRequest className="size-4" />
              创建变更单
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

      <Tabs defaultValue="release" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-serif text-2xl tracking-tight">运行窗格</h3>
            <p className="text-sm text-muted-foreground">以选项卡分离发布、翻译与策略面。</p>
          </div>
          <TabsList>
            <TabsTrigger value="release">发布</TabsTrigger>
            <TabsTrigger value="translation">翻译</TabsTrigger>
            <TabsTrigger value="strategy">策略</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="release" className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <Badge variant="outline" className="w-fit">Release lane</Badge>
              <CardTitle>提测前检查</CardTitle>
              <CardDescription>聚合仓库状态、同步节奏与评审热区。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="rounded-[24px] border border-border/70 bg-background/80 p-4">
                <p className="font-medium text-foreground">版本链完整</p>
                <p className="mt-2 leading-6">v1.15 与 v1.17 均已纳入管理视图，分支规则可继续沉淀为模板。</p>
              </div>
              <div className="rounded-[24px] border border-border/70 bg-background/80 p-4">
                <p className="font-medium text-foreground">告警聚焦</p>
                <p className="mt-2 leading-6">当前高优先仅 3 项，足以支撑轻量值班模式。</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>建议下一步</CardTitle>
              <CardDescription>结论是，脚手架已具备继续演化的最小闭环。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {['接入真实仓库元数据', '增加登录与权限层', '串接发布 Webhook', '沉淀 PR 审批面板'].map((item) => (
                <div key={item} className="flex min-h-32 flex-col justify-between rounded-[24px] border border-border/70 bg-background/80 p-4">
                  <Badge variant="secondary" className="w-fit">Roadmap</Badge>
                  <div>
                    <p className="font-medium text-foreground">{item}</p>
                    <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                      <ArrowUpRight className="size-3.5" />
                      ready
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="translation">
          <Card>
            <CardHeader>
              <CardTitle>翻译策略</CardTitle>
              <CardDescription>将术语统一、增量同步、人工校审拆成三段队列。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              {['术语冻结', '增量对齐', '人工校审'].map((item) => (
                <div key={item} className="rounded-[24px] border border-border/70 bg-background/80 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Step</p>
                  <p className="mt-4 font-medium text-foreground">{item}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="strategy">
          <Card>
            <CardHeader>
              <CardTitle>治理原则</CardTitle>
              <CardDescription>逻辑有问题的地方，不靠人肉补，靠流程收敛。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              {['一处数据源', '一条发布链', '一套术语库'].map((item) => (
                <div key={item} className="rounded-[24px] border border-border/70 bg-background/80 p-5 text-sm leading-6 text-muted-foreground">
                  <p className="font-medium text-foreground">{item}</p>
                  <p className="mt-2">避免同义配置四处漂移。</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
