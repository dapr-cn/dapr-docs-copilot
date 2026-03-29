import assert from 'node:assert/strict'
import { extractMarkdownHeadingLevels, validateTranslationOutput } from '../src/server/translation-output-validation'

function validateMissingFrontmatterKeys() {
  const result = validateTranslationOutput({
    fileId: 'docs/alpha.md',
    sourcePath: 'data/source/docs/alpha.md',
    targetPath: 'translated_content/zh_CN/docs/alpha.md',
    sourceContent: ['---', 'title: Alpha', 'aliases:', '  - /docs/alpha', '---', '# Alpha', '', '## Install', ''].join('\n'),
    candidateContent: ['---', 'title: Alpha CN', '---', '# Alpha CN', '', '## Install CN', ''].join('\n'),
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.missingFrontmatterKeys, ['aliases'])
  assert.ok(result.triggeredRules.includes('missing_frontmatter_keys'))
}

function validateUnexpectedFrontmatterKeys() {
  const result = validateTranslationOutput({
    fileId: 'docs/beta.md',
    sourceContent: ['---', 'title: Beta', '---', '# Beta', ''].join('\n'),
    candidateContent: ['---', 'title: Beta CN', 'summary: extra', '---', '# Beta CN', ''].join('\n'),
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.unexpectedFrontmatterKeys, ['summary'])
  assert.ok(result.triggeredRules.includes('unexpected_frontmatter_keys'))
}

function validateHeadingCountMismatch() {
  const result = validateTranslationOutput({
    fileId: 'docs/gamma.md',
    sourceContent: ['# Gamma', '', '## Install', '', '## Verify', ''].join('\n'),
    candidateContent: ['# Gamma CN', '', '## Install CN', ''].join('\n'),
  })

  assert.equal(result.ok, false)
  assert.ok(result.triggeredRules.includes('heading_count_mismatch'))
  assert.ok(result.triggeredRules.includes('heading_level_mismatch'))
  assert.equal(result.sourceHeadingCount, 3)
  assert.equal(result.targetHeadingCount, 2)
  assert.deepEqual(result.headingLevelMismatches, [{ index: 3, sourceLevel: 2, targetLevel: null }])
}

function validateHeadingLevelMismatch() {
  const result = validateTranslationOutput({
    fileId: 'docs/theta.md',
    sourceContent: ['# Theta', '', '## Install', '', '### Deep Dive', ''].join('\n'),
    candidateContent: ['# Theta CN', '', '### Install CN', '', '### Deep Dive CN', ''].join('\n'),
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.sourceHeadingLevels, [1, 2, 3])
  assert.deepEqual(result.targetHeadingLevels, [1, 3, 3])
  assert.deepEqual(result.headingLevelMismatches, [{ index: 2, sourceLevel: 2, targetLevel: 3 }])
  assert.ok(result.triggeredRules.includes('heading_level_mismatch'))
}

function validateMarkdownWithoutFrontmatter() {
  const result = validateTranslationOutput({
    fileId: 'docs/delta.md',
    sourceContent: ['# Delta', '', 'workflow', '', '## Notes', ''].join('\n'),
    candidateContent: ['# Delta CN', '', 'workflow zh', '', '## Notes CN', ''].join('\n'),
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.sourceFrontmatterKeys, [])
  assert.deepEqual(result.targetFrontmatterKeys, [])
}

function validateHeadingExtractionIgnoresCodeFences() {
  const levels = extractMarkdownHeadingLevels([
    '# Top',
    '',
    '```md',
    '## Not a heading',
    '```',
    '',
    'Subheading',
    '---',
    '',
    '### Real heading',
    '',
  ].join('\n'))

  assert.deepEqual(levels, [1, 2, 3])
}

function validateDiagnosticFormat() {
  const candidateContent = ['---', 'title: Epsilon CN', '---', '# Epsilon CN', '', '### Install CN', ''].join('\n')
  const result = validateTranslationOutput({
    fileId: 'docs/epsilon.md',
    sourcePath: 'data/source/docs/epsilon.md',
    targetPath: 'translated_content/zh_CN/docs/epsilon.md',
    sourceContent: ['---', 'title: Epsilon', 'aliases:', '  - /docs/epsilon', '---', '# Epsilon', '', '## Install', ''].join('\n'),
    candidateContent,
  })

  assert.equal(result.ok, false)
  assert.match(result.diagnosticMessage, /file: docs\/epsilon\.md/)
  assert.match(result.diagnosticMessage, /rules: missing_frontmatter_keys,heading_level_mismatch/)
  assert.match(result.diagnosticMessage, /sourceHeadingCount: 2/)
  assert.match(result.diagnosticMessage, /targetHeadingCount: 2/)
  assert.match(result.diagnosticMessage, /headingLevelMismatches: #2:2->3/)
  assert.match(result.diagnosticMessage, /candidateContent:\n---\ntitle: Epsilon CN\n---\n# Epsilon CN\n\n### Install CN\n?$/)
}

function validateBomFrontmatterAndHeadings() {
  const result = validateTranslationOutput({
    fileId: 'docs/bom.md',
    sourceContent: ['\uFEFF---', 'title: Bom', '---', 'Body', '', '## Section', ''].join('\n'),
    candidateContent: ['---', 'title: Bom CN', '---', '正文', '', '## 章节', ''].join('\n'),
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.sourceFrontmatterKeys, ['title'])
  assert.deepEqual(result.targetFrontmatterKeys, ['title'])
  assert.deepEqual(result.sourceHeadingLevels, [2])
  assert.deepEqual(result.targetHeadingLevels, [2])
}

validateMissingFrontmatterKeys()
validateUnexpectedFrontmatterKeys()
validateHeadingCountMismatch()
validateHeadingLevelMismatch()
validateMarkdownWithoutFrontmatter()
validateHeadingExtractionIgnoresCodeFences()
validateDiagnosticFormat()
validateBomFrontmatterAndHeadings()

console.log('validated translation output validator contracts')
