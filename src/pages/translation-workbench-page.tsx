import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TranslationWorkbenchView } from '@/components/translation-workbench/workbench-view'
import {
  createTranslationWorkbenchJob,
  fetchTranslationWorkbenchFiles,
  fetchTranslationWorkbenchJob,
  fetchTranslationWorkbenchVersions,
  getTranslationWorkbenchPollInterval,
  retryTranslationWorkbenchItem,
} from '@/lib/translation-workbench'
import {
  DEFAULT_TRANSLATION_JOB_CONCURRENCY,
  MAX_TRANSLATION_JOB_CONCURRENCY,
  MIN_TRANSLATION_JOB_CONCURRENCY,
  isValidTranslationJobConcurrency,
  type TranslationWorkbenchFile,
  type TranslationWorkbenchJobItem,
  type TranslationWorkbenchVersion,
} from '@/lib/translation-workbench-models'

const EMPTY_VERSIONS: TranslationWorkbenchVersion[] = []
const EMPTY_FILES: TranslationWorkbenchFile[] = []

function getConcurrencyValidationMessage(rawValue: string): string | undefined {
  if (rawValue.trim().length === 0) {
    return `并发数量仅支持 ${MIN_TRANSLATION_JOB_CONCURRENCY}-${MAX_TRANSLATION_JOB_CONCURRENCY} 的整数`
  }

  const value = Number(rawValue)
  if (!isValidTranslationJobConcurrency(value)) {
    return `并发数量仅支持 ${MIN_TRANSLATION_JOB_CONCURRENCY}-${MAX_TRANSLATION_JOB_CONCURRENCY} 的整数`
  }

  return undefined
}

export function TranslationWorkbenchPage() {
  const isDev = import.meta.env.DEV
  const queryClient = useQueryClient()
  const [selectedVersion, setSelectedVersion] = useState('')
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [concurrencyValue, setConcurrencyValue] = useState(String(DEFAULT_TRANSLATION_JOB_CONCURRENCY))
  const [bannerMessage, setBannerMessage] = useState<string>()
  const [bannerTone, setBannerTone] = useState<'default' | 'good' | 'warn'>('default')
  const completedJobsRef = useRef(new Set<string>())

  const versionsQuery = useQuery({
    queryKey: ['translation-workbench', 'versions'],
    queryFn: fetchTranslationWorkbenchVersions,
    enabled: isDev,
  })

  const filesQuery = useQuery({
    queryKey: ['translation-workbench', 'files', selectedVersion],
    queryFn: () => fetchTranslationWorkbenchFiles(selectedVersion),
    enabled: isDev && selectedVersion.length > 0,
  })

  const jobQuery = useQuery({
    queryKey: ['translation-workbench', 'job', activeJobId],
    queryFn: () => fetchTranslationWorkbenchJob(activeJobId!),
    enabled: isDev && activeJobId !== null,
    refetchInterval: (query) => getTranslationWorkbenchPollInterval(query.state.data),
  })

  const createJobMutation = useMutation({
    mutationFn: createTranslationWorkbenchJob,
    onSuccess: (job) => {
      setActiveJobId(job.jobId)
      setConcurrencyValue(String(job.concurrency))
      setSelectedFileIds([])
      setBannerMessage(`任务已创建：${job.items.length} 项，并发 ${job.concurrency}`)
      setBannerTone('good')
    },
    onError: (error) => {
      setBannerMessage(error.message)
      setBannerTone('warn')
    },
  })

  const retryMutation = useMutation({
    mutationFn: ({ jobId, itemId }: { jobId: string; itemId: string }) => retryTranslationWorkbenchItem(jobId, itemId),
    onSuccess: (job) => {
      setActiveJobId(job.jobId)
      setBannerMessage('失败项已重新入队')
      setBannerTone('good')
    },
    onError: (error) => {
      setBannerMessage(error.message)
      setBannerTone('warn')
    },
  })

  const versions = versionsQuery.data?.versions ?? EMPTY_VERSIONS
  const files = filesQuery.data?.files ?? EMPTY_FILES
  const templateName = versionsQuery.data?.templateName ?? filesQuery.data?.templateName ?? 'claude-default.hbs'
  const job = jobQuery.data
  const isQueueLocked = Boolean(job?.isActive)
  const concurrencyError = useMemo(() => getConcurrencyValidationMessage(concurrencyValue), [concurrencyValue])

  useEffect(() => {
    if (selectedVersion || versions.length === 0) {
      return
    }

    setSelectedVersion(versions[0].id)
  }, [selectedVersion, versions])

  useEffect(() => {
    setSelectedFileIds((current) => {
      const next = current.filter((fileId) => files.some((file) => file.id === fileId))
      return next.length === current.length ? current : next
    })
  }, [files])

  useEffect(() => {
    if (!job) {
      return
    }

    setConcurrencyValue(String(job.concurrency))
  }, [job])

  useEffect(() => {
    if (!job || job.isActive || completedJobsRef.current.has(job.jobId)) {
      return
    }

    completedJobsRef.current.add(job.jobId)
    if (job.counts.completed > 0) {
      void queryClient.invalidateQueries({ queryKey: ['translation-workbench', 'files', job.version] })
      setBannerMessage(`任务完成：成功 ${job.counts.completed}，失败 ${job.counts.failed}`)
      setBannerTone(job.counts.failed > 0 ? 'warn' : 'good')
      return
    }

    if (job.counts.failed > 0) {
      setBannerMessage(`任务结束：失败 ${job.counts.failed}`)
      setBannerTone('warn')
    }
  }, [job, queryClient])

  const filesErrorMessage = useMemo(() => {
    if (!isDev) {
      return undefined
    }
    return filesQuery.error?.message
  }, [filesQuery.error, isDev])

  function handleSelectVersion(nextVersion: string) {
    if (!nextVersion || isQueueLocked) {
      return
    }

    setSelectedVersion(nextVersion)
    setSelectedFileIds([])
    setActiveJobId(null)
    setConcurrencyValue(String(DEFAULT_TRANSLATION_JOB_CONCURRENCY))
    setBannerMessage(undefined)
  }

  function handleChangeConcurrency(nextValue: string) {
    if (isQueueLocked) {
      return
    }

    setConcurrencyValue(nextValue)
  }

  function handleToggleFile(fileId: string) {
    setSelectedFileIds((current) => (current.includes(fileId) ? current.filter((item) => item !== fileId) : [...current, fileId]))
  }

  function handleToggleAll(checked: boolean) {
    setSelectedFileIds(checked ? files.map((file) => file.id) : [])
  }

  function handleSelectAll() {
    setSelectedFileIds(files.map((file) => file.id))
  }

  function handleClearSelection() {
    setSelectedFileIds([])
  }

  function handleRefresh() {
    setBannerMessage(undefined)
    void versionsQuery.refetch()
    if (selectedVersion) {
      void filesQuery.refetch()
    }
    if (activeJobId) {
      void jobQuery.refetch()
    }
  }

  function handleTranslate() {
    if (!selectedVersion) {
      setBannerMessage('请先选择版本')
      setBannerTone('warn')
      return
    }

    if (selectedFileIds.length === 0) {
      setBannerMessage('至少选择一个待翻译文件')
      setBannerTone('warn')
      return
    }

    if (isQueueLocked) {
      setBannerMessage('队列运行中，勿重复提交')
      setBannerTone('warn')
      return
    }

    if (concurrencyError) {
      setBannerMessage(concurrencyError)
      setBannerTone('warn')
      return
    }

    createJobMutation.mutate({
      version: selectedVersion,
      fileIds: selectedFileIds,
      concurrency: Number(concurrencyValue),
    })
  }

  function handleRetry(item: TranslationWorkbenchJobItem) {
    if (!job || item.status !== 'failed') {
      setBannerMessage('仅失败项允许重试')
      setBannerTone('warn')
      return
    }

    retryMutation.mutate({
      jobId: job.jobId,
      itemId: item.id,
    })
  }

  return (
    <TranslationWorkbenchView
      isDev={isDev}
      versions={versions}
      selectedVersion={selectedVersion}
      templateName={templateName}
      files={files}
      job={job}
      selectedFileIds={selectedFileIds}
      concurrencyValue={concurrencyValue}
      concurrencyError={concurrencyError}
      isLoadingVersions={versionsQuery.isLoading}
      isLoadingFiles={filesQuery.isLoading || filesQuery.isFetching}
      isSubmitting={createJobMutation.isPending}
      isRetrying={retryMutation.isPending}
      isQueueLocked={isQueueLocked}
      bannerMessage={bannerMessage}
      bannerTone={bannerTone}
      filesErrorMessage={filesErrorMessage}
      onSelectVersion={handleSelectVersion}
      onChangeConcurrency={handleChangeConcurrency}
      onSelectAll={handleSelectAll}
      onClearSelection={handleClearSelection}
      onRefresh={handleRefresh}
      onTranslate={handleTranslate}
      onToggleFile={handleToggleFile}
      onToggleAll={handleToggleAll}
      onRetry={handleRetry}
    />
  )
}
