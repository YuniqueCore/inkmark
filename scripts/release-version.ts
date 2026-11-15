/** Product version and mobile install counter have independent, explicit semantics. */
import {Octokit} from '@octokit/rest'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {gt, rsort, valid} from 'semver'
import * as v from 'valibot'
import {versionSchema} from './artifacts.ts'

const productSchema = v.strictObject({name: v.string(), id: v.string(), build: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2_100_000_000))})
const packageSchema = v.object({version: versionSchema})
const git = (...args: string[]) => execFileSync('git', args, {encoding: 'utf8'}).trim()

async function main(): Promise<void> {
  if (process.argv[2] === 'check') {
    const versions = git('tag', '--list', 'v*', '--merged', 'HEAD').split('\n').map(tag => tag.slice(1)).filter(value => valid(value) === value && !value.includes('-') && !value.includes('+'))
    const baseline = rsort(versions)[0]
    if (!baseline) throw new Error('A published stable version is required as the native build baseline')
    const previous = v.parse(productSchema, JSON.parse(git('show', `v${baseline}:native/product.json`)))
    const product = v.parse(productSchema, JSON.parse(await readFile('native/product.json', 'utf8')))
    const {version} = v.parse(packageSchema, JSON.parse(await readFile('package.json', 'utf8')))
    if (version !== baseline && !gt(version, baseline)) throw new Error('Product version must not precede the latest stable tag')
    if (product.build < previous.build || version !== baseline && product.build === previous.build) throw new Error('A new product version requires a larger native build number')
    console.log(`Release version ${version}, native build ${product.build}; baseline v${baseline} / ${previous.build}`)
  } else if (process.argv[2] === 'prepare-pr') {
    const {number} = v.parse(v.object({number: v.pipe(v.number(), v.integer(), v.minValue(1))}), JSON.parse(process.env.RELEASE_PR ?? 'null'))
    const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/')
    if (!owner || !repo || !process.env.GH_TOKEN) throw new Error('Release PR preparation requires repository and GitHub token')
    const github = new Octokit({auth: process.env.GH_TOKEN})
    const coordinates = {owner, repo}
    const {data: pr} = await github.pulls.get({...coordinates, pull_number: number})
    if (pr.base.ref !== 'main' || pr.head.repo?.full_name !== pr.base.repo.full_name || pr.user?.login !== 'github-actions[bot]' || !pr.head.ref.startsWith('release-please--')) throw new Error('Expected the repository bot release PR')
    const {data: baseFile} = await github.repos.getContent({...coordinates, path: 'native/product.json', ref: pr.base.sha})
    if (Array.isArray(baseFile) || !('content' in baseFile) || baseFile.encoding !== 'base64') throw new Error('Expected native product baseline')
    const base = v.parse(productSchema, JSON.parse(Buffer.from(baseFile.content, 'base64').toString('utf8')))
    if (base.build === 2_100_000_000) throw new Error('Native install counter exhausted')
    const {data: file} = await github.repos.getContent({...coordinates, path: 'native/product.json', ref: pr.head.sha})
    if (Array.isArray(file) || !('content' in file) || file.encoding !== 'base64') throw new Error('Expected native product metadata')
    const product = v.parse(productSchema, JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')))
    if (product.build !== base.build + 1) {
      await github.repos.createOrUpdateFileContents({...coordinates, path: file.path, branch: pr.head.ref, sha: file.sha,
        message: 'chore: advance native install counter for release',
        content: Buffer.from(JSON.stringify({...product, build: base.build + 1}, null, 2) + '\n').toString('base64')})
    }
    console.log(`Release PR #${number}: native build ${base.build + 1}`)
  } else throw new Error('Expected check or prepare-pr')
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Release operation failed")
  process.exitCode = 1
})
