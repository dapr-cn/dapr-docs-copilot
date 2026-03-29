import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, PauseCircle, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PrWorkbenchStepSnapshot, PrWorkbenchStepStatus } from '@/lib/pr-workbench-models'

type StepCardProps = {
  index: number
  step: PrWorkbenchStepSnapshot<unknown>
  actionLabel: string
  actionDisabled?: boolean
  disabledReason?: string
  isPending?: boolean
  onAction: () => void
  children?: ReactNode
}

function getStepPresentation(status: PrWorkbenchStepStatus) {
  switch (status) {
    case 'passed':
      return { label: '已通过', variant: 'success' as const, icon: CheckCircle2 }
    case 'failed':
      return { label: '失败', variant: 'warning' as const, icon: AlertTriangle }
    case 'running':
      return { label: '执行中', variant: 'secondary' as const, icon: LoaderCircle }
    case 'stale':
      return { label: '已失效', variant: 'warning' as const, icon: RotateCcw }
    case 'blocked':
      return { label: '待解锁', variant: 'secondary' as const, icon: PauseCircle }
    default:
      return { label: '待执行', variant: 'outline' as const, icon: Clock3 }
  }
}

export function StepCard({ index, step, actionLabel, actionDisabled = false, disabledReason, isPending = false, onAction, children }: StepCardProps) {
  const presentation = getStepPresentation(step.status)
  const Icon = presentation.icon

  return (
    <Card className="border-border/70 bg-card/90">
      <CardHeader className="gap-4 border-b border-border/70 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">Step {index}</Badge>
            <Badge variant={presentation.variant} className="gap-2">
              <Icon className={step.status === 'running' ? 'size-3.5 animate-spin' : 'size-3.5'} />
              {presentation.label}
            </Badge>
          </div>
          <div>
            <CardTitle>{step.title}</CardTitle>
            <CardDescription>{step.description}</CardDescription>
          </div>
          {step.error ? <div className="text-sm leading-6 text-amber-700">{step.error.message}</div> : null}
          {step.staleReason ? <div className="text-sm leading-6 text-amber-700">{step.staleReason}</div> : null}
          {disabledReason ? <div className="text-sm leading-6 text-muted-foreground">{disabledReason}</div> : null}
        </div>

        <Button onClick={onAction} disabled={actionDisabled || isPending} className="shrink-0">
          {isPending ? '执行中' : actionLabel}
        </Button>
      </CardHeader>
      {children ? <CardContent className="space-y-4 pt-6">{children}</CardContent> : null}
    </Card>
  )
}
