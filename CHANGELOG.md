# pi-live-compaction

## 0.1.7

### Patch Changes

- [`2948f15`](https://github.com/victor-software-house/pi-live-compaction/commit/2948f1529fde3ba659a46aa800e9076dce46063b) Thanks [@any-victor](https://github.com/any-victor)! - Render the live compaction stream as a volatile in-memory message so it disappears after Pi's native compaction rebuild without persisting a stream row, and patch the live Pi runtime rather than any package-local Pi copy.

## 0.1.4

### Patch Changes

- Documentation refresh: updated README visuals, OG banner, and repo metadata.

## 0.1.3

### Patch Changes

- README restructured with approved visual diagrams (pipeline, preset routing, continuity sections), OG banner frame tightened and content centered, comparison table moved to collapsible section, inspiration corrected.

## 0.1.2

### Patch Changes

- Use Markdown component for streaming compaction rendering instead of raw Text, add VSH brand mark and gallery image, add README banner with pi.image for pi.dev gallery.

## 0.1.1

### Patch Changes

- [`21f17b9`](https://github.com/victor-software-house/pi-live-compaction/commit/21f17b9d89f5b9854dc0f7e487f1fbcf70da8c8e) Thanks [@any-victor](https://github.com/any-victor)! - Add tsdown build step for proper npm module resolution. Path aliases now resolve at build time via dist/ output instead of relying on jiti to read tsconfig paths.

## 0.1.0

### Initial Release

- Initial release of pi-live-compaction.

  Live streaming compaction extension for Pi with customizable Liquid templates,
  preset-routed summarizer models, file-touched manifest extraction, and a full
  TUI settings panel. Includes chat-flow streaming progress via custom message
  renderer pattern.

## 0.1.5

### Patch Changes

- Fix package metadata: pi.description, expanded keywords, corrected repository URL format.

## 0.1.6

### Patch Changes

- Fix header line counter not updating during live streaming. Store theme ref from renderer, call headerRef.setText() on each throttled update.

## 0.1.6

### Patch Changes

- Fix stale ctx crash when reload or session switch fires mid-compaction. safeUI() wraps ctx.ui calls so streaming completes gracefully.
- Fix header line counter not updating during live streaming.
- Fix live streaming updates using Markdown.setText().
