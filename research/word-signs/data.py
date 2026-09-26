"""Public metadata acquisition, availability comparison and versioned clip manifests.

No cookies, logins or access-control workarounds. Raw videos always stay in cache/.
"""
from __future__ import annotations
import argparse, collections, concurrent.futures, hashlib, io, json, pathlib, subprocess, sys, urllib.parse, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parent
CACHE = ROOT / 'cache'
META = CACHE / 'metadata'
SOURCES = {
    'msasl': 'https://download.microsoft.com/download/3/c/a/3ca92c78-1c4a-4a91-a7ee-6980c1d242ec/MS-ASL.zip',
    'wlasl': 'https://raw.githubusercontent.com/dxli94/WLASL/master/start_kit/WLASL_v0.3.json',
}
# Candidate taxonomy is a selection aid, not an assertion that landmark-only
# recognition has been validated. Labels come from the actual public metadata.
CANDIDATES = {
    'book': ['two-hands', 'movement'], 'drink': ['movement', 'near-face'],
    'help': ['two-hands', 'movement'], 'yes': ['movement'], 'no': ['movement'],
    'mother': ['static-ish', 'near-face'], 'father': ['static-ish', 'near-face'],
    'happy': ['upper-body', 'movement'], 'please': ['upper-body', 'movement'],
    'thank you': ['near-face', 'movement'], 'hello': ['near-face', 'movement'],
    'sad': ['two-hands', 'upper-body'], 'sorry': ['upper-body', 'movement'],
    'eat': ['near-face', 'static-ish'],
}

def read(path): return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
def write(path, value):
    path = pathlib.Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
def sha(path): return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'SignlyResearch/0.1'}), timeout=20)
def fetch(url, path):
    path = pathlib.Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with request(url) as response, path.open('wb') as output:
        while block := response.read(1024 * 1024): output.write(block)

def metadata():
    META.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        target = META / ('MS-ASL.zip' if name == 'msasl' else 'WLASL_v0.3.json')
        if not target.exists(): fetch(url, target)
    with zipfile.ZipFile(META / 'MS-ASL.zip') as archive:
        for name in archive.namelist():
            if pathlib.PurePosixPath(name).name in {'MSASL_train.json', 'MSASL_val.json', 'MSASL_test.json', 'MSASL_classes.json', 'README.md', 'C-UDA-0.1_annotated_discussion.pdf'}:
                dest = META / 'msasl' / 'MS-ASL' / pathlib.PurePosixPath(name).name
                dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(archive.read(name))
    return {name: {'url':url, 'sha256':sha(META / ('MS-ASL.zip' if name == 'msasl' else 'WLASL_v0.3.json'))} for name,url in SOURCES.items()}

def source_key(url):
    if url.startswith('www.'): url = 'https://' + url
    parsed = urllib.parse.urlparse(url)
    if 'youtube.com' in parsed.netloc: return 'youtube:' + urllib.parse.parse_qs(parsed.query).get('v',[''])[0]
    if parsed.netloc == 'youtu.be': return 'youtube:' + parsed.path.strip('/')
    return parsed.netloc.lower() + parsed.path

def records(dataset):
    result = []
    if dataset == 'wlasl':
        for item in read(META / 'WLASL_v0.3.json'):
            if item['gloss'] not in CANDIDATES: continue
            for clip in item['instances']:
                result.append(dict(id='wlasl-' + clip['video_id'], label=item['gloss'], split={'val':'validation'}.get(clip['split'],clip['split']),
                    signer=str(clip['signer_id']), url=clip['url'], source=source_key(clip['url']),
                    start=max(0,clip['frame_start']-1)/clip['fps'], end=None if clip['frame_end']==-1 else clip['frame_end']/clip['fps']))
    else:
        for split,file in [('train','train'),('validation','val'),('test','test')]:
            for i,clip in enumerate(read(META/'msasl/MS-ASL'/f'MSASL_{file}.json')):
                if clip['text'] not in CANDIDATES: continue
                url = 'https://' + clip['url'] if clip['url'].startswith('www.') else clip['url']
                result.append(dict(id=f'msasl-{split}-{i}',label=clip['text'],split=split, signer=str(clip['signer_id']),
                    url=url,source=source_key(url),start=clip['start_time'],end=clip['end_time']))
    return result

def probe(clip):
    try:
        if clip['source'].startswith('youtube:'):
            proc=subprocess.run([sys.executable,'-m','yt_dlp','--skip-download','--dump-json','--no-playlist','--socket-timeout','12','--retries','0',clip['url']],capture_output=True,text=True,timeout=45)
            ok=proc.returncode==0
            detail='extractable' if ok else proc.stderr[-600:]
        else:
            with request(clip['url']) as response:
                header=response.read(1024)
                ok = b'ftyp' in header[:100] or header[:3] in (b'FWS',b'CWS')
                detail=f"HTTP {response.status}; {response.headers.get('Content-Type')}; media header={ok}"
        return {**clip,'available':ok,'detail':detail}
    except Exception as error: return {**clip,'available':False,'detail':str(error)}

def compare():
    report={'schemaVersion':1,'sources':metadata(),'datasets':{}}
    for dataset in SOURCES:
        clips=records(dataset)
        # Deterministic per-host sample, spanning official splits where possible.
        chosen={}
        for clip in clips:
            key=(urllib.parse.urlparse(clip['url']).netloc,clip['split'])
            if key not in chosen: chosen[key]=clip
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: probes=list(pool.map(probe,chosen.values()))
        report['datasets'][dataset]={'candidateClips':len(clips),'hosts':dict(collections.Counter(urllib.parse.urlparse(x['url']).netloc for x in clips)), 'probes':probes,'availableProbes':sum(x['available'] for x in probes)}
        print(dataset,len(probes),'probes,',sum(x['available'] for x in probes),'available',flush=True)
    write(ROOT/'reports/availability.json',report)

def download_one(clip):
    target=CACHE/'videos'/f"{clip['id']}.mp4"
    try:
        if not target.exists():
            if clip['source'].startswith('youtube:'):
                import imageio_ffmpeg
                target.parent.mkdir(parents=True,exist_ok=True)
                section = ['--download-sections',f"*{clip['start']}-{clip['end']}"] if clip['end'] else []
                proc=subprocess.run([sys.executable,'-m','yt_dlp','--no-playlist','--socket-timeout','15','--retries','0','--max-filesize','60M','--ffmpeg-location',imageio_ffmpeg.get_ffmpeg_exe(),'-f','best[ext=mp4][height<=480]/best[ext=mp4]',*section,'-o',str(target),clip['url']],capture_output=True,text=True,timeout=100)
                if proc.returncode: raise RuntimeError(proc.stderr[-500:])
            else: fetch(clip['url'],target)
        import cv2
        cap=cv2.VideoCapture(str(target)); ok,frame=cap.read()
        fps=cap.get(cv2.CAP_PROP_FPS); count=cap.get(cv2.CAP_PROP_FRAME_COUNT); cap.release()
        if not ok or fps<=0: raise ValueError('not a decodable video')
        trimmed=clip['source'].startswith('youtube:') and clip['end'] is not None
        if not trimmed and clip['start'] >= count/fps: raise ValueError('annotation starts after video end')
        return {**clip,'path':str(target.relative_to(ROOT)).replace('\\','/'),'sha256':sha(target),'duration':count/fps,'decodeStart':0 if trimmed else clip['start'],'decodeEnd':count/fps if trimmed else clip['end'],'available':True}
    except Exception as error: return {**clip,'available':False,'detail':str(error)}

def validate_manifest(manifest):
    if manifest.get('schemaVersion')!=1: raise ValueError('unsupported manifest schema')
    seen={}; sources={}; signers={}; hashes={}
    for clip in manifest['clips']:
        if clip['id'] in seen: raise ValueError('duplicate clip id')
        seen[clip['id']]=clip
        if clip['split'] not in ('train','validation','test'): raise ValueError('invalid split')
        for groups,key in [(sources,clip['source']),(signers,clip['signer']),(hashes,clip['sha256'])]:
            if key in groups and groups[key]!=clip['split']: raise ValueError('split leakage: '+key)
            groups[key]=clip['split']

def select(dataset, include_youtube=False):
    clips=records(dataset)
    if not include_youtube: clips=[x for x in clips if not x['source'].startswith('youtube:') and x['url'].lower().endswith('.mp4')]
    if dataset=='msasl':
        # Fixed representative vocabulary before looking at any model outcomes.
        targets=list(CANDIDATES)[:10]
        clips=[x for x in clips if x['label'] in targets]
        priority={'test':0,'validation':1,'train':2}; owners={}; clean=[]
        for clip in sorted(clips,key=lambda x:(priority[x['split']],x['id'])):
            keys=['signer:'+clip['signer'],'source:'+clip['source']]
            if any(key in owners and owners[key]!=clip['split'] for key in keys): continue
            for key in keys: owners[key]=clip['split']
            clean.append(clip)
        def bucket(pair):
            label,split=pair; goal=12 if split=='train' else 4; results=[]; successes=0
            candidates=sorted([x for x in clean if x['label']==label and x['split']==split],key=lambda x:(x['end']-x['start'],x['id']))
            for clip in candidates:
                result=download_one(clip); results.append(result); successes+=int(result['available'])
                if successes>=goal: break
            print(label,split,successes,'usable of',len(results),'attempts',flush=True)
            return results
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            downloaded=[item for group in pool.map(bucket,[(label,split) for label in targets for split in priority]) for item in group]
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            downloaded=list(pool.map(download_one,clips))
    write(ROOT/'reports/downloads.json',downloaded)
    usable=[x for x in downloaded if x['available']]
    # Honor official assignments. Keep evaluation signers/sources out of training;
    # never move clips to a more convenient split. Test has precedence over val.
    priority={'test':0,'validation':1,'train':2}
    owners={}; selected=[]; excluded=[]
    for clip in sorted(usable,key=lambda x:(priority[x['split']],x['id'])):
        keys=['signer:'+clip['signer'],'source:'+clip['source'],'sha:'+clip['sha256']]
        if any(key in owners and owners[key]!=clip['split'] for key in keys):
            excluded.append({'id':clip['id'],'reason':'signer/source/hash appears in earlier held-out split'}); continue
        for key in keys: owners[key]=clip['split']
        selected.append(clip)
    counts={label:{split:sum(x['label']==label and x['split']==split for x in selected) for split in priority} for label in CANDIDATES}
    labels=[label for label in CANDIDATES if counts[label]['train']>=2 and counts[label]['validation']>=1 and counts[label]['test']>=1][:10]
    manifest={'schemaVersion':1,'dataset':dataset,'sources':{dataset:SOURCES[dataset]},'metadataSha256':sha(META/('WLASL_v0.3.json' if dataset=='wlasl' else 'MS-ASL.zip')),
        'license':'C-UDA; see original dataset terms; raw media is not redistributed',
        'preprocessingVersion':'signly-sequence-v1','vocabulary':[{'label':label,'categories':CANDIDATES[label]} for label in labels],
        'splitPolicy':'Official split assignments, with conflicting signers/source videos/hashes excluded; test > validation > train',
        'counts':{label:counts[label] for label in labels},'clips':[x for x in selected if x['label'] in labels]}
    validate_manifest(manifest)
    write(ROOT/'reports/selection.json',{'allCounts':counts,'excluded':excluded,'selectedLabels':labels})
    write(ROOT/'manifests/poc-v1.json',manifest)
    for split in priority: write(ROOT/f'manifests/{split}-v1.json',{**manifest,'clips':[x for x in manifest['clips'] if x['split']==split]})
    print(json.dumps(counts,indent=2)); print('Selected:',labels)
    if len(labels)<8: raise SystemExit('Fewer than 8 classes meet minimum real-data coverage. Do not manufacture clips or report success.')

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('command',choices=['metadata','compare','select']); p.add_argument('--dataset',choices=list(SOURCES),default='wlasl'); p.add_argument('--include-youtube',action='store_true'); a=p.parse_args()
    if a.command=='metadata': print(metadata())
    elif a.command=='compare': compare()
    else: select(a.dataset,a.include_youtube)
