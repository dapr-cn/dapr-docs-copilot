import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrWorkbenchView } from '../src/components/pr-workbench/pr-workbench-view'
import { PRIMARY_NAVIGATION } from '../src/lib/primary-navigation'
import type { PrWorkbenchSession, PrWorkbenchVersionWorkspace } from '../src/lib/pr-workbench-models'

const versions: PrWorkbenchVersionWorkspace[] = [
  {
    version: 'v1.17',
    label: 'v1.17',
    zhRepoPath: 'repos/v1.17_zh',
    forkRepoPath: 'repos/fork-v1.17',
    zhBranch: 'v1.17_content',
    forkBranch: 'v1.17',
    zhRemote: 'origin',
    forkUpstreamRemote: 'source',
    submodulePath: 'translations/docs-zh',
    buildScriptName: 'build',
    buildCommandLabel: 'npm run build',
    buildScript: 'node build.mjs',
  },
]

const blockedSession: PrWorkbenchSession = {
  version: 'v1.17',
  workspace: versions[0],
  ready: false,
  lastUpdatedAt: '2026-03-29T12:00:00.000Z',
  steps: {
    zhSync: {
      id: 'zhSync',
      title: 'zh 仓同步校验',
      description: '检查 zh 仓。',
      status: 'idle',
      logs: [],
    },
    forkRefresh: {
      id: 'forkRefresh',
      title: '更新 fork 与 submodule',
      description: '更新 fork。',
      status: 'blocked',
      blockedReason: '需先通过 zh 仓同步校验',
      logs: [],
    },
    buildVerification: {
      id: 'buildVerification',
      title: '本地构建验证',
      description: '执行构建。',
      status: 'blocked',
      blockedReason: '需先完成 fork 更新与 submodule 对齐',
      logs: [],
    },
  },
}

const readySession: PrWorkbenchSession = {
  version: 'v1.17',
  workspace: versions[0],
  ready: true,
  lastUpdatedAt: '2026-03-29T12:10:00.000Z',
  readySummary: {
    version: 'v1.17',
    zhHeadSha: 'aaaaaaaa11111111',
    forkHeadSha: 'bbbbbbbb22222222',
    submoduleSha: 'aaaaaaaa11111111',
    buildVerifiedAt: '2026-03-29T12:09:00.000Z',
    buildCommandLabel: 'npm run build',
  },
  steps: {
    zhSync: {
      id: 'zhSync',
      title: 'zh 仓同步校验',
      description: '检查 zh 仓。',
      status: 'passed',
      logs: [
        {
          id: 'zh-log',
          scope: 'zhSync',
          title: '读取 zh HEAD',
          summary: 'HEAD=aaaaaaaa11111111',
          command: 'git rev-parse HEAD',
          cwd: 'repos/v1.17_zh',
          stdout: 'aaaaaaaa11111111',
          startedAt: '2026-03-29T12:00:00.000Z',
          finishedAt: '2026-03-29T12:00:01.000Z',
          exitCode: 0,
        },
      ],
      result: {
        checkedAt: '2026-03-29T12:00:01.000Z',
        zhHeadSha: 'aaaaaaaa11111111',
        upstreamRef: 'origin/v1.17_content',
        aheadCount: 0,
        behindCount: 0,
        dirtyEntries: [],
        dirtyFiles: [],
      },
    },
    forkRefresh: {
      id: 'forkRefresh',
      title: '更新 fork 与 submodule',
      description: '更新 fork。',
      status: 'passed',
      logs: [],
      result: {
        checkedAt: '2026-03-29T12:05:00.000Z',
        zhHeadSha: 'aaaaaaaa11111111',
        upstreamRef: 'source/v1.17',
        forkHeadSha: 'bbbbbbbb22222222',
        previousForkHeadSha: 'cccccccc33333333',
        submodulePath: 'translations/docs-zh',
        submoduleSha: 'aaaaaaaa11111111',
        dirtyEntries: [],
      },
    },
    buildVerification: {
      id: 'buildVerification',
      title: '本地构建验证',
      description: '执行构建。',
      status: 'passed',
      logs: [
        {
          id: 'build-log',
          scope: 'buildVerification',
          title: '执行本地构建',
          summary: 'npm run build',
          command: 'npm run build',
          cwd: 'repos/fork-v1.17',
          stdout: 'build ok',
          startedAt: '2026-03-29T12:08:00.000Z',
          finishedAt: '2026-03-29T12:09:00.000Z',
          exitCode: 0,
        },
      ],
      result: {
        startedAt: '2026-03-29T12:08:00.000Z',
        finishedAt: '2026-03-29T12:09:00.000Z',
        command: ['npm', 'run', 'build'],
        commandLabel: 'npm run build',
        exitCode: 0,
        succeeded: true,
        stdout: 'build ok',
        stderr: '',
        forkHeadSha: 'bbbbbbbb22222222',
        submoduleSha: 'aaaaaaaa11111111',
      },
    },
  },
}

const behindSession: PrWorkbenchSession = {
  version: 'v1.17',
  workspace: versions[0],
  ready: false,
  lastUpdatedAt: '2026-03-29T12:03:00.000Z',
  steps: {
    zhSync: {
      id: 'zhSync',
      title: 'zh 仓同步校验',
      description: '检查 zh 仓。',
      status: 'failed',
      error: {
        code: 'zh_diverged',
        message: 'zh 分支与 origin/v1.17_content 未对齐（ahead 0 / behind 1）',
      },
      logs: [],
      result: {
        checkedAt: '2026-03-29T12:03:00.000Z',
        zhHeadSha: 'aaaaaaaa11111111',
        upstreamRef: 'origin/v1.17_content',
        aheadCount: 0,
        behindCount: 1,
        dirtyEntries: [],
        dirtyFiles: [],
      },
    },
    forkRefresh: {
      id: 'forkRefresh',
      title: '更新 fork 与 submodule',
      description: '更新 fork。',
      status: 'blocked',
      blockedReason: '需先通过 zh 仓同步校验',
      logs: [],
    },
    buildVerification: {
      id: 'buildVerification',
      title: '本地构建验证',
      description: '执行构建。',
      status: 'blocked',
      blockedReason: '需先完成 fork 更新与 submodule 对齐',
      logs: [],
    },
  },
}

assert.ok(PRIMARY_NAVIGATION.some((item) => item.label === 'PR 工作台'))

const blockedHtml = renderToStaticMarkup(
  <PrWorkbenchView
    isDev
    versions={versions}
    selectedVersion="v1.17"
    session={blockedSession}
    onSelectVersion={() => {}}
    onRefresh={() => {}}
    onCheckZhSync={() => {}}
    onPullZh={() => {}}
    onPushZh={() => {}}
    onRefreshFork={() => {}}
    onCommitFork={() => {}}
    onVerifyBuild={() => {}}
    onPushFork={() => {}}
  />,
)
assert.ok(blockedHtml.includes('PR 工作台'))
assert.ok(blockedHtml.includes('需先通过步骤 1。'))
assert.ok(blockedHtml.includes('disabled=""'))
assert.ok(blockedHtml.includes('docs-zh'))

const behindHtml = renderToStaticMarkup(
  <PrWorkbenchView
    isDev
    versions={versions}
    selectedVersion="v1.17"
    session={behindSession}
    onSelectVersion={() => {}}
    onRefresh={() => {}}
    onCheckZhSync={() => {}}
    onPullZh={() => {}}
    onPushZh={() => {}}
    onRefreshFork={() => {}}
    onCommitFork={() => {}}
    onVerifyBuild={() => {}}
    onPushFork={() => {}}
  />,
)
assert.ok(behindHtml.includes('直接拉取 zh'))
assert.ok(behindHtml.includes('直接推送 zh'))

const readyHtml = renderToStaticMarkup(
  <PrWorkbenchView
    isDev
    versions={versions}
    selectedVersion="v1.17"
    session={readySession}
    bannerMessage="构建结果已刷新"
    bannerTone="good"
    onSelectVersion={() => {}}
    onRefresh={() => {}}
    onCheckZhSync={() => {}}
    onPullZh={() => {}}
    onPushZh={() => {}}
    onRefreshFork={() => {}}
    onCommitFork={() => {}}
    onVerifyBuild={() => {}}
    onPushFork={() => {}}
  />,
)
assert.ok(readyHtml.includes('Ready 摘要'))
assert.ok(readyHtml.includes('当前版本可进入 PR 准备'))
assert.ok(readyHtml.includes('build ok'))
assert.ok(readyHtml.includes('npm run build'))
assert.ok(readyHtml.includes('执行构建'))
assert.ok(readyHtml.includes('提交 fork 变更'))
assert.ok(readyHtml.includes('推送 fork'))

console.log('validated pr workbench ui contracts')
