import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LandmarkFrame } from '../contracts/recognition';
import {
  HAND_CONNECTIONS,
  createLandmarkOverlay,
  drawLandmarkFrame,
  drawOverlayCaption,
  isMirroredTransform,
} from './overlay';

const HAND: { x: number; y: number; z: number }[] = Array.from({ length: 21 }, (_, index) => ({
  x: index / 21,
  y: index / 21,
  z: 0,
}));

const FRAME: LandmarkFrame = {
  width: 640,
  height: 480,
  hands: [{ handedness: 'Right', landmarks: HAND }],
};

function createRecordingContext() {
  const calls: string[] = [];
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    clearRect: (x: number, y: number, width: number, height: number) => {
      calls.push(`clear:${x},${y},${width},${height}`);
    },
    beginPath: () => {
      calls.push('begin');
    },
    moveTo: (x: number, y: number) => {
      calls.push(`move:${x},${y}`);
    },
    lineTo: (x: number, y: number) => {
      calls.push(`line:${x},${y}`);
    },
    stroke: () => {
      calls.push('stroke');
    },
    arc: (x: number, y: number, radius: number) => {
      calls.push(`arc:${x},${y},${radius}`);
    },
    fill: () => {
      calls.push('fill');
    },
    save: () => {
      calls.push('save');
    },
    restore: () => {
      calls.push('restore');
    },
    translate: (x: number, y: number) => {
      calls.push(`translate:${x},${y}`);
    },
    scale: (x: number, y: number) => {
      calls.push(`scale:${x},${y}`);
    },
    fillRect: (x: number, y: number, width: number, height: number) => {
      calls.push(`fillRect:${x},${y},${width},${height}`);
    },
    fillText: (text: string, x: number, y: number) => {
      calls.push(`fillText:${text}@${x},${y}`);
    },
    measureText: (text: string) => ({ width: text.length * 10 }),
  };
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('landmark overlay', () => {
  it('draws 21 connections and 21 points scaled to the frame size', () => {
    const { context, calls } = createRecordingContext();

    drawLandmarkFrame(context, FRAME);

    expect(calls.filter((call) => call === 'stroke')).toHaveLength(HAND_CONNECTIONS.length);
    expect(calls.filter((call) => call.startsWith('arc'))).toHaveLength(21);
    expect(calls[0]).toBe('clear:0,0,640,480');
    expect(calls).toContain('move:0,0');

    const [lineX, lineY] = calls
      .find((call) => call.startsWith('line:'))!
      .slice('line:'.length)
      .split(',')
      .map(Number);
    expect(lineX).toBeCloseTo(640 / 21);
    expect(lineY).toBeCloseTo(480 / 21);
  });

  it('only clears the frame when no hands are present', () => {
    const { context, calls } = createRecordingContext();

    drawLandmarkFrame(context, { width: 320, height: 240, hands: [] });

    expect(calls).toEqual(['clear:0,0,320,240']);
  });

  it('skips connections whose landmarks are missing instead of drawing broken bones', () => {
    const { context, calls } = createRecordingContext();

    drawLandmarkFrame(context, {
      width: 640,
      height: 480,
      hands: [{ handedness: 'Left', landmarks: [HAND[0]] }],
    });

    expect(calls.filter((call) => call === 'stroke')).toHaveLength(0);
    expect(calls.filter((call) => call.startsWith('arc'))).toHaveLength(1);
  });

  it('keeps every connection inside the 21 point hand model', () => {
    expect(HAND_CONNECTIONS).toHaveLength(21);
    for (const [start, end] of HAND_CONNECTIONS) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThan(21);
      expect(end).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThan(21);
    }
  });

  it('attaches a mirrored canvas over the video and removes it on destroy', () => {
    const { context, calls } = createRecordingContext();
    const canvas = {
      width: 0,
      height: 0,
      style: {} as CSSStyleDeclaration,
      setAttribute: vi.fn(),
      getContext: vi.fn(() => context),
      remove: vi.fn(),
    };
    const parent = {
      style: { position: '' } as CSSStyleDeclaration,
      clientLeft: 1,
      clientTop: 1,
      insertBefore: vi.fn(),
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 0, height: 0 }),
    };
    const video = {
      parentElement: parent,
      nextSibling: null,
      getBoundingClientRect: () => ({ left: 125, top: 75, width: 640, height: 480 }),
    };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({
        position: 'static',
        transform: 'matrix(-1, 0, 0, 1, 640, 0)',
        borderRadius: '8px',
      })),
    );

    const overlay = createLandmarkOverlay(video as unknown as HTMLVideoElement);

    expect(canvas.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(parent.insertBefore).toHaveBeenCalledWith(canvas, null);
    expect(parent.style.position).toBe('relative');

    overlay.draw(FRAME);

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(canvas.style.left).toBe('24px');
    expect(canvas.style.top).toBe('24px');
    expect(canvas.style.width).toBe('640px');
    expect(canvas.style.height).toBe('480px');
    expect(canvas.style.transform).toBe('matrix(-1, 0, 0, 1, 640, 0)');
    expect(canvas.style.borderRadius).toBe('8px');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(calls).toContain('clear:0,0,640,480');

    overlay.destroy();

    expect(canvas.remove).toHaveBeenCalledTimes(1);
    expect(parent.style.position).toBe('');
  });

  it('passes the caption through the overlay with mirror compensation', () => {
    const { context, calls } = createRecordingContext();
    const canvas = {
      width: 0,
      height: 0,
      style: {} as CSSStyleDeclaration,
      setAttribute: vi.fn(),
      getContext: vi.fn(() => context),
      remove: vi.fn(),
    };
    const parent = {
      style: { position: '' } as CSSStyleDeclaration,
      clientLeft: 0,
      clientTop: 0,
      insertBefore: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    };
    const video = {
      parentElement: parent,
      nextSibling: null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
    };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({
        position: 'static',
        transform: 'matrix(-1, 0, 0, 1, 640, 0)',
        borderRadius: '0px',
      })),
    );

    const overlay = createLandmarkOverlay(video as unknown as HTMLVideoElement);
    overlay.draw(FRAME, 'A 86%');

    expect(calls.some((call) => call.startsWith('fillText:A 86%'))).toBe(true);
    expect(calls).toContain('translate:640,0');
    overlay.destroy();
  });
});

describe('candidate caption', () => {
  it('detection of a horizontal css mirror', () => {
    expect(isMirroredTransform('matrix(-1, 0, 0, 1, 640, 0)')).toBe(true);
    expect(isMirroredTransform('matrix(1, 0, 0, 1, 0, 0)')).toBe(false);
    expect(isMirroredTransform('none')).toBe(false);
    expect(isMirroredTransform('')).toBe(false);
  });

  it('flips caption drawing so the text stays readable over a mirrored preview', () => {
    const { context, calls } = createRecordingContext();

    drawOverlayCaption(context, FRAME, 'A 86%', true);

    expect(calls[0]).toBe('save');
    expect(calls).toContain('translate:640,0');
    expect(calls).toContain('scale:-1,1');
    expect(calls.some((call) => call.startsWith('fillText:A 86%'))).toBe(true);
    expect(calls.at(-1)).toBe('restore');
    expect(calls.indexOf('translate:640,0')).toBeLessThan(
      calls.findIndex((call) => call.startsWith('fillText:')),
    );
  });

  it('draws an unflipped caption when the preview is not mirrored', () => {
    const { context, calls } = createRecordingContext();

    drawOverlayCaption(context, FRAME, 'B 71%', false);

    expect(calls).not.toContain('translate:640,0');
    expect(calls).not.toContain('scale:-1,1');
    expect(calls.some((call) => call.startsWith('fillText:B 71%'))).toBe(true);
    expect(calls.at(-1)).toBe('restore');
  });
});
