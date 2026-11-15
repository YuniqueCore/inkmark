# InkMark

InkMark is a local-first review workbench for text, Markdown, and pictures. A reviewer imports or pastes material, selects a passage or image region, records an annotation, and exports review feedback. Documents, annotations, image assets, and the seven-day trash stay in the local workspace. Unsubmitted drafts are not durable backups.

The primary task is reading and annotating. Source, split, and rendered Markdown views must preserve source-based selection and annotation identity. Text passages and image regions share annotation bodies, status, selection, export, and deletion rules; their selectors and rendering remain distinct.

The static website remains a complete offline-capable client with no server requirement. Desktop and mobile use native navigation, toolbars, lists, forms, and dialogs. A canvas-only WebView retains mature Markdown and image-annotation rendering. NSH's native-rendered controls are not all direct wrappers around OS widgets; system menus, text editors, file pickers, and clipboard use platform facilities where available.

Every interface must retain import/export, multi-selection, search and batch annotation, revision comparison, reading preferences, local persistence, workspace backup/restore, and trash recovery. UI simplification must not remove these capabilities or silently discard drafts. No new reply thread or automatic suggestion-application workflow is implied by this redesign.
