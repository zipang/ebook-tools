---
version: alpha
name: Reading Theme

# ============================================================================
# COLORS — every entry maps to a --color-* CSS variable
# ============================================================================
colors:
  brand:
    primary: "#111111"   # --color-brand-primary (headings, logo, header)
    accent:  "#e2fc91"   # --color-brand-accent  (highlight, key accents)
    # secondary: omitted → --color-brand-secondary: var(--color-brand-primary)
    # tertiary:  omitted → --color-brand-tertiary:  var(--color-brand-primary)

  action:
    success: "#b5cea8"   # --color-action-success
    info:    "#9cdcfe"   # --color-action-info
    warning: "#d7ba7d"   # --color-action-warning
    danger:  "#f13e3e"   # --color-action-danger

  text:
    base: "#111111"      # --color-text
    # accent: omitted → --color-text-accent: var(--color-text)
    # muted:  omitted → --color-text-muted:  var(--color-text)
    # ondark: omitted → --color-text-ondark: var(--color-surface)

  surface:
    base: "#fff5ee"      # --color-surface     (seashell page background)
    alt:  "#f1e7e1"      # --color-surface-alt (warm tint of the base)
    # dark: omitted → --color-surface-dark: var(--color-surface)
    # card: omitted → --color-surface-card: var(--color-surface)

# ============================================================================
# TYPOGRAPHY — font family, weight, line height, and tracking presets
# ============================================================================
typography:
  base:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontWeight: "var(--font-weight-regular)"
    lineHeight: "var(--line-height-normal)"
  display:
    fontFamily: '"Instrument Serif", "Times New Roman", Georgia, serif'
    fontWeight: "var(--font-weight-regular)"
    lineHeight: "var(--line-height-tight)"
    letterSpacing: "var(--letter-spacing-tight)"
  mono:
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace'

# ============================================================================
# ROUNDED — corner radius presets
# ============================================================================
rounded:
  sm:   "0.25rem"
  md:   "0.5rem"   # matches the source --border-radius
  lg:   "1rem"
  full: "9999px"

# ============================================================================
# SPACING — 4px linear scale, base is 1rem
# ============================================================================
spacing:
  xs:   "0.25rem"
  sm:   "0.5rem"
  md:   "0.75rem"
  base: "1rem"
  lg:   "1.25rem"
  xl:   "2rem"
  xxl:  "3rem"

# ============================================================================
# ELEVATION — flat preset, depth comes from color and spacing
# ============================================================================
elevation:
  sm: "none"
  md: "none"
  lg: "none"

# ============================================================================
# BORDER — 124 preset widths
# ============================================================================
border:
  sm: "1px"
  md: "2px"
  lg: "4px"
---

## Overview

This document is the design system for the extracted document projects. 

- `documents/DESIGN.md` documents the tokens and their usage.
- `documents/design-tokens.css` exposes the tokens as `:root` CSS variables.
- `documents/color-variants.css` derives the `muted` and `active` variants.
- `src/templates/default/print.css` embeds the same variables so each extracted
  document stays self-contained. Keep the two token blocks identical.

The palette and the type come from the page
`https://cydstumpel.nl/css-scroll-triggered-animations-are-here-and-i-completely-missed-them/`.
The theme keeps the warm seashell background, the near-black text, and the lime
highlight. The result is a calm, high-contrast reading page.

## Colors

- **Primary (`#111111`)** — Near-black. Headings, logo, header, and body text.
- **Accent (`#e2fc91`)** — Lime highlight. Key accents and the `mark` element.
- **Secondary** and **tertiary** — omitted. The stylesheet falls back to
  `var(--color-brand-primary)`.
- **Success (`#b5cea8`)**, **info (`#9cdcfe`)**, **warning (`#d7ba7d`)**, and
  **danger (`#f13e3e`)** — these four colors come from the code theme on the
  source page.
- **Text base (`#111111`)** — Body text. The accent, muted, and on-dark variants
  fall back to the text and surface colors.
- **Surface base (`#fff5ee`)** — Seashell. The default page background.
- **Surface alt (`#f1e7e1`)** — A warm tint of the base. It separates alternating
  sections and table rows.

### Color variants

Brand and action colors carry `muted` and `active` variants. The
`color-variants.css` file derives them from the base color with CSS relative
color syntax:

- `muted` — `hsl(from <base> h calc(s * 0.8) calc(l * 1.2))` — less saturated
  and lighter. This is the resting variant.
- `active` — `hsl(from <base> h calc(s * 1.2) calc(l * 1.1))` — more saturated
  and lighter. This is the hover and pressed variant.

Only brand and action colors carry these variants. Text and surface colors
define their variants in the token tables above. The variants are not design
tokens. Do not list them in the front matter.

## Typography

Body text uses **Geist**. Headings use **Instrument Serif**. Code and labels use
**JetBrains Mono**. The theme references these families with system fallbacks,
because the font files are not bundled. The browser uses the fallback when a
family is not installed.

The type scale is geometric with ratio 1.25 (Major Third):
`size(step) = 1rem * 1.25^step`. Thus `md` is `1rem`, `lg` is `1.25rem`, `xl` is
`1.5625rem`, and `xs` is `0.64rem`. Font sizes live in the stylesheet only. The
optional `2xl` and `display` steps are overridden in the stylesheet.

## Layout

A 4px linear spacing scale with 1rem (16px) as the base step. Reading text is
constrained to about 68 characters per line. Section padding uses `space-xl` and
`space-xxl`.

## Elevation & Depth

The design is flat. All elevation tokens are `none`. Depth comes from color
contrast and spacing, not from shadows.

## Shapes

Small controls use a 4px radius. Cards, tables, and code blocks use 8px
(`rounded.md`), which matches the source `--border-radius`. Large panels use
16px. Circular shapes use `rounded.full`.

## Components

### Link

The Link component uses `colors.text.base` for its color and a lime underline
for emphasis. The interactive states use the derived variants from
`color-variants.css`:

- **default** — `textColor: "{colors.text.base}"` → `--color-text`
- **hover and active** — `--color-brand-accent` for the underline
- **visited** — `--color-text-muted` (falls back to `--color-text`)

In the stylesheet this maps to:

```css
a {
	color: var(--color-text);
	text-decoration: underline;
	text-decoration-color: var(--color-brand-accent);
	text-decoration-thickness: var(--border-md);
}
a:hover,
a:active {
	background: var(--color-brand-accent);
}
```

### Blockquote

The Blockquote component uses `colors.surface.alt` for its background and
`colors.brand.primary` for the leading rule.

## DO's and DON'Ts

- Do use the accent color only for the most important action per screen.
- Do use `var()` fallbacks for optional tokens in the stylesheet.
- Do not list the derived `muted` and `active` variants as tokens in the front
  matter.
- Do not add a token that this document does not describe.
- Do not bundle font binaries without a new decision. The families use system
  fallbacks for now.
