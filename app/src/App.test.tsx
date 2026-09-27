import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'

function setSearch(value: string) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { search: value } },
  })
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

beforeEach(() => setSearch(''))

describe('Signly main page', () => {
  it('renders the branding, recognition screen, result and word builder', () => {
    const markup = renderToStaticMarkup(<App />)
    expect(markup).toContain('Signly')
    expect(markup).toContain('Hackathon prototype')
    expect(markup).toContain('Live recognition')
    expect(markup).toContain('Recognition result')
    expect(markup).toContain('Your words')
    expect(markup).toContain('Supported words')
    expect(markup).not.toContain('kNN')
    expect(markup).not.toContain('Match confidence')
    expect(markup).toContain('/collector.html')
    expect(markup).not.toContain('MOCK DATA')
  })

  it('exposes exactly one page heading and one start action', () => {
    const markup = renderToStaticMarkup(<App />)
    expect(count(markup, '<h1')).toBe(1)
    expect(count(markup, '<main')).toBe(1)
    expect(count(markup, 'Start camera')).toBe(1)
    expect(count(markup, 'aria-live="polite"')).toBe(1)
  })

  it('keeps the mock banner isolated to ?mock=1', () => {
    setSearch('?mock=1')
    const markup = renderToStaticMarkup(<App />)
    expect(markup).toContain('MOCK DATA · UI DEVELOPMENT')
    expect(markup).toContain('Mock vocabulary — not validated')
    expect(markup).toContain('Start camera')
    expect(count(markup, '<h1')).toBe(1)
  })

  it('exposes legacy wording only in explicit legacy mode', () => {
    setSearch('?mode=legacy')
    const markup = renderToStaticMarkup(<App />)
    expect(markup).toContain('LEGACY / DIAGNOSTICS')
    expect(markup).toContain('kNN')
    expect(markup).toContain('Match confidence')
  })
})
