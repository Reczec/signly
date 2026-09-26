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
const CAPTION_FONT = '600 22px system-ui, sans-serif';
const CAPTION_COLOR = '#f2f6ff';
const CAPTION_BACKGROUND = 'rgba(13, 21, 38, 0.78)';
const CAPTION_MARGIN = 16;
const CAPTION_PADDING_X = 10;
const CAPTION_PADDING_Y = 6;
const CAPTION_TEXT_HEIGHT = 22;
const CAPTION_TEXT_BASELINE = 17;

export interface LandmarkOverlay {
  draw(frame: LandmarkFrame, caption?: string | null): void;
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

export function isMirroredTransform(transform: string): boolean {
  const match = /^matrix\(\s*(-?[\d.eE+]+)/.exec(transform.trim());
  if (!match) return false;
  return Number(match[1]) < 0;
}

export function drawOverlayCaption(
  ctx: CanvasRenderingContext2D,
  frame: LandmarkFrame,
  caption: string,
  mirrored: boolean,
): void {
  ctx.save();
  try {
    if (mirrored) {
      ctx.translate(frame.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.font = CAPTION_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const textWidth = ctx.measureText(caption).width;
    const boxWidth = textWidth + CAPTION_PADDING_X * 2;
    const boxHeight = CAPTION_TEXT_HEIGHT + CAPTION_PADDING_Y * 2;
    const boxX = CAPTION_MARGIN;
    const boxY = frame.height - CAPTION_MARGIN - boxHeight;
    ctx.fillStyle = CAPTION_BACKGROUND;
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.fillStyle = CAPTION_COLOR;
    ctx.fillText(caption, boxX + CAPTION_PADDING_X, boxY + CAPTION_PADDING_Y + CAPTION_TEXT_BASELINE);
  } finally {
    ctx.restore();
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
  let mirrored = false;

  function layout(): void {
    const videoRect = video.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    canvas.style.left = `${videoRect.left - parentRect.left - parent.clientLeft}px`;
    canvas.style.top = `${videoRect.top - parentRect.top - parent.clientTop}px`;
    canvas.style.width = `${videoRect.width}px`;
    canvas.style.height = `${videoRect.height}px`;
    const transform = getComputedStyle(video).transform;
    canvas.style.transform = transform === 'none' ? '' : transform;
    mirrored = transform !== 'none' && isMirroredTransform(transform);
    canvas.style.borderRadius = getComputedStyle(video).borderRadius;
  }

  return {
    draw(frame: LandmarkFrame, caption?: string | null): void {
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      layout();
      if (!ctx) return;
      drawLandmarkFrame(ctx, frame);
      if (caption) drawOverlayCaption(ctx, frame, caption, mirrored);
    },
    destroy(): void {
      canvas.remove();
      if (positionWasAdded) parent.style.position = previousPosition;
    },
  };
}
