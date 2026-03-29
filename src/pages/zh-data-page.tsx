import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ZhDataConsoleView } from '@/components/zh-data/console-view'
import { fetchZhConsole } from '@/lib/zh-data'
import { createGlossaryTerm, deleteGlossaryTerm, fetchGlossaryDataset, updateGlossaryTerm } from '@/lib/zh-glossary'
import { runZhDataSync } from '@/lib/zh-sync'

export function ZhDataPage() {
  const canRunSync = import.meta.env.DEV
  const [selectedVersion, setSelectedVersion] = useState('')
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['zh-data-console', selectedVersion || '__default__'],
    queryFn: () => fetchZhConsole(selectedVersion || undefined),
  })
  const effectiveVersion = selectedVersion || data?.version || ''
  const glossaryQuery = useQuery({
    queryKey: ['glossary-admin', effectiveVersion || '__default__'],
    queryFn: () => fetchGlossaryDataset(effectiveVersion),
    enabled: effectiveVersion.length > 0,
  })
  const syncMutation = useMutation({
    mutationFn: runZhDataSync,
  })
  const createMutation = useMutation({
    mutationFn: (draft: Parameters<typeof createGlossaryTerm>[1]) => createGlossaryTerm(effectiveVersion, draft),
    onSuccess: async (result) => {
      queryClient.setQueryData(['glossary-admin', result.dataset.version], result.dataset)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['zh-data-console'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })])
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ termId, draft }: { termId: string; draft: Parameters<typeof updateGlossaryTerm>[2] }) => updateGlossaryTerm(effectiveVersion, termId, draft),
    onSuccess: async (result) => {
      queryClient.setQueryData(['glossary-admin', result.dataset.version], result.dataset)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['zh-data-console'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })])
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (termId: string) => deleteGlossaryTerm(effectiveVersion, termId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['glossary-admin', result.dataset.version], result.dataset)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['zh-data-console'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })])
    },
  })

  if (!data || (glossaryQuery.isPending && !glossaryQuery.data)) {
    return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-[28px] bg-muted" />)}</div>
  }

  return (
    <ZhDataConsoleView
      payload={data}
      versions={data.versions}
      selectedVersion={effectiveVersion}
      onSelectVersion={setSelectedVersion}
      glossary={
        glossaryQuery.data
          ? {
              dataset: glossaryQuery.data,
              onCreate: (draft) => createMutation.mutateAsync(draft),
              onUpdate: (termId, draft) => updateMutation.mutateAsync({ termId, draft }),
              onDelete: (termId) => deleteMutation.mutateAsync(termId),
            }
          : undefined
      }
      onRunSync={canRunSync && effectiveVersion ? () => syncMutation.mutate(effectiveVersion) : undefined}
      isSyncing={canRunSync && syncMutation.isPending}
      syncMessage={
        !canRunSync
          ? undefined
          : syncMutation.isPending
          ? '全量同步执行中'
          : syncMutation.isError
            ? syncMutation.error.message
            : syncMutation.isSuccess
              ? '同步完成，页面即将刷新'
              : undefined
      }
      syncTone={!canRunSync ? 'default' : syncMutation.isError ? 'warn' : syncMutation.isSuccess ? 'good' : 'default'}
    />
  )
}
