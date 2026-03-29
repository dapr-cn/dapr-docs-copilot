import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PrWorkbenchCommandLog } from '@/lib/pr-workbench-models'

type LogPanelProps = {
  logs: PrWorkbenchCommandLog[]
}

function formatCommandLine(log: PrWorkbenchCommandLog): string {
  return [log.command, log.cwd ? `@ ${log.cwd}` : undefined].filter(Boolean).join(' ')
}

export function LogPanel({ logs }: LogPanelProps) {
  return (
    <Card className="border-border/70 bg-card/90">
      <CardHeader>
        <Badge variant="outline" className="w-fit">最近日志</Badge>
        <CardTitle>关键 Git 与构建摘要</CardTitle>
        <CardDescription>重点是，只保留最近回合；stdout / stderr 取尾部，便于定位阻断。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {logs.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-border/70 bg-background/75 p-5 text-sm leading-6 text-muted-foreground">
            尚无日志。先执行任一步，再回看 Git 摘要或构建输出。
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="rounded-[24px] border border-border/70 bg-background/80 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="secondary">{log.scope}</Badge>
                <span className="text-sm font-medium text-foreground">{log.title}</span>
                <span className="text-xs text-muted-foreground">{log.startedAt}</span>
                {typeof log.exitCode === 'number' ? <span className="text-xs text-muted-foreground">exit={log.exitCode}</span> : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{log.summary}</p>
              {log.command ? <p className="mt-2 font-mono text-xs leading-5 text-foreground/80">{formatCommandLine(log)}</p> : null}
              {log.stdout ? <pre className="mt-3 overflow-x-auto rounded-[18px] bg-foreground/[0.04] p-3 text-xs leading-5 text-foreground/80">{log.stdout}</pre> : null}
              {log.stderr ? <pre className="mt-3 overflow-x-auto rounded-[18px] bg-amber-500/10 p-3 text-xs leading-5 text-amber-900">{log.stderr}</pre> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
