"""One small transfer-learning attempt; reuse the working 13-word encoder.

Only two new output rows are trained, using already verified public clips.
No test tensors, downloads or app modifications. Reports are write-once.
"""
import argparse
import copy

import numpy as np
import torch
from torch import nn
import onnxruntime as ort

from data import ROOT, read, write, sha, validate_manifest
from expansion import subset, counts_for
from expansion_v3 import gate, promotion
import train as training

REPORT = ROOT / 'reports/transfer-v4'
ART = ROOT / 'artifacts/transfer-v4'
CHECKPOINT = ROOT / 'artifacts/expansion/candidate-13.pt'
SOURCE = ROOT / 'manifests/expansion-v3.json'
NEGATIVE = ROOT / 'manifests/rejection-validation-v2.json'


class ExtendedClassifier(nn.Module):
    def __init__(self, baseline):
        super().__init__()
        self.baseline = baseline.eval()
        for parameter in self.baseline.parameters(): parameter.requires_grad_(False)
        self.additions = nn.Linear(64, 2)
        nn.init.zeros_(self.additions.weight)
        nn.init.constant_(self.additions.bias, -3)

    def embedding(self, x):
        return self.baseline.head[:2](self.baseline.features(x.transpose(1, 2)).mean(-1))

    def forward(self, x):
        z = self.embedding(x)
        return torch.cat([self.baseline.head[3](z), self.additions(z)], dim=1)


def run(reproduce=False):
    torch.set_num_threads(2)
    training.seed_everything(training.SEED)
    source = read(SOURCE); labels = [v['label'] for v in source['vocabulary']][:15]
    manifest = subset(source, labels)
    baseline_labels = labels[:13]
    if labels[13:] != ['cake', 'what']: raise ValueError('Unexpected preregistered label order')
    validate_manifest({**manifest, 'clips': manifest['clips'] + read(NEGATIVE)['clips']})
    if not reproduce and (REPORT / 'result.json').exists(): raise ValueError('Attempt completed; do not retune it')
    protocol = {'labels': labels, 'seed': training.SEED, 'sourceSha256': sha(SOURCE),
        'checkpointSha256': sha(CHECKPOINT), 'negativeSha256': sha(NEGATIVE),
        'method': 'Frozen baseline encoder and original output rows; train only two added linear output rows.',
        'optimizer': 'Adam', 'learningRate': .02, 'weightDecay': .001,
        'maxEpochs': 200, 'patience': 30, 'selection': 'minimum validation cross entropy',
        'acceptance': {'confidence': .85, 'margin': 0},
        'promotion': 'Same paired recognition and rejection gates as v3; no threshold search.',
        'testRead': False}
    if (REPORT / 'protocol.json').exists():
        if read(REPORT / 'protocol.json') != protocol: raise ValueError('Protocol changed')
    else:
        if reproduce: raise ValueError('Missing original protocol')
        write(REPORT / 'protocol.json', protocol)
    baseline = training.WordClassifier(baseline_labels)
    baseline.load_state_dict(torch.load(CHECKPOINT, weights_only=True))
    model = ExtendedClassifier(baseline).eval()
    splits = {s: training.load_split(manifest, s, labels) for s in ('train', 'validation')}
    base_val = training.load_split(read(ROOT / 'manifests/final-v2.json'), 'validation', baseline_labels)
    negative = read(NEGATIVE)
    negative_inputs = training.load_split(negative, 'validation', [v['label'] for v in negative['vocabulary']])[0]
    with torch.no_grad():
        embeddings = {s: model.embedding(values[0]) for s, values in splits.items()}
        original_logits = {s: baseline.head[3](z) for s, z in embeddings.items()}
        paired_reference = baseline(base_val[0]).numpy()
    live = ROOT.parents[1] / 'app/public/models/word-classifier-v1.onnx'
    reference_session = ort.InferenceSession(str(live), providers=['CPUExecutionProvider'])
    reference_logits = reference_session.run(None, {'sequence': base_val[0].numpy()})[0]
    if not np.allclose(paired_reference, reference_logits, atol=1e-4, rtol=0):
        raise ValueError('Checkpoint does not reproduce the live model')
    base_report = {'metrics': training.metrics(base_val[1].numpy(), reference_logits.argmax(1), baseline_labels),
                  'gate': gate(reference_logits, base_val[1].numpy()),
                  'negative': gate(reference_session.run(None, {'sequence': negative_inputs.numpy()})[0])}
    optimizer = torch.optim.Adam(model.additions.parameters(), lr=.02, weight_decay=.001)
    best = float('inf'); best_state = None; stale = 0; curve = []; best_epoch = 0
    for epoch in range(200):
        optimizer.zero_grad()
        logits = torch.cat([original_logits['train'], model.additions(embeddings['train'])], 1)
        loss = nn.functional.cross_entropy(logits, splits['train'][1]); loss.backward(); optimizer.step()
        with torch.no_grad():
            val_logits = torch.cat([original_logits['validation'], model.additions(embeddings['validation'])], 1)
            val_loss = nn.functional.cross_entropy(val_logits, splits['validation'][1]).item()
        curve.append({'epoch': epoch + 1, 'trainLoss': loss.item(), 'validationLoss': val_loss})
        if val_loss < best - 1e-4:
            best = val_loss; best_state = copy.deepcopy(model.additions.state_dict()); best_epoch = epoch + 1; stale = 0
        else:
            stale += 1
            if stale >= 30: break
    model.additions.load_state_dict(best_state)
    with torch.no_grad():
        logits = model(splits['validation'][0]).numpy()
        paired = model(base_val[0]).numpy()
        negatives = model(negative_inputs).numpy()
    old_difference = float(np.abs(paired[:, :13] - paired_reference).max())
    if old_difference > 1e-6: raise ValueError('Original logits changed')
    metrics = training.metrics(splits['validation'][1].numpy(), logits.argmax(1), labels)
    paired_gate = gate(paired, base_val[1].numpy()); negative_gate = gate(negatives)
    ART.mkdir(parents=True, exist_ok=True)
    output = ART / ('reproduced.onnx' if reproduce else 'candidate.onnx')
    torch.onnx.export(model, (torch.zeros(1, 32, 162),), output, input_names=['sequence'], output_names=['logits'],
        dynamic_axes={'sequence': {0: 'batch'}, 'logits': {0: 'batch'}}, opset_version=17, dynamo=False)
    exported = ort.InferenceSession(str(output), providers=['CPUExecutionProvider']).run(None, {'sequence': splits['validation'][0].numpy()})[0]
    difference = float(np.abs(exported - logits).max())
    if difference > 1e-4 or not np.array_equal(exported.argmax(1), logits.argmax(1)): raise ValueError('ONNX parity failed')
    result = {'labels': labels, 'counts': counts_for(manifest['clips'], labels), 'baseline': base_report,
              'validation': metrics, 'gate': gate(logits, splits['validation'][1].numpy()),
              'paired': paired_gate, 'negative': negative_gate,
              'passesPromotionRule': promotion(metrics, paired_gate, negative_gate, base_report),
              'parameters': sum(p.numel() for p in model.parameters()),
              'trainableParameters': sum(p.numel() for p in model.parameters() if p.requires_grad),
              'bestEpoch': best_epoch, 'curve': curve, 'onnxMaxDifference': difference,
              'oldLogitsMaxDifference': old_difference, 'modelSha256': sha(output), 'testRead': False}
    if reproduce:
        if result['modelSha256'] != read(REPORT / 'result.json')['modelSha256']: raise ValueError('Reproduction differs')
        write(ART / 'reproduction.json', {'matches': True, 'modelSha256': result['modelSha256'], 'testRead': False})
    else:
        write(REPORT / 'result.json', result)
        write(REPORT / 'frozen.json', {'selected': 'candidate' if result['passesPromotionRule'] else 'baseline',
              'modelSha256': result['modelSha256'] if result['passesPromotionRule'] else sha(live),
              'protocolSha256': sha(REPORT / 'protocol.json'), 'testRead': False})
    print({k: result[k] for k in ('passesPromotionRule', 'gate', 'paired', 'negative', 'trainableParameters', 'oldLogitsMaxDifference', 'onnxMaxDifference')}, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--reproduce', action='store_true')
    run(parser.parse_args().reproduce)
