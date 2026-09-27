"""Provenance and held-out boundary regression checks (no training or test inference)."""
import copy
import unittest
from unittest.mock import patch

from data import ROOT, read, validate_manifest, sha
from expansion import owners_for, subset, final, experiment, REPORT, ART
from train import load_split


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.base = read(ROOT/'manifests/poc-v1.json')
        self.expanded = read(ROOT/'manifests/expansion-v2.json')

    def test_official_assignments_and_baseline_holdouts_are_unchanged(self):
        from data import META
        original = {'wlasl-'+c['video_id']: {'split':{'val':'validation'}.get(c['split'],c['split']),
                    'signer':str(c['signer_id']), 'label':group['gloss']}
                    for group in read(META/'WLASL_v0.3.json') for c in group['instances']}
        old = {c['id']:c for c in self.base['clips']}
        new = {c['id']:c for c in self.expanded['clips']}
        self.assertTrue(set(old).issubset(new))
        for cid, c in old.items():
            self.assertEqual(c['sha256'],new[cid]['sha256'])
            self.assertEqual(c['split'],new[cid]['split'])
        for c in new.values():
            self.assertEqual({k:c[k] for k in ('label','split','signer')},original[c['id']])
        base_labels={v['label'] for v in self.base['vocabulary']}
        self.assertEqual({c['id'] for c in old.values() if c['split']!='train'},
                         {c['id'] for c in new.values() if c['split']!='train' and c['label'] in base_labels})

    def test_no_leakage_including_rejection_calibration(self):
        negative=read(ROOT/'manifests/rejection-validation-v2.json')
        validate_manifest({**self.expanded,'clips':self.expanded['clips']+negative['clips']})
        self.assertEqual({c['split'] for c in negative['clips']},{'validation'})
        self.assertFalse({c['label'] for c in negative['clips']} & {v['label'] for v in self.expanded['vocabulary']})

    def test_signer_source_and_hash_conflicts_are_rejected(self):
        for key in ('signer','source','sha256'):
            manifest=copy.deepcopy(self.base)
            a=manifest['clips'][0]
            b=next(c for c in manifest['clips'] if c['split']!=a['split'])
            b[key]=a[key]
            with self.subTest(key=key), self.assertRaises(ValueError): validate_manifest(manifest)

    def test_duplicate_bytes_are_rejected_even_within_one_split(self):
        manifest=copy.deepcopy(self.base)
        a=manifest['clips'][0]; b=next(c for c in manifest['clips'][1:] if c['split']==a['split'])
        b['sha256']=a['sha256']
        with self.assertRaisesRegex(ValueError,'duplicate content'): validate_manifest(manifest)

    def test_baseline_owners_cannot_be_reassigned(self):
        owners=owners_for(self.expanded['clips'],self.base['clips'])
        for c in self.base['clips']:
            self.assertEqual(owners['signer'][c['signer']],c['split'])
            self.assertEqual(owners['source'][c['source']],c['split'])

    def test_test_tensors_are_locked_by_default(self):
        with patch('train.read',side_effect=AssertionError('Must not read any feature file')):
            with self.assertRaisesRegex(ValueError,'locked'): load_split(self.expanded,'test',[])

    def test_frozen_experiment_and_final_evaluation_are_not_rerun(self):
        with self.assertRaisesRegex(ValueError,'frozen'): experiment()
        with self.assertRaisesRegex(ValueError,'already evaluated'): final()

    def test_frozen_metadata_and_shipped_model_are_bound(self):
        frozen=read(REPORT/'frozen.json')
        self.assertEqual(sha(ROOT/'manifests/final-v2.json'),frozen['manifestSha256'])
        self.assertEqual(sha(ART/'final.onnx'),frozen['modelSha256'])
        shipped=ROOT.parents[1]/'app/public/models'
        self.assertEqual(sha(shipped/'word-classifier-v1.onnx'),frozen['modelSha256'])
        self.assertEqual(sha(shipped/'word-classifier-v1.labels.json'),frozen['metadataSha256'])

    def test_subset_preserves_label_order_and_official_splits(self):
        labels=[v['label'] for v in self.base['vocabulary']]+['white']
        selected=subset(self.expanded,labels)
        self.assertEqual([v['label'] for v in selected['vocabulary']],labels)
        self.assertTrue(all(c['label'] in labels for c in selected['clips']))
        validate_manifest(selected)


if __name__=='__main__': unittest.main()
