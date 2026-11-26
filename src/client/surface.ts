/**
 * Skin-safe surfaces.
 *
 * The panel styles take their colors from DSH theme tokens
 * (`--dsw-alias-bg-*`). That is normally correct — but "skins" installed by
 * users override those tokens with transparent or translucent values, so our
 * panels end up drawn straight onto the skin's artwork and text stops being
 * readable.
 *
 * We cannot detect a skin by name, so we measure instead: render a probe
 * element that inherits the theme's surface token, read back the computed
 * color and look at its alpha. If the theme surface is see-through we switch
 * the injected stylesheets to a set of built-in opaque surfaces
 * (`data-me-surface="opaque"` on <html>), otherwise we keep the theme look
 * untouched (`data-me-surface="theme"`).
 *
 * The tone (dark / light) is derived from the theme's label color, so an
 * opaque panel never guesses wrong about which palette matches.
 */

export type SurfaceMode = 'theme' | 'opaque'
export type SurfaceTone = 'dark' | 'light'
export type SurfacePreference = 'auto' | 'on' | 'off'

/** Alpha at which a theme surface still counts as opaque enough to keep. */
export const OPAQUE_ALPHA_THRESHOLD = 0.85

export interface SurfaceDecision {
  mode: SurfaceMode
  tone: SurfaceTone
  /** Measured alpha of the theme surface, or null when it could not be read. */
  alpha: number | null
}

/** Parse `rgb()` / `rgba()` / `color(...)` into an alpha in 0..1, or null. */
export function parseAlpha(color: unknown): number | null {
  if (typeof color !== 'string') return null
  const text = color.trim().toLowerCase()
  if (text === '') return null
  if (text === 'transparent' || text === 'none') return 0
  // rgb(r g b / a) and rgba(r, g, b, a)
  const slash = /\/([^/)]+)\)\s*$/.exec(text)
  if (slash !== null) {
    const value = parseAlphaValue(slash[1])
    if (value !== null) return value
  }
  const rgba = /^rgba?\(([^)]*)\)$/.exec(text)
  if (rgba !== null) {
    const parts = rgba[1].split(/[,/\s]+/).filter((part) => part !== '')
    if (parts.length >= 4) return parseAlphaValue(parts[3])
    return 1
  }
  // color(srgb r g b / a)
  return text.startsWith('color(') ? 1 : null
}

function parseAlphaValue(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  if (text.endsWith('%')) {
    const percent = Number(text.slice(0, -1))
    return Number.isFinite(percent) ? clamp01(percent / 100) : null
  }
  const value = Number(text)
  return Number.isFinite(value) ? clamp01(value) : null
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/** Relative luminance of a computed `rgb()` color, for tone detection. */
export function parseLuminance(color: unknown): number | null {
  if (typeof color !== 'string') return null
  const match = /rgba?\(([^)]*)\)/.exec(color.trim().toLowerCase())
  if (match === null) return null
  const parts = match[1].split(/[,/\s]+/).filter((part) => part !== '')
  if (parts.length < 3) return null
  const channel = (raw: string): number | null => {
    if (raw.endsWith('%')) {
      const percent = Number(raw.slice(0, -1))
      return Number.isFinite(percent) ? clamp01(percent / 100) : null
    }
    const value = Number(raw)
    return Number.isFinite(value) ? clamp01(value / 255) : null
  }
  const red = channel(parts[0])
  const green = channel(parts[1])
  const blue = channel(parts[2])
  if (red === null || green === null || blue === null) return null
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** Probe the document for the theme's surface alpha and label luminance. */
export function detectSurface(doc: Document | null | undefined): SurfaceDecision {
  if (doc === null || doc === undefined) return { mode: 'theme', tone: 'dark', alpha: null }
  const win = doc.defaultView
  if (win === null) return { mode: 'theme', tone: 'dark', alpha: null }
  const body = doc.body
  if (body === null) return { mode: 'theme', tone: 'dark', alpha: null }

  const probe = doc.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    'width:1px',
    'height:1px',
    'background:var(--dsw-alias-bg-base, transparent)',
    'color:var(--dsw-alias-label-primary, rgb(230,230,230))',
    'pointer-events:none',
  ].join(';')
  body.appendChild(probe)
  let alpha: number | null = null
  let luminance: number | null = null
  try {
    const computed = win.getComputedStyle(probe)
    alpha = parseAlpha(computed.backgroundColor)
    luminance = parseLuminance(computed.color)
  } catch {
    alpha = null
    luminance = null
  } finally {
    probe.remove()
  }

  // Label color is the inverse of the theme: bright label text means a dark
  // theme, dark label text means a light theme.
  const tone: SurfaceTone = luminance !== null && luminance > 0.6 ? 'dark' : 'light'
  const mode: SurfaceMode = alpha === null || alpha >= OPAQUE_ALPHA_THRESHOLD ? 'theme' : 'opaque'
  return { mode, tone, alpha }
}

/** Resolve the user preference (`off` / `on`) or fall back to detection. */
export function resolveSurfaceMode(
  preference: SurfacePreference | string | null | undefined,
  detected: SurfaceDecision,
): SurfaceDecision {
  if (preference === 'on') return { mode: 'opaque', tone: detected.tone, alpha: detected.alpha }
  if (preference === 'off') return { mode: 'theme', tone: detected.tone, alpha: detected.alpha }
  return detected
}

/** Write the decision onto <html> so the injected stylesheets can react. */
export function applySurfaceMode(doc: Document | null | undefined, decision: SurfaceDecision): void {
  if (doc === null || doc === undefined) return
  const root = doc.documentElement
  if (root === null) return
  root.setAttribute('data-me-surface', decision.mode)
  root.setAttribute('data-me-surface-tone', decision.tone)
}

/** Detect + resolve + apply in one step; returns the applied decision. */
export function syncSurface(
  doc: Document | null | undefined,
  preference: SurfacePreference | string | null | undefined,
): SurfaceDecision {
  const decision = resolveSurfaceMode(preference, determineSurface(doc))
  applySurfaceMode(doc, decision)
  return decision
}

/**
 * The effective decision: a forced preference still needs a tone, so detection
 * always runs once and its result is cached for the page.
 */
let cached: SurfaceDecision | null = null

export function determineSurface(doc: Document | null | undefined): SurfaceDecision {
  if (cached !== null) return cached
  cached = detectSurface(doc)
  return cached
}

/** Test hook: forget the cached detection. */
export function resetSurfaceCache(): void {
  cached = null
}
