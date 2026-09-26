import type { LandmarkFrame } from '../contracts/recognition'

/**
 * Integration slot for Laptop A's hand-landmark renderer.
 * The UI only reserves a mirrored overlay layer inside the camera stage and
 * forwards frames; drawing, MediaPipe and coordinates stay in the pipeline.
 */
type LandmarkRenderer = (frame: LandmarkFrame, layer: HTMLElement | null) => void

let renderer: LandmarkRenderer | null = null
let layer: HTMLElement | null = null

/** Register (or with null unregister) the renderer that draws hand landmarks. */
export function registerLandmarkRenderer(next: LandmarkRenderer | null): () => void {
  renderer = next
  return () => {
    if (renderer === next) renderer = null
  }
}

/** Callback ref for the overlay element inside the camera stage. */
export function attachLandmarkLayer(element: HTMLElement | null): void {
  layer = element
}

/** Forwarded as the engine's optional onLandmarks callback. */
export function dispatchLandmarkFrame(frame: LandmarkFrame): void {
  renderer?.(frame, layer)
}
