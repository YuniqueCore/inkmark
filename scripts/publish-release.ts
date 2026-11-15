/** Publish verified delivery artifacts; never build or overwrite release assets. */
import {Octokit} from '@octokit/rest'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {parseArgs} from 'node:util'
import {join} from 'node:path'
import * as v from 'valibot'
import {commitSchema, versionSchema} from './artifacts.ts'
import {collectReleaseAssets, planReleaseAssets} from './release-assets.ts'

async function main(): Promise<void> {
  const {values} = parseArgs({options: {
    run: {type: 'string'}, tag: {type: 'string'}, source: {type: 'string'},
    artifacts: {type: 'string', default: '.local-build/release-inputs'}, publish: {type: 'boolean', default: false},
  }})
  if (!values.run || !/^[1-9]\d*$/.test(values.run) || !values.tag?.startsWith('v')) throw new Error('Required: --run <delivery run ID> --tag v<version> [--publish]')
  const version = v.parse(versionSchema, values.tag.slice(1))
  if (version.includes('-') || version.includes('+')) throw new Error('This workflow publishes stable product versions only')
  const repository = process.env.GITHUB_REPOSITORY ?? execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {encoding: 'utf8'}).trim()
  const [owner, repo] = repository.split('/')
  if (!owner || !repo || repository.split('/').length !== 2) throw new Error('Invalid GitHub repository')
  const auth = process.env.GH_TOKEN ?? execFileSync('gh', ['auth', 'token'], {encoding: 'utf8'}).trim()
  const github = new Octokit({auth, request: {timeout: 300_000}})
  const coordinates = {owner, repo}
  const runId = Number(values.run)
  const {data: run} = await github.actions.getWorkflowRun({...coordinates, run_id: runId})
  const {data: workflow} = await github.actions.getWorkflow({...coordinates, workflow_id: 'deploy.yml'})
  if (run.workflow_id !== workflow.id || run.head_branch !== 'main' || !['push', 'workflow_dispatch'].includes(run.event)
      || run.repository.full_name.toLowerCase() !== repository.toLowerCase() || run.head_repository?.full_name.toLowerCase() !== repository.toLowerCase()) {
    throw new Error('Only trusted main delivery runs can publish a release')
  }
  const commit = v.parse(commitSchema, run.head_sha)
  if (values.source && values.source !== commit) throw new Error('Release output and delivery source differ')
  const comparison = await github.repos.compareCommitsWithBasehead({...coordinates, basehead: `${commit}...main`})
  if (comparison.data.merge_base_commit.sha !== commit) throw new Error('Delivery source is not on main history')
  const jobs = await github.paginate(github.actions.listJobsForWorkflowRun, {...coordinates, run_id: runId, filter: 'latest', per_page: 100})
  for (const name of ['build', 'native / Desktop / macos', 'native / Desktop / linux', 'native / Desktop / windows', 'native / Android / APK, AAB and emulator', 'native / iOS / simulator, unsigned device and tests']) {
    const matching = jobs.filter(job => job.name === name)
    if (matching.length !== 1 || matching[0]!.conclusion !== 'success') throw new Error(`Required delivery producer did not succeed: ${name}`)
  }

  async function sourceJson(path: string): Promise<unknown> {
    const {data} = await github.repos.getContent({...coordinates, path, ref: commit})
    if (Array.isArray(data) || !('content' in data) || data.encoding !== 'base64') throw new Error(`Expected a source JSON file: ${path}`)
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))
  }
  const product = v.parse(v.object({version: versionSchema}), await sourceJson('package.json'))
  const native = v.parse(v.object({build: v.pipe(v.number(), v.integer(), v.minValue(1))}), await sourceJson('native/product.json'))
  const nsh = v.parse(v.object({version: versionSchema, commit: commitSchema}), await sourceJson('native/toolchain.json'))
  if (product.version !== version) throw new Error('Release tag and source package version differ')
  const assets = await collectReleaseAssets(values.artifacts!, join('.local-build', `release-${version}`), {
    version, commit, build: native.build, nsh, run: run.html_url,
  })

  async function tagCommit(): Promise<string | undefined> {
    let object
    try { object = (await github.git.getRef({...coordinates, ref: `tags/${values.tag}`})).data.object }
    catch (error) { if (error instanceof Error && 'status' in error && error.status === 404) return; throw error }
    const visited = new Set<string>()
    while (object.type === 'tag') {
      if (visited.has(object.sha)) throw new Error('Cyclic annotated release tag')
      visited.add(object.sha)
      object = (await github.git.getTag({...coordinates, tag_sha: object.sha})).data.object
    }
    if (object.type !== 'commit') throw new Error('Release tag does not identify a commit')
    return object.sha
  }
  const tagged = await tagCommit()
  if (tagged && tagged !== commit) throw new Error('Existing release tag identifies different source')
  const releases = await github.paginate(github.repos.listReleases, {...coordinates, per_page: 100})
  let release = releases.find(item => item.tag_name === values.tag)
  if (release && release.target_commitish !== commit) throw new Error('Existing release target is not the verified source SHA')
  const marker = '<!-- inkmark-verified-delivery -->'
  const deliveryNotes = `${marker}\n\n## Application downloads\n\nBuilt from ${commit} in [verified delivery](${run.html_url}). Download the archive for your platform below; \`BUILD.json\` records source, NSH and signing status, and \`SHA256SUMS\` covers every application archive and the build index.\n\nmacOS is ad-hoc signed and not notarized; Windows and Linux are unsigned. Android provides a debug-signed APK and unsigned AAB. iOS provides an arm64 simulator app and an unsigned device app requiring your own identity/provisioning profile. These are development distribution packages, not store submissions.\n`
  if (!release) release = (await github.repos.createRelease({...coordinates, tag_name: values.tag!, target_commitish: commit, name: values.tag, draft: true, body: deliveryNotes})).data
  const remoteAssets = () => github.paginate(github.repos.listReleaseAssets, {...coordinates, release_id: release!.id, per_page: 100})
  const plan = planReleaseAssets(assets, await remoteAssets(), release.draft ? 'draft' : 'published')
  for (const assetId of plan.discard) await github.repos.deleteReleaseAsset({...coordinates, asset_id: assetId})
  for (const file of plan.upload) {
    await github.repos.uploadReleaseAsset({...coordinates, release_id: release.id, name: file.name, data: await readFile(file.path) as unknown as string, headers: {'content-type': 'application/octet-stream'}})
    console.log(`Uploaded ${file.name}`)
  }
  const verified = planReleaseAssets(assets, await remoteAssets(), release.draft ? 'draft' : 'published')
  if (verified.upload.length || verified.discard.length) throw new Error('Release attachments are incomplete')
  if (values.publish && release.draft) {
    if (!tagged) {
      try { await github.git.createRef({...coordinates, ref: `refs/tags/${values.tag}`, sha: commit}) }
      catch (error) {
        if (!(error instanceof Error && 'status' in error && error.status === 422 && await tagCommit() === commit)) throw error
      }
    }
    release = (await github.repos.updateRelease({...coordinates, release_id: release.id, draft: false,
      body: release.body?.includes(marker) ? release.body : `${release.body ?? ''}\n\n${deliveryNotes}`})).data
  }
  if (!release.draft && await tagCommit() !== commit) throw new Error('Published tag does not match verified delivery')
  console.log(JSON.stringify({url: release.html_url, draft: release.draft, source: commit, version, assets: assets.length, checksums: 'verified'}))
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Release operation failed")
  process.exitCode = 1
})
