import assert from 'node:assert/strict'
import { buildEffectiveSyncStatusOverview } from '../src/lib/zh-data'

const overview = buildEffectiveSyncStatusOverview(
  {
    version: 'v1.17',
    items: [
      {
        bucket: 'docs',
        relativePath: 'alpha.md',
        sourcePath: 'docs/alpha.md',
        sourceFile: 'data/source/docs/alpha.md',
        sourceSha256: 'sha-alpha',
        sourceStatus: 'synced',
        translationStatus: 'missingTranslation',
        translationFile: 'translated_content/zh_CN/docs/alpha.md',
      },
      {
        bucket: 'docs',
        relativePath: 'beta.md',
        sourcePath: 'docs/beta.md',
        sourceFile: 'data/source/docs/beta.md',
        sourceSha256: 'sha-beta',
        sourceStatus: 'synced',
        translationStatus: 'staleTranslation',
        translationFile: 'translated_content/zh_CN/docs/beta.md',
      },
    ],
  },
)

assert.ok(overview)
assert.equal(overview.items[0]?.translationStatus, 'missingTranslation')
assert.equal(overview.items[0]?.translationUpdatedAt, undefined)
assert.equal(overview.items[1]?.translationStatus, 'staleTranslation')
assert.equal(overview.translationSummary.translated, 0)
assert.equal(overview.translationSummary.staleTranslation, 1)
assert.equal(overview.translationSummary.missingTranslation, 1)
assert.equal(overview.buckets[0]?.translatedCount, 0)
assert.equal(overview.buckets[0]?.staleTranslationCount, 1)
assert.equal(overview.buckets[0]?.missingTranslationCount, 1)

console.log('validated zh data authority state contracts')
