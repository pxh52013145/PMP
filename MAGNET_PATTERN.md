# Magnet Pattern Guide

This document is the maintainable working guide for magnet layout, chrome, and content styling in Pixel Matrix Player.

It complements:

- `docs/architecture/magnet-generation-spec.md` for registration and generation flow
- `docs/architecture/magnet-style-guidelines.md` for host-side DOM style contract

## 1. Core model

A magnet is split into three concerns:

- **Layout**: where the shell lives on the pixel matrix
- **Chrome**: how the outer frame is painted
- **Content**: how the renderer lays out text, controls, and visuals inside the shell

Do not mix these concerns.

## 1.1 Builtin declaration pattern

Every builtin magnet should declare two explicit preset constants:

- `*_CHROME` from `apps/desktop/src/modules/magnets/chromePresets.ts`
- `*_LAYOUT` from `apps/desktop/src/modules/magnets/layoutPresets.ts`

Even when a layout preset is empty, keep it explicit in the builtin definition.

Why:

- avoids hidden reliance on fallback geometry behavior
- makes single-vs-panel placement intent obvious in code review
- keeps future layout migrations mechanical and low risk

Example:

```ts
const BACK_BUTTON_CHROME = createControlChromePreset()
const BACK_BUTTON_LAYOUT = createDockedSingleControlLayoutPreset({
  dock: { x: 'start' },
})

export const BACK_BUTTON_MAGNET: Magnet = {
  ...BACK_BUTTON_LAYOUT,
  style: BACK_BUTTON_CHROME.style,
  animation: BACK_BUTTON_CHROME.animation,
}
```

## 2. DOM layers

Runtime DOM structure:

- `magnet-shell`
  - absolute positioning, hit area, z-index, cursor
- `magnet`
  - host chrome container
- `magnet-base-layer`
  - background, stroke, blur, shadow
- `magnet-content-layer`
  - content layout and typography

Rules:

- `magnet-shell` owns real bounds
- `magnet-base-layer` owns chrome paint only
- `magnet-content-layer` owns content spacing only
- renderer CSS must not try to reposition the shell

## 3. Layout vocabulary

### `anchors`

- Define the occupied grid relationship
- Are the source of truth for matrix placement
- Must not be used for visual micro-offset hacks

### `anchorType`

- `single`: one-slot control/button
- `horizontal`: one-row strip
- `vertical`: one-column strip
- `rectangular`: panel/block area

### `boundsMode`

Only applies to `single` magnets.

- `centered`
  - centers the control within its slot
  - best default for free-standing controls
- `docked`
  - locks the control to a slot edge on the axes you specify
  - use only when the control must maintain a seam relationship with a nearby panel or control

### `boundsDock`

Only applies when `boundsMode: 'docked'`.

- `x?: 'start' | 'center' | 'end'`
- `y?: 'start' | 'center' | 'end'`

Important:

- omitted axes fall back to standard `single` centering
- use single-axis docking whenever possible
- avoid `y: 'end'` on top-row controls unless a hard seam is intentional

### `boundsInset`

Real layout inset.

```ts
boundsInset?: {
  top?: number
  right?: number
  bottom?: number
  left?: number
}
```

Use `boundsInset` when you want to change the actual shell bounds.

It affects:

- layout position
- occupied visual area
- collision behavior
- adaptive join detection
- hit testing area

Typical use cases:

- give a top-row panel real breathing room from the window edge
- reduce a panel's true footprint without changing its anchors
- keep spacing stable across resize and adaptive layout passes


### `boundsOutset`

Real layout outset.

```ts
boundsOutset?: {
  top?: number
  right?: number
  bottom?: number
  left?: number
}
```

Use `boundsOutset` when you want to expand the actual shell bounds outward without changing anchors.

It affects:

- layout position
- occupied visual area
- collision behavior
- adaptive join detection
- hit testing area

Typical use cases:

- align a top-row panel's outer border with a 36px single control that overhangs the first grid row
- extend a panel shell to create a shared top baseline without moving internal content
- keep seam logic host-driven instead of using renderer transforms
### `chrome.inset`

Visual inset only.

```ts
chrome?: {
  enabled?: boolean
  inset?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  }
}
```

Use `chrome.inset` when you want the frame and content box to draw inside the shell without changing layout math.

It affects:

- chrome paint area
- content box area

It does not affect:

- shell bounds
- collisions
- joins
- hit area

Typical use cases:

- visually soften a magnet that feels too edge-to-edge
- add polish without changing geometry
- create a controlled internal breathing box

## 4. Style responsibilities

### Host geometry tokens

Use these for shell size:

- `style.width`
- `style.height`

Do not move a magnet by editing nested renderer wrappers.

### Host chrome tokens

Use these for outer frame paint:

- `backgroundColor`
- `border`
- `borderRadius`
- `boxShadow`
- `backdropFilter`
- `filter`
- `overflow`

Prefer shared presets:

- `createControlChromePreset`
- `createPanelChromePreset`
- `createDragHandleChromePreset`

### Content tokens

Use these for inner layout only:

- `padding`
- `display`
- `alignItems`
- `justifyContent`
- `flexDirection`
- `gap`
- `color`
- `fontSize`
- `fontWeight`
- `lineHeight`
- `letterSpacing`
- `fontVariantNumeric`
- `textAlign`

If the problem is “text is too close to the border”, use content spacing first.

If the problem is "the frame itself should sit farther from the edge" or needs to extend outward to meet another shell, use `boundsInset`, `boundsOutset`, or `chrome.inset` instead.

## 5. Recommended archetypes

### Free control

Use for standard top-bar buttons and isolated icon magnets.

- `anchorType: 'single'`
- `boundsMode: 'centered'`
- control preset chrome

### Seam-locked control

Use for controls that must visually align to a panel seam.

- `anchorType: 'single'`
- `boundsMode: 'docked'`
- prefer a single dock axis, such as `boundsDock: { x: 'start' }`

### Primary panel

Use for large content areas.

- `anchorType: 'rectangular'`
- panel preset chrome
- `boundsInset` or `boundsOutset` only when the shell itself needs true geometry adjustment

### Top-row panel

Use when a panel begins in row `0` and needs either inward breathing room or outward alignment to top-bar controls.

- use `boundsInset.top` when the panel itself should sit lower inside its anchored footprint
- use `boundsOutset.top` when the panel's outer border should align with an overhanging top-row single control
- only use `chrome.inset.top` if you want a purely visual adjustment without changing layout relationships

## 6. How to adjust spacing correctly

### Want a real gap between magnets?

Use one of:

- anchors
- `boundsInset`
- `boundsOutset`
- adaptive layout policy

Do not use CSS margin hacks on `magnet-shell`.

### Want only visual breathing inside a magnet?

Use one of:

- `chrome.inset`
- content `padding`
- renderer CSS

### Want a control to align with a panel on one side only?

Use:

```ts
boundsMode: 'docked'
boundsDock: { x: 'start' }
```

Avoid docking both axes unless the relationship is intentionally rigid.

## 7. Current examples

### Layout presets

Use the shared layout presets in `apps/desktop/src/modules/magnets/layoutPresets.ts` when possible.

- `createCenteredSingleControlLayoutPreset()`
  - explicit default for free single-slot controls
- `createDockedSingleControlLayoutPreset()`
  - seam-locked single controls
- `createPanelLayoutPreset()`
  - panel layout tokens such as `boundsInset`

### `btn-back`

- uses `boundsMode: 'docked'`
- currently docks only on `x`
- keeps left seam alignment with the navigation page while preserving vertical freedom

### `process-perf-monitor`

- uses `boundsOutset.top`
- extends its shell upward so the outer border aligns with top-row single controls while keeping anchors unchanged

## 8. Anti-patterns

Avoid these:

- changing shell spacing via random `x += ...` or `y += ...` patches
- using renderer CSS to fake shell movement
- using `padding` to solve real inter-magnet spacing problems
- docking both axes by default for top-row controls
- mixing visual polish and layout math in one-off component CSS

## 9. Review checklist

Before shipping a magnet layout change, verify:

- Does the shell spacing come from anchors, `boundsMode`, `boundsInset`, or `boundsOutset`?
- Does the chrome paint come from presets and chrome tokens?
- Does inner spacing come from content tokens or renderer CSS?
- Does resize behavior stay stable in roomy and compact windows?
- Are seam joins only happening when they are intended?

## 10. Practical rule of thumb

- **Move the shell** -> anchors / `boundsMode` / `boundsInset` / `boundsOutset`
- **Move the frame visually inside the shell** -> `chrome.inset`
- **Move content inside the frame** -> `padding` / renderer CSS

If you are unsure, start from the shell outward, not the renderer inward.
