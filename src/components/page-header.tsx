import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PageHeaderProps = {
  eyebrow: string
  title: string
  description: string
  badge?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, description, badge, actions, className }: PageHeaderProps) {
  return (
    <section className={cn('relative overflow-hidden rounded-[32px] border border-border/70 bg-card/85 p-6 shadow-[0_24px_80px_-56px_hsl(var(--foreground)/0.35)] sm:p-8', className)}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,hsl(var(--accent-soft)/0.16),transparent_45%,hsl(var(--accent-secondary)/0.12))]" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">{eyebrow}</Badge>
            {badge ? <Badge variant="secondary">{badge}</Badge> : null}
          </div>
          <div className="space-y-3">
            <h2 className="font-serif text-4xl tracking-tight sm:text-5xl">{title}</h2>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {actions ?? (
            <>
              <Button variant="outline">查看日志</Button>
              <Button>进入工作流</Button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
