import type { LandmarkFrame } from '../contracts/recognition';

export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

const CONNECTION_COLOR = '#5eead4';
const CONNECTION_WIDTH = 3;
const POINT_COLOR = '#ffffff';
const POINT_RADIUS = 5;
const WRIST_COLOR = '#2dd4bf';
const WRIST_RADIUS = 8;

export interface LandmarkOverlay {
  draw(frame: LandmarkFrame): void;
  destroy(): void;
}

export function drawLandmarkFrame(ctx: CanvasRenderingContext2D, frame: LandmarkFrame): void {
  ctx.clearRect(0, 0, frame.width, frame.height);
  for (const hand of frame.hands) {
    const points = hand.landmarks.map((point) => ({
      x: point.x * frame.width,
      y: point.y * frame.height,
    }));
    ctx.strokeStyle = CONNECTION_COLOR;
    ctx.lineWidth = CONNECTION_WIDTH;
    for (const [start, end] of HAND_CONNECTIONS) {
      const from = points[start];
      const to = points[end];
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    points.forEach((point, index) => {
      const isWrist = index === 0;
      ctx.beginPath();
      ctx.fillStyle = isWrist ? WRIST_COLOR : POINT_COLOR;
      ctx.arc(point.x, point.y, isWrist ? WRIST_RADIUS : POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

const NOOP_OVERLAY: LandmarkOverlay = {
  draw() {},
  destroy() {},
};

export function createLandmarkOverlay(video: HTMLVideoElement): LandmarkOverlay {
  const parentElement = video.parentElement;
  if (!parentElement || typeof document === 'undefined') return NOOP_OVERLAY;
  const parent: HTMLElement = parentElement;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-signly-overlay', 'landmarks');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.position = 'absolute';
  canvas.style.pointerEvents = 'none';

  const previousPosition = parent.style.position;
  const positionWasAdded = getComputedStyle(parent).position === 'static';
  if (positionWasAdded) parent.style.position = 'relative';
  parent.insertBefore(canvas, video.nextSibling);

  const ctx = canvas.getContext('2d');

  function layout(): void {
    const videoRect = video.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    canvas.style.left = `${videoRect.left - parentRect.left - parent.clientLeft}px`;
    canvas.style.top = `${videoRect.top - parentRect.top - parent.clientTop}px`;
    canvas.style.width = `${videoRect.width}px`;
    canvas.style.height = `${videoRect.height}px`;
    const transform = getComputedStyle(video).transform;
    canvas.style.transform = transform === 'none' ? '' : transform;
    canvas.style.borderRadius = getComputedStyle(video).borderRadius;
  }

  return {
    draw(frame: LandmarkFrame): void {
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      layout();
      if (ctx) drawLandmarkFrame(ctx, frame);
    },
    destroy(): void {
      canvas.remove();
      if (positionWasAdded) parent.style.position = previousPosition;
    },
  };
}
