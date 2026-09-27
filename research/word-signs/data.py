"""Public metadata acquisition, availability comparison and versioned clip manifests.

No cookies, logins or access-control workarounds. Raw videos always stay in cache/.
"""
from __future__ import annotations
import argparse, collections, concurrent.futures, hashlib, io, json, pathlib, random, re, subprocess, sys, urllib.parse, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parent
CACHE = ROOT / 'cache'
META = CACHE / 'metadata'
SOURCES = {
    'msasl': 'https://download.microsoft.com/download/3/c/a/3ca92c78-1c4a-4a91-a7ee-6980c1d242ec/MS-ASL.zip',
    'wlasl': 'https://raw.githubusercontent.com/dxli94/WLASL/master/start_kit/WLASL_v0.3.json',
}
# Public WLASL mirror on Hugging Face (ungated). Bytes are verified against its
# published object index; reachable originals were checked separately in the
# baseline integrity report. It is a distribution channel, never a source
# of new labels or splits. YouTube is never contacted for downloads.
MIRROR_DATASET = 'Voxel51/WLASL'
MIRROR_RESOLVE = f'https://huggingface.co/datasets/{MIRROR_DATASET}/resolve/main/'
MIRROR_TREE = f'https://huggingface.co/api/datasets/{MIRROR_DATASET}/tree/main/data?recursive=true&expand=false'
TREE = META / 'wlasl-mirror-tree.json'
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
# Declared before any model exists. Added because the pre-registered candidates
# alone cannot fill 8-12 classes with real held-out clips: several have no
# reachable validation/test instance. Ordinary everyday ASL glosses, upper body
# and hands visible. Categories remain an informal vocabulary aid.
EXPANSION = {
    'water': ['near-face'], 'name': ['two-hands'], 'good': ['near-face'], 'bad': ['near-face'],
    'love': ['two-hands', 'upper-body'], 'family': ['two-hands'], 'school': ['two-hands'],
    'work': ['two-hands'], 'friend': ['two-hands'], 'time': ['upper-body'], 'again': ['movement'],
    'slow': ['movement'], 'make': ['two-hands'], 'want': ['upper-body', 'movement'],
    'need': ['upper-body', 'movement'], 'know': ['near-face'], 'think': ['near-face'],
    'see': ['near-face'], 'play': ['two-hands'], 'home': ['near-face'], 'day': ['movement'],
    'night': ['near-face'], 'change': ['two-hands', 'movement'], 'get': ['movement'],
    'put': ['movement'], 'walk': ['upper-body', 'movement'], 'sit': ['upper-body', 'movement'],
    'stand': ['upper-body', 'movement'], 'wait': ['upper-body', 'movement'], 'call': ['movement'],
    'feel': ['upper-body'], 'try': ['two-hands'], 'stop': ['movement'], 'come': ['movement'],
    'give': ['two-hands', 'movement'], 'take': ['two-hands', 'movement'], 'hold': ['two-hands'],
    'write': ['two-hands'], 'read': ['two-hands'], 'open': ['two-hands', 'movement'],
    'close': ['two-hands', 'movement'], 'big': ['two-hands'], 'small': ['two-hands'],
    'cold': ['upper-body'], 'new': ['two-hands'], 'old': ['movement'], 'today': ['movement'],
    'tomorrow': ['near-face'], 'morning': ['near-face'], 'doctor': ['upper-body'],
    'nurse': ['upper-body'], 'money': ['two-hands'], 'color': ['two-hands'], 'red': ['near-face'],
    'blue': ['near-face'], 'green': ['near-face'], 'white': ['two-hands'], 'black': ['two-hands'],
}
VOCABULARY = {**CANDIDATES, **EXPANSION}

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

def blob_sha1(data): return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()
def lfs_pointer_blob_sha1(data):
    pointer=('version https://git-lfs.github.com/spec/v1\n'
             f'oid sha256:{hashlib.sha256(data).hexdigest()}\n'
             f'size {len(data)}\n').encode()
    return hashlib.sha1(b'blob %d\0' % len(pointer) + pointer).hexdigest()
def matches_index(data, oid):
    """Accept a download when it matches the published git object id.

    Hugging Face stores larger clips through Git LFS, so the tree lists the
    sha1 of the small pointer blob instead of the file bytes; the pointer text
    is fully determined by the content, so both forms are reconstructed and
    checked here. Nothing is trusted without a matching hash."""
    return blob_sha1(data)==oid or lfs_pointer_blob_sha1(data)==oid

def mirror_index(refresh=False):
    """Path -> {path,size,oid} for every file that actually exists in the mirror.
    The oid is the git object id published by Hugging Face, so a download can be
    verified without trusting the transport."""
    if refresh or not TREE.exists():
        files, url = [], MIRROR_TREE
        while url:
            with request(url) as response: page, link = json.loads(response.read()), response.headers.get('Link','')
            files += [{'path':x['path'],'size':x['size'],'oid':x['oid']} for x in page if x.get('type')=='file']
            match = re.search(r'<([^>]+)>; rel="next"', link or ''); url = match.group(1) if match else None
        write(TREE, {'dataset':MIRROR_DATASET,'treeUrl':MIRROR_TREE,'files':files})
    return {pathlib.PurePosixPath(entry['path']).stem: entry for entry in read(TREE)['files']}

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
    mirror = mirror_index(refresh=True)
    return {name: {'url':url, 'sha256':sha(META / ('MS-ASL.zip' if name == 'msasl' else 'WLASL_v0.3.json'))} for name,url in SOURCES.items()} | {
        'mirror': {'dataset':MIRROR_DATASET,'treeUrl':MIRROR_TREE,'files':len(mirror),'sha256':sha(TREE)}}

def source_key(url):
    if url.startswith('www.'): url = 'https://' + url
    parsed = urllib.parse.urlparse(url)
    if 'youtube.com' in parsed.netloc: return 'youtube:' + urllib.parse.parse_qs(parsed.query).get('v',[''])[0]
    if parsed.netloc == 'youtu.be': return 'youtube:' + parsed.path.strip('/')
    return parsed.netloc.lower() + parsed.path

def records(dataset):
    result = []
    if dataset == 'wlasl':
        index = mirror_index()
        for item in read(META / 'WLASL_v0.3.json'):
            if item['gloss'] not in VOCABULARY: continue
            for clip in item['instances']:
                record = dict(id='wlasl-' + clip['video_id'], label=item['gloss'], split={'val':'validation'}.get(clip['split'],clip['split']),
                    signer=str(clip['signer_id']), url=clip['url'], source=source_key(clip['url']),
                    start=max(0,clip['frame_start']-1)/clip['fps'], end=None if clip['frame_end']==-1 else clip['frame_end']/clip['fps'],
                    frameStart=clip['frame_start'], frameEnd=clip['frame_end'])
                entry = index.get(clip['video_id'])
                if entry: record.update(mirrorPath=entry['path'], mirrorSize=entry['size'], mirrorOid=entry['oid'])
                result.append(record)
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

def probe_direct(clip):
    """Check a single non-YouTube clip without downloading the whole file."""
    try:
        request_obj=urllib.request.Request(clip['url'],headers={'User-Agent':'SignlyResearch/0.1','Range':'bytes=0-4095'})
        with urllib.request.urlopen(request_obj,timeout=20) as response:
            header=response.read(4096)
        media = b'ftyp' in header[:64] or header[:3] in (b'FWS',b'CWS')
        return {**clip,'reachable':media,'detail':f"media header={media}"}
    except Exception as error:
        return {**clip,'reachable':False,'detail':str(error)}

def reachability(dataset='wlasl'):
    """Probe every direct (non-YouTube) candidate clip so vocabulary selection is
    driven by clips we can actually fetch, not by optimistic metadata."""
    clips=[x for x in records(dataset) if not x['source'].startswith('youtube:')]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(probe_direct,clips))
    reachable=[x for x in results if x['reachable']]
    by_label=collections.defaultdict(collections.Counter)
    for x in reachable: by_label[x['label']][x['split']]+=1
    report={'schemaVersion':1,'dataset':dataset,'probed':len(results),'reachable':len(reachable),
        'perLabel':{k:dict(v) for k,v in sorted(by_label.items())},
        'hosts':dict(collections.Counter(urllib.parse.urlparse(x['url']).netloc for x in reachable)),
        'clips':sorted(results,key=lambda x:(x['label'],x['split'],x['id']))}
    write(ROOT/'reports/reachability.json',report)
    print('probed',len(results),'reachable',len(reachable))
    for label,counts in report['perLabel'].items(): print(f"  {label:10s} {counts}")
    return report

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

def download_one(clip, max_seconds=15):
    """Fetch one clip from the mirror when possible, otherwise from its original
    non-YouTube URL. Mirror bytes are checked against the published git object id
    before they are accepted; direct downloads must be complete."""
    target=CACHE/'videos'/f"{clip['id']}.mp4"
    try:
        data=None
        if clip.get('mirrorPath') and target.exists():
            cached=target.read_bytes()
            if len(cached)==clip['mirrorSize'] and matches_index(cached,clip['mirrorOid']):
                data=cached; origin='mirror:'+MIRROR_DATASET; verifiedBy='huggingface-git-oid-cached'
        if data is None:
            if clip.get('mirrorPath'):
                origin='mirror:'+MIRROR_DATASET
                data=request_bytes(MIRROR_RESOLVE+clip['mirrorPath'])
                if len(data)!=clip['mirrorSize']: raise ValueError(f"size {len(data)} != published {clip['mirrorSize']}")
                if not matches_index(data,clip['mirrorOid']): raise ValueError('content hash mismatch against published index')
                verifiedBy='huggingface-git-oid'
            elif clip['source'].startswith('youtube:'):
                raise ValueError('no non-YouTube source; YouTube downloads are not attempted')
            else:
                origin='direct:'+urllib.parse.urlparse(clip['url']).netloc
                with request(clip['url']) as response:
                    expected=response.headers.get('Content-Length'); data=response.read()
                if expected and len(data)!=int(expected): raise ValueError(f"truncated download {len(data)} of {expected}")
                verifiedBy='content-length'
            target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
        import cv2
        cap=cv2.VideoCapture(str(target)); ok,frame=cap.read()
        fps=cap.get(cv2.CAP_PROP_FPS); count=cap.get(cv2.CAP_PROP_FRAME_COUNT); cap.release()
        if not ok or fps<=0 or count<=0: raise ValueError('not a decodable video')
        duration=count/fps
        start=0.0 if clip['frameStart']==1 else clip['start']
        end=clip['end'] if clip['end'] is not None else duration
        if start>=duration: raise ValueError('annotation starts after video end')
        if end-start>max_seconds: raise ValueError(f'annotation window {end-start:.1f}s exceeds {max_seconds}s')
        return {**clip,'path':str(target.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(data).hexdigest(),'duration':duration,
            'decodeStart':start,'decodeEnd':min(end,duration),'available':True,'origin':origin,'verifiedBy':verifiedBy}
    except Exception as error: return {**clip,'available':False,'detail':str(error)}

def request_bytes(url):
    with request(url) as response: return response.read()

def validate_manifest(manifest):
    if manifest.get('schemaVersion')!=1: raise ValueError('unsupported manifest schema')
    seen={}; sources={}; signers={}; hashes={}
    for clip in manifest['clips']:
        if clip['id'] in seen: raise ValueError('duplicate clip id')
        seen[clip['id']]=clip
        if clip['split'] not in ('train','validation','test'): raise ValueError('invalid split')
        if any(not isinstance(clip.get(k),str) or not clip[k].strip() for k in ('id','label','signer','source','sha256')):
            raise ValueError('missing clip provenance')
        if not re.fullmatch('[a-f0-9]{64}',clip['sha256']): raise ValueError('invalid content hash')
        if clip['sha256'] in hashes: raise ValueError('duplicate content hash')
        for groups,key in [(sources,clip['source']),(signers,clip['signer']),(hashes,clip['sha256'])]:
            if key in groups and groups[key]!=clip['split']: raise ValueError('split leakage: '+key)
            groups[key]=clip['split']

SPLITS=('test','validation','train')   # held-out splits claim a signer first
TRAIN_MIN, VAL_MIN, TEST_MIN, TRAIN_CAP, VAL_CAP, TEST_CAP, MAX_LABELS = 4, 1, 1, 12, 3, 3, 12
PER_SIGNER_CAP = 3   # within one label/split, never take more than this from a signer

def pool_clips(clips):
    """Clips we can actually obtain: present in the mirror or probed reachable
    over a non-YouTube URL, with an annotation that covers the whole file.
    Full-file annotations avoid any ambiguity between the annotated fps and the
    encoded file's fps when deciding which frames to decode."""
    report_path=ROOT/'reports/reachability.json'
    probed={c['id']:c['reachable'] for c in read(report_path)['clips']} if report_path.exists() else None
    usable=[]
    for clip in clips:
        if clip['frameStart']!=1 or clip['frameEnd']!=-1: continue
        if clip.get('mirrorPath'): usable.append(clip); continue
        if clip['source'].startswith('youtube:'): continue
        if probed is None or probed.get(clip['id']): usable.append(clip)
    return usable

def label_order(pool):
    """Pre-registered words first, then declared expansions ranked by how much
    real held-out data they actually have. No model outcome is involved."""
    present={clip['label'] for clip in pool}
    def score(label):
        counts=collections.Counter(c['split'] for c in pool if c['label']==label)
        return (-(counts['validation']+counts['test']), -counts['train'], label)
    return [g for g in CANDIDATES if g in present] + sorted((g for g in EXPANSION if g in present), key=score)

_ASSIGN_CACHE = {}

def assign_signers(pool, order, minimums, seed=20260926, climbs=128, perturbations=128):
    """Assign every signer to exactly one split.

    A clip is usable only when its signer sits in that clip's own split, so the
    question is a global one: which split does each of the ~55 signers belong to.
    Seeded random restarts, then iterated local search from the best assignment.
    Objective order: pre-registered words covered, then declared expansions,
    then usable clips."""
    key=(tuple(sorted(minimums.items())),tuple(sorted(c['id'] for c in pool)))
    if key in _ASSIGN_CACHE: return _ASSIGN_CACHE[key]
    signers=sorted({c['signer'] for c in pool})
    contrib={s:{k:collections.Counter() for k in SPLITS} for s in signers}
    for clip in pool: contrib[clip['signer']][clip['split']][clip['label']]+=1
    pre_registered=set(CANDIDATES)
    def evaluate(assign):
        counts={k:collections.Counter() for k in SPLITS}
        for s in signers: counts[assign[s]].update(contrib[s][assign[s]])
        ok=[label for label in order if all(counts[k][label]>=minimums[k] for k in SPLITS)]
        clips=sum(min(counts['train'][l],TRAIN_CAP)+min(counts['validation'][l],VAL_CAP)+min(counts['test'][l],TEST_CAP) for l in ok)
        return (sum(1 for l in ok if l in pre_registered), sum(1 for l in ok if l not in pre_registered), clips), counts, ok
    def improve(assign):
        score,_,_=evaluate(assign)
        changed=True
        while changed:
            changed=False
            for s in signers:
                for k in SPLITS:
                    if k==assign[s]: continue
                    alternative=dict(assign); alternative[s]=k
                    candidate,_,_=evaluate(alternative)
                    if candidate>score: assign, score = alternative, candidate; changed=True; break
                if changed: break
        return assign, score
    rng=random.Random(seed)
    best=None
    starts=[{s:'train' for s in signers},{s:'test' for s in signers},{s:'validation' for s in signers}]
    starts+=[{s:rng.choice(SPLITS) for s in signers} for _ in range(climbs)]
    for start in starts:
        improved,score=improve(start)
        if best is None or score>best[1]: best=(improved,score)
    for _ in range(perturbations):
        start=dict(best[0])
        for _ in range(rng.randint(2,6)): start[rng.choice(signers)]=rng.choice(SPLITS)
        improved,score=improve(start)
        if score>best[1]: best=(improved,score)
    assign,score=best
    _,counts,ok=evaluate(assign)
    result=(assign,counts,ok,score)
    _ASSIGN_CACHE[key]=result
    return result

def choose(pool, order, blocked=frozenset(), minimums=None, caps=None):
    """Signer/source-disjoint selection that never moves a clip away from its
    official WLASL split. The signer->split assignment is solved globally first;
    clips are then materialised for the words that reach the minimums."""
    minimums=minimums or {'test':TEST_MIN,'validation':VAL_MIN,'train':TRAIN_MIN}
    caps=caps or {'test':TEST_CAP,'validation':VAL_CAP,'train':TRAIN_CAP}
    remaining=[c for c in pool if c['id'] not in blocked]
    assign,_,ok,score=assign_signers(remaining,order,minimums)
    accepted={}; kept=[]; used_sources={}
    for label in [g for g in order if g in set(ok)][:MAX_LABELS]:
        taken=[]; per_signer=collections.defaultdict(collections.Counter)
        for split in SPLITS:
            group=[c for c in remaining if c['label']==label and c['split']==split and assign.get(c['signer'])==split]
            group=sorted(group,key=lambda c:(per_signer[split][c['signer']]>=PER_SIGNER_CAP,c['id']))
            for clip in group:
                if len([c for c in taken if c['split']==split])>=caps[split]: break
                if clip['source'] in used_sources and used_sources[clip['source']]!=split: continue
                if per_signer[split][clip['signer']]>=PER_SIGNER_CAP: continue
                taken.append(clip); per_signer[split][clip['signer']]+=1
        counts=collections.Counter(c['split'] for c in taken)
        if all(counts[split]>=minimums[split] for split in SPLITS):
            accepted[label]=counts; kept+=taken
            for clip in taken: used_sources[clip['source']]=clip['split']
    return kept, accepted

def select_wlasl():
    pool=pool_clips(records('wlasl'))
    order=label_order(pool)
    blocked=set(); attempts={}
    for round_number in range(1,6):
        chosen, counts = choose(pool, order, blocked)
        labels=[g for g in order if g in counts][:MAX_LABELS]
        chosen=[c for c in chosen if c['label'] in set(labels)]
        print(f'round {round_number}: {len(labels)} labels, {len(chosen)} clips to fetch',flush=True)
        if not chosen: break
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool_executor:
            for result in pool_executor.map(download_one,chosen): attempts[result['id']]=result
        failed={cid for cid,r in attempts.items() if not r['available']}
        # Identical bytes in two splits would leak across the evaluation boundary.
        by_hash=collections.defaultdict(list)
        for cid,r in attempts.items():
            if r['available'] and cid not in failed: by_hash[r['sha256']].append(r)
        priority={'test':0,'validation':1,'train':2}; duplicates=set()
        for group in by_hash.values():
            if len(group)<2 or len({c['split'] for c in group})<2: continue
            for clip in sorted(group,key=lambda c:priority[c['split']])[1:]: duplicates.add(clip['id'])
        retry=(failed|duplicates)-blocked
        print(f'  {len(failed)} unavailable, {len(duplicates)} duplicate-hash clips',flush=True)
        if not retry: break
        blocked|=retry
    write(ROOT/'reports/downloads.json',list(attempts.values()))
    chosen, counts = choose(pool, order, blocked)
    labels=[g for g in order if g in counts][:MAX_LABELS]
    label_set=set(labels)
    wanted={c['id'] for c in chosen if c['label'] in label_set}
    kept=[attempts[cid] for cid in wanted if cid in attempts and attempts[cid]['available']]
    final_counts={label:{split:sum(1 for c in kept if c['label']==label and c['split']==split) for split in SPLITS} for label in labels}
    manifest={'schemaVersion':1,'dataset':'wlasl',
        'sources':{'wlasl':SOURCES['wlasl'],'mirror':{'dataset':MIRROR_DATASET,'treeUrl':MIRROR_TREE,'resolve':MIRROR_RESOLVE}},
        'metadataSha256':sha(META/'WLASL_v0.3.json'),'mirrorIndexSha256':sha(TREE),
        'license':'C-UDA; see original dataset terms; raw media is not redistributed',
        'preprocessingVersion':'signly-sequence-v1',
        'vocabulary':[{'label':label,'categories':(CANDIDATES if label in CANDIDATES else EXPANSION)[label],
                       'origin':'pre-registered' if label in CANDIDATES else 'declared-expansion'} for label in labels],
        'splitPolicy':'Official WLASL split assignments only; signers and source videos never cross splits; test > validation > train',
        'counts':final_counts,'clips':kept}
    validate_manifest(manifest)
    write(ROOT/'reports/selection.json',{'pool':len(pool),'declaredOrder':order,'blocked':sorted(blocked),
        'reachedMinimums':sorted(counts),'selectedLabels':labels,'counts':final_counts,
        'origins':dict(collections.Counter(r.get('origin','') for r in kept)),
        'verifiedBy':dict(collections.Counter(r.get('verifiedBy','') for r in kept))})
    write(ROOT/'manifests/poc-v1.json',manifest)
    for split in SPLITS: write(ROOT/f'manifests/{split}-v1.json',{**manifest,'clips':[c for c in kept if c['split']==split]})
    print(json.dumps(final_counts,indent=2)); print('Selected:',labels)
    if len(labels)<8:
        raise SystemExit('Fewer than 8 classes meet minimum real-data coverage. Do not manufacture clips or report success.')
    return manifest


def looks_like_video(data):
    if len(data)>12 and data[4:8]==b'ftyp': return True
    try:
        import cv2, tempfile, os
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp: tmp.write(data); path=tmp.name
        try:
            capture=cv2.VideoCapture(path); ok,_=capture.read(); capture.release(); return bool(ok)
        finally: os.unlink(path)
    except Exception: return False

def verify(manifest_path=None):
    """Two independent checks on every selected clip.

    1. Local bytes are re-hashed against the mirror's published git object id.
    2. The clip is cross-downloaded from its original non-YouTube URL: a byte
    match is recorded as a match, a host that no longer serves the video (dead
    host, HTML page) is reported as unreachable/invalid-original, and only a
    reachable host serving a different real video is a hard failure."""
    manifest=read(manifest_path or ROOT/'manifests/poc-v1.json'); report=[]
    for clip in manifest['clips']:
        entry={'id':clip['id'],'label':clip['label'],'split':clip['split'],'url':clip['url']}
        if clip.get('mirrorPath'):
            data=(ROOT/clip['path']).read_bytes()
            if len(data)!=clip['mirrorSize'] or not matches_index(data,clip['mirrorOid']):
                report.append({**entry,'result':'mirror-oid-mismatch','detail':'local bytes do not match the published index'}); continue
            entry['mirror']='oid-verified'
        if clip['source'].startswith('youtube:'):
            report.append({**entry,'result':'no-direct-original','detail':'original URL is YouTube; local copy verified against mirror index'}); continue
        try:
            with request(clip['url']) as response:
                expected=response.headers.get('Content-Length'); data=response.read()
            if expected and len(data)!=int(expected): raise ValueError('truncated direct download')
            if not looks_like_video(data):
                report.append({**entry,'result':'invalid-original','detail':'host no longer serves a video at this URL'}); continue
            remote=hashlib.sha256(data).hexdigest()
            report.append({**entry,'result':'match' if remote==clip['sha256'] else 'mismatch',
                'remoteSha256':remote,'localSha256':clip['sha256']})
        except Exception as error:
            report.append({**entry,'result':'unreachable','detail':str(error)})
    summary=dict(collections.Counter(r['result'] for r in report))
    write(ROOT/'reports/integrity.json',{'summary':summary,'clips':report})
    print(json.dumps(summary,indent=2))
    if summary.get('mismatch') or summary.get('mirror-oid-mismatch'):
        raise SystemExit('Local copy or original host disagrees with the verified bytes. Stop and investigate.')
    return summary

def select(dataset, include_youtube=False):
    if dataset=='wlasl': return select_wlasl()
    clips=records(dataset)
    if not include_youtube: clips=[x for x in clips if not x['source'].startswith('youtube:') and x['url'].lower().endswith('.mp4')]
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
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool_executor:
        downloaded=[item for group in pool_executor.map(bucket,[(label,split) for label in targets for split in priority]) for item in group]
    write(ROOT/'reports/downloads.json',downloaded)
    usable=[x for x in downloaded if x['available']]
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
    p=argparse.ArgumentParser(); p.add_argument('command',choices=['metadata','compare','reachability','select','verify']); p.add_argument('--dataset',choices=list(SOURCES),default='wlasl'); p.add_argument('--include-youtube',action='store_true'); a=p.parse_args()
    if a.command=='metadata': print(metadata())
    elif a.command=='compare': compare()
    elif a.command=='reachability': reachability(a.dataset)
    elif a.command=='verify': verify()
    else: select(a.dataset,a.include_youtube)
