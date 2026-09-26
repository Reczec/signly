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
    expect(markup).toContain('Hackathon-Prototyp')
    expect(markup).toContain('Live-Erkennung')
    expect(markup).toContain('Erkennungsergebnis')
    expect(markup).toContain('Wortbaustein')
    expect(markup).toContain('Worterkennung · Offline-Evaluation')
    expect(markup).toContain('/collector.html')
    expect(markup).not.toContain('MOCK DATA')
  })

  it('exposes exactly one page heading and one start action', () => {
    const markup = renderToStaticMarkup(<App />)
    expect(count(markup, '<h1')).toBe(1)
    expect(count(markup, '<main')).toBe(1)
    expect(count(markup, 'Kamera starten')).toBe(1)
    expect(count(markup, 'aria-live="polite"')).toBe(1)
  })

  it('keeps the mock banner isolated to ?mock=1', () => {
    setSearch('?mock=1')
    const markup = renderToStaticMarkup(<App />)
    expect(markup).toContain('MOCK DATA · UI DEVELOPMENT')
    expect(markup).toContain('Mock-Vokabular – nicht validiert')
    expect(markup).toContain('Kamera starten')
    expect(count(markup, '<h1')).toBe(1)
  })
})
