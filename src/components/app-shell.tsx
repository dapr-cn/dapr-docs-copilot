import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { Bell, Search, Sparkles } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { PRIMARY_NAVIGATION } from '@/lib/primary-navigation'
import { cn } from '@/lib/utils'

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const isDev = import.meta.env.DEV

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--accent-soft))_0,transparent_38%),radial-gradient(circle_at_bottom_right,hsl(var(--accent-secondary)/0.24)_0,transparent_30%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(hsl(var(--border)/0.35)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.35)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]" />

        <aside className="hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-72 lg:flex-col lg:border-r lg:border-border/70 lg:bg-card/70 lg:px-6 lg:py-8 lg:backdrop-blur-xl">
          <div className="space-y-4">
            <Badge variant="outline" className="w-fit bg-background/65">Zh Translation</Badge>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">Dapr Docs Console</p>
              <h1 className="mt-3 font-serif text-3xl tracking-tight">Translation Console</h1>
              <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
                去 demo 化后，首页只服务中文数据同步、源文追踪与校审焦点。
              </p>
            </div>
          </div>

          <Separator className="my-6" />

          <nav className="flex flex-1 flex-col gap-2">
            {PRIMARY_NAVIGATION.map((item) => {
              const Icon = item.icon
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to)

              return (
                <Button key={item.to} asChild variant={active ? 'secondary' : 'ghost'} className="h-12 justify-start rounded-2xl px-4">
                  <Link to={item.to}>
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                </Button>
              )
            })}
          </nav>

          <div className="rounded-[24px] border border-border/70 bg-background/80 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>NB</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-semibold">newbe36524</p>
                <p className="text-xs text-muted-foreground">owner / maintainer</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <span>自动化巡检</span>
              <span className="font-semibold text-emerald-700">管道在线</span>
            </div>
          </div>
        </aside>

        <div className="relative flex min-h-screen flex-1 flex-col lg:ml-72">
          <header className="sticky top-0 z-30 border-b border-border/70 bg-background/82 backdrop-blur-xl">
            <div className="flex w-full items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
              <div className="flex flex-1 items-center gap-3 rounded-full border border-border bg-card/75 px-4 py-2 shadow-sm">
                <Search className="size-4 text-muted-foreground" />
                <Input
                  className="h-auto border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
                  placeholder="检索仓库、路由、任务……"
                  aria-label="搜索管理台内容"
                />
              </div>
              <Button variant="outline" size="icon" className="hidden sm:inline-flex">
                <Bell className="size-4" />
              </Button>
              <Button size="sm" className="rounded-full">
                <Sparkles className="size-4" />
                新建任务
              </Button>
            </div>
            <div className="flex w-full gap-2 overflow-x-auto px-4 pb-4 sm:px-6 lg:hidden lg:px-8">
              {PRIMARY_NAVIGATION.map((item) => {
                const Icon = item.icon
                const active = item.exact ? pathname === item.to : pathname.startsWith(item.to)

                return (
                  <Button
                    key={item.to}
                    asChild
                    variant={active ? 'secondary' : 'outline'}
                    size="sm"
                    className={cn('shrink-0 rounded-full', !active && 'bg-background/70')}
                  >
                    <Link to={item.to}>
                      <Icon className="size-4" />
                      {item.label}
                    </Link>
                  </Button>
                )
              })}
            </div>
          </header>

          <main className="flex w-full flex-1 flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
      {isDev ? <TanStackRouterDevtools position="bottom-right" /> : null}
    </div>
  )
}
