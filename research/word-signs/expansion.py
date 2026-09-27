"""Auditable expansion experiment. No test tensors are read by `experiment`.

Official splits and all baseline signer/source owners are immutable. New owners
are assigned test > validation > train using metadata only, before training.
No files under app/public are changed by this script.
"""
import argparse
import collections
import concurrent.futures
import pathlib
import shutil
import os

import data
from data import ROOT, CACHE, META, read, write, sha, validate_manifest

BASE = ROOT / 'manifests/poc-v1.json'
MANIFEST = ROOT / 'manifests/expansion-v2.json'
ART = ROOT / 'artifacts/expansion'
REPORT = ROOT / 'reports/expansion'
MIRROR_REVISION = '3cf8daaac08088798f539d62fa511028bf5e6fd0'
PRIORITY = {'test': 0, 'validation': 1, 'train': 2}


def owners_for(clips, baseline):
    owners = {key: {c[key]: c['split'] for c in baseline} for key in ('signer', 'source')}
    for c in sorted(clips, key=lambda c: (PRIORITY[c['split']], c['id'])):
        for key in owners:
            owners[key].setdefault(c[key], c['split'])
    return owners


def counts_for(clips, labels):
    return {label: {split: sum(c['label'] == label and c['split'] == split for c in clips)
                    for split in ('train', 'validation', 'test')} for label in labels}


def prepare():
    if (REPORT / 'frozen.json').exists():
        raise ValueError('Experiment frozen; use a new version for further data selection.')
    baseline = read(BASE)
    # Preserve exact baseline bytes for rollback and the paired validation comparison.
    ART.mkdir(parents=True, exist_ok=True)
    for suffix in ('onnx', 'labels.json'):
        source = ROOT.parents[1] / f'app/public/models/word-classifier-v1.{suffix}'
        dest = ART / f'baseline.{suffix}'
        if not dest.exists(): shutil.copyfile(source, dest)
    metadata = read(META / 'WLASL_v0.3.json')
    data.VOCABULARY.update({entry['gloss']: [] for entry in metadata[:200]})
    all_clips = data.records('wlasl')
    pool = data.pool_clips(all_clips)
    owners = owners_for(pool, baseline['clips'])
    clean = [c for c in pool if all(owners[k][c[k]] == c['split'] for k in owners)]
    base_labels = [v['label'] for v in baseline['vocabulary']]
    counts = counts_for(clean, data.VOCABULARY)
    eligible = [label for label, cc in counts.items()
                if cc['train'] >= 4 and cc['validation'] >= 1 and cc['test'] >= 1]
    additions = sorted(set(eligible) - set(base_labels),
                       key=lambda l: (l != 'white', -counts[l]['validation'], -counts[l]['train'], l))
    labels = base_labels + additions
    wanted = {c['id']: c for c in baseline['clips']}
    # More real clips where available; baseline validation/test membership is frozen.
    for c in clean:
        if c['label'] in labels and (c['label'] not in base_labels or c['split'] == 'train'):
            wanted.setdefault(c['id'], c)
    # Untargeted validation signs are rejection examples, never an UNKNOWN class.
    negatives = [c for c in clean if c['label'] not in labels and c['split'] == 'validation']
    for c in negatives: wanted[c['id']] = c
    data.MIRROR_RESOLVE = f'https://huggingface.co/datasets/{data.MIRROR_DATASET}/resolve/{MIRROR_REVISION}/'
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        downloaded = list(executor.map(data.download_one, wanted.values()))
    hashes = {}; kept = []; excluded = []
    baseline_ids = {c['id'] for c in baseline['clips']}
    for c in sorted(downloaded, key=lambda c: (c['id'] not in baseline_ids, PRIORITY[c['split']], c['id'])):
        if not c['available']:
            excluded.append({'id': c['id'], 'reason': c.get('detail')}); continue
        if c['sha256'] in hashes:
            excluded.append({'id': c['id'], 'reason': 'duplicate bytes', 'duplicateOf': hashes[c['sha256']]}); continue
        hashes[c['sha256']] = c['id']; kept.append(c)
    if not baseline_ids.issubset({c['id'] for c in kept}):
        raise ValueError('Baseline changed or unavailable; refusing to proceed')
    final_counts = counts_for(kept, labels)
    labels = [l for l in labels if all(final_counts[l][s] >= n for s, n in [('train',4),('validation',1),('test',1)])]
    target = [c for c in kept if c['label'] in labels]
    negative = [c for c in kept if c['label'] not in labels and c['split'] == 'validation']
    manifest = {**baseline, 'vocabulary': [{'label': l} for l in labels], 'clips': target,
                'counts': counts_for(target, labels), 'baselineSha256': sha(BASE),
                'mirrorRevision': MIRROR_REVISION,
                'splitPolicy': 'Official splits; baseline signer/source ownership frozen; new owners test > validation > train; all duplicate bytes excluded.'}
    validate_manifest({**manifest, 'clips': target + negative})
    write(MANIFEST, manifest)
    write(ROOT / 'manifests/rejection-validation-v2.json', {**manifest, 'clips': negative,
          'vocabulary': [{'label': l} for l in sorted({c['label'] for c in negative})]})
    write(REPORT / 'availability.json', {'candidatePolicy': 'Declared candidates plus first 200 official WLASL glosses; metadata only',
          'officialCandidates': len(all_clips), 'obtainableFullFileAnnotations': len(pool), 'splitCompatible': len(clean),
          'perClass': counts, 'selectedLabels': labels, 'usableCounts': manifest['counts'],
          'excluded': excluded, 'negativeValidationClips': len(negative), 'owners': owners,
          'metadataSha256': sha(META / 'WLASL_v0.3.json'), 'indexSha256': sha(data.TREE),
          'promotionRule': 'Overall validation accuracy >= baseline; baseline validation correct >= baseline; macro F1 >= baseline - 0.02. Largest passing stage. No test outcomes.'})
    print({'labels': labels, 'clips': len(target), 'negativeValidation': len(negative), 'excluded': excluded}, flush=True)


def extract():
    from preprocess import extract as extract_clip
    import subprocess
    manifests = [MANIFEST, ROOT / 'manifests/rejection-validation-v2.json']
    report = []
    for path in manifests:
        for c in read(path)['clips']:
            raw = extract_clip(c)
            frames = raw['frames']
            hand_counts = [len(f['hands']) for f in frames]
            # Measured visibility/motion proxies, not expert labels for sign requirements.
            movement = []
            for a, b in zip(frames, frames[1:]):
                for handed in ('Left', 'Right'):
                    ha = next((h for h in a['hands'] if h['handedness'] == handed), None)
                    hb = next((h for h in b['hands'] if h['handedness'] == handed), None)
                    if ha and hb:
                        p, q = ha['landmarks'][0], hb['landmarks'][0]
                        movement.append(((p['x']-q['x'])**2+(p['y']-q['y'])**2)**.5)
            report.append({'id': c['id'], 'label': c['label'], 'split': c['split'], 'frames': len(frames),
                'handFrameFraction': sum(n > 0 for n in hand_counts)/len(frames),
                'twoHandFrameFraction': sum(n == 2 for n in hand_counts)/len(frames),
                'meanWristStepNormalized': sum(movement)/max(1,len(movement)), 'extractionOk': True})
            print(f"extracted {len(report)} {c['id']}", flush=True)
        node = os.environ.get('SIGNLY_NODE') or shutil.which('node')
        if node is None: raise RuntimeError('Node 24 must be on PATH for the shared feature encoder')
        subprocess.run([node, '--import', 'tsx', 'scripts/sequence-batch.ts', str(path)],
                       cwd=ROOT.parents[1]/'app', check=True)
    for row in report:
        row['poseFrameFraction'] = read(CACHE/'features'/f"{row['id']}.json")['quality']['poseFrameFraction']
    write(REPORT / 'preprocessing.json', report)


def subset(manifest, labels):
    return {**manifest, 'vocabulary': [{'label': l} for l in labels],
            'clips': [c for c in manifest['clips'] if c['label'] in labels]}


def calibration(logits, targets, negative_logits):
    import numpy as np
    def scores(x):
        e = np.exp(x - x.max(axis=1, keepdims=True)); p = e/e.sum(axis=1,keepdims=True)
        s = np.sort(p,axis=1)
        return p.argmax(axis=1), s[:,-1], s[:,-1]-s[:,-2]
    predicted, conf, margin = scores(logits)
    _, nc, nm = scores(negative_logits)
    rows = []
    for threshold in (.5,.55,.6,.65,.7,.75,.8,.85,.9,.95,.975,.99):
        for gap in (0.,.1,.15,.2,.3,.4,.5):
            accepted = (conf >= threshold) & (margin >= gap)
            wrong = int(((predicted != targets) & accepted).sum())
            false = int(((nc >= threshold) & (nm >= gap)).sum())
            rows.append({'confidence': threshold, 'margin': gap, 'accepted': int(accepted.sum()),
                         'wrongAccepted': wrong, 'negativeFalseAccepted': false})
    passing = [r for r in rows if r['wrongAccepted'] == 0 and r['negativeFalseAccepted']/len(nc) <= .1]
    # Zero accepted is permitted but must be reported, never disguised as accuracy.
    best = max(passing, key=lambda r:(r['accepted'], -r['negativeFalseAccepted'], -r['confidence'], -r['margin'])) if passing else {
        'confidence': 1., 'margin': 1., 'accepted': 0, 'wrongAccepted': 0, 'negativeFalseAccepted': 0}
    return {'selected': best, 'validationSamples': len(targets), 'negativeSamples': len(nc),
            'policy': 'Maximize validation coverage with zero wrong target acceptances and <=10% non-target false acceptances; global thresholds only.', 'grid': rows}


def experiment():
    if (REPORT/'frozen.json').exists(): raise ValueError('Already frozen; no more experiments in this version')
    import numpy as np
    import torch
    import onnxruntime as ort
    import train as training
    torch.set_num_threads(2)
    manifest = read(MANIFEST); validate_manifest(manifest)
    baseline = read(BASE); labels = [v['label'] for v in manifest['vocabulary']]
    base_labels = [v['label'] for v in baseline['vocabulary']]
    baseline_val = training.load_split(baseline, 'validation', base_labels)
    session = ort.InferenceSession(str(ART/'baseline.onnx'), providers=['CPUExecutionProvider'])
    base_logits = session.run(None, {'sequence': baseline_val[0].numpy()})[0]
    base_metrics = training.metrics(baseline_val[1].numpy(), base_logits.argmax(1), base_labels)
    negatives = read(ROOT/'manifests/rejection-validation-v2.json')
    negative_labels = [v['label'] for v in negatives['vocabulary']]
    negative_inputs = training.load_split(negatives, 'validation', negative_labels)[0].numpy()
    write(REPORT/'baseline-validation.json', {'metrics': base_metrics,
         'calibration': calibration(base_logits, baseline_val[1].numpy(),session.run(None,{'sequence':negative_inputs})[0])})
    stages = sorted(set([12, min(13,len(labels)), min(20,len(labels))]))
    rows = []
    for n in stages:
        stage = subset(manifest, labels[:n]); stage_labels = labels[:n]
        training.seed_everything(training.SEED)
        splits = {s: training.load_split(stage,s,stage_labels) for s in ('train','validation')}
        model = training.WordClassifier(stage_labels)
        history = training.train(model,splits['train'],splits['validation'],stage_labels)
        predictions, logits = training.predict(model,splits['validation'][0],stage_labels)
        metrics = training.metrics(splits['validation'][1].numpy(),predictions,stage_labels)
        base_pred,_ = training.predict(model,baseline_val[0],stage_labels)
        paired = float((base_pred==baseline_val[1].numpy()).mean())
        _, neg_logits = training.predict(model,torch.tensor(negative_inputs),stage_labels)
        calibrated = calibration(logits,splits['validation'][1].numpy(),neg_logits)
        path = ART/f'candidate-{n}.onnx'; model.eval()
        torch.onnx.export(model,(torch.zeros(1,32,162),),path,input_names=['sequence'],output_names=['logits'],
             dynamic_axes={'sequence':{0:'batch'},'logits':{0:'batch'}},opset_version=17,dynamo=False)
        torch.save(model.state_dict(),ART/f'candidate-{n}.pt')
        exported = ort.InferenceSession(str(path),providers=['CPUExecutionProvider']).run(None,{'sequence':splits['validation'][0].numpy()})[0]
        difference = float(np.abs(exported-logits).max())
        if difference > 1e-4 or not np.array_equal(exported.argmax(1),predictions): raise ValueError('ONNX parity failed')
        passes = metrics['accuracy'] >= base_metrics['accuracy'] and paired+1e-6 >= base_metrics['accuracy'] and metrics['macroF1'] >= base_metrics['macroF1']-.02
        report = {'classes': n, 'labels': stage_labels, 'validation': metrics, 'baselineSubsetAccuracy': paired,
            'passesPromotionRule': passes, 'training': history, 'calibration': calibrated,
            'parameters': sum(p.numel() for p in model.parameters()), 'onnxMaxDifference': difference,
            'modelSha256': sha(path), 'manifestSha256': sha(MANIFEST)}
        write(REPORT/f'candidate-{n}.json',report)
        rows.append({k:report[k] for k in ('classes','baselineSubsetAccuracy','passesPromotionRule','onnxMaxDifference') } | {'accuracy':metrics['accuracy'],'macroF1':metrics['macroF1']})
        print(rows[-1],flush=True)
    write(REPORT/'stages.json',rows)


def freeze():
    if (REPORT/'frozen.json').exists(): raise ValueError('Already frozen')
    rows = read(REPORT/'stages.json'); promoted = [r for r in rows if r['passesPromotionRule']]
    n = max((r['classes'] for r in promoted),default=0)
    name = f'candidate-{n}' if n else 'baseline'
    manifest = read(MANIFEST) if n else read(BASE)
    labels = [v['label'] for v in manifest['vocabulary']][:n or 12]
    manifest = subset(manifest,labels)
    report = read(REPORT/f'{name}.json') if n else read(REPORT/'baseline-validation.json')
    thresholds = {k: report['calibration']['selected'][k] for k in ('confidence','margin')}
    source = ART/f'{name}.onnx'
    # Bind label order, tensor version and thresholds inside the ONNX protobuf too.
    import onnx, json
    model = onnx.load(str(source))
    contract = {'preprocessingVersion':'signly-sequence-v1','sequenceLength':32,'sequenceDimensions':162,
                'labels':labels,'acceptance':thresholds}
    onnx.helper.set_model_props(model, {'signly.contract':json.dumps(contract,separators=(',',':'))})
    onnx.save(model,ART/'final.onnx'); onnx.checker.check_model(model)
    write(ART/'final.labels.json', {'schemaVersion':2, **contract, 'modelSha256':sha(ART/'final.onnx'),
        'inputName':'sequence','outputName':'logits','source':'reports/expansion/frozen.json'})
    write(ROOT/'manifests/final-v2.json', {**manifest,'counts':counts_for(manifest['clips'],labels)})
    write(REPORT/'frozen.json', {'selected':name,'labels':labels,'acceptance':thresholds,
         'manifestSha256':sha(ROOT/'manifests/final-v2.json'), 'modelSha256':sha(ART/'final.onnx'),
         'metadataSha256':sha(ART/'final.labels.json'), 'testRead':False,
         'reason':'Largest stage passing predeclared validation gates, otherwise unchanged baseline weights. Selection and calibration complete before final test.'})
    print(read(REPORT/'frozen.json'))


def final():
    import numpy as np
    import torch
    import train as training
    import onnxruntime as ort
    frozen = read(REPORT/'frozen.json')
    manifest_path = ROOT/'manifests/final-v2.json'
    if sha(manifest_path)!=frozen['manifestSha256'] or sha(ART/'final.onnx')!=frozen['modelSha256'] or sha(ART/'final.labels.json')!=frozen['metadataSha256']:
        raise ValueError('Frozen artifact changed')
    if (REPORT/'final-evaluation.json').exists(): raise ValueError('Final test already evaluated; read saved report instead')
    manifest = read(manifest_path); validate_manifest(manifest); labels=frozen['labels']
    splits={s:training.load_split(manifest,s,labels,allow_test=s=='test') for s in ('train','validation','test')}
    session=ort.InferenceSession(str(ART/'final.onnx'),providers=['CPUExecutionProvider'])
    results={}; parity=[]
    reference = None
    if frozen['selected']!='baseline':
        reference=training.WordClassifier(labels)
        reference.load_state_dict(torch.load(ART/f"{frozen['selected']}.pt",weights_only=True)); reference.eval()
    for split,(inputs,targets,ids,_) in splits.items():
        logits=session.run(None,{'sequence':inputs.numpy()})[0]; pred=logits.argmax(1)
        results[split]=training.metrics(targets.numpy(),pred,labels)
        probs=np.exp(logits-logits.max(1,keepdims=True)); probs/=probs.sum(1,keepdims=True); ranked=np.sort(probs,axis=1)
        accepted=(ranked[:,-1]>=frozen['acceptance']['confidence']) & (ranked[:,-1]-ranked[:,-2]>=frozen['acceptance']['margin'])
        results[split]['gate']={'accepted':int(accepted.sum()),'wrongAccepted':int(((pred!=targets.numpy())&accepted).sum()),'rejected':int((~accepted).sum())}
        if reference:
            with torch.no_grad(): ref=reference(inputs).numpy()
            difference=float(np.abs(ref-logits).max()); same=bool(np.array_equal(ref.argmax(1),pred))
            if difference>1e-4 or not same: raise ValueError('Final parity failed')
            parity.append({'split':split,'maxAbsoluteDifference':difference,'samePredictions':same})
    # A real validation sequence for explicit local browser numerical parity; ignored artifact.
    fixture_inputs=splits['validation'][0][:1].numpy()
    raw=read(CACHE/'landmarks'/f"{splits['validation'][2][0]}.json")
    write(ART/'browser-parity.json',{'tensor':fixture_inputs[0].tolist(),'logits':session.run(None,{'sequence':fixture_inputs})[0][0].tolist(),'labels':labels,'frames':raw['frames']})
    write(REPORT/'final-evaluation.json',{'frozen':frozen,'results':results,'parity':parity,
        'counts':manifest['counts'],'uniqueSigners':{s:len({c['signer'] for c in manifest['clips'] if c['split']==s}) for s in splits},
        'limitations':['Tiny per-class held-out support; confidence intervals are wide.','Baseline test outcomes were published before this task; this is a frozen reevaluation, not a new independent test.','No human webcam accuracy measured.']})
    print({s:{k:v for k,v in r.items() if k not in ('perClass','confusionMatrix')} for s,r in results.items()})


def restore():
    """Rehydrate ignored videos from the saved manifests, without reselection."""
    data.MIRROR_RESOLVE=f'https://huggingface.co/datasets/{data.MIRROR_DATASET}/resolve/{MIRROR_REVISION}/'
    metadata_path=META/'WLASL_v0.3.json'
    if not metadata_path.exists(): data.fetch(data.SOURCES['wlasl'],metadata_path)
    if sha(metadata_path)!=read(MANIFEST)['metadataSha256']: raise ValueError('Original metadata checksum changed')
    pose=CACHE/'models/pose_landmarker_lite.task'; pose.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(ROOT.parents[1]/'app/public/models/pose_landmarker_lite.task',pose)
    frozen=read(REPORT/'frozen.json'); ART.mkdir(parents=True,exist_ok=True)
    for suffix, key in [('onnx','modelSha256'),('labels.json','metadataSha256')]:
        source=ROOT.parents[1]/f'app/public/models/word-classifier-v1.{suffix}'
        if sha(source)!=frozen[key]: raise ValueError('Shipped model differs from frozen experiment')
        shutil.copyfile(source,ART/f'final.{suffix}')
    clips=read(MANIFEST)['clips']+read(ROOT/'manifests/rejection-validation-v2.json')['clips']
    validate_manifest({'schemaVersion':1,'clips':clips})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for expected, actual in zip(clips,executor.map(data.download_one,clips)):
            if not actual['available'] or actual['sha256']!=expected['sha256']:
                raise ValueError('Cannot reproduce verified bytes for '+expected['id'])
    print(f'Restored {len(clips)} verified public clips; no selection or training performed.')


def reproduce():
    """Retrain only the frozen train/validation data. Test remains unopened."""
    import torch, numpy as np, onnx, onnxruntime as ort, json
    import train as training
    frozen=read(REPORT/'frozen.json'); path=ROOT/'manifests/final-v2.json'
    if sha(path)!=frozen['manifestSha256']: raise ValueError('Frozen manifest changed')
    if frozen['selected']=='baseline': raise ValueError('Use the preserved baseline model for rollback')
    manifest=read(path); validate_manifest(manifest); labels=frozen['labels']
    torch.set_num_threads(2); training.seed_everything(training.SEED)
    splits={s:training.load_split(manifest,s,labels) for s in ('train','validation')}
    model=training.WordClassifier(labels)
    history=training.train(model,splits['train'],splits['validation'],labels); model.eval()
    target=ART/'reproduced.onnx'; target.parent.mkdir(parents=True,exist_ok=True)
    torch.onnx.export(model,(torch.zeros(1,32,162),),target,input_names=['sequence'],output_names=['logits'],
         dynamic_axes={'sequence':{0:'batch'},'logits':{0:'batch'}},opset_version=17,dynamo=False)
    proto=onnx.load(str(target))
    contract={'preprocessingVersion':'signly-sequence-v1','sequenceLength':32,'sequenceDimensions':162,
              'labels':labels,'acceptance':frozen['acceptance']}
    onnx.helper.set_model_props(proto,{'signly.contract':json.dumps(contract,separators=(',',':'))})
    onnx.save(proto,target)
    matches=sha(target)==frozen['modelSha256']
    write(ART/'reproduction.json',{'modelSha256':sha(target),'matchesFrozenModel':matches,'bestEpoch':history['bestEpoch'],'testRead':False})
    if not matches: raise ValueError('Reproduction differs from frozen model; artifacts preserved, shipped model untouched')
    # Recreate the dev browser fixture from validation only.
    inputs=splits['validation'][0][:1].numpy()
    logits=ort.InferenceSession(str(target),providers=['CPUExecutionProvider']).run(None,{'sequence':inputs})[0]
    raw=read(CACHE/'landmarks'/f"{splits['validation'][2][0]}.json")
    write(ART/'browser-parity.json',{'tensor':inputs[0].tolist(),'logits':logits[0].tolist(),'labels':labels,'frames':raw['frames']})
    print({'matchesFrozenModel':matches,'sha256':sha(target),'testRead':False})


if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('command',choices=['prepare','extract','experiment','freeze','final','restore','reproduce'])
    args=parser.parse_args(); globals()[args.command]()
