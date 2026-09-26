export const PREPROCESSING_VERSION = 'signly-landmark-v1';
export const LANDMARK_COUNT = 21;
export const FEATURE_DIMENSIONS = LANDMARK_COUNT * 3;
export const MIN_SCALE = 0.0001;

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

const WRIST_TO_MCP_INDICES = [5, 9, 13, 17];

function isFinitePoint(point: LandmarkPoint | undefined): boolean {
  return (
    typeof point?.x === 'number' &&
    typeof point?.y === 'number' &&
    typeof point?.z === 'number' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}

export function tryExtractFeatures(
  landmarks: readonly LandmarkPoint[] | undefined,
  width: number,
  height: number,
): number[] | null {
  if (!Array.isArray(landmarks) || landmarks.length !== LANDMARK_COUNT) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const yScale = height / width;
  const converted: number[][] = [];
  for (const landmark of landmarks) {
    if (!isFinitePoint(landmark)) return null;
    converted.push([landmark.x, landmark.y * yScale, landmark.z]);
  }
  const wrist = converted[0];
  let scaleSum = 0;
  for (const index of WRIST_TO_MCP_INDICES) {
    const point = converted[index];
    if (!point) return null;
    scaleSum += Math.hypot(point[0] - wrist[0], point[1] - wrist[1]);
  }
  const scale = scaleSum / WRIST_TO_MCP_INDICES.length;
  if (!(scale > MIN_SCALE)) return null;
  const features: number[] = [];
  for (const point of converted) {
    features.push(
      (point[0] - wrist[0]) / scale,
      (point[1] - wrist[1]) / scale,
      (point[2] - wrist[2]) / scale,
    );
  }
  for (const value of features) {
    if (!Number.isFinite(value)) return null;
  }
  return features;
}
