# Shared workspace, native capabilities

InkMark keeps one document model, one workspace command owner and one IndexedDB persistence implementation. The static website remains a Vite output: it needs neither a server nor NSH/Wasm. Native applications render navigation, toolbars, lists, forms and dialogs with NSH. Only the text/Markdown/image canvas stays in a sealed offline WebView. NSH is pinned to **0.5.1**, including archive checksums in `native/toolchain.json`; updating the manifest is an explicit dependency change.

## Boundaries

```text
ReviewDocument + Selector + Annotation          src/core
                    |
Workspace commands + IndexedDB CAS             src/workbench
       /                              \
BrowserShell + DOM controls       NativeShell + typed projections
src/ui                            src/platform/native
       \                              |
        Shared document canvas     NSH native controls / interaction sessions
        Markdown / images          native/shared/ui
                    |
Typed file / clipboard / link capabilities      src/platform
       /                              \
Desktop Rust bindings             Mobile host.call bindings
system dialogs / atomic files     Android Activity / iOS ViewController
```

`Workspace` composes a canvas artifact (`html`, stable `baseUrl`) with `FileBindings`. It does not own reviews, duplicate storage or reinterpret annotations. Text and image review continue to share export, selection, filtering and trash behavior. Rust, Java and Swift implement only operations that require their operating system. There is no plugin registry, provider selector or second database.

The web chooses ordinary file inputs, downloads and the browser clipboard at build time. Native builds use a strict, bounded request/response protocol. No filesystem path or executable JavaScript can be requested through that protocol. Desktop folder imports return relative display paths and do not follow directory symlinks. Mobile document providers and share sheets remain user-mediated.

Review filenames share one portable naming rule across web downloads, native saves and ZIP entries: preserve the format/date/extension and collision suffix within 255 UTF-8 bytes, using `sanitize-filename` and `truncate-utf8-bytes`. Truncation never changes a document's stored name or merges archive entries. Windows bitmap-only clipboard data (CF_DIB) is normalized to PNG at the browser input boundary using `image-size` metadata checks and the WebView's decoder/Canvas. Input bytes and dimensions are checked before conversion; the resulting PNG must also fit the image budget. PNG/JPEG/WebP clipboard bytes remain unchanged, and ordinary file import retains its existing format contract.

Native transfers are limited to **32 MiB in aggregate and 100 files** per selection. Hosts check metadata and enforce the bound again while reading; they never return a partially read selection. Image domain limits remain 12 MiB / 32 million pixels. NSH's default picker eagerly reads selected files, so these hosts use bounded operating-system adapters instead. JSON/base64 is deliberately bounded rather than treated as a streaming transport. Larger browser backups remain supported by the web implementation; oversized native backups fail visibly and retain the workspace.

Desktop export reports `saved` only after an atomic file replacement succeeds. Android reports `shared` after handing a granted content URI to the chooser, not after a recipient saves it. iOS waits for the share completion/cancellation callback. `downloaded` means the browser initiated a download. Cancellation produces no success message. Mobile export files stay in an app-owned cache for at most 24 hours before the next export cleans them; the cache has a 512 MiB quota. iOS cancels remove their temporary file immediately. Uninstalling the app removes its local workspace; Android cloud/device backup is disabled.

## Presentation protocol and ownership

`BrowserShell` and `NativeShell` implement one presentation boundary. Shared models own review grouping/filtering/selection, document navigation, search navigation, selection drafts and trash scope. Neither view stores another workspace. Native projections contain summaries and current interaction values; original image bytes remain in IndexedDB and the canvas.

Native commands carry a page session and monotonically increasing request ID. The host retires old page sessions; the workspace rejects replayed requests and stale interaction owners. Cancel/close commands carry no editable fields so invalid intermediate input can always be dismissed. Field values are bounded to 8,388,608 UTF-16 code units; complete JSON messages are bounded to 32 Mi code units. Interaction validation and aggregate-size checks precede registration or updates, preserving the previous draft when rejected. Documents, reviews and trash render 100-row pages; bulk actions retain the entire filtered scope. Export previews are explicitly shortened without truncating the saved artifact.

Native IME composition and unacknowledged commands block explicit desktop close. Open text, annotation and search forms also block close, including empty forms whose first input may not yet have reached the canvas. New text-selection dismissal retains its owned draft; explicit cancel discards it. Other changed native editing forms ask before dismissing; Escape/Android back use the native Sheet cancellation event. Modal image coordinates have one local input owner and do not accept stale projection echoes. No implicit autosave converts drafts into annotations.

This replaces the old full-web-shell native path and removes the radial reading settings widget, duplicated header actions and edge collapse controls. The native build has its own canvas entry and cannot accidentally mount the browser navigation. The static Web build still provides every capability independently of NSH. Adding another document selector should compose the existing annotation/list/export/storage rules rather than add a second workspace or persistence layer.

## Platform artifacts

| Platform | CI artifact | Requirements / distribution state |
| --- | --- | --- |
| Web | GitHub Pages static site | Current browser; no native runtime |
| macOS | Apple Silicon `.app` in ZIP | macOS 14+; ad-hoc signed, not notarized |
| Linux | x86_64 `.tar.gz` | GTK 4.14+, WebKitGTK 6 and CJK fonts; Ubuntu needs the included application-specific AppArmor profile |
| Windows | x86_64 ZIP, installer when Inno Setup is available | Windows WebView2 Runtime; unsigned |
| Android | debug-signed APK and unsigned release AAB | API 26+; release AAB needs the owner's signing key |
| iOS | arm64 simulator ZIP and unsigned device ZIP | iOS 16.4+; device installation requires Apple signing/provisioning |

The upstream iOS embedding SDK supplies arm64 device and simulator slices. Intel iOS simulators are not supported by this SDK. Mobile builds use the official embedding SDK, not NSH's generic package shell, because file picking and sharing belong to InkMark's host. CI artifacts include `BUILD.json` and `SHA256SUMS`; signing certificates and private keys are never uploaded. These are test/distribution candidates, not App Store or Play Store submissions.

The Linux archive includes [installation instructions and an AppArmor profile](../native/linux/README.md) for `/opt/InkMark/InkMark`. CI loads the same policy for its exact NSH development-host path. This permits WebKit's sandbox namespaces without disabling the system-wide AppArmor restriction or WebKit's sandbox.

## Persistence and lifecycle

The production document origin is `https://inkmark.localhost/`; do not change it casually because WebView storage is origin-scoped. On macOS the installed application bundle identifier additionally isolates its WebKit profile from the NSH development host. IndexedDB remains authoritative; localStorage only stores existing reading preferences/recovery metadata. There is no automatic sync between the website and an installed application: use workspace export/import.

Explicit desktop close waits for file operations and committed IndexedDB state, and refuses unsubmitted editor, selection, image, annotation and search-composer drafts. Each close attempt has its own ID. Cancelling a timed-out attempt invalidates its response and its input-lock ownership; an old save cannot close a newer editing session. System termination, force quit, crashes and mobile process eviction cannot be vetoed. Background flush is best effort, and unsubmitted drafts are not durable. Exported backups also exclude unsubmitted drafts.

Restoration and close attempts acquire independent input locks and release only their own ownership. A rejected close cannot unlock a pending workspace replacement. Text-input dialogs validate their document owner and commit synchronously in the same event turn; late imports cannot switch that owner behind an open dialog. If Android delivers a file-picker result after its original Activity/WebView was destroyed, the current Activity reports that the selection was interrupted and asks the user to select again. It never replays an old JavaScript request into the new session.

The native HTML has a hash-based script CSP and embedded fonts/icons/styles. Raw Markdown HTML remains escaped; remote images require the existing explicit user action and HTTPS on native. External http/https/mailto links go to the system; document fragment links stay in the WebView. Android does not request broad filesystem, camera or photo-library permission. Clipboard image import uses granted content URIs on Android and the NSH clipboard on Apple/desktop platforms.

Mobile hosts own safe-area and keyboard insets. Native forms use native text editors and keyboard-aware sheets with submission controls outside the scrollable content; browser forms use the visible viewport. Source/preview selection mapping and image geometry stay in the shared canvas. Window width controls pane layout independently of the platform control size.

Wide-layout reading modes and manual annotation types use NSH's `Tabs`/`Tab` primitives, including selected semantics; compact reading modes use a checked native menu. macOS and Linux support roving keyboard focus; NSH 0.5.1 on Windows currently traverses text inputs only, so non-input control keyboard navigation remains an upstream limitation. Native form scroll views use `keyboardShouldPersistTaps="handled"` so the first tap on a control performs its action with the keyboard open. Document selection mode survives sidebar/sheet remounts, while selected document IDs remain owned by the shared workbench. Exiting selection clears them explicitly. Counts describe the complete selection, including other pages; a filtered empty review list provides a direct reset.

## Build and test

The parent [delivery workflow](../.github/workflows/deploy.yml) builds one offline document and passes it to every native job in the same run. Pushes to `main` also deploy static Pages; manual runs validate all five native platforms without deploying by default:

```sh
gh workflow run deploy.yml --ref main -f deploy_pages=false
# Targeted verification still builds and validates the shared offline document first.
gh workflow run deploy.yml --ref main -f native_target=linux -f deploy_pages=false
```

`native_target` defaults to `all`; it can select macos, linux, windows, android or ios for a focused run. Set `deploy_pages=true` only when deliberately deploying `main`. Pull requests cannot deploy. Manual verification and push delivery have separate concurrency groups, including the requested target; actual Pages deployments are serialized. Only the deploy job receives Pages write and OIDC permissions. The native workflow stays reusable rather than exposing a second manual entry that would lack its required input artifact.

CI caches mechanisms, not delivery outputs:

- The shared JavaScript action caches Bun's package store by OS, architecture, Bun version and lockfile. Every runner still performs a frozen install; `node_modules` is never shared.
- NSH caches immutable release archives by platform, embedding SDK and toolchain manifest. Setup verifies SHA-256 on every run and extracts fresh SDK directories.
- Desktop Rust uses the pinned official `mr-boxington-action` in isolated `objects` mode. Its job export includes all mbx calls, including NSH-generated crates with their own target directories. Compiler identity, platform and manifest/lock hashes scope the cache; pull requests restore without saving, and trusted manual runs on `main` can save.
- Gradle retains its existing official action cache. Generated documents, packages, WebView profiles, test evidence and Xcode DerivedData are not dependency caches.

Compare consecutive runs' restore/save logs, Rust object reuse and package timings before reporting a speed improvement. A cold run or an action-level cache hit alone is not performance evidence. Cache semantics follow [GitHub's reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) and [mbx's object-cache contract](https://github.com/jdx/mr-boxington/blob/v1.30.0/docs/github-action.md).

Desktop packaging enables NSH's official verbose output so successful Cargo builds retain their mbx hit/miss diagnostics. Failed browser journeys upload screenshots, comparison images and Playwright traces as `web-tests`; a failed shared build prevents dependent native packaging and Pages deployment.

Use Bun 1.3.14+, Node 24, mise 2026.8.16+ and the checked-in lockfile. Desktop Rust is pinned to 1.100.0; `mise.toml` installs `mr-boxington` 1.30.0 (`mbx`) and its official Cargo wrapper so Cargo builds use the repository's build-cache workflow. Version 1.30.0 includes the [upstream Windows build-script trampoline fix](https://github.com/jdx/mr-boxington/pull/787). The NSH launcher uses `mise exec`; do not set `CARGO=mbx`, which makes Cargo metadata calls recurse.

```sh
mise install
bun install --frozen-lockfile
bun run check
bun run build:pages
bun run native:setup
bun run build:native-web
bun run nsh check native/desktop
bun run nsh package native/desktop --target macos --out .local-build/packages/desktop
node scripts/native-artifact.mjs macos

# Actual NSH WebView business journey; use windows or linux on those operating systems.
node scripts/native-test-prepare.mjs
bun run nsh test native/tests --target macos

cd native/desktop
mbx fmt --all --check
mbx test --workspace --all-features
mbx clippy --workspace --all-targets --all-features -- -D warnings
```

Linux CI uses Xvfb, a D-Bus session, the X11 GTK backend and an XTEST preflight. NSH's reduced key-event fallback cannot validate Tab traversal. Native keyboard tests verify cursor edits as well as leaving embedded content and entering the tab list. On a real Linux desktop, run the native journey directly in its existing display session. Android additionally needs JDK 17, platform `android-37.0` and build-tools `37.0.0`:

```sh
node scripts/native-setup.mjs android
bun run nsh build native/mobile --release --out native/generated/mobile-assets/nsh
native/android/gradlew -p native/android assembleDebug bundleRelease lint
native/android/gradlew -p native/android connectedDebugAndroidTest
```

For iOS, install Xcode and XcodeGen, then:

```sh
node scripts/native-setup.mjs ios
bun run nsh build native/mobile --release --out native/generated/mobile-assets/nsh
export INKMARK_VERSION=$(node -p 'require("./package.json").version')
export INKMARK_BUILD=$(node -p 'require("./native/product.json").build')
xcodegen generate --spec native/ios/project.yml
xcodebuild -project native/ios/InkMark.xcodeproj -scheme InkMark \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO test
```

Use an available simulator name from `xcrun simctl list devices available`. XCTest targets require iOS 17+ because current Xcode's XCTest libraries do; the application retains its 16.4 deployment target.

## Evidence and test scope

- Existing browser BDD journeys cover text and image annotations, source/preview anchors, import conflicts, W3C idempotency, backups, bulk export/delete/recovery, storage conflicts and security boundaries. Reviewed snapshots cover desktop/mobile layouts; the touch journey adds selectionchange-only input, stable focus/drafts and a keyboard-sized search panel.
- Native protocol tests exercise a real 32 MiB payload in both the browser and NSH QuickJS (including forwarding without exceeding its 256 MiB heap), malformed envelopes, traversal, pending-request cleanup, external versus fragment links, and late close attempts.
- Rust tests use actual temporary files for atomic overwrite/failure, bounded folder imports, relative paths and symlink exclusion.
- The NSH journey operates native navigation, reading controls, source/annotation/search forms and export actions around the real canvas-only WebView. It covers CRLF edits, selection-to-native-focus handoff, close protection, malformed coordinates and export cancellation/failure/retry with deterministic file bindings. It does not simulate an OS file-picker click. Its script exists only in the generated test artifact. Its separate `inkmark-tests.localhost` origin is reset before bootstrap because NSH's fresh test data directory does not isolate every engine's WebView store.
- Desktop close-refusal checks use the real NSH window close button and application-menu shortcut. All desktop journeys inject BMP bytes at the file boundary: `nsh test` replaces the system clipboard with its own text-only backend. A separate Windows probe seeds a bitmap-only system clipboard and uses `nsh run` to check NSH's actual CF_DIB acquisition. Run it with `powershell.exe -NoProfile -STA -File native/tests/clipboard.ps1`; this intentionally replaces the test machine's clipboard. The ordinary business journey leaves that clipboard untouched.
- `bun run check` builds the offline HTML before browser BDD and CI passes that same artifact to every native build. Browser tests exercise restoration concurrent with a close request, retained modal input during delayed imports, malformed/oversized BMP rejection, exact PNG preservation and operation cleanup after failure.
- Android instrumentation runs the installed host, imports a real clipboard image URI, validates and annotates its region, opens the real system share sheet, checks the exported ZIP bytes and recreates the Activity to check persistence. On API 29+ the same journey opens the real system file picker, recreates the background Activity while the picker remains open, observes the interruption notice and retries selection to import successfully without losing existing reviews. Separate adapter checks read granted content URIs and reject oversized selections.
- iOS unit tests exercise coordinated filesystem reads and bounded export/import. XCUITest creates Markdown through a native text editor, selects rendered preview through native navigation, verifies the WebView has no editing forms, and terminates/relaunches the app to check IndexedDB persistence. Packaging also checks the actual app for its compiled NSH bundle, manifests and asset catalog; an executable without its workspace resources is not a valid artifact.

Build success alone is not device execution evidence. CI reports are bound to their source commit. OS selection handles, third-party cloud-file providers, IME composition, recipient-specific share completion, accessibility readers and release signing still need device acceptance on the owner's intended devices. Tests do not pretend injected DOM selection is a physical long press. Xcode emits its generic AppIntents metadata warning for this application, which declares no App Intents, and NSH's prebuilt iOS SDK references unavailable upstream Rust object paths during dSYM generation. Android Gradle Plugin 9.5.1 uses a Gradle API deprecated by Gradle 9.9.1. These upstream toolchain diagnostics are not hidden with application-wide warning suppression.

## Research and decisions

Syzygy's `docs/new/nsh-desktop-evaluation-2026-11-07.md`, ADR 0021 (shared workspace, independent window state) and ADR 0063 (editor save/draft recovery) informed the boundary review. Those documents describe research and experiments; they are not evidence that Syzygy already ships this cross-platform implementation. InkMark adopts the shared-domain/host-boundary principle without copying Syzygy's plugin or multi-window infrastructure.

Upstream sources: [NSH 0.5.1](https://github.com/longbridge/nsh/releases/tag/v0.5.1), [packaging](https://nsh.dev/docs/packaging/), [native testing](https://nsh.dev/docs/testing-and-trace/), [Android embedding](https://nsh.dev/docs/android/#embedding-in-an-android-app), [iOS embedding](https://nsh.dev/docs/ios/#embedding-in-an-ios-app), [Apple document coordination](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/DocumentPickerProgrammingGuide/AccessingDocuments/AccessingDocuments.html), [WKWebView data stores](https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/websitedatastore).
