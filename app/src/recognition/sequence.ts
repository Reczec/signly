/** Canonical offline/live feature definition. No image/runtime dependency. */
export const SEQUENCE_VERSION = 'signly-sequence-v1'
export const SEQUENCE_LENGTH = 32
export const SEQUENCE_DIMENSIONS = 162
export interface Point { x: number; y: number; z: number; visibility?: number; presence?: number }
export interface SequenceFrame {
  timestampMs: number
  width: number
  height: number
  hands: { handedness: 'Left' | 'Right'; landmarks: Point[] }[]
  pose: Point[]
}
const BODY = [11, 12, 13, 14, 15, 16, 23, 24]
const finite = (p: Point | undefined): p is Point => !!p && [p.x, p.y, p.z].every(Number.isFinite)
const visible = (p: Point | undefined): p is Point => finite(p) && (p.visibility ?? 1) >= .5 && (p.presence ?? 1) >= .5

export function encodeSequence(frames: readonly SequenceFrame[]) {
  if (!frames.length) throw new Error('Empty sequence')
  let previous: ({ x: number; y: number; at: number } | null)[] = [null, null]
  const encoded: number[][] = []
  const timestamps: number[] = []
  let handFrames = 0, poseFrames = 0
  for (const frame of frames) {
    if (!Number.isFinite(frame.timestampMs) || (timestamps.length && frame.timestampMs <= timestamps.at(-1)!)) throw new Error('Timestamps must increase')
    if (!(frame.width > 0 && frame.height > 0)) throw new Error('Invalid frame dimensions')
    timestamps.push(frame.timestampMs)
    const aspect = frame.height / frame.width
    const xy = (p: Point) => [p.x, p.y * aspect]
    const l = frame.pose[11], r = frame.pose[12]
    const torso = visible(l) && visible(r)
    const center = torso ? [(l.x + r.x) / 2, (l.y + r.y) * aspect / 2] : [0, 0]
    const scale = torso ? Math.hypot(l.x-r.x, (l.y-r.y)*aspect) : 0
    const bodyValid = torso && scale > .02
    if (bodyValid) poseFrames++
    const values: number[] = []
    for (const index of BODY) {
      const p = frame.pose[index]
      values.push(...(bodyValid && visible(p) ? [(p.x-center[0])/scale,(p.y*aspect-center[1])/scale,1] : [0,0,0]))
    }
    const hands = frame.hands.filter(h => h.landmarks.length === 21 && h.landmarks.every(finite)).slice(0,2)
    const cost = (hand: typeof hands[number], slot: number) => {
      const point = xy(hand.landmarks[0]); const prev = previous[slot]
      const prior = (hand.handedness === 'Left' ? 0 : 1) === slot ? 0 : .2
      return prior + (prev && frame.timestampMs-prev.at <= 400 ? Math.hypot(point[0]-prev.x, point[1]-prev.y) : 0)
    }
    const assigned: (typeof hands[number] | undefined)[] = [undefined, undefined]
    if (hands.length === 2) {
      const straight = cost(hands[0],0)+cost(hands[1],1) <= cost(hands[0],1)+cost(hands[1],0)
      assigned[0]=hands[straight?0:1]; assigned[1]=hands[straight?1:0]
    } else if (hands.length === 1) assigned[cost(hands[0],0)<=cost(hands[0],1)?0:1]=hands[0]
    const wrists: (number[] | null)[] = [null, null]
    let anyHand = false
    for (let slot=0;slot<2;slot++) {
      const hand=assigned[slot]
      if (!hand) { values.push(...Array(67).fill(0)); continue }
      const wrist=hand.landmarks[0]; const w=xy(wrist)
      const handScale=[5,9,13,17].reduce((s,i)=>s+Math.hypot(hand.landmarks[i].x-wrist.x,(hand.landmarks[i].y-wrist.y)*aspect),0)/4
      if (handScale <= .0001) { values.push(...Array(67).fill(0)); continue }
      previous[slot]={x:w[0],y:w[1],at:frame.timestampMs}; anyHand=true
      // Hand z is wrist-relative only. Pose z is intentionally not used.
      for (const p of hand.landmarks) values.push((p.x-wrist.x)/handScale,(p.y-wrist.y)*aspect/handScale,(p.z-wrist.z)/handScale)
      wrists[slot]=bodyValid?[(w[0]-center[0])/scale,(w[1]-center[1])/scale]:null
      values.push(...(wrists[slot]??[0,0]),bodyValid?1:0,1)
    }
    if (anyHand) handFrames++
    if (wrists[0] && wrists[1]) {
      const dx=wrists[1][0]-wrists[0][0],dy=wrists[1][1]-wrists[0][1]
      values.push(dx,dy,Math.hypot(dx,dy),1)
    } else values.push(0,0,0,0)
    if (values.length!==SEQUENCE_DIMENSIONS || !values.every(Number.isFinite)) throw new Error('Invalid sequence features')
    encoded.push(values)
  }
  const start=timestamps[0], end=timestamps.at(-1)!
  const sampleTimes=Array.from({length:SEQUENCE_LENGTH},(_,i)=>start+(end-start)*i/(SEQUENCE_LENGTH-1))
  const tensor=sampleTimes.map(t=>{
    let nearest=0
    for(let i=1;i<timestamps.length;i++) if(Math.abs(timestamps[i]-t)<Math.abs(timestamps[nearest]-t)) nearest=i
    // Never interpolate across missing detections or lengthy observation gaps.
    return Math.abs(timestamps[nearest]-t)<=120 ? encoded[nearest] : Array(SEQUENCE_DIMENSIONS).fill(0)
  })
  return { preprocessingVersion:SEQUENCE_VERSION, shape:[SEQUENCE_LENGTH,SEQUENCE_DIMENSIONS], timestampsMs:sampleTimes,
    sourceTimestampsMs:timestamps, tensor, quality:{handFrameFraction:handFrames/frames.length,poseFrameFraction:poseFrames/frames.length} }
}
