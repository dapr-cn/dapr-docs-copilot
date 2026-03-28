export type Metric = {
  label: string
  value: string
  delta: string
  tone: 'stable' | 'good' | 'warn'
}

export type ActivityItem = {
  id: string
  title: string
  detail: string
  time: string
  tone: 'good' | 'warn' | 'stable'
}

export type SiteRecord = {
  id: string
  site: string
  branch: string
  status: 'healthy' | 'review' | 'queued'
  locale: string
  owner: string
  lastSync: string
  coverage: string
}

export type KnowledgeSource = {
  name: string
  type: string
  records: string
  freshness: string
}

export type DashboardPayload = {
  metrics: Metric[]
  activities: ActivityItem[]
  focus: string[]
}

export type CopilotPayload = {
  sources: KnowledgeSource[]
  prompts: string[]
  automations: ActivityItem[]
}

const dashboardPayload: DashboardPayload = {
  metrics: [
    { label: '受管仓库', value: '7', delta: '+1 本周', tone: 'good' },
    { label: '待合并变更', value: '12', delta: '3 条高优先', tone: 'warn' },
    { label: '知识库新鲜度', value: '94%', delta: '近 24h 已同步', tone: 'good' },
    { label: '发布链路健康度', value: 'A-', delta: '队列稳定', tone: 'stable' },
  ],
  activities: [
    {
      id: 'a1',
      title: 'v1.17 中文站完成增量拉取',
      detail: '同步 43 篇文档，2 篇待人工校审。',
      time: '14:08',
      tone: 'good',
    },
    {
      id: 'a2',
      title: 'Copilot 提示词库进入评审',
      detail: '新增术语对齐规则与多版本检索策略。',
      time: '13:26',
      tone: 'stable',
    },
    {
      id: 'a3',
      title: 'fork-v1.15 存在回归风险',
      detail: '上游文档目录变更，需更新映射规则。',
      time: '11:41',
      tone: 'warn',
    },
  ],
  focus: ['版本对齐', '翻译质检', '提示词治理', '发布回归巡检'],
}

const sitesPayload: SiteRecord[] = [
  {
    id: 's1',
    site: 'docs v1.17',
    branch: 'v1.17',
    status: 'healthy',
    locale: 'en-US',
    owner: 'upstream',
    lastSync: '2026-03-28 14:06',
    coverage: '100%',
  },
  {
    id: 's2',
    site: 'docs-zh v1.17',
    branch: 'v1.17_content',
    status: 'review',
    locale: 'zh-CN',
    owner: 'translation',
    lastSync: '2026-03-28 14:08',
    coverage: '91%',
  },
  {
    id: 's3',
    site: 'fork-docs v1.15',
    branch: 'v1.15',
    status: 'queued',
    locale: 'zh-CN',
    owner: 'pr-source',
    lastSync: '2026-03-28 11:32',
    coverage: '77%',
  },
  {
    id: 's4',
    site: 'copilot-admin',
    branch: 'main',
    status: 'healthy',
    locale: 'zh-CN',
    owner: 'admin',
    lastSync: '2026-03-28 14:23',
    coverage: 'bootstrap',
  },
]

const copilotPayload: CopilotPayload = {
  sources: [
    { name: 'Release Notes', type: 'Markdown', records: '128 篇', freshness: '15 分钟前' },
    { name: 'Glossary Memory', type: 'Vector', records: '4.2k 片段', freshness: '刚刚' },
    { name: 'PR Comment Digest', type: 'JSON Feed', records: '316 条', freshness: '1 小时前' },
  ],
  prompts: [
    '校对新增版本页面，并输出术语偏差列表',
    '根据源文档差异生成翻译任务切片',
    '汇总一周内所有回归风险与建议处置',
  ],
  automations: [
    {
      id: 'c1',
      title: '知识库夜间重建',
      detail: '索引分片 8/8 完成，等待验证。',
      time: '02:10',
      tone: 'good',
    },
    {
      id: 'c2',
      title: '术语漂移监测',
      detail: '发现 6 个敏感术语需人工确认。',
      time: '09:20',
      tone: 'warn',
    },
    {
      id: 'c3',
      title: 'PR 摘要代理',
      detail: '本轮生成 14 条摘要，命中率 92%。',
      time: '12:42',
      tone: 'stable',
    },
  ],
}

async function wait(ms = 180) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchDashboard() {
  await wait()
  return dashboardPayload
}

export async function fetchSites() {
  await wait()
  return sitesPayload
}

export async function fetchCopilotWorkspace() {
  await wait()
  return copilotPayload
}
