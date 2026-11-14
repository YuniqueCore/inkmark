# Shared workspace, native capabilities

InkMark keeps one document model, one DOM workspace and one IndexedDB persistence implementation. The static website remains a Vite output: it needs neither a server nor NSH/Wasm. Native applications embed that same offline document in an NSH WebView. NSH is pinned to **0.5.1**, including archive checksums in `native/toolchain.json`; updating the manifest is an explicit dependency change.

## Boundaries

```text
ReviewDocument + Selector + Annotation       src/core (unchanged domain)
                 |
DOM workspace + IndexedDB CAS                src/ui + src/main.ts
                 |
Typed file / clipboard / link protocol       src/platform
                 |
NSH Workspace(document, files)               native/shared
        /                         \
Desktop Rust bindings             Mobile host.call bindings
system dialogs / atomic files     Android Activity / iOS ViewController
```

`Workspace` composes a document artifact (`html`, stable `baseUrl`) with `FileBindings`. It does not own reviews, duplicate storage or reinterpret annotations. Text and image review continue to share export, selection, filtering and trash behavior. Rust, Java and Swift implement only operations that require their operating system. There is no plugin registry, provider selector or second database.

The web chooses ordinary file inputs, downloads and the browser clipboard at build time. Native builds use a strict, bounded request/response protocol. No filesystem path or executable JavaScript can be requested through that protocol. Desktop folder imports return relative display paths and do not follow directory symlinks. Mobile document providers and share sheets remain user-mediated.

Native transfers are limited to **32 MiB in aggregate and 100 files** per selection. Hosts check metadata and enforce the bound again while reading; they never return a partially read selection. Image domain limits remain 12 MiB / 32 million pixels. NSH's default picker eagerly reads selected files, so these hosts use bounded operating-system adapters instead. JSON/base64 is deliberately bounded rather than treated as a streaming transport. Larger browser backups remain supported by the web implementation; oversized native backups fail visibly and retain the workspace.

Desktop export reports `saved` only after an atomic file replacement succeeds. Android reports `shared` after handing a granted content URI to the chooser, not after a recipient saves it. iOS waits for the share completion/cancellation callback. `downloaded` means the browser initiated a download. Cancellation produces no success message. Mobile export files stay in an app-owned cache for at most 24 hours before the next export cleans them; the cache has a 512 MiB quota. iOS cancels remove their temporary file immediately. Uninstalling the app removes its local workspace; Android cloud/device backup is disabled.

## Platform artifacts

| Platform | CI artifact | Requirements / distribution state |
| --- | --- | --- |
| Web | GitHub Pages static site | Current browser; no native runtime |
| macOS | Apple Silicon `.app` in ZIP | macOS 14+; ad-hoc signed, not notarized |
| Linux | x86_64 `.tar.gz` | GTK 4.14+ and WebKitGTK 6; Ubuntu needs the included application-specific AppArmor profile |
| Windows | x86_64 ZIP, installer when Inno Setup is available | Windows WebView2 Runtime; unsigned |
| Android | debug-signed APK and unsigned release AAB | API 26+; release AAB needs the owner's signing key |
| iOS | arm64 simulator ZIP and unsigned device ZIP | iOS 16.4+; device installation requires Apple signing/provisioning |

The upstream iOS embedding SDK supplies arm64 device and simulator slices. Intel iOS simulators are not supported by this SDK. Mobile builds use the official embedding SDK, not NSH's generic package shell, because file picking and sharing belong to InkMark's host. CI artifacts include `BUILD.json` and `SHA256SUMS`; signing certificates and private keys are never uploaded. These are test/distribution candidates, not App Store or Play Store submissions.

The Linux archive includes [installation instructions and an AppArmor profile](../native/linux/README.md) for `/opt/InkMark/InkMark`. CI loads the same policy for its exact NSH development-host path. This permits WebKit's sandbox namespaces without disabling the system-wide AppArmor restriction or WebKit's sandbox.

## Persistence and lifecycle

The production document origin is `https://inkmark.localhost/`; do not change it casually because WebView storage is origin-scoped. On macOS the installed application bundle identifier additionally isolates its WebKit profile from the NSH development host. IndexedDB remains authoritative; localStorage only stores existing reading preferences/recovery metadata. There is no automatic sync between the website and an installed application: use workspace export/import.

Explicit desktop close waits for file operations and committed IndexedDB state, and refuses unsubmitted editor, selection, image, annotation and search-composer drafts. Each close attempt has its own ID. Cancelling a timed-out attempt invalidates its response and its input-lock ownership; an old save cannot close a newer editing session. System termination, force quit, crashes and mobile process eviction cannot be vetoed. Background flush is best effort, and unsubmitted drafts are not durable. Exported backups also exclude unsubmitted drafts.

The native HTML has a hash-based script CSP and embedded fonts/icons/styles. Raw Markdown HTML remains escaped; remote images require the existing explicit user action and HTTPS on native. External http/https/mailto links go to the system; document fragment links stay in the WebView. Android does not request broad filesystem, camera or photo-library permission. Clipboard image import uses granted content URIs on Android and the NSH clipboard on Apple/desktop platforms.

Mobile hosts own safe-area and keyboard insets. DOM floating editors and search panels use the visible viewport, preserve focused composer nodes and scroll their actions into view. Source/preview text selection and image coordinates stay in the shared UI.

## Build and test

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

On Linux run the native journey under `xvfb-run -a dbus-run-session --` when no display is available so portal services inherit the display. Android additionally needs JDK 17, platform `android-37.0` and build-tools `37.0.0`:

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
- The NSH journey runs the production DOM in a real platform WebView with deterministic file/clipboard bindings. It tests bridge integration, not an OS file-picker click. Its script exists only in the generated test artifact. Its separate `inkmark-tests.localhost` origin is reset before bootstrap because NSH's fresh test data directory does not isolate every engine's WebView store.
- Android instrumentation runs the installed host, imports a real clipboard image URI, validates and annotates its region, opens the real system share sheet, checks the exported ZIP bytes and recreates the Activity to check persistence. Separate adapter checks read granted content URIs and reject oversized selections.
- iOS unit tests exercise coordinated filesystem reads and bounded export/import. XCUITest creates Markdown and terminates/relaunches the app to check its WebView persistence. Packaging also checks the actual app for its compiled NSH bundle, manifests and asset catalog; an executable without its workspace resources is not a valid artifact.

Build success alone is not device execution evidence. CI reports are bound to their source commit. OS selection handles, third-party cloud-file providers, IME composition, recipient-specific share completion, accessibility readers and release signing still need device acceptance on the owner's intended devices. Tests do not pretend injected DOM selection is a physical long press. Xcode emits its generic AppIntents metadata warning for this application, which declares no App Intents, and NSH's prebuilt iOS SDK references unavailable upstream Rust object paths during dSYM generation. Android Gradle Plugin 9.5.1 uses a Gradle API deprecated by Gradle 9.9.1. These upstream toolchain diagnostics are not hidden with application-wide warning suppression.

## Research and decisions

Syzygy's `docs/new/nsh-desktop-evaluation-2026-11-07.md`, ADR 0021 (shared workspace, independent window state) and ADR 0063 (editor save/draft recovery) informed the boundary review. Those documents describe research and experiments; they are not evidence that Syzygy already ships this cross-platform implementation. InkMark adopts the shared-domain/host-boundary principle without copying Syzygy's plugin or multi-window infrastructure.

Upstream sources: [NSH 0.5.1](https://github.com/longbridge/nsh/releases/tag/v0.5.1), [packaging](https://nsh.dev/docs/packaging/), [native testing](https://nsh.dev/docs/testing-and-trace/), [Android embedding](https://nsh.dev/docs/android/#embedding-in-an-android-app), [iOS embedding](https://nsh.dev/docs/ios/#embedding-in-an-ios-app), [Apple document coordination](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/DocumentPickerProgrammingGuide/AccessingDocuments/AccessingDocuments.html), [WKWebView data stores](https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/websitedatastore).
