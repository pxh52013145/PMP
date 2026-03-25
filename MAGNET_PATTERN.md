# Magnet Pattern Guide

This document defines the active magnet layout model in Pixel Matrix Player.

It complements:

- `docs/architecture/magnet-generation-spec.md` for registration and generation flow
- `docs/architecture/magnet-style-guidelines.md` for host DOM and surface styling rules

## 1. Core split

Every magnet is authored across three separate layers:

- `anchors`: matrix occupancy and grid relationship
- `bounds`: real shell geometry
- `chrome` and renderer content: visual frame and inner layout

Do not mix these concerns.

Rules:

- `anchors` answer "which pixels / cells does this magnet belong to?"
- `bounds` answer "where the authored shell starts and ends in screen space"
- `chrome.outset` answers "how far the rendered shell should extend beyond authored bounds"
- `chrome.inset` answers "how far inward should the renderer content be padded?"
- renderer CSS answers "how do children lay out inside the shell?"

There is no longer any auxiliary per-mode bounds field family in runtime authoring. Layout is expressed only through explicit `bounds` references.

## 2. Bounds contract

Runtime layout is driven by one explicit object:

```ts
interface MagnetBoundsReference {
  source: 'slot' | 'span' | 'viewport' | 'magnet'
  edge: 'start' | 'center' | 'end'
  magnetId?: string
  offset?: number
}

interface MagnetBoundsAxis {
  start: MagnetBoundsReference
  end: MagnetBoundsReference
}

interface MagnetBoundsSpec {
  horizontal: MagnetBoundsAxis
  vertical: MagnetBoundsAxis
}
```

Each axis resolves two references:

- `start`
- `end`

The resolved `end` must be greater than `start`, otherwise the bounds are invalid and the magnet will not render.

## 2.1 Reference sources

### `slot`

Resolves against the first anchor cell.

Use it when a single control must seam to the exact slot edge.

Typical use:

- left-docked back button
- top-docked icon aligned to a panel seam

### `span`

Resolves against the full anchor footprint.

Use it for normal centered controls and for panel/bar shells that should match the occupied anchor span.

Typical use:

- default single control
- horizontal bar
- vertical bar
- rectangular panel

### `viewport`

Resolves against the full host viewport.

Use it for overlays or full-screen shells that should not depend on the anchor footprint.

### `magnet`

Resolves against another magnet's computed shell bounds.

Required field:

- `magnetId`

Use it when one shell must align to another shell, instead of approximating the relationship with hardcoded offsets.

Typical use:

- make a panel top edge align to `btn-back`
- make two adjacent shells share an exact outer border

Avoid cyclic references between magnets.

## 2.2 Reference edges

Each source exposes three edges:

- `start`
- `center`
- `end`

Meaning:

- horizontal axis: left / center / right
- vertical axis: top / center / bottom

`offset` is always applied after the edge is resolved.

## 2.3 Direct edge offsets

Bounds tuning is now expressed as explicit per-edge offsets inside references or preset helpers.

When using preset `edgeOffsets`, the sign is direct and literal:

- left/top positive: move inward
- left/top negative: move outward
- right/bottom positive: move outward
- right/bottom negative: move inward

This replaces the old inset/outset split with one simpler rule: each edge can move independently.

## 3. Preset vocabulary

Builtin magnets should still declare explicit layout presets from `apps/desktop/src/modules/magnets/layoutPresets.ts`.

### `createCenteredSingleControlLayoutPreset`

Use for standard free-standing single magnets.

Semantics:

- horizontal bounds center on the anchor span
- vertical bounds center on the anchor span
- width and height come from the preset options

Example:

```ts
const layout = createCenteredSingleControlLayoutPreset({
  width: 36,
  height: 36,
})
```

### `createDockedSingleControlLayoutPreset`

Use for single magnets that must seam to a slot edge.

Semantics:

- explicitly docked axes resolve against `slot`
- omitted dock axes fall back to centered single behavior

Example:

```ts
const layout = createDockedSingleControlLayoutPreset({
  width: 36,
  height: 36,
  dock: { x: 'start' },
})
```

This means:

- left edge is pinned to the slot start
- right edge is `36px` from that left seam
- vertical axis remains centered

### `createPanelLayoutPreset`

Use for rectangular shells that should follow the full anchor span by default.

Default behavior:

- left/right use `span.start` / `span.end`
- top/bottom use `span.start` / `span.end`
- chrome is optional and visual-only

Supports:

- `edgeOffsets`
- `edgeOverrides`
- `chromeInset`
- `chromeOutset`

### `createHorizontalBarLayoutPreset`

Use for one-row shells whose width follows the anchor span, while height is fixed.

Default behavior:

- horizontal axis follows `span`
- vertical axis is centered to a fixed size
- chrome is optional and visual-only

### `createVerticalBarLayoutPreset`

Use for one-column shells whose height follows the anchor span, while width is fixed.

Default behavior:

- vertical axis follows `span`
- horizontal axis is centered to a fixed size
- chrome is optional and visual-only

### `createDefaultBoundsForMagnet`

Use this as the default authoring helper when a magnet is created from generic editor or plugin input.

It derives an initial bounds preset from:

- `anchorType`
- `style.width`
- `style.height`

Important:

- these style sizes are authoring inputs for the preset
- the runtime shell size comes from resolved `bounds`, not directly from DOM style width/height

## 4. Chrome and content

### `chrome.inset`

`chrome.inset` is visual-only and **content-only**.

It changes:

- content box area

It does not change:

- frame paint area
- shell bounds
- collision behavior
- seam alignment
- hit area

Use it when the magnet should look more padded without changing geometry.

### `chrome.outset`

`chrome.outset` is visual-only in the outward direction.

It changes:

- rendered shell size
- visible outer frame reach

It does not change:

- authored `bounds` references
- anchor occupancy
- collision behavior
- hit area in runtime (the shell still receives pointer events)
- referenced shell alignment when another magnet uses `source: 'magnet'` (magnet sources resolve structural bounds)

Use it when a bar or panel should visually bleed past the occupied span without baking that bleed into `bounds`.

### Renderer layout

Renderer styles should solve inner layout only:

- padding
- flex/grid alignment
- typography
- internal gaps

Renderer CSS must not reposition the shell to compensate for layout design.

## 5. Authoring rules

### Rule 1

If the relationship is about matrix occupancy, edit `anchors`.

### Rule 2

If the relationship is about real shell edges, edit `bounds`.

### Rule 3

If the relationship is about content breathing room inward, edit `chrome.inset`.

### Rule 4

If the relationship is about visible shell extension outward, edit `chrome.outset`.

### Rule 5

If one magnet must line up with another magnet, prefer `source: 'magnet'` over ad-hoc CSS transforms.

### Rule 6

Do not add special-case layout code for a specific magnet if the same result can be expressed by `bounds`.

## 6. Common patterns

### Free single control

```ts
const layout = createCenteredSingleControlLayoutPreset({
  width: 36,
  height: 36,
})
```

### Left-seamed back button

```ts
const layout = createDockedSingleControlLayoutPreset({
  width: 36,
  height: 36,
  dock: { x: 'start' },
})
```

### Panel aligned to another magnet's top edge

```ts
const layout = createPanelLayoutPreset({
  edgeOverrides: {
    top: createMagnetEdgeReference('btn-back', 'start'),
  },
})
```

### Panel with a slightly expanded outer shell

```ts
const layout = createPanelLayoutPreset({
  chromeOutset: {
    left: 9,
    right: 9,
  },
})
```

### Full-viewport overlay shell

```ts
const bounds = {
  horizontal: {
    start: { source: 'viewport', edge: 'start' },
    end: { source: 'viewport', edge: 'end' },
  },
  vertical: {
    start: { source: 'viewport', edge: 'start' },
    end: { source: 'viewport', edge: 'end' },
  },
}
```

## 7. Migration note

Older layout authoring paths are removed from active runtime usage.

Any new magnet, editor surface, import/export path, or preset helper must use the explicit `bounds` contract only.
