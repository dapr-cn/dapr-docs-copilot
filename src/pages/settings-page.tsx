import { useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

export function SettingsPage() {
  const [settings, setSettings] = useState({
    autoSync: true,
    reviewGate: true,
    promptAudit: true,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        badge="Control plane"
        title="把策略收敛进配置，而非散落在脚本里。"
        description="重点是给后续权限、环境变量、Webhook 与代理参数留下位置。当前先落最小设置页。"
        actions={
          <>
            <Button variant="outline">重置</Button>
            <Button>保存更改</Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <Badge variant="outline" className="w-fit">Policies</Badge>
            <CardTitle>运行策略</CardTitle>
            <CardDescription>三个开关，对应后续最核心的自动化边界。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              ['autoSync', '自动同步', '仓库与知识库按计划任务增量拉取。'],
              ['reviewGate', '评审门禁', '发布前必须通过校审或规则检查。'],
              ['promptAudit', '提示词审计', '保留 AI 工作流输入输出轨迹。'],
            ].map(([key, label, desc]) => (
              <div key={key} className="flex items-start justify-between gap-4 rounded-[24px] border border-border/70 bg-background/80 p-4">
                <div>
                  <p className="font-medium text-foreground">{label}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{desc}</p>
                </div>
                <Switch
                  checked={settings[key as keyof typeof settings]}
                  onCheckedChange={(checked) =>
                    setSettings((current) => ({
                      ...current,
                      [key]: checked,
                    }))
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="secondary" className="w-fit">Env</Badge>
            <CardTitle>基础接入点</CardTitle>
            <CardDescription>此处先占位，后续可直接接 `.env`、服务端配置与密钥管理。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor="api-endpoint">API Endpoint</label>
              <Input id="api-endpoint" defaultValue="https://api.dapr-cn.local" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor="vector-index">Vector Index</label>
              <Input id="vector-index" defaultValue="dapr-docs-prod" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor="release-hook">Release Webhook</label>
              <Input id="release-hook" defaultValue="https://hooks.example.local/release" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
