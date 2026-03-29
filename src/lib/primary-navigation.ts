import { BookCopy, Database, GitPullRequestArrow, Languages, LayoutDashboard, Settings2 } from 'lucide-react'

export const PRIMARY_NAVIGATION = [
  { to: '/translation-workbench', label: '翻译工作台', icon: Languages, exact: false },
  { to: '/pr-workbench', label: 'PR 工作台', icon: GitPullRequestArrow, exact: false },
  { to: '/zh-data', label: '中文数据', icon: Database, exact: false },
  { to: '/', label: '总览', icon: LayoutDashboard, exact: true },
  { to: '/sites', label: '站点', icon: BookCopy, exact: false },
  { to: '/settings', label: '设置', icon: Settings2, exact: false },
] as const
