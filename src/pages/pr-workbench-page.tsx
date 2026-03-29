import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PrWorkbenchView } from '@/components/pr-workbench/pr-workbench-view'
import {
  fetchPrWorkbenchSession,
  fetchPrWorkbenchVersions,
  getPrWorkbenchPollInterval,
  runPrWorkbenchBuildVerification,
  runPrWorkbenchForkCommit,
  runPrWorkbenchForkRefresh,
  runPrWorkbenchForkPush,
  runPrWorkbenchZhPull,
  runPrWorkbenchZhPush,
  runPrWorkbenchZhSync,
} from '@/lib/pr-workbench'

export function PrWorkbenchPage() {
  const isDev = import.meta.env.DEV
  const queryClient = useQueryClient()
  const [selectedVersion, setSelectedVersion] = useState('')
  const [bannerMessage, setBannerMessage] = useState<string>()
  const [bannerTone, setBannerTone] = useState<'default' | 'good' | 'warn'>('default')

  const versionsQuery = useQuery({
    queryKey: ['pr-workbench', 'versions'],
    queryFn: fetchPrWorkbenchVersions,
    enabled: isDev,
  })

  const sessionQuery = useQuery({
    queryKey: ['pr-workbench', 'session', selectedVersion],
    queryFn: () => fetchPrWorkbenchSession(selectedVersion),
    enabled: isDev && selectedVersion.length > 0,
    refetchInterval: (query) => getPrWorkbenchPollInterval(query.state.data),
  })

  useEffect(() => {
    if (selectedVersion || !versionsQuery.data?.versions.length) {
      return
    }

    setSelectedVersion(versionsQuery.data.versions[0].version)
  }, [selectedVersion, versionsQuery.data])

  function applySessionSuccess(message: string, tone: 'default' | 'good' | 'warn' = 'good') {
    return async (payload: { session: Awaited<ReturnType<typeof fetchPrWorkbenchSession>> }) => {
      queryClient.setQueryData(['pr-workbench', 'session', payload.session.version], payload.session)
      setBannerMessage(message)
      setBannerTone(tone)
      await queryClient.invalidateQueries({ queryKey: ['pr-workbench', 'session', payload.session.version] })
    }
  }

  const zhSyncMutation = useMutation({
    mutationFn: runPrWorkbenchZhSync,
    onSuccess: applySessionSuccess('zh 仓校验已刷新', 'good'),
    onError: (error) => {
      setBannerMessage(error.message)
      setBannerTone('warn')
    },
  })

  const zhPullMutation = useMutation({
    mutationFn: runPrWorkbenchZhPull,
    onSuccess: applySessionSuccess('zh 仓已拉齐 upstream', 'good'),
    onError: (error) => {
      setBannerMessage(error.message)
      setBannerTone('warn')
    },
  })

  const zhPushMutation = useMutation({
    mutationFn: runPrWorkbenchZhPush,
    onSuccess: applySessionSuccess('zh 仓已推送 upstream', 'good'),
    onError: (error) => {
      setBannerMessage(error.message)
      setBannerTone('warn')
    },
  })

  const forkRefreshMutation = useMutation({
    mutationFn: runPrWorkbenchForkRefresh,
    onSuccess: applySessionSuccess('fork 与 docs-zh 状态已刷新', 'good'),
    onError: (error) => {
      setBannerMessage(error.message)
      setBannerTone('warn')
    },
  })

  const forkCommitMutation = useMutation({
    mutationFn: runPrWorkbenchForkCommit,
    onSuccess: applySessionSuccess('fork 变更已提交，需重跑构建', 'good'),
    onError: (error) => {
      setBannerMessage(error.message)
      setBannerTone('warn')
    },
  })

  const buildMutation = useMutation({
    mutationFn: runPrWorkbenchBuildVerification,
    onSuccess: applySessionSuccess('构建结果已刷新', 'good'),
    onError: (error) => {
      setBannerMessage(error.message)
      setBannerTone('warn')
    },
  })

  const forkPushMutation = useMutation({
    mutationFn: runPrWorkbenchForkPush,
    onSuccess: applySessionSuccess('fork 分支已推送 origin', 'good'),
    onError: (error) => {
      setBannerMessage(error.message)
      setBannerTone('warn')
    },
  })

  function handleSelectVersion(version: string) {
    setSelectedVersion(version)
    setBannerMessage(undefined)
  }

  function handleRefresh() {
    setBannerMessage(undefined)
    void versionsQuery.refetch()
    if (selectedVersion) {
      void sessionQuery.refetch()
    }
  }

  const isMutating =
    zhSyncMutation.isPending ||
    zhPullMutation.isPending ||
    zhPushMutation.isPending ||
    forkRefreshMutation.isPending ||
    forkCommitMutation.isPending ||
    buildMutation.isPending ||
    forkPushMutation.isPending

  return (
    <PrWorkbenchView
      isDev={isDev}
      versions={versionsQuery.data?.versions ?? []}
      selectedVersion={selectedVersion}
      session={sessionQuery.data}
      isLoadingVersions={versionsQuery.isLoading || versionsQuery.isFetching}
      isLoadingSession={sessionQuery.isLoading || sessionQuery.isFetching}
      isMutating={isMutating}
      bannerMessage={bannerMessage}
      bannerTone={bannerTone}
      versionsErrorMessage={versionsQuery.error?.message}
      sessionErrorMessage={sessionQuery.error?.message}
      onSelectVersion={handleSelectVersion}
      onRefresh={handleRefresh}
      onCheckZhSync={() => selectedVersion && zhSyncMutation.mutate(selectedVersion)}
      onPullZh={() => selectedVersion && zhPullMutation.mutate(selectedVersion)}
      onPushZh={() => selectedVersion && zhPushMutation.mutate(selectedVersion)}
      onRefreshFork={() => selectedVersion && forkRefreshMutation.mutate(selectedVersion)}
      onCommitFork={() => selectedVersion && forkCommitMutation.mutate(selectedVersion)}
      onVerifyBuild={() => selectedVersion && buildMutation.mutate(selectedVersion)}
      onPushFork={() => selectedVersion && forkPushMutation.mutate(selectedVersion)}
    />
  )
}
