"""A separate, preregistered vocabulary experiment; v2 artifacts stay immutable.

Only `final` may read test features, after all selection decisions are frozen.
No command in this script changes the live app's model files.
"""
import argparse
import concurrent.futures
import os
import shutil
import subprocess

import data
from data import ROOT, CACHE, META, read, write, sha, validate_manifest
from expansion import MIRROR_REVISION, counts_for, owners_for, subset

REPORT = ROOT / 'reports/expansion-v3'
ART = ROOT / 'artifacts/expansion-v3'
MANIFEST = ROOT / 'manifests/expansion-v3.json'
BASE = ROOT / 'manifests/final-v2.json'
NEGATIVE = ROOT / 'manifests/rejection-validation-v2.json'
ACCEPTANCE = {'confidence': .85, 'margin': 0.0}


def check_unfrozen():
    if (REPORT / 'frozen.json').exists():
        raise ValueError('V3 is frozen; do not retune or overwrite its results.')


def plan():
    check_unfrozen()
    if (REPORT / 'protocol.json').exists():
        raise ValueError('Protocol already registered; use the saved plan.')
    baseline = read(BASE)
    previous = read(ROOT / 'manifests/expansion-v2.json')['clips'] + read(NEGATIVE)['clips']
    metadata = read(META / 'WLASL_v0.3.json')
    data.VOCABULARY.update({entry['gloss']: [] for entry in metadata})
    all_clips = data.records('wlasl')
    pool = [c for c in all_clips if c.get('mirrorPath') and c['frameStart'] == 1 and c['frameEnd'] == -1]
    owners = owners_for(pool, previous)
    # Preserve even the unused signer/source assignments declared in v2.
    prior = read(ROOT / 'reports/expansion/availability.json')
    for key in owners:
        owners[key].update(prior['owners'][key])
    known_duplicates = {c['id'] for c in prior['excluded'] if c.get('reason') == 'duplicate bytes'}
    clean = [c for c in pool if c['id'] not in known_duplicates and all(owners[k][c[k]] == c['split'] for k in owners)]
    counts = counts_for(clean, data.VOCABULARY)
    base_labels = [v['label'] for v in baseline['vocabulary']]
    negative_labels = {c['label'] for c in read(NEGATIVE)['clips']}
    signer_counts = {label: len({c['signer'] for c in clean if c['label'] == label and c['split'] == 'train'}) for label in counts}
    additions = [label for label, cc in counts.items() if label not in base_labels and label not in negative_labels
                 and cc['train'] >= 4 and cc['validation'] >= 1 and cc['test'] >= 1 and signer_counts[label] >= 2]
    additions.sort(key=lambda label: (-counts[label]['validation'], -signer_counts[label], -counts[label]['train'], label))
    labels = base_labels + additions[:37]
    base_ids = {c['id'] for c in baseline['clips']}
    candidates = list(baseline['clips']) + [c for c in clean if c['id'] not in base_ids and
                  (c['label'] in additions[:37] or (c['label'] in base_labels and c['split'] == 'train'))]
    stages = sorted({n for n in (15, 19, 23, 30, 40, 50, len(labels)) if 13 < n <= len(labels)})
    ART.mkdir(parents=True, exist_ok=True)
    for suffix in ('onnx', 'labels.json'):
        source = ROOT.parents[1] / f'app/public/models/word-classifier-v1.{suffix}'
        shutil.copyfile(source, ART / f'baseline.{suffix}')
    protocol = {
        'version': 3, 'baselineManifestSha256': sha(BASE), 'negativeManifestSha256': sha(NEGATIVE),
        'baselineModelSha256': sha(ART / 'baseline.onnx'), 'baselineMetadataSha256': sha(ART / 'baseline.labels.json'),
        'metadataSha256': sha(META / 'WLASL_v0.3.json'), 'indexSha256': sha(data.TREE),
        'mirrorRevision': MIRROR_REVISION, 'officialGlossesReviewed': len(metadata),
        'officialClipsReviewed': len(all_clips), 'mirrorWholeFileClips': len(pool), 'splitCompatibleClips': len(clean),
        'candidateLabels': labels, 'stageSizes': stages, 'candidateCounts': counts_for(candidates, labels),
        'trainSignerCounts': {label: signer_counts[label] for label in labels},
        'selection': 'All official glosses; whole-file public mirror clips; preserve all v2 owners and baseline holdouts; exclude known duplicates and fixed negative-validation labels. New labels ranked by validation count, training signer count, train count, lexical order. No model outcomes.',
        'training': {'architecture': 'unchanged conv1d-temporal', 'seed': 20260926, 'threads': 2,
                     'epochs': 300, 'patience': 30, 'batchSize': 8, 'inputNoiseStd': .01},
        'acceptance': ACCEPTANCE,
        'promotion': 'Largest stage with overall validation accuracy >= baseline, macro F1 >= baseline minus .02, baseline-subset correct >= baseline, baseline-subset accepted-correct >= baseline, baseline-subset accepted-wrong <= baseline, and fixed negative false acceptances <= baseline. Threshold fixed at .85, no threshold search.',
        'testPolicy': 'No test feature reads until frozen. Evaluate a promoted candidate once only. Historical v2 test clips are already known and reported separately from previously unopened clips. No replacement candidate or retuning after test.',
        'owners': owners, 'candidates': candidates,
    }
    write(REPORT / 'protocol.json', protocol)
    print({k: protocol[k] for k in ('officialGlossesReviewed', 'mirrorWholeFileClips', 'splitCompatibleClips', 'candidateLabels', 'stageSizes', 'candidateCounts')}, flush=True)


def prepare():
    check_unfrozen()
    if list(REPORT.glob('candidate-*.json')) or (REPORT / 'stages.json').exists():
        raise ValueError('Training has started; data selection is locked.')
    if (REPORT / 'availability.json').exists():
        attempt = len(list(REPORT.glob('download-attempt-*.json'))) + 1
        shutil.copyfile(REPORT / 'availability.json', REPORT / f'download-attempt-{attempt}.json')
    protocol = read(REPORT / 'protocol.json')
    data.MIRROR_RESOLVE = f'https://huggingface.co/datasets/{data.MIRROR_DATASET}/resolve/{MIRROR_REVISION}/'
    old = read(ROOT / 'manifests/expansion-v2.json')['clips'] + read(NEGATIVE)['clips']
    by_hash = {c['sha256']: c['id'] for c in old}
    baseline = read(BASE); baseline_ids = {c['id'] for c in baseline['clips']}
    kept = []; excluded = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for c in executor.map(data.download_one, protocol['candidates']):
            if not c['available']:
                excluded.append({'id': c['id'], 'reason': c.get('detail')}); continue
            if c['sha256'] in by_hash and by_hash[c['sha256']] != c['id']:
                excluded.append({'id': c['id'], 'reason': 'duplicate bytes', 'duplicateOf': by_hash[c['sha256']]}); continue
            by_hash[c['sha256']] = c['id']; kept.append(c)
            print(f"verified {len(kept)} {c['id']}", flush=True)
    if not baseline_ids.issubset({c['id'] for c in kept}): raise ValueError('Baseline clip missing')
    if any('10013' in str(c.get('reason')) for c in excluded):
        raise RuntimeError('Sandbox blocked network access; retry with network permission before selecting vocabulary.')
    counts = counts_for(kept, protocol['candidateLabels'])
    base_labels = [v['label'] for v in baseline['vocabulary']]
    labels = [l for l in protocol['candidateLabels'] if l in base_labels or
              (counts[l]['train'] >= 4 and counts[l]['validation'] >= 1 and counts[l]['test'] >= 1
               and len({c['signer'] for c in kept if c['label'] == l and c['split'] == 'train'}) >= 2)]
    clips = [c for c in kept if c['label'] in labels]
    manifest = {**baseline, 'clips': clips, 'vocabulary': [{'label': l} for l in labels],
                'counts': counts_for(clips, labels), 'protocolSha256': sha(REPORT / 'protocol.json')}
    validate_manifest({**manifest, 'clips': clips + read(NEGATIVE)['clips']})
    write(MANIFEST, manifest)
    write(REPORT / 'availability.json', {'labels': labels, 'counts': manifest['counts'], 'excluded': excluded,
          'stageSizes': sorted({min(n, len(labels)) for n in protocol['stageSizes'] if min(n, len(labels)) > 13}),
          'manifestSha256': sha(MANIFEST), 'newClips': len(clips) - len(baseline['clips'])})
    print(read(REPORT / 'availability.json'), flush=True)


def extract(test=False):
    from preprocess import extract as extract_clip
    manifest = read(MANIFEST)
    if test:
        frozen = read(REPORT / 'frozen.json')
        if frozen['selected'] == 'baseline': raise ValueError('No promoted model; leave test unopened.')
        manifest = subset(manifest, frozen['labels'])
    clips = [c for c in manifest['clips'] if (c['split'] == 'test') == test]
    extraction_manifest = ROOT / f'manifests/expansion-v3-{"test" if test else "development"}.json'
    write(extraction_manifest, {**manifest, 'clips': clips})
    for i, c in enumerate(clips):
        raw = extract_clip(c)
        print(f"extracted {i+1}/{len(clips)} {c['id']} ({len(raw['frames'])} frames)", flush=True)
    node = os.environ.get('SIGNLY_NODE') or shutil.which('node')
    if not node: raise RuntimeError('Node is required for the shared sequence encoder')
    subprocess.run([node, '--import', 'tsx', 'scripts/sequence-batch.ts', str(extraction_manifest)],
                   cwd=ROOT.parents[1] / 'app', check=True)
    write(REPORT / f'preprocessing-{"test" if test else "development"}.json', [
        {'id': c['id'], 'label': c['label'], 'split': c['split'],
         'quality': read(CACHE / 'features' / f"{c['id']}.json")['quality']} for c in clips])


def gate(logits, targets=None):
    import numpy as np
    exps = np.exp(logits - logits.max(1, keepdims=True)); probs = exps / exps.sum(1, keepdims=True)
    accepted = probs.max(1) >= ACCEPTANCE['confidence']
    report = {'samples': len(logits), 'accepted': int(accepted.sum()), 'rejected': int((~accepted).sum())}
    if targets is not None:
        correct = logits.argmax(1) == targets
        report.update(correct=int(correct.sum()), acceptedCorrect=int((accepted & correct).sum()),
                      acceptedWrong=int((accepted & ~correct).sum()))
    return report


def promotion(metrics, paired, negative, baseline):
    return (metrics['accuracy'] >= baseline['metrics']['accuracy'] and
            metrics['macroF1'] >= baseline['metrics']['macroF1'] - .02 and
            paired['correct'] >= baseline['gate']['correct'] and
            paired['acceptedCorrect'] >= baseline['gate']['acceptedCorrect'] and
            paired['acceptedWrong'] <= baseline['gate']['acceptedWrong'] and
            negative['accepted'] <= baseline['negative']['accepted'])


def experiment():
    check_unfrozen()
    import numpy as np
    import torch
    import onnxruntime as ort
    import train as training
    torch.set_num_threads(2)
    protocol = read(REPORT / 'protocol.json'); manifest = read(MANIFEST)
    if sha(REPORT / 'protocol.json') != manifest['protocolSha256']: raise ValueError('Protocol changed')
    if sha(NEGATIVE) != protocol['negativeManifestSha256']: raise ValueError('Negative set changed')
    if sha(ART / 'baseline.onnx') != protocol['baselineModelSha256']: raise ValueError('Baseline changed')
    validate_manifest({**manifest, 'clips': manifest['clips'] + read(NEGATIVE)['clips']})
    base = read(BASE); base_labels = [v['label'] for v in base['vocabulary']]
    base_val = training.load_split(base, 'validation', base_labels)
    neg = read(NEGATIVE)
    neg_inputs = training.load_split(neg, 'validation', [v['label'] for v in neg['vocabulary']])[0]
    session = ort.InferenceSession(str(ART / 'baseline.onnx'), providers=['CPUExecutionProvider'])
    base_logits = session.run(None, {'sequence': base_val[0].numpy()})[0]
    baseline = {'metrics': training.metrics(base_val[1].numpy(), base_logits.argmax(1), base_labels),
                'gate': gate(base_logits, base_val[1].numpy()),
                'negative': gate(session.run(None, {'sequence': neg_inputs.numpy()})[0])}
    write(REPORT / 'baseline-validation.json', baseline)
    labels = [v['label'] for v in manifest['vocabulary']]; rows = []
    for n in read(REPORT / 'availability.json')['stageSizes']:
        path = REPORT / f'candidate-{n}.json'
        if path.exists():
            saved = read(path)
            if saved['manifestSha256'] != sha(MANIFEST) or sha(ART / f'candidate-{n}.onnx') != saved['modelSha256']:
                raise ValueError('Saved candidate changed')
            rows.append(saved); continue
        stage_labels = labels[:n]; stage = subset(manifest, stage_labels)
        training.seed_everything(training.SEED)
        splits = {s: training.load_split(stage, s, stage_labels) for s in ('train', 'validation')}
        model = training.WordClassifier(stage_labels)
        history = training.train(model, splits['train'], splits['validation'], stage_labels)
        pred, logits = training.predict(model, splits['validation'][0], stage_labels)
        metrics = training.metrics(splits['validation'][1].numpy(), pred, stage_labels)
        _, paired_logits = training.predict(model, base_val[0], stage_labels)
        _, neg_logits = training.predict(model, neg_inputs, stage_labels)
        paired = gate(paired_logits, base_val[1].numpy()); negative = gate(neg_logits)
        output = ART / f'candidate-{n}.onnx'; model.eval()
        torch.onnx.export(model, (torch.zeros(1, 32, 162),), output, input_names=['sequence'], output_names=['logits'],
            dynamic_axes={'sequence': {0: 'batch'}, 'logits': {0: 'batch'}}, opset_version=17, dynamo=False)
        torch.save(model.state_dict(), ART / f'candidate-{n}.pt')
        exported = ort.InferenceSession(str(output), providers=['CPUExecutionProvider']).run(None, {'sequence': splits['validation'][0].numpy()})[0]
        difference = float(np.abs(exported - logits).max())
        if difference > 1e-4 or not np.array_equal(exported.argmax(1), pred): raise ValueError('ONNX parity failed')
        row = {'classes': n, 'labels': stage_labels, 'counts': counts_for(stage['clips'], stage_labels),
               'validation': metrics, 'gate': gate(logits, splits['validation'][1].numpy()), 'paired': paired,
               'negative': negative, 'passesPromotionRule': promotion(metrics, paired, negative, baseline),
               'training': history, 'onnxMaxDifference': difference, 'parameters': sum(p.numel() for p in model.parameters()),
               'modelSha256': sha(output), 'manifestSha256': sha(MANIFEST), 'testRead': False}
        write(path, row); rows.append(row)
        print({k: row[k] for k in ('classes', 'gate', 'paired', 'negative', 'passesPromotionRule')}, flush=True)
    write(REPORT / 'stages.json', [{k: r[k] for k in ('classes', 'gate', 'paired', 'negative', 'passesPromotionRule')} |
          {'accuracy': r['validation']['accuracy'], 'macroF1': r['validation']['macroF1']} for r in rows])


def freeze():
    check_unfrozen()
    import json
    import onnx
    rows = read(REPORT / 'stages.json')
    expected = read(REPORT / 'availability.json')['stageSizes']
    if [r['classes'] for r in rows] != expected: raise ValueError('Not all preregistered stages evaluated')
    n = max((r['classes'] for r in rows if r['passesPromotionRule']), default=13)
    selected = f'candidate-{n}' if n > 13 else 'baseline'
    labels = [v['label'] for v in read(MANIFEST)['vocabulary']][:n]
    if n > 13:
        saved = read(REPORT / f'{selected}.json')
        if sha(ART / f'{selected}.onnx') != saved['modelSha256'] or sha(MANIFEST) != saved['manifestSha256']:
            raise ValueError('Candidate or manifest changed')
        model = onnx.load(ART / f'{selected}.onnx')
        contract = {'preprocessingVersion': 'signly-sequence-v1', 'sequenceLength': 32,
                    'sequenceDimensions': 162, 'labels': labels, 'acceptance': ACCEPTANCE}
        onnx.helper.set_model_props(model, {'signly.contract': json.dumps(contract, separators=(',', ':'))})
        onnx.save(model, ART / 'final.onnx'); onnx.checker.check_model(model)
        write(ART / 'final.labels.json', {'schemaVersion': 2, **contract, 'modelSha256': sha(ART / 'final.onnx'),
              'inputName': 'sequence', 'outputName': 'logits', 'source': 'reports/expansion-v3/frozen.json'})
    else:
        for suffix in ('onnx', 'labels.json'): shutil.copyfile(ART / f'baseline.{suffix}', ART / f'final.{suffix}')
    final_manifest = subset(read(MANIFEST) if n > 13 else read(BASE), labels)
    final_manifest['counts'] = counts_for(final_manifest['clips'], labels)
    write(ROOT / 'manifests/final-v3.json', final_manifest)
    write(REPORT / 'frozen.json', {'selected': selected, 'labels': labels, 'acceptance': ACCEPTANCE,
          'modelSha256': sha(ART / 'final.onnx'), 'metadataSha256': sha(ART / 'final.labels.json'),
          'manifestSha256': sha(ROOT / 'manifests/final-v3.json'), 'protocolSha256': sha(REPORT / 'protocol.json'),
          'testRead': False, 'reason': 'Largest stage passing all preregistered validation and live-policy gates; otherwise keep the functioning 13-word model.'})
    print(read(REPORT / 'frozen.json'), flush=True)


def final():
    import numpy as np
    import onnxruntime as ort
    import train as training
    frozen = read(REPORT / 'frozen.json')
    if frozen['selected'] == 'baseline': raise ValueError('No promotion; no reason to reopen the test set.')
    if (REPORT / 'final-evaluation.json').exists(): raise ValueError('Final evaluation already exists')
    if sha(ART / 'final.onnx') != frozen['modelSha256'] or sha(ROOT / 'manifests/final-v3.json') != frozen['manifestSha256']:
        raise ValueError('Frozen artifact changed')
    extract(test=True)
    manifest = read(ROOT / 'manifests/final-v3.json'); labels = frozen['labels']
    inputs, targets, ids, _ = training.load_split(manifest, 'test', labels, allow_test=True)
    session = ort.InferenceSession(str(ART / 'final.onnx'), providers=['CPUExecutionProvider'])
    logits = session.run(None, {'sequence': inputs.numpy()})[0]
    historical_ids = {c['id'] for c in read(BASE)['clips'] if c['split'] == 'test'}
    results = {}
    for name, mask in [('all', np.ones(len(ids), dtype=bool)), ('historical', np.array([i in historical_ids for i in ids])),
                       ('previouslyUnopened', np.array([i not in historical_ids for i in ids]))]:
        results[name] = {'metrics': training.metrics(targets.numpy()[mask], logits[mask].argmax(1), labels),
                         'gate': gate(logits[mask], targets.numpy()[mask]), 'clipIds': [i for i, keep in zip(ids, mask) if keep]}
    write(REPORT / 'final-evaluation.json', {'results': results, 'modelSha256': frozen['modelSha256'],
          'caveat': 'Historical v2 test clips were previously reported. New-label support is small. Not webcam accuracy.'})
    print({k: v['gate'] for k, v in results.items()}, flush=True)


def restore():
    """Restore saved public data without rerunning vocabulary selection."""
    manifest = read(MANIFEST)
    if sha(REPORT / 'protocol.json') != manifest['protocolSha256']: raise ValueError('Protocol changed')
    data.MIRROR_RESOLVE = f'https://huggingface.co/datasets/{data.MIRROR_DATASET}/resolve/{MIRROR_REVISION}/'
    clips = manifest['clips'] + read(NEGATIVE)['clips']
    validate_manifest({**manifest, 'clips': clips})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for expected, actual in zip(clips, executor.map(data.download_one, clips)):
            if not actual['available'] or actual['sha256'] != expected['sha256']:
                raise ValueError('Restore failed: ' + expected['id'])
    pose = CACHE / 'models/pose_landmarker_lite.task'
    if not pose.exists():
        pose.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT.parents[1] / 'app/public/models/pose_landmarker_lite.task', pose)
    print({'verifiedPublicClips': len(clips), 'selectionChanged': False}, flush=True)


def reproduce():
    """Retrain exactly the preregistered stages; write only ignored artifacts."""
    import torch
    import train as training
    torch.set_num_threads(2)
    ART.mkdir(parents=True, exist_ok=True)
    manifest = read(MANIFEST)
    if sha(REPORT / 'protocol.json') != manifest['protocolSha256']: raise ValueError('Protocol changed')
    labels = [v['label'] for v in manifest['vocabulary']]
    rows = []
    for n in read(REPORT / 'availability.json')['stageSizes']:
        saved = read(REPORT / f'candidate-{n}.json')
        if sha(MANIFEST) != saved['manifestSha256']: raise ValueError('Manifest changed')
        stage_labels = labels[:n]; stage = subset(manifest, stage_labels)
        training.seed_everything(training.SEED)
        splits = {s: training.load_split(stage, s, stage_labels) for s in ('train', 'validation')}
        model = training.WordClassifier(stage_labels)
        training.train(model, splits['train'], splits['validation'], stage_labels)
        model.eval(); output = ART / f'reproduced-{n}.onnx'
        torch.onnx.export(model, (torch.zeros(1, 32, 162),), output, input_names=['sequence'], output_names=['logits'],
            dynamic_axes={'sequence': {0: 'batch'}, 'logits': {0: 'batch'}}, opset_version=17, dynamo=False)
        digest = sha(output)
        if digest != saved['modelSha256']: raise ValueError(f'Reproduction mismatch: {n}')
        row = {'classes': n, 'modelSha256': digest, 'matches': True, 'testRead': False}
        rows.append(row); print(row, flush=True)
    write(ART / 'reproduction.json', rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['plan', 'prepare', 'extract', 'experiment', 'freeze', 'final', 'restore', 'reproduce'])
    args = parser.parse_args()
    globals()[args.command]()
