# Design direction

The agreed direction is restrained Apple/Linear-inspired productivity UI: clear hierarchy, neutral surfaces, compact desktop controls, generous reading space, and one accent for focus and active state. Annotation colors retain their semantic meaning. This is an original InkMark interface, not a reproduction of either product.

## Layout

- Desktop: one toolbar, a 224–280 px document navigator, a flexible review surface, and a 320–360 px annotation inspector. Reading modes belong in the toolbar. Document content is centered with an approximately 72-character measure.
- Mobile: document library, reading screen, and annotation sheet. Primary actions remain reachable with 44 px touch targets. Secondary operations live in explicit menus. Split view remains available when deliberately selected; it is not forced on a narrow viewport.
- The toolbar exposes document navigation, reading mode, annotation inspector, export, and a concise action menu. Import/new belongs with documents. Search and less frequent review/workspace operations remain discoverable in the menu and through existing shortcuts.
- Lists use quiet separators and clear selected/focused states. Avoid nested cards, decorative gradients, glass, excessive badges, and hover-only essential actions.
- Forms keep inputs stable during composition. Errors appear next to the action and retain entered text. Destructive actions name their scope and consequences.

Image review uses direct canvas interaction: empty-space drag creates a region, existing objects select and move, handles resize, and Space/middle mouse temporarily pans. Two fingers pan/pinch without a tool switch. Coordinate fields remain the precise alternative. Selection is cleared consistently when hidden or removed. The browser and native shell share this geometry engine, while native sheets retain their platform form semantics. See [image-review.md](docs/image-review.md) for cancellation, keyboard and persistence contracts.

## Tokens

Use system UI typography for controls, with independent reading-font preferences for the document. Light surfaces: canvas `#ffffff`, chrome `#f7f7f8`, inset `#ededf0`, text `#202124`, secondary `#60636b`, border `#dddfe3`, accent `#0866ce`. Dark surfaces: canvas `#17181a`, chrome `#202124`, inset `#2b2d31`, text `#f2f3f5`, secondary `#acafb8`, border `#373a40`, accent `#71b3ff`.

Use a 4 px spacing grid, 6–8 px control radii, 13–14 px desktop control text, and 16 px mobile form text. Compact desktop controls are at least 28 px tall; touch targets are at least 44 px. Focus is visible independently of hover and selection. Reading themes affect the canvas without turning application chrome into decorative stationery.

## Rendering and ownership

The workspace owns documents, revisions, annotations, trash, persistence, and command validation. Shared presentation models own filtering, selection, grouping, and search navigation. Web and native views render their projections and submit semantic actions. They do not reimplement business rules.

The document surface owns DOM selection/source mapping, Markdown, image geometry, and scrolling. It does not own navigation or form widgets in native builds. Full source and image data stay with the workspace/surface; the native shell receives summaries, not a second durable workspace.

Native editing sessions are registered before focus leaves the canvas. Each session has an identity and a captured document/annotation owner. Submitted values remain in the form until the owner accepts them; stale ownership produces an error, not a write to the newly active document. Close and workspace replacement consult these sessions and the existing save/file-operation guards.

## Evidence and acceptance

The direction incorporates two text-only Gemini 3.8 Flash high critiques; those consultations did not inspect screenshots. Its suggestions to silently save drafts and add replies/apply-suggestion actions were rejected as changes to product semantics.

Validate empty/populated workspaces, light/dark, narrow/wide layouts, source/preview/split selection, image regions, form composition and cancellation, multi-select export/delete, stale async operations, recovery, and reload persistence. Native tests must demonstrate native controls and canvas-only web content rather than testing a hidden full web shell.

References: [Apple toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), [NSH design guides](https://nsh.dev/docs/design-guides/). The pinned NSH source is authoritative when its website differs.

The implementation review also led to direct desktop reading controls, explicit document multi-selection, quieter annotation rows, grouped image actions and shared shortcut/button validation. Claims about missing NSH keymap cleanup, focus behavior and mobile safe areas were not accepted without checking the pinned runtime. Keymap subscriptions are component-scoped, and the mobile embedding hosts already own safe-area insets.
