import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createGlossaryTermInFile,
  deleteGlossaryTermInFile,
  readGlossaryDataset,
  updateGlossaryTermInFile,
} from '../src/lib/zh-glossary-admin'

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zh-glossary-admin-'))
const glossaryFilePath = path.join(tempRoot, 'glossary.json')

try {
  await writeFile(
    glossaryFilePath,
    JSON.stringify(
      {
        version: 'v1.17',
        generatedAt: '2026-03-28T10:00:00.000Z',
        terms: [
          {
            source: 'workflow',
            target: '工作流',
            notes: '旧数据',
            status: 'approved',
            category: 'product',
          },
          {
            source: 'sidecar',
            target: '边车',
            notes: '沿用译法',
            status: 'approved',
            category: 'architecture',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  )

  const initialDataset = await readGlossaryDataset(glossaryFilePath)
  assert.equal(initialDataset.terms.length, 2)
  assert.ok(initialDataset.terms.every((term) => term.id.startsWith('term-')))

  const legacyTermId = initialDataset.terms[0].id
  const createResult = await createGlossaryTermInFile(glossaryFilePath, {
    source: 'state store',
    target: '状态存储',
    notes: '新增术语',
  })
  assert.equal(createResult.dataset.terms.length, 3)

  const persistedAfterCreate = JSON.parse(await readFile(glossaryFilePath, 'utf8')) as {
    generatedAt: string
    terms: Array<Record<string, unknown>>
  }
  assert.ok(typeof persistedAfterCreate.generatedAt === 'string' && persistedAfterCreate.generatedAt.length > 0)
  assert.ok(persistedAfterCreate.terms.every((term) => typeof term.id === 'string'))
  assert.ok(persistedAfterCreate.terms.every((term) => !('status' in term) && !('category' in term)))

  const updateResult = await updateGlossaryTermInFile(glossaryFilePath, legacyTermId, {
    source: 'workflow',
    target: '工作流编排',
    notes: '已更新备注',
  })
  const updatedTerm = updateResult.dataset.terms.find((term) => term.id === legacyTermId)
  assert.equal(updatedTerm?.target, '工作流编排')
  assert.ok(updatedTerm?.updatedAt)

  const createdTerm = createResult.dataset.terms.find((term) => term.source === 'state store')
  assert.ok(createdTerm)
  const deleteResult = await deleteGlossaryTermInFile(glossaryFilePath, createdTerm!.id)
  assert.equal(deleteResult.dataset.terms.some((term) => term.id === createdTerm!.id), false)

  console.log('validated zh glossary admin contracts')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
