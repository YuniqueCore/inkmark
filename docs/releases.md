# Application releases

InkMark has one product version in `package.json`. The static website and five native platforms share it. `native/product.json` owns the independent integer install counter used by Android and Apple hosts; the private Rust binding crate has its own internal crate version.

## Normal release

Use Conventional Commits: `fix:` proposes a patch and `feat:` proposes a minor version. After a push to `main` passes the shared build and all five native jobs, [delivery](../.github/workflows/deploy.yml) runs the pinned [Google release-please v5 action](https://github.com/googleapis/release-please-action/tree/45996ed1f6d02564a971a2fa1b5860e934307cf7). It maintains one Release PR with the product version, changelog and manifest. The next step sets the PR's native install counter to its base plus one; repeated preparation does not increment it again. Version checks reject a new product version without a larger install counter.

Review and merge that PR. Its main delivery builds the exact release commit, runs browser/native tests, creates a draft, attaches the verified application files and only then publishes it. No tag-event workflow is needed: publication stays in the same verified delivery, so `GITHUB_TOKEN` suffices. PR creation and publication permissions belong only to the final release job; ordinary build jobs remain read-only.

GitHub can require approval for CI started by bot-created PRs. Approve that run or dispatch the existing delivery workflow on the Release PR branch to validate it before merging; do not add a personal token merely to bypass this behavior. See [GitHub's current token trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

## Download contract

Each Release provides eight application files plus `BUILD.json` and `SHA256SUMS`:

| Platform | Files | Distribution status |
| --- | --- | --- |
| macOS arm64 | `.zip` | Ad-hoc signed; not notarized |
| Linux x64 | `.tar.gz` | Unsigned; includes AppArmor installation guidance |
| Windows x64 | Portable `.zip`, `-setup.exe` | Unsigned |
| Android | `-debug.apk`, `-unsigned.aab` | APK uses the debug key; AAB requires release signing |
| iOS arm64 | `-simulator.zip`, `-unsigned.zip` | Simulator app and unsigned device app; device installation requires an Apple identity/profile |

These are development distribution packages, not App Store/Play Store submissions. The build index records source SHA, native install counter, NSH version/commit, delivery run and each platform's signing status. `SHA256SUMS` covers all eight application files and the build index. GitHub's own source archives are separate automatic attachments.

The shared [artifact contract](../scripts/artifacts.ts) defines platform names, expected files, signing labels and metadata. [Collection](../scripts/release-assets.ts) rejects missing installers, unexpected files, symlinks, dirty/mixed commits, wrong versions/toolchains, invalid checksum indexes and changed bytes. [Publication](../scripts/publish-release.ts) additionally requires the trusted main delivery workflow, six successful producer jobs and an actual tag resolving to the same commit. It reads version metadata from that commit, never the publisher checkout.

## Resume or publish a verified delivery

The [manual release workflow](../.github/workflows/release.yml) reuses the same publisher and existing build artifacts. It does not rebuild the application. Supply the exact main delivery run and matching version tag:

```sh
# Prepare or resume a draft; inspect its attachments before publishing.
gh workflow run release.yml --ref main -f tag=v0.13.1 -f run_id=43711256642 -f publish=false
# Publish only after the same verification succeeds.
gh workflow run release.yml --ref main -f tag=v0.13.1 -f run_id=43711256642 -f publish=true
```

Correct existing assets are skipped after digest comparison. Different bytes, unexpected names or a tag pointing elsewhere stop publication; the workflow never uses `--clobber`. A failed GitHub upload can leave an empty `starter` asset. Only an expected-name, zero-byte, digest-less placeholder in this verified draft may be deleted and retried; uploaded or published assets are never replaced. This follows [GitHub's asset upload contract](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset).

The initial native release is v0.13.1 at `8a1727c8a1746a6ba911a32582da1acfe21b53a2`, delivery `43711256642`. Its verified tag establishes the native install-counter baseline before this automation is enabled; older web-only tags do not define native build numbers. The manifest and bootstrap SHA record that baseline without introducing an old-schema compatibility path.
