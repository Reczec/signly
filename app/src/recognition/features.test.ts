import { describe, expect, it } from 'vitest';
import {
  FEATURE_DIMENSIONS,
  LANDMARK_COUNT,
  PREPROCESSING_VERSION,
  tryExtractFeatures,
} from './features';

interface Point {
  x: number;
  y: number;
  z: number;
}

function buildHand(offsetX = 0, offsetY = 0, scale = 1): Point[] {
  const points: Point[] = [];
  points.push({ x: 0.2 * scale + offsetX, y: 0.4 * scale + offsetY, z: 0 });
  for (let index = 1; index < LANDMARK_COUNT; index++) {
    points.push({
      x: (0.2 + index * 0.02) * scale + offsetX,
      y: (0.4 + (index % 5) * 0.03) * scale + offsetY,
      z: -index * 0.005 * scale,
    });
  }
  return points;
}

function rotate(points: Point[]): Point[] {
  return points.map((point) => ({
    x: point.y,
    y: -point.x,
    z: point.z,
  }));
}

describe('shared landmark preprocessing', () => {
  it('exposes the shared preprocessing version and a 63 coordinate feature vector', () => {
    expect(PREPROCESSING_VERSION).toBe('signly-landmark-v1');
    expect(FEATURE_DIMENSIONS).toBe(63);

    const features = tryExtractFeatures(buildHand(), 640, 480);

    expect(features).not.toBeNull();
    expect(features).toHaveLength(FEATURE_DIMENSIONS);
    expect(features!.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('anchors the wrist at the origin', () => {
    const features = tryExtractFeatures(buildHand(), 640, 480)!;
    expect(features.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('converts y into width units before subtracting the wrist', () => {
    const hand = buildHand();
    hand[1] = { x: 0.3, y: 0.5, z: 0 };
    hand[5] = { x: 0.3, y: 0.4, z: 0 };
    hand[9] = { x: 0.3, y: 0.4, z: 0 };
    hand[13] = { x: 0.3, y: 0.4, z: 0 };
    hand[17] = { x: 0.3, y: 0.4, z: 0 };

    const features = tryExtractFeatures(hand, 640, 480)!;

    const scale = 0.1;
    const expectedY = ((0.5 - 0.4) * (480 / 640)) / scale;
    expect(features[4]).toBeCloseTo(expectedY, 10);
    expect(features[3]).toBeCloseTo(1, 10);
    expect(expectedY).not.toBeCloseTo(1, 10);
  });

  it('is invariant against translation of the whole hand', () => {
    const base = tryExtractFeatures(buildHand(0.13, -0.27), 640, 480)!;
    const moved = tryExtractFeatures(buildHand(-0.31, 0.44), 640, 480)!;

    for (let index = 0; index < base.length; index++) {
      expect(moved[index]).toBeCloseTo(base[index], 10);
    }
  });

  it('is invariant against uniform scaling of the hand', () => {
    const base = tryExtractFeatures(buildHand(0.1, 0.1, 1), 640, 480)!;
    const scaled = tryExtractFeatures(buildHand(0.1, 0.1, 2.5), 640, 480)!;

    for (let index = 0; index < base.length; index++) {
      expect(scaled[index]).toBeCloseTo(base[index], 10);
    }
  });

  it('keeps orientation instead of rotating into a canonical frame', () => {
    const base = tryExtractFeatures(buildHand(), 640, 480)!;
    const turned = tryExtractFeatures(rotate(buildHand()), 640, 480)!;

    const difference = base.reduce(
      (sum, value, index) => sum + Math.abs(value - turned[index]),
      0,
    );
    expect(difference).toBeGreaterThan(1);
  });

  it('rejects nonfinite coordinates and degenerate geometry', () => {
    const broken = buildHand();
    broken[7] = { x: Number.NaN, y: 0.4, z: 0 };
    expect(tryExtractFeatures(broken, 640, 480)).toBeNull();

    const identical = Array.from({ length: LANDMARK_COUNT }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
    }));
    expect(tryExtractFeatures(identical, 640, 480)).toBeNull();

    const collapsed = Array.from({ length: LANDMARK_COUNT }, (_, index) => ({
      x: 0.5,
      y: 0.5,
      z: index,
    }));
    expect(tryExtractFeatures(collapsed, 640, 480)).toBeNull();
  });

  it('rejects wrong landmark counts and invalid frame sizes', () => {
    expect(tryExtractFeatures(buildHand().slice(0, 20), 640, 480)).toBeNull();
    expect(tryExtractFeatures(undefined, 640, 480)).toBeNull();
    expect(tryExtractFeatures(buildHand(), 0, 480)).toBeNull();
    expect(tryExtractFeatures(buildHand(), 640, Number.NaN)).toBeNull();
  });
});
