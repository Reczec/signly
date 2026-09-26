import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RecognitionResult } from '../contracts/recognition'
import { applyRecognitionResult, backspaceWord, clearWord, createWordBuilder } from './wordBuilder'
import { RecognitionResultCard } from './RecognitionResultCard'
import { createStabilizer } from '../recognition/stabilizer'

function accepted(sign: string, sequence: number): RecognitionResult {
  return { schemaVersion: 1, sessionId: 's', sequence, sign, confidence: 1, stable: true,
    accepted: true, timestamp: sequence * 100, state: 'accepted', handsDetected: 2, latencyMs: 1, error: null }
}
describe('word milestone regressions', () => {
  it('keeps multiword glosses atomic and restores the preceding token timestamp on delete', () => {
    let state = createWordBuilder()
    for (const [index, label] of ['HELLO', 'THANK YOU', 'HELP'].entries()) state = applyRecognitionResult(state, accepted(label, index + 1))
    expect(state.word).toBe('HELLO THANK YOU HELP')
    expect(state.tokens.map(token => token.text)).toEqual(['HELLO', 'THANK YOU', 'HELP'])
    state = backspaceWord(state)
    expect(state.currentLetter).toBe('THANK YOU')
    expect(state.lastAcceptedAt).toBe(200)
    state = backspaceWord(state)
    expect(state.word).toBe('HELLO')
    state = clearWord(state)
    state = applyRecognitionResult(state, accepted('THANK YOU', 2))
    expect(state.tokens).toEqual([])
  })
  it('uses valid CSS percentages, including zero and nonfinite inputs', () => {
    for (const [confidence, width] of [[6 / 7, '86%'], [0, '0%'], [NaN, '0%'], [2, '100%']]) {
      const html = renderToStaticMarkup(<RecognitionResultCard sign="HELP" confidence={Number(confidence)} status="recognizing" />)
      expect(html).toContain(`width:${width}`)
    }
  })
  it('requires observed absence after a gap, resume, or intervening unreliable frame', () => {
    const s = createStabilizer()
    s.requireRelease(0)
    expect(s.update({ kind: 'absent' }, 5000).phase).toBe('release_required')
    for (const t of [5200, 5400, 5600]) s.update({ kind: 'absent' }, t)
    s.update({ kind: 'unreliable' }, 5700)
    for (const t of [5800, 6000, 6200, 6400, 6600]) expect(s.update({ kind: 'absent' }, t).phase).toBe('release_required')
    expect(s.update({ kind: 'absent' }, 6800).phase).toBe('no_hand')
    s.requireRelease(7000)
    s.update({ kind: 'absent' }, 7100)
    expect(s.update({ kind: 'absent' }, 9000).phase).toBe('release_required')
  })
})
