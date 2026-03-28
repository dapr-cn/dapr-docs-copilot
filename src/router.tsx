import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { CopilotPage } from '@/pages/copilot-page'
import { DashboardPage } from '@/pages/dashboard-page'
import { SettingsPage } from '@/pages/settings-page'
import { SitesPage } from '@/pages/sites-page'
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

const copilotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'copilot',
  component: CopilotPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  sitesRoute,
  copilotRoute,
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
