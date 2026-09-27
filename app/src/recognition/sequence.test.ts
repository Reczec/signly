import { describe, expect, it } from 'vitest';
import { encodeSequence, type SequenceFrame } from './sequence';

function frame(timestampMs: number): SequenceFrame {
  return { timestampMs, width: 640, height: 480,
    pose: Array.from({ length: 33 }, (_, i) => ({ x: i === 11 ? .3 : .7, y: .4, z: i, visibility: 1 })),
    hands: ['Left', 'Right'].map((handedness, side) => ({ handedness: handedness as 'Left' | 'Right',
      landmarks: Array.from({ length: 21 }, (_, i) => ({ x: .25 + side * .3 + i * .003, y: .5 + i * .002, z: i * .001 })) })) };
}

describe('shared sequence preprocessing', () => {
  it('encodes exactly 32 by 162 finite features with separate hand/body masks', () => {
    const encoded = encodeSequence([frame(0), frame(100)]);
    expect(encoded.shape).toEqual([32,162]);
    expect(encoded.tensor.every(row => row.length === 162 && row.every(Number.isFinite))).toBe(true);
    expect(encoded.quality).toEqual({ handFrameFraction: 1, poseFrameFraction: 1 });
    expect(encoded.tensor[0][90]).toBe(1);
    expect(encoded.tensor[0][157]).toBe(1);
    expect(encoded.tensor[0][161]).toBe(1);
  });

  it('keeps hand identity when detector ordering reverses', () => {
    const a = frame(0), b = frame(100);
    b.hands.reverse();
    const encoded = encodeSequence([a,b]);
    expect(encoded.tensor[0]).toEqual(encoded.tensor.at(-1));
  });

  it('does not combine pose depth with hand depth and keeps hand shape without pose', () => {
    const a = frame(0), b = frame(100);
    b.pose = b.pose.map(p => ({ ...p, z: p.z * 1000 }));
    expect(encodeSequence([a,b]).tensor[0]).toEqual(encodeSequence([a,b]).tensor.at(-1));
    b.pose = [];
    const row = encodeSequence([b]).tensor[0];
    expect(row.slice(0,24)).toEqual(Array(24).fill(0));
    expect(row.slice(24,87)).toEqual(encodeSequence([a]).tensor[0].slice(24,87));
    expect(row[89]).toBe(0); expect(row[90]).toBe(1); expect(row[161]).toBe(0);
  });

  it('masks absent hands and long timestamp gaps rather than inventing motion', () => {
    const missing = frame(100); missing.hands = [];
    const result = encodeSequence([frame(0),missing,frame(200)]);
    expect(result.quality.handFrameFraction).toBeCloseTo(2/3);
    expect(result.tensor.some(row => row.slice(24).every(v => v === 0))).toBe(true);
    const gap = encodeSequence([frame(0),frame(1000)]);
    expect(gap.tensor[16]).toEqual(Array(162).fill(0));
  });

  it('rejects nonmonotonic timestamps and invalid dimensions', () => {
    expect(() => encodeSequence([frame(10),frame(10)])).toThrow('increase');
    expect(() => encodeSequence([{ ...frame(0), width: 0 }])).toThrow('dimensions');
  });
});
