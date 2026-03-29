import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { DashboardPage } from '@/pages/dashboard-page'
import { PrWorkbenchPage } from '@/pages/pr-workbench-page'
import { SettingsPage } from '@/pages/settings-page'
import { SitesPage } from '@/pages/sites-page'
import { TranslationWorkbenchPage } from '@/pages/translation-workbench-page'
import { ZhDataPage } from '@/pages/zh-data-page'
import type { QueryClient } from '@tanstack/react-query'

export type RouterContext = {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
})

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
})

const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sites',
  component: SitesPage,
})

const zhDataRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'zh-data',
  component: ZhDataPage,
})

const translationWorkbenchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'translation-workbench',
  component: TranslationWorkbenchPage,
})

const prWorkbenchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'pr-workbench',
  component: PrWorkbenchPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  translationWorkbenchRoute,
  prWorkbenchRoute,
  zhDataRoute,
  sitesRoute,
  settingsRoute,
])

export const router = createRouter({
  routeTree,
  context: {
    queryClient: undefined!,
  },
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
