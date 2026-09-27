import { SEQUENCE_DIMENSIONS, SEQUENCE_LENGTH, SEQUENCE_VERSION } from './sequence';

export interface WordModelContract {
  preprocessingVersion: string;
  sequenceLength: number;
  sequenceDimensions: number;
  labels: string[];
  acceptance: { confidence: number; margin: number };
}
export interface WordModelMetadata extends WordModelContract {
  schemaVersion: 2;
  modelSha256: string;
  inputName: 'sequence';
  outputName: 'logits';
}

export function validateWordMetadata(value: unknown): WordModelMetadata {
  const v = value as Partial<WordModelMetadata> | null;
  if (!v || v.schemaVersion !== 2 || v.preprocessingVersion !== SEQUENCE_VERSION ||
      v.sequenceLength !== SEQUENCE_LENGTH || v.sequenceDimensions !== SEQUENCE_DIMENSIONS) {
    throw new Error('Word model metadata schema, preprocessing version or shape mismatch.');
  }
  if (!Array.isArray(v.labels) || v.labels.length < 2 || new Set(v.labels).size !== v.labels.length ||
      !v.labels.every(l => typeof l === 'string' && l.trim() === l && l.length > 0 && l.toUpperCase() !== 'UNKNOWN')) {
    throw new Error('Word model labels must be unique, non-empty supported words.');
  }
  if (!v.acceptance || ![v.acceptance.confidence, v.acceptance.margin].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new Error('Word model acceptance thresholds are invalid.');
  }
  if (typeof v.modelSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.modelSha256) || v.inputName !== 'sequence' || v.outputName !== 'logits') {
    throw new Error('Word model checksum or input/output names are invalid.');
  }
  return v as WordModelMetadata;
}

// ONNX ModelProto field 14 is repeated StringStringEntryProto metadata_props.
// Read only this tiny public protobuf field; weights and graph are skipped.
// This lets the browser verify label ORDER against the exported model itself.
function fields(bytes: Uint8Array): Map<number, Uint8Array[]> {
  const result = new Map<number, Uint8Array[]>();
  let offset = 0;
  const varint = () => {
    let n = 0, multiplier = 1;
    for (let i = 0; i < 10; i++) {
      if (offset >= bytes.length) throw new Error('Truncated ONNX metadata.');
      const b = bytes[offset++]; n += (b & 127) * multiplier;
      if (b < 128) return n;
      multiplier *= 128;
    }
    throw new Error('Invalid ONNX metadata varint.');
  };
  while (offset < bytes.length) {
    const tag = varint(), wire = tag % 8, number = Math.floor(tag / 8);
    if (number === 0) throw new Error('Invalid ONNX field.');
    if (wire === 0) varint();
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const length = varint();
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new Error('Truncated ONNX field.');
      result.set(number, [...(result.get(number) ?? []), bytes.subarray(offset, offset + length)]);
      offset += length;
    } else throw new Error('Unsupported ONNX wire type.');
    if (offset > bytes.length) throw new Error('Truncated ONNX field.');
  }
  return result;
}

export async function verifyWordModel(bytes: Uint8Array<ArrayBuffer>, metadata: WordModelMetadata): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== metadata.modelSha256) throw new Error('Word model checksum mismatch; restore the matching model and labels.');
  const decoder = new TextDecoder();
  const entries = (fields(bytes).get(14) ?? []).map(entry => fields(entry));
  const values = entries.filter(e => decoder.decode(e.get(1)?.[0]) === 'signly.contract');
  if (values.length !== 1) throw new Error('Word model is missing its embedded Signly contract.');
  const embedded = JSON.parse(decoder.decode(values[0].get(2)?.[0])) as WordModelContract;
  for (const key of ['preprocessingVersion', 'sequenceLength', 'sequenceDimensions', 'labels', 'acceptance'] as const) {
    if (JSON.stringify(embedded[key]) !== JSON.stringify(metadata[key])) {
      throw new Error(`Word model embedded ${key} mismatch.`);
    }
  }
}
