import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, DatabaseZap, SendHorizontal, Workflow } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { fetchCopilotWorkspace } from '@/lib/mock-api'

export function CopilotPage() {
  const { data } = useQuery({
    queryKey: ['copilot'],
    queryFn: fetchCopilotWorkspace,
  })

  const [title, setTitle] = useState('术语漂移周报')
  const [prompt, setPrompt] = useState('请汇总 v1.17 中文站本周所有术语偏差，按严重度排序，并给出修复建议。')

  const preview = useMemo(() => `${title}

${prompt}`.trim(), [prompt, title])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Copilot"
        badge="Prompt workspace"
        title="把知识库、工作流、提示词收进同一工位。"
        description="此页展示管理端后续可扩展的 AI 工作台：知识源摘要、自动化任务、提示词起草与运行预览。"
        actions={
          <>
            <Button variant="outline">
              <DatabaseZap className="size-4" />
              重建索引
            </Button>
            <Button>
              <Workflow className="size-4" />
              新建代理流
            </Button>
          </>
        }
      />

      <Tabs defaultValue="sources">
        <TabsList>
          <TabsTrigger value="sources">知识源</TabsTrigger>
          <TabsTrigger value="automation">自动化</TabsTrigger>
          <TabsTrigger value="prompt">提示词</TabsTrigger>
        </TabsList>

        <TabsContent value="sources">
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <Card>
              <CardHeader>
                <Badge variant="outline" className="w-fit">Knowledge fabric</Badge>
                <CardTitle>知识源摘要</CardTitle>
                <CardDescription>重点是先定义可接入的数据边界。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {data?.sources.map((item) => (
                  <div key={item.name} className="rounded-[24px] border border-border/70 bg-background/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{item.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{item.type}</p>
                      </div>
                      <Badge variant="secondary">{item.records}</Badge>
                    </div>
                    <p className="mt-4 text-xs uppercase tracking-[0.24em] text-muted-foreground">新鲜度 {item.freshness}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>推荐提示词</CardTitle>
                <CardDescription>可直接作为后续模板仓的首批种子。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {data?.prompts.map((item, index) => (
                  <div key={item} className="rounded-[24px] border border-border/70 bg-background/80 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Template {index + 1}</p>
                    <p className="mt-3 text-sm leading-6 text-foreground">{item}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="automation">
          <div className="grid gap-6 lg:grid-cols-3">
            {data?.automations.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <Badge variant={item.tone === 'good' ? 'success' : item.tone === 'warn' ? 'warning' : 'secondary'} className="w-fit">{item.time}</Badge>
                  <CardTitle>{item.title}</CardTitle>
                  <CardDescription>{item.detail}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">流程状态可进一步接入队列、日志与重试控制。</CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="prompt">
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Card>
              <CardHeader>
                <Badge variant="outline" className="w-fit">Prompt draft</Badge>
                <CardTitle>起草区</CardTitle>
                <CardDescription>逻辑有问题时，先修提示词输入结构。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="任务标题" />
                <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入提示词主体" />
                <Button className="w-full">
                  <SendHorizontal className="size-4" />
                  提交到代理流
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Badge variant="secondary" className="w-fit">Preview</Badge>
                <CardTitle>运行预览</CardTitle>
                <CardDescription>后续可换成真实消息流、tokens、引用来源等输出。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-[28px] border border-dashed border-border bg-background/80 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                      <Bot className="size-4" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Copilot Draft</p>
                      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">single-site console</p>
                    </div>
                  </div>
                  <pre className="mt-5 overflow-x-auto whitespace-pre-wrap text-sm leading-7 text-foreground">{preview}</pre>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
