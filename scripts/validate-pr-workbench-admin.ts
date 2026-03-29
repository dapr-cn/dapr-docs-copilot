import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { createPrWorkbenchAdmin } from '../src/server/pr-workbench-admin'

const execFileAsync = promisify(execFile)
const gitCommand = process.platform === 'win32' ? 'git.exe' : 'git'

async function run(command: string, args: string[], cwd: string, allowFailure = false) {
  try {
    const result = await execFileAsync(command, args, { cwd, env: process.env, maxBuffer: 8 * 1024 * 1024 })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string }
    if (allowFailure) {
      return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
    }
    throw new Error([command, ...args, `\n${failure.stderr ?? ''}`].join(' '))
  }
}

async function git(cwd: string, args: string[], allowFailure = false) {
  return run(gitCommand, args, cwd, allowFailure)
}

async function gitOutput(cwd: string, args: string[]) {
  const result = await git(cwd, args)
  return result.stdout.trim()
}

async function configureRepo(cwd: string) {
  await git(cwd, ['config', 'user.name', 'Codex Test'])
  await git(cwd, ['config', 'user.email', 'codex@example.com'])
}

async function setBareHead(repoPath: string, ref: string) {
  await git(repoPath, ['symbolic-ref', 'HEAD', ref])
}

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'pr-workbench-'))
  const reposRoot = path.join(workspaceRoot, 'repos')
  await mkdir(reposRoot, { recursive: true })

  const zhOrigin = path.join(workspaceRoot, 'zh-origin.git')
  const sourceOrigin = path.join(workspaceRoot, 'source-origin.git')
  const forkOrigin = path.join(workspaceRoot, 'fork-origin.git')
  await git(workspaceRoot, ['init', '--bare', zhOrigin])
  await git(workspaceRoot, ['init', '--bare', sourceOrigin])

  const zhSeed = path.join(workspaceRoot, 'zh-seed')
  await git(workspaceRoot, ['clone', zhOrigin, zhSeed])
  await configureRepo(zhSeed)
  await git(zhSeed, ['checkout', '-b', 'v9.99_content'])
  await writeFile(path.join(zhSeed, 'README.md'), '# zh\n', 'utf8')
  await git(zhSeed, ['add', 'README.md'])
  await git(zhSeed, ['commit', '-m', 'init zh'])
  await git(zhSeed, ['push', '-u', 'origin', 'v9.99_content'])
  await setBareHead(zhOrigin, 'refs/heads/v9.99_content')

  const sourceSeed = path.join(workspaceRoot, 'source-seed')
  await git(workspaceRoot, ['clone', sourceOrigin, sourceSeed])
  await configureRepo(sourceSeed)
  await git(sourceSeed, ['checkout', '-b', 'v9.99'])
  await writeFile(
    path.join(sourceSeed, 'package.json'),
    JSON.stringify(
      {
        name: 'fork-docs',
        private: true,
        scripts: {
          build: 'node build.mjs',
        },
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(
    path.join(sourceSeed, 'build.mjs'),
    [
      "import { existsSync } from 'node:fs'",
      "import { execSync } from 'node:child_process'",
      "const sha = execSync('git -C translations/docs-zh rev-parse HEAD').toString().trim()",
      "console.log(`submodule=${sha}`)",
      "if (existsSync('build.fail')) {",
      "  console.error('build fail marker')",
      '  process.exit(1)',
      '}',
      "console.log('build ok')",
      '',
    ].join('\n'),
    'utf8',
  )
  await git(sourceSeed, ['-c', 'protocol.file.allow=always', 'submodule', 'add', zhOrigin, 'translations/docs-zh'])
  await git(sourceSeed, ['add', 'package.json', 'build.mjs', '.gitmodules', 'translations/docs-zh'])
  await git(sourceSeed, ['commit', '-m', 'init source'])
  await git(sourceSeed, ['push', '-u', 'origin', 'v9.99'])
  await setBareHead(sourceOrigin, 'refs/heads/v9.99')

  await git(workspaceRoot, ['clone', '--bare', sourceOrigin, forkOrigin])
  await setBareHead(forkOrigin, 'refs/heads/v9.99')

  const zhRepo = path.join(reposRoot, 'v9.99_zh')
  const forkRepo = path.join(reposRoot, 'fork-v9.99')
  const zhRemoteWorker = path.join(workspaceRoot, 'zh-remote-worker')
  const sourceWorker = path.join(workspaceRoot, 'source-worker')

  await git(reposRoot, ['clone', zhOrigin, zhRepo])
  await configureRepo(zhRepo)
  await git(zhRepo, ['checkout', 'v9.99_content'])

  await git(reposRoot, ['clone', forkOrigin, forkRepo])
  await configureRepo(forkRepo)
  await git(forkRepo, ['config', 'protocol.file.allow', 'always'])
  await git(forkRepo, ['checkout', 'v9.99'])
  await git(forkRepo, ['remote', 'add', 'source', sourceOrigin])

  await git(workspaceRoot, ['clone', zhOrigin, zhRemoteWorker])
  await configureRepo(zhRemoteWorker)
  await git(zhRemoteWorker, ['checkout', 'v9.99_content'])

  await git(workspaceRoot, ['clone', sourceOrigin, sourceWorker])
  await configureRepo(sourceWorker)
  await git(sourceWorker, ['checkout', 'v9.99'])

  return {
    workspaceRoot,
    zhRepo,
    forkRepo,
    zhRemoteWorker,
    sourceWorker,
    async cleanup() {
      await rm(workspaceRoot, { recursive: true, force: true })
    },
  }
}

async function validateAdminFlow() {
  const workspace = await createWorkspace()
  try {
    const admin = createPrWorkbenchAdmin({
      workspaceRoot: workspace.workspaceRoot,
      env: {
        ...process.env,
        GIT_ALLOW_PROTOCOL: 'file',
      },
    })

    const versions = await admin.listVersions()
    assert.equal(versions.versions.length, 1)
    assert.equal(versions.versions[0].version, 'v9.99')
    assert.equal(versions.versions[0].forkRepoPath, 'repos/fork-v9.99')

    const initialSession = await admin.getSession('v9.99')
    assert.equal(initialSession.steps.zhSync.status, 'idle')
    assert.equal(initialSession.steps.forkRefresh.status, 'blocked')

    await writeFile(path.join(workspace.zhRepo, 'dirty.txt'), 'dirty\n', 'utf8')
    const dirtySession = await admin.checkZhSync('v9.99')
    assert.equal(dirtySession.session.steps.zhSync.status, 'failed')
    assert.equal(dirtySession.session.steps.zhSync.error?.code, 'zh_dirty')
    await rm(path.join(workspace.zhRepo, 'dirty.txt'), { force: true })

    await writeFile(path.join(workspace.zhRepo, 'ahead.md'), '# ahead\n', 'utf8')
    await git(workspace.zhRepo, ['add', 'ahead.md'])
    await git(workspace.zhRepo, ['commit', '-m', 'ahead'])
    const aheadSession = await admin.checkZhSync('v9.99')
    assert.equal(aheadSession.session.steps.zhSync.status, 'failed')
    assert.equal(aheadSession.session.steps.zhSync.error?.code, 'zh_diverged')
    assert.equal(aheadSession.session.steps.zhSync.result?.aheadCount, 1)
    const pushedSession = await admin.pushZh('v9.99')
    assert.equal(pushedSession.session.steps.zhSync.status, 'passed')
    assert.equal(pushedSession.session.steps.zhSync.result?.aheadCount, 0)
    assert.equal(pushedSession.session.steps.zhSync.result?.behindCount, 0)

    await git(workspace.zhRemoteWorker, ['pull', '--ff-only'])
    await writeFile(path.join(workspace.zhRemoteWorker, 'behind.md'), '# behind\n', 'utf8')
    await git(workspace.zhRemoteWorker, ['add', 'behind.md'])
    await git(workspace.zhRemoteWorker, ['commit', '-m', 'behind'])
    await git(workspace.zhRemoteWorker, ['push', 'origin', 'v9.99_content'])
    const behindSession = await admin.checkZhSync('v9.99')
    assert.equal(behindSession.session.steps.zhSync.status, 'failed')
    assert.equal(behindSession.session.steps.zhSync.result?.behindCount, 1)
    const pulledSession = await admin.pullZh('v9.99')
    assert.equal(pulledSession.session.steps.zhSync.status, 'passed')
    assert.equal(pulledSession.session.steps.zhSync.result?.aheadCount, 0)
    assert.equal(pulledSession.session.steps.zhSync.result?.behindCount, 0)

    await writeFile(path.join(workspace.zhRepo, 'ready.md'), '# ready\n', 'utf8')
    await git(workspace.zhRepo, ['add', 'ready.md'])
    await git(workspace.zhRepo, ['commit', '-m', 'ready sha'])
    await git(workspace.zhRepo, ['push', 'origin', 'v9.99_content'])

    const zhPassed = await admin.checkZhSync('v9.99')
    assert.equal(zhPassed.session.steps.zhSync.status, 'passed')
    const validatedZhSha = zhPassed.session.steps.zhSync.result?.zhHeadSha
    assert.ok(validatedZhSha)

    await writeFile(path.join(workspace.sourceWorker, 'source-update.md'), '# source update\n', 'utf8')
    await git(workspace.sourceWorker, ['add', 'source-update.md'])
    await git(workspace.sourceWorker, ['commit', '-m', 'source update'])
    await git(workspace.sourceWorker, ['push', 'origin', 'v9.99'])

    const forkPassed = await admin.updateFork('v9.99')
    assert.equal(forkPassed.session.steps.forkRefresh.status, 'passed')
    assert.equal(forkPassed.session.steps.forkRefresh.result?.submoduleSha, validatedZhSha)
    const sourceHeadSha = await gitOutput(workspace.sourceWorker, ['rev-parse', 'HEAD'])
    assert.equal(forkPassed.session.steps.forkRefresh.result?.forkHeadSha, sourceHeadSha)

    const forkCommitted = await admin.commitFork('v9.99')
    assert.equal(forkCommitted.session.steps.forkRefresh.status, 'passed')
    assert.notEqual(forkCommitted.session.steps.forkRefresh.result?.forkHeadSha, sourceHeadSha)

    await writeFile(path.join(workspace.forkRepo, 'build.fail'), '1\n', 'utf8')
    const buildFailed = await admin.verifyBuild('v9.99')
    assert.equal(buildFailed.session.steps.buildVerification.status, 'failed')
    assert.equal(buildFailed.session.steps.buildVerification.error?.code, 'build_failed')
    assert.equal(buildFailed.session.ready, false)
    await rm(path.join(workspace.forkRepo, 'build.fail'), { force: true })

    const buildPassed = await admin.verifyBuild('v9.99')
    assert.equal(buildPassed.session.steps.buildVerification.status, 'passed')
    assert.equal(buildPassed.session.steps.buildVerification.result?.exitCode, 0)
    assert.equal(buildPassed.session.ready, true)
    assert.equal(buildPassed.session.readySummary?.submoduleSha, validatedZhSha)

    const pushedFork = await admin.pushFork('v9.99')
    assert.equal(pushedFork.session.steps.buildVerification.status, 'passed')
    const forkRemoteSha = (await gitOutput(workspace.forkRepo, ['ls-remote', 'origin', 'refs/heads/v9.99'])).split(/\s+/)[0]
    assert.equal(forkRemoteSha, pushedFork.session.steps.buildVerification.result?.forkHeadSha)

    await writeFile(path.join(workspace.zhRepo, 'stale.md'), '# stale\n', 'utf8')
    await git(workspace.zhRepo, ['add', 'stale.md'])
    await git(workspace.zhRepo, ['commit', '-m', 'stale'])
    await git(workspace.zhRepo, ['push', 'origin', 'v9.99_content'])

    const staleSession = await admin.getSession('v9.99')
    assert.equal(staleSession.steps.zhSync.status, 'stale')
    assert.equal(staleSession.steps.buildVerification.status, 'stale')
    assert.equal(staleSession.ready, false)
  } finally {
    await workspace.cleanup()
  }
}

await validateAdminFlow()
console.log('validated pr workbench admin contracts')
