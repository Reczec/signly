import { beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { search: '' } },
  })
})

describe('Signly main page', () => {
  it('renders the branding, recognition screen, result and word builder', () => {
    const markup = renderToStaticMarkup(<App />)
    expect(markup).toContain('Signly')
    expect(markup).toContain('Hackathon-Prototyp')
    expect(markup).toContain('Live-Erkennung')
    expect(markup).toContain('Kamera starten')
    expect(markup).toContain('Erkennungsergebnis')
    expect(markup).toContain('Wortbaustein')
    expect(markup).toContain('Validiertes Vokabular aus dem Modell')
    expect(markup).toContain('/collector.html')
    expect(markup).not.toContain('MOCK DATA')
  })
})
