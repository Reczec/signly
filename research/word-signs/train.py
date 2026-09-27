"""Train, evaluate and export the CPU word-classifier baseline.

Everything here runs on real clips selected by data.py and encoded by the shared
implementation in app/src/recognition/sequence.ts, so the ONNX model consumes the
same 32x162 sequence that the browser produces at runtime. Seeds are fixed and
early stopping reads only validation. This command never opens test tensors;
expansion.py owns freezing and the separate final evaluation.
"""
import argparse, json, pathlib, random, time
import numpy as np, torch, torch.nn as nn
from data import ROOT, CACHE, read, write, validate_manifest

SEED=20260926; SEQUENCE_LENGTH=32; SEQUENCE_DIMENSIONS=162
MAX_EPOCHS=300; PATIENCE=30; INPUT_NOISE_STD=0.01


class WordClassifier(nn.Module):
    """Temporal conv over the 32x162 sequence, global pooled, small head."""
    def __init__(self, classes):
        super().__init__()
        self.features=nn.Sequential(
            nn.Conv1d(SEQUENCE_DIMENSIONS,64,kernel_size=5,padding=2), nn.BatchNorm1d(64), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(64,128,kernel_size=3,padding=1), nn.BatchNorm1d(128), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(128,128,kernel_size=3,padding=1), nn.BatchNorm1d(128), nn.ReLU())
        self.head=nn.Sequential(nn.Linear(128,64), nn.ReLU(), nn.Dropout(0.3), nn.Linear(64,len(classes)))
        self.classes=list(classes)
    def forward(self, sequence):
        hidden=self.features(sequence.transpose(1,2)).mean(dim=-1)
        return self.head(hidden)


def seed_everything(seed):
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed); torch.use_deterministic_algorithms(True, warn_only=True)

def load_split(manifest, split, labels, *, allow_test=False):
    if split == 'test' and not allow_test:
        raise ValueError('Test tensors are locked; evaluate only after decisions are frozen.')
    index={label:i for i,label in enumerate(labels)}
    clips=[c for c in manifest['clips'] if c['split']==split]
    tensors=[]; targets=[]; hand_fractions=[]; ids=[]
    for clip in clips:
        feature=read(CACHE/'features'/f"{clip['id']}.json")
        if feature['preprocessingVersion']!=manifest['preprocessingVersion']: raise ValueError('feature version mismatch: '+clip['id'])
        if feature['shape']!=[SEQUENCE_LENGTH,SEQUENCE_DIMENSIONS]: raise ValueError('unexpected feature shape: '+clip['id'])
        if feature['videoSha256']!=clip['sha256']: raise ValueError('checksum mismatch: '+clip['id'])
        values = np.asarray(feature['tensor'])
        if values.shape != (SEQUENCE_LENGTH,SEQUENCE_DIMENSIONS) or not np.isfinite(values).all():
            raise ValueError('invalid feature tensor: '+clip['id'])
        tensors.append(feature['tensor']); targets.append(index[clip['label']])
        hand_fractions.append(feature['quality']['handFrameFraction']); ids.append(clip['id'])
    return torch.tensor(tensors,dtype=torch.float32), torch.tensor(targets,dtype=torch.long), ids, hand_fractions

@torch.no_grad()
def predict(model, inputs, labels):
    model.eval(); logits=[]; batch=32
    for start in range(0,len(inputs),batch): logits.append(model(inputs[start:start+batch]))
    logits=torch.cat(logits); return logits.argmax(dim=1).cpu().numpy(), logits.cpu().numpy()

def metrics(targets, predictions, labels):
    matrix=[[0]*len(labels) for _ in labels]
    for truth,predicted in zip(targets.tolist(),predictions.tolist()): matrix[truth][predicted]+=1
    per_class=[]
    for i,label in enumerate(labels):
        true_positive=matrix[i][i]; support=sum(matrix[i]); predicted=sum(row[i] for row in matrix)
        precision=true_positive/predicted if predicted else 0.0; recall=true_positive/support if support else 0.0
        f1=2*precision*recall/(precision+recall) if precision+recall else 0.0
        per_class.append({'label':label,'support':support,'precision':round(precision,4),'recall':round(recall,4),'f1':round(f1,4)})
    accuracy=sum(matrix[i][i] for i in range(len(labels)))/max(1,len(targets))
    macro=sum(row['f1'] for row in per_class)/len(per_class)
    return {'samples':len(targets),'accuracy':round(accuracy,4),'macroF1':round(macro,4),
            'perClass':per_class,'confusionMatrix':{'labels':labels,'rowsTrueColumnsPredicted':matrix}}

def evaluate(model, inputs, targets, labels):
    predictions,_=predict(model,inputs,labels)
    return metrics(targets.numpy(),predictions,labels)

def train(model, train_data, val_data, labels):
    generator=torch.Generator().manual_seed(SEED)
    optimizer=torch.optim.Adam(model.parameters(),lr=1e-3,weight_decay=1e-4)
    loss_fn=nn.CrossEntropyLoss()
    inputs,targets=train_data[0],train_data[1]; val_inputs,val_targets=val_data[0],val_data[1]
    best_loss=float('inf'); best_state=None; best_epoch=0; stale=0; curve=[]
    for epoch in range(MAX_EPOCHS):
        model.train(); order=torch.randperm(len(inputs),generator=generator); total=0.0
        for start in range(0,len(order),8):
            batch=order[start:start+8]; noisy=inputs[batch]+torch.randn(inputs[batch].shape)*INPUT_NOISE_STD
            optimizer.zero_grad(); loss=loss_fn(model(noisy),targets[batch]); loss.backward(); optimizer.step()
            total+=loss.item()*len(batch)
        model.eval()
        with torch.no_grad(): val_loss=loss_fn(model(val_inputs),val_targets).item()
        predictions,_=predict(model,inputs,labels); val_predictions,_=predict(model,val_inputs,labels)
        curve.append({'epoch':epoch+1,'trainLoss':round(total/len(inputs),4),
                      'trainAccuracy':round(float((predictions==targets.numpy()).mean()),4),
                      'validationLoss':round(val_loss,4),
                      'validationAccuracy':round(float((val_predictions==val_targets.numpy()).mean()),4)})
        if val_loss<best_loss-1e-4: best_loss=val_loss; best_epoch=epoch+1; best_state={k:v.clone() for k,v in model.state_dict().items()}; stale=0
        else:
            stale+=1
            if stale>=PATIENCE: break
    model.load_state_dict(best_state)
    return {'epochsRun':len(curve),'bestEpoch':best_epoch,'bestValidationLoss':round(best_loss,4),
            'earlyStopping':{'metric':'validationLoss','patience':PATIENCE,'inputNoiseStd':INPUT_NOISE_STD},'curve':curve}

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--manifest',type=pathlib.Path,default=ROOT/'manifests/poc-v1.json')
    parser.add_argument('--model',type=pathlib.Path,default=ROOT/'artifacts/word-classifier-v1.onnx'); a=parser.parse_args()
    seed_everything(SEED); started=time.perf_counter()
    manifest=read(a.manifest); validate_manifest(manifest)
    labels=[entry['label'] for entry in manifest['vocabulary']]
    if len(labels)<8: raise SystemExit('Refusing to train on fewer than 8 classes.')
    splits={name:load_split(manifest,name,labels) for name in ('train','validation')}
    for name,(inputs,targets,_,_) in splits.items(): print(f'{name}: {len(inputs)} clips')
    model=WordClassifier(labels)
    history=train(model,splits['train'],splits['validation'],labels)
    results={name:evaluate(model,data[0],data[1],labels) for name,data in splits.items()}
    parameters=sum(p.numel() for p in model.parameters())
    a.model.parent.mkdir(parents=True,exist_ok=True)
    model.eval()
    torch.onnx.export(model,(torch.zeros(1,SEQUENCE_LENGTH,SEQUENCE_DIMENSIONS),),a.model,input_names=['sequence'],output_names=['logits'],
        dynamic_axes={'sequence':{0:'batch'},'logits':{0:'batch'}},opset_version=17,dynamo=False)
    import onnx, onnxruntime
    onnx.checker.check_model(onnx.load(str(a.model)))
    session=onnxruntime.InferenceSession(str(a.model),providers=['CPUExecutionProvider'])
    parity=[]
    for name,(inputs,_,_,_) in splits.items():
        with torch.no_grad(): reference=model(inputs).numpy()
        exported=session.run(None,{'sequence':inputs.numpy()})[0]
        parity.append({'split':name,'maxAbsoluteDifference':float(np.abs(reference-exported).max())})
    labels_path=a.model.with_suffix('.labels.json')
    write(labels_path,{'preprocessingVersion':manifest['preprocessingVersion'],'sequenceLength':SEQUENCE_LENGTH,
        'sequenceDimensions':SEQUENCE_DIMENSIONS,'labels':labels,'source':str(a.manifest.relative_to(ROOT)).replace('\\','/')})
    hand_fractions={name:round(float(np.mean(data[3])),4) for name,data in splits.items()}
    report={'schemaVersion':1,'seed':SEED,'manifest':str(a.manifest.relative_to(ROOT)).replace('\\','/'),
        'preprocessingVersion':manifest['preprocessingVersion'],'shape':[SEQUENCE_LENGTH,SEQUENCE_DIMENSIONS],
        'clips':len(manifest['clips']),'classes':len(labels),'labels':labels,
        'splits':{name:len(data[0]) for name,data in splits.items()},'handFrameFraction':hand_fractions,
        'model':{'architecture':'conv1d-temporal','parameters':parameters,'input':'sequence[batch,32,162]','output':f'logits[batch,{len(labels)}]'},
        'training':history,'results':results,
        'onnx':{'path':str(a.model.relative_to(ROOT)).replace('\\','/'),'labelsPath':str(labels_path.relative_to(ROOT)).replace('\\','/'),
            'opset':17,'opsetRuntime':onnxruntime.__version__,'parity':parity},
        'seconds':round(time.perf_counter()-started,1),
        'caveats':['Validation and test splits are small; per-class test support is 1-2 clips, so single errors move accuracy by several points.',
                   'Signers are disjoint across splits, so this measures unseen-signer generalisation rather than memorising identities.']}
    write(ROOT/'reports/training-validation.json',report)
    print(json.dumps({'validation':results['validation']['accuracy'],
        'macroF1':results['validation']['macroF1'],'bestEpoch':history['bestEpoch'],'onnx':report['onnx']['path'],
        'test':'locked; use expansion.py freeze then final'},indent=2))

if __name__=='__main__': main()
