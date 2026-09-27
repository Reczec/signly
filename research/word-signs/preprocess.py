"""Decode real public clips and extract raw timestamped landmarks on CPU.

Feature normalization is NOT duplicated here: app/src/recognition/sequence.ts
is used by the Node batch encoder and remains reusable for live webcam frames.
"""
import argparse, json, pathlib, time
import cv2, mediapipe as mp
from data import ROOT, CACHE, read, write, sha, fetch, validate_manifest

POSE_URL='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
REPO=ROOT.parents[1]
HAND=REPO/'app/public/models/hand_landmarker.task'
POSE=CACHE/'models/pose_landmarker_lite.task'

def points(values):
    return [dict(x=p.x,y=p.y,z=p.z,visibility=p.visibility,presence=p.presence) for p in values]

def native_path(path):
    """MediaPipe's native file loader mangles non-ASCII paths on Windows, so the
    8.3 short path (same file, ASCII spelling) is passed to it when available."""
    import ctypes
    if not hasattr(ctypes, 'windll'):
        return str(path)
    buffer=ctypes.create_unicode_buffer(32768)
    length=ctypes.windll.kernel32.GetShortPathNameW(str(path),buffer,32768)
    return buffer.value if 0<length<32768 else str(path)

def extract(clip):
    if mp.__version__ != '0.10.35': raise ValueError('Use the pinned MediaPipe 0.10.35 extractor')
    path=ROOT/clip['path']; output=CACHE/'landmarks'/f"{clip['id']}.json"
    if sha(path)!=clip['sha256']: raise ValueError('Video checksum mismatch: '+clip['id'])
    if output.exists():
        cached=read(output)
        if (cached.get('videoSha256')==clip['sha256'] and cached.get('extractorVersion')=='mp-0.10.35-hands-pose-15hz-v1'
                and cached.get('models')=={'handSha256':sha(HAND),'poseSha256':sha(POSE)}): return cached
    cap=cv2.VideoCapture(str(path)); fps=cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or fps<=0: raise ValueError('Video decode failed: '+clip['id'])
    start=clip.get('decodeStart',clip['start']); end=clip.get('decodeEnd',clip['end']) or clip['duration']
    end=min(end,clip['duration'])
    if end-start>15: raise ValueError('Unexpected long isolated clip: '+clip['id'])
    Base=mp.tasks.BaseOptions; vision=mp.tasks.vision
    hands=vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(base_options=Base(model_asset_path=native_path(HAND),delegate=Base.Delegate.CPU),running_mode=vision.RunningMode.VIDEO,num_hands=2))
    pose=vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(base_options=Base(model_asset_path=native_path(POSE),delegate=Base.Delegate.CPU),running_mode=vision.RunningMode.VIDEO,num_poses=1,output_segmentation_masks=False))
    frames=[]; next_at=start; index=0
    try:
        # Sequential decode avoids inaccurate keyframe seeks in short clips.
        while True:
            ok,frame=cap.read()
            if not ok: break
            seconds=index/fps; index+=1
            if seconds<next_at: continue
            if seconds>=end: break
            next_at=seconds+1/15
            h,w=frame.shape[:2]
            if w>640:
                frame=cv2.resize(frame,(640,round(h*640/w))); h,w=frame.shape[:2]
            stamp=round(seconds*1000)
            image=mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
            hr=hands.detect_for_video(image,stamp); pr=pose.detect_for_video(image,stamp)
            frames.append(dict(timestampMs=stamp,width=w,height=h,
                hands=[dict(handedness=hr.handedness[i][0].category_name,landmarks=points(lm)) for i,lm in enumerate(hr.hand_landmarks)],
                pose=points(pr.pose_landmarks[0]) if pr.pose_landmarks else []))
    finally:
        cap.release(); hands.close(); pose.close()
    if len(frames)<2: raise ValueError('Fewer than two decoded observations: '+clip['id'])
    result={'extractorVersion':'mp-0.10.35-hands-pose-15hz-v1','id':clip['id'],'videoSha256':clip['sha256'],
        'models':{'handSha256':sha(HAND),'poseSha256':sha(POSE)},'frames':frames}
    write(output,result); return result

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--manifest',type=pathlib.Path,default=ROOT/'manifests/poc-v1.json'); p.add_argument('--download-model',action='store_true'); a=p.parse_args()
    if a.download_model and not POSE.exists(): fetch(POSE_URL,POSE)
    if not POSE.exists(): raise SystemExit('Missing local pose model; run with --download-model once.')
    manifest=read(a.manifest); validate_manifest(manifest); started=time.perf_counter(); report=[]
    for i,clip in enumerate(manifest['clips']):
        try:
            raw=extract(clip); report.append({'id':clip['id'],'frames':len(raw['frames']),'ok':True})
        except Exception as error: report.append({'id':clip['id'],'ok':False,'error':str(error)})
        print(f"{i+1}/{len(manifest['clips'])} {clip['id']} {report[-1]}",flush=True)
    write(ROOT/'reports/preprocessing.json',{'seconds':time.perf_counter()-started,'clips':report})
    if any(not x['ok'] for x in report): raise SystemExit('Extraction failures recorded; do not silently omit clips from evaluation.')
