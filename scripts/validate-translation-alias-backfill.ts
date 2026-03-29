import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { backfillTranslatedAliases } from '../src/server/translation-alias-backfill'

async function main() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'translation-alias-backfill-'))

  try {
    const repoRoot = path.join(workspaceRoot, 'repos', 'v9.99_zh')
    const translatedRoot = path.join(repoRoot, 'translated_content', 'zh_CN', 'docs')
    await mkdir(translatedRoot, { recursive: true })

    const missingPrefixPath = path.join(translatedRoot, 'alpha.md')
    const existingPrefixPath = path.join(translatedRoot, 'beta.md')
    const noAliasesPath = path.join(translatedRoot, 'gamma.md')

    await writeFile(
      missingPrefixPath,
      [
        '---',
        'title: "Alpha"',
        'aliases:',
        '  - "/contributing/codespaces/"',
        '  - "https://example.com/docs/"',
        '---',
        'Alpha CN',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      existingPrefixPath,
      [
        '---',
        'title: "Beta"',
        'aliases: ["/zh-hans/reference/api/", "https://example.com/docs/"]',
        '---',
        'Beta CN',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      noAliasesPath,
      [
        '---',
        'title: "Gamma"',
        '---',
        'Gamma CN',
        '',
      ].join('\n'),
      'utf8',
    )

    const dryRun = await backfillTranslatedAliases({
      workspaceRoot,
      versions: ['v9.99'],
      dryRun: true,
    })
    assert.equal(dryRun.scannedFiles, 3)
    assert.equal(dryRun.updatedFiles, 1)
    assert.equal(await readFile(missingPrefixPath, 'utf8'), [
      '---',
      'title: "Alpha"',
      'aliases:',
      '  - "/contributing/codespaces/"',
      '  - "https://example.com/docs/"',
      '---',
      'Alpha CN',
      '',
    ].join('\n'))

    const written = await backfillTranslatedAliases({
      workspaceRoot,
      versions: ['v9.99'],
    })
    assert.equal(written.scannedFiles, 3)
    assert.equal(written.updatedFiles, 1)
    assert.equal(
      await readFile(missingPrefixPath, 'utf8'),
      [
        '---',
        'title: "Alpha"',
        'aliases:',
        '  - "/zh-hans/contributing/codespaces/"',
        '  - "https://example.com/docs/"',
        '---',
        'Alpha CN',
        '',
      ].join('\n'),
    )
    assert.equal(
      await readFile(existingPrefixPath, 'utf8'),
      [
        '---',
        'title: "Beta"',
        'aliases: ["/zh-hans/reference/api/", "https://example.com/docs/"]',
        '---',
        'Beta CN',
        '',
      ].join('\n'),
    )
    assert.equal(
      await readFile(noAliasesPath, 'utf8'),
      [
        '---',
        'title: "Gamma"',
        '---',
        'Gamma CN',
        '',
      ].join('\n'),
    )
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

await main()

console.log('validated translation alias backfill')
