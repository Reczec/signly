// Development-only verification page, intentionally absent from build entries.
import * as ort from 'onnxruntime-web/wasm';
import { createWordRecognitionModel, WORD_MODEL_PATH } from '../src/recognition/wordModel';
import { encodeSequence, type SequenceFrame } from '../src/recognition/sequence';

document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  const result = document.querySelector('#result')!;
  result.textContent = 'Running';
  let session: ort.InferenceSession | undefined;
  try {
    const fixture = await fetch('/verification/browser-parity.json').then(r => {
      if (!r.ok) throw new Error('Copy the final research browser-parity.json fixture into app/public/verification first.');
      return r.json();
    }) as {
      tensor: number[][]; logits: number[]; labels: string[]; frames: SequenceFrame[];
    };
    const model = await createWordRecognitionModel();
    if (JSON.stringify(model.labels) !== JSON.stringify(fixture.labels)) throw new Error('Label mismatch');
    const prediction = await model.predict(fixture.tensor);
    const liveTensor = encodeSequence(fixture.frames).tensor;
    const referenceFlat = fixture.tensor.flat();
    const preprocessingDifference = Math.max(...Array.from(Float32Array.from(liveTensor.flat()), (v,i) => Math.abs(v-referenceFlat[i])));
    session = await ort.InferenceSession.create(WORD_MODEL_PATH, { executionProviders: ['wasm'] });
    const outputs = await session.run({ sequence: new ort.Tensor('float32', Float32Array.from(fixture.tensor.flat()), [1,32,162]) });
    const actual = Array.from(outputs.logits.data as Float32Array);
    const maxAbsoluteDifference = Math.max(...actual.map((v,i) => Math.abs(v-fixture.logits[i])));
    const expectedIndex = fixture.logits.indexOf(Math.max(...fixture.logits));
    const samePrediction = prediction.label === fixture.labels[expectedIndex];
    result.textContent = JSON.stringify({ passed: maxAbsoluteDifference < 1e-4 && samePrediction && preprocessingDifference === 0,
      maxAbsoluteDifference, preprocessingDifference, samePrediction, labels: model.labels, prediction }, null, 2);
  } catch (cause) { result.textContent = `FAIL: ${String(cause)}`; }
  finally { await session?.release(); }
};
