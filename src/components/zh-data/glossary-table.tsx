import { Fragment, useMemo, useState } from 'react'
import { AlertTriangle, PencilLine, Plus, Save, Search, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { GlossaryDataset, GlossaryMutationResult, GlossaryTerm, GlossaryTermDraft, GlossaryValidationErrors, ZhDatasetView } from '@/lib/zh-data-models'
import { validateGlossaryTermDraft } from '@/lib/zh-glossary'
import { cn } from '@/lib/utils'

type GlossaryTableProps = {
  dataset: ZhDatasetView
  glossary: GlossaryDataset
  onCreate: (draft: GlossaryTermDraft) => Promise<GlossaryMutationResult>
  onUpdate: (termId: string, draft: GlossaryTermDraft) => Promise<GlossaryMutationResult>
  onDelete: (termId: string) => Promise<GlossaryMutationResult>
  initialState?: {
    search?: string
    createDraft?: GlossaryTermDraft | null
    createErrors?: GlossaryValidationErrors
    drafts?: Record<string, GlossaryTermDraft>
    rowErrors?: Record<string, GlossaryValidationErrors | undefined>
    pendingRows?: Record<string, 'save' | 'delete' | undefined>
  }
}

const CREATE_ROW_ID = '__create__'

function emptyDraft(): GlossaryTermDraft {
  return {
    source: '',
    target: '',
    notes: '',
  }
}

function filterTerms(terms: GlossaryTerm[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN')
  if (!normalizedKeyword) {
    return terms
  }

  return terms.filter((term) => {
    const haystack = [term.source, term.target, term.notes].join(' ').toLocaleLowerCase('zh-CN')
    return haystack.includes(normalizedKeyword)
  })
}

function hasErrors(errors: GlossaryValidationErrors | undefined) {
  return Boolean(errors && Object.values(errors).some(Boolean))
}

function glossaryErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '术语请求失败'
}

export function GlossaryTable({ dataset, glossary, onCreate, onUpdate, onDelete, initialState }: GlossaryTableProps) {
  const [search, setSearch] = useState(initialState?.search ?? '')
  const [createDraft, setCreateDraft] = useState<GlossaryTermDraft | null>(initialState?.createDraft ?? null)
  const [createErrors, setCreateErrors] = useState<GlossaryValidationErrors | undefined>(initialState?.createErrors)
  const [drafts, setDrafts] = useState<Record<string, GlossaryTermDraft>>(initialState?.drafts ?? {})
  const [rowErrors, setRowErrors] = useState<Record<string, GlossaryValidationErrors | undefined>>(initialState?.rowErrors ?? {})
  const [pendingRows, setPendingRows] = useState<Record<string, 'save' | 'delete' | undefined>>(initialState?.pendingRows ?? {})

  const filteredTerms = useMemo(() => filterTerms(glossary.terms, search), [glossary.terms, search])
  const isReadOnly = glossary.readOnlyState.mode === 'read-only'
  const readOnlyReason = glossary.readOnlyState.mode === 'read-only' ? glossary.readOnlyState.reason : undefined

  const startCreate = () => {
    if (isReadOnly) {
      return
    }

    setCreateDraft(emptyDraft())
    setCreateErrors(undefined)
  }

  const cancelCreate = () => {
    setCreateDraft(null)
    setCreateErrors(undefined)
  }

  const saveCreate = async () => {
    if (!createDraft) {
      return
    }

    const errors = validateGlossaryTermDraft(createDraft, glossary)
    if (hasErrors(errors)) {
      setCreateErrors(errors)
      return
    }

    setPendingRows((current) => ({ ...current, [CREATE_ROW_ID]: 'save' }))
    setCreateErrors(undefined)

    try {
      await onCreate(createDraft)
      setCreateDraft(null)
    } catch (error) {
      setCreateErrors({ form: glossaryErrorMessage(error) })
    } finally {
      setPendingRows((current) => ({ ...current, [CREATE_ROW_ID]: undefined }))
    }
  }

  const startEdit = (term: GlossaryTerm) => {
    if (isReadOnly) {
      return
    }

    setDrafts((current) => ({
      ...current,
      [term.id]: {
        source: term.source,
        target: term.target,
        notes: term.notes,
      },
    }))
    setRowErrors((current) => ({ ...current, [term.id]: undefined }))
  }

  const cancelEdit = (termId: string) => {
    setDrafts((current) => {
      const next = { ...current }
      delete next[termId]
      return next
    })
    setRowErrors((current) => ({ ...current, [termId]: undefined }))
  }

  const saveEdit = async (termId: string) => {
    const draft = drafts[termId]
    if (!draft) {
      return
    }

    const errors = validateGlossaryTermDraft(draft, glossary, termId)
    if (hasErrors(errors)) {
      setRowErrors((current) => ({ ...current, [termId]: errors }))
      return
    }

    setPendingRows((current) => ({ ...current, [termId]: 'save' }))
    setRowErrors((current) => ({ ...current, [termId]: undefined }))

    try {
      await onUpdate(termId, draft)
      cancelEdit(termId)
    } catch (error) {
      setRowErrors((current) => ({ ...current, [termId]: { form: glossaryErrorMessage(error) } }))
    } finally {
      setPendingRows((current) => ({ ...current, [termId]: undefined }))
    }
  }

  const removeTerm = async (termId: string) => {
    setPendingRows((current) => ({ ...current, [termId]: 'delete' }))
    setRowErrors((current) => ({ ...current, [termId]: undefined }))

    try {
      await onDelete(termId)
    } catch (error) {
      setRowErrors((current) => ({ ...current, [termId]: { form: glossaryErrorMessage(error) } }))
    } finally {
      setPendingRows((current) => ({ ...current, [termId]: undefined }))
    }
  }

  return (
    <Card className="border-border/70 bg-card/90">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Badge variant="outline" className="w-fit">{dataset.fileName}</Badge>
          <div>
            <CardTitle>{dataset.label}</CardTitle>
            <CardDescription className="mt-2 max-w-2xl">{dataset.description}</CardDescription>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge variant={isReadOnly ? 'warning' : 'success'}>
            {isReadOnly ? '只读降级' : pendingRows[CREATE_ROW_ID] || Object.values(pendingRows).some(Boolean) ? '保存中' : '可写'}
          </Badge>
          <Badge variant="secondary">{dataset.infoLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 overflow-hidden">
        {isReadOnly ? (
          <div className="flex flex-col gap-2 rounded-[24px] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" />
              当前仅可浏览术语。
            </div>
            <p>{readOnlyReason}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索术语或备注" className="pl-10" />
          </div>
          <Button variant="outline" onClick={startCreate} disabled={isReadOnly || Boolean(createDraft)}>
            <Plus className="size-4" />
            新增术语
          </Button>
        </div>

        <div className="max-h-[min(68vh,52rem)] overflow-auto rounded-[24px] border border-border/70 bg-background/55">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">英文</TableHead>
                <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">中文</TableHead>
                <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">备注</TableHead>
                <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {createDraft ? (
                <EditableRow
                  rowId={CREATE_ROW_ID}
                  draft={createDraft}
                  errors={createErrors}
                  pendingAction={pendingRows[CREATE_ROW_ID]}
                  onChange={(field, value) => {
                    setCreateDraft((current) => (current ? { ...current, [field]: value } : current))
                    setCreateErrors(undefined)
                  }}
                  onCancel={cancelCreate}
                  onSave={saveCreate}
                  saveLabel="创建"
                />
              ) : null}

              {filteredTerms.map((term) => {
                const draft = drafts[term.id]
                const pendingAction = pendingRows[term.id]

                if (draft) {
                  return (
                    <EditableRow
                      key={term.id}
                      rowId={term.id}
                      draft={draft}
                      errors={rowErrors[term.id]}
                      pendingAction={pendingAction}
                      onChange={(field, value) => {
                        setDrafts((current) => ({
                          ...current,
                          [term.id]: {
                            ...current[term.id],
                            [field]: value,
                          },
                        }))
                        setRowErrors((current) => ({ ...current, [term.id]: undefined }))
                      }}
                      onCancel={() => cancelEdit(term.id)}
                      onSave={() => saveEdit(term.id)}
                    />
                  )
                }

                return (
                  <Fragment key={term.id}>
                    <TableRow>
                      <TableCell className="font-medium text-foreground">{term.source}</TableCell>
                      <TableCell>{term.target}</TableCell>
                      <TableCell className="text-muted-foreground">{term.notes || '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(term)} disabled={isReadOnly || Boolean(pendingAction)}>
                            <PencilLine className="size-4" />
                            编辑
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => void removeTerm(term.id)} disabled={isReadOnly || Boolean(pendingAction)}>
                            <Trash2 className="size-4" />
                            {pendingAction === 'delete' ? '删除中' : '删除'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {rowErrors[term.id]?.form ? (
                      <TableRow>
                        <TableCell colSpan={4} className="pt-0">
                          <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
                            {rowErrors[term.id]?.form}
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}

              {!createDraft && filteredTerms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    {glossary.terms.length === 0 ? dataset.emptyMessage ?? '暂无术语。' : '未找到匹配术语。'}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

type EditableRowProps = {
  rowId: string
  draft: GlossaryTermDraft
  errors?: GlossaryValidationErrors
  pendingAction?: 'save' | 'delete'
  saveLabel?: string
  onChange: (field: keyof GlossaryTermDraft, value: string) => void
  onCancel: () => void
  onSave: () => void
}

function EditableRow({
  rowId,
  draft,
  errors,
  pendingAction,
  saveLabel = '保存',
  onChange,
  onCancel,
  onSave,
}: EditableRowProps) {
  const isSaving = pendingAction === 'save'

  return (
    <Fragment key={rowId}>
      <TableRow className="bg-muted/25">
        <TableCell className="align-top">
          <FieldInput value={draft.source} onChange={(value) => onChange('source', value)} error={errors?.source} placeholder="例如 workflow" disabled={isSaving} />
        </TableCell>
        <TableCell className="align-top">
          <FieldInput value={draft.target} onChange={(value) => onChange('target', value)} error={errors?.target} placeholder="例如 工作流" disabled={isSaving} />
        </TableCell>
        <TableCell className="align-top">
          <FieldInput value={draft.notes} onChange={(value) => onChange('notes', value)} error={errors?.notes} placeholder="可选备注" disabled={isSaving} />
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onSave} disabled={isSaving}>
              <Save className="size-4" />
              {isSaving ? `${saveLabel}中` : saveLabel}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
              <X className="size-4" />
              取消
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {errors?.form ? (
        <TableRow>
          <TableCell colSpan={4} className="pt-0">
            <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">{errors.form}</p>
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  )
}

type FieldInputProps = {
  value: string
  placeholder: string
  disabled: boolean
  error?: string
  onChange: (value: string) => void
}

function FieldInput({ value, placeholder, disabled, error, onChange }: FieldInputProps) {
  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(error && 'border-rose-500/60 focus-visible:ring-rose-500/40')}
      />
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  )
}
