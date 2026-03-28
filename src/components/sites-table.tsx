import { useMemo, useState } from 'react'
import { flexRender, getCoreRowModel, getFilteredRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { Search } from 'lucide-react'
import type { SiteRecord } from '@/lib/mock-api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function statusBadge(status: SiteRecord['status']) {
  if (status === 'healthy') return <Badge variant="success">healthy</Badge>
  if (status === 'review') return <Badge variant="warning">review</Badge>
  return <Badge variant="secondary">queued</Badge>
}

export function SitesTable({ data }: { data: SiteRecord[] }) {
  const [globalFilter, setGlobalFilter] = useState('')

  const columns = useMemo<ColumnDef<SiteRecord>[]>(
    () => [
      {
        accessorKey: 'site',
        header: '站点',
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-foreground">{row.original.site}</p>
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{row.original.branch}</p>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: '状态',
        cell: ({ row }) => statusBadge(row.original.status),
      },
      {
        accessorKey: 'locale',
        header: '语言',
      },
      {
        accessorKey: 'owner',
        header: '归属',
      },
      {
        accessorKey: 'coverage',
        header: '覆盖度',
      },
      {
        accessorKey: 'lastSync',
        header: '最近同步',
      },
    ],
    [],
  )

  // TanStack Table intentionally exposes imperative helpers here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _, filterValue) => {
      const keyword = String(filterValue).toLowerCase().trim()
      if (!keyword) return true
      return Object.values(row.original).some((value) => String(value).toLowerCase().includes(keyword))
    },
  })

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <CardTitle>站点矩阵</CardTitle>
          <CardDescription>以 TanStack Table 组织多仓、多语言、多分支管理视图。</CardDescription>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={globalFilter} onChange={(event) => setGlobalFilter(event.target.value)} className="pl-10" placeholder="筛选站点 / 分支 / 责任人" />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
