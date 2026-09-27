"""V3 data boundaries and promotion regressions; never performs test inference."""
import copy
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import expansion_v3 as experiment
from data import ROOT, META, read, sha, validate_manifest
from train import load_split


class ExpansionV3Tests(unittest.TestCase):
    def test_metadata_and_all_previous_owners_stay_frozen(self):
        protocol = read(experiment.REPORT / 'protocol.json')
        manifest = read(experiment.MANIFEST)
        previous = read(ROOT / 'reports/expansion/availability.json')['owners']
        official = {'wlasl-' + c['video_id']: {'label': group['gloss'], 'signer': str(c['signer_id']),
                    'split': {'val': 'validation'}.get(c['split'], c['split'])}
                    for group in read(META / 'WLASL_v0.3.json') for c in group['instances']}
        self.assertEqual(manifest['protocolSha256'], sha(experiment.REPORT / 'protocol.json'))
        for key, owners in previous.items():
            for identity, split in owners.items():
                self.assertEqual(protocol['owners'][key][identity], split)
        for clip in manifest['clips']:
            self.assertEqual({k: clip[k] for k in ('label', 'signer', 'split')}, official[clip['id']])
            for key in ('signer', 'source'):
                self.assertEqual(protocol['owners'][key][clip[key]], clip['split'])

    def test_baseline_clips_and_holdout_membership_unchanged(self):
        base = read(experiment.BASE)
        new = read(experiment.MANIFEST)
        by_id = {c['id']: c for c in new['clips']}
        for c in base['clips']:
            self.assertEqual(by_id[c['id']]['sha256'], c['sha256'])
            self.assertEqual(by_id[c['id']]['split'], c['split'])
        labels = {v['label'] for v in base['vocabulary']}
        self.assertEqual({c['id'] for c in base['clips'] if c['split'] != 'train'},
                         {c['id'] for c in new['clips'] if c['split'] != 'train' and c['label'] in labels})

    def test_no_signer_source_or_hash_leakage_including_fixed_negatives(self):
        manifest = read(experiment.MANIFEST)
        neg = read(experiment.NEGATIVE)
        validate_manifest({**manifest, 'clips': manifest['clips'] + neg['clips']})
        self.assertFalse({v['label'] for v in manifest['vocabulary']} & {c['label'] for c in neg['clips']})
        self.assertEqual(sha(experiment.NEGATIVE), read(experiment.REPORT / 'protocol.json')['negativeManifestSha256'])

    def test_test_features_locked_without_explicit_final_permission(self):
        with patch('train.read', side_effect=AssertionError('No feature read allowed')):
            with self.assertRaisesRegex(ValueError, 'Test tensors are locked'):
                load_split(read(experiment.MANIFEST), 'test', [])

    def test_promotion_rejects_lost_old_words_or_more_false_acceptances(self):
        baseline = {'metrics': {'accuracy': .78, 'macroF1': .75},
                    'gate': {'correct': 11, 'acceptedCorrect': 6, 'acceptedWrong': 1},
                    'negative': {'accepted': 11}}
        metrics = {'accuracy': .8, 'macroF1': .76}
        paired = copy.deepcopy(baseline['gate']); negative = copy.deepcopy(baseline['negative'])
        self.assertTrue(experiment.promotion(metrics, paired, negative, baseline))
        for key, value in [('correct', 10), ('acceptedCorrect', 5), ('acceptedWrong', 2)]:
            with self.subTest(key=key):
                self.assertFalse(experiment.promotion(metrics, {**paired, key: value}, negative, baseline))
        self.assertFalse(experiment.promotion(metrics, paired, {'accepted': 12}, baseline))
        self.assertFalse(experiment.promotion({'accuracy': .7, 'macroF1': .76}, paired, negative, baseline))
        self.assertFalse(experiment.promotion({'accuracy': .8, 'macroF1': .7}, paired, negative, baseline))

    def test_gate_counts_confident_errors_and_rejections_separately(self):
        logits = np.log(np.array([[.86, .14], [.1, .9], [.6, .4]]))
        self.assertEqual(experiment.gate(logits, np.array([0, 0, 0])),
                         {'samples': 3, 'accepted': 2, 'rejected': 1, 'correct': 2, 'acceptedCorrect': 1, 'acceptedWrong': 1})

    def test_selection_is_locked_when_training_starts(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(experiment, 'REPORT', pathlib.Path(directory)):
            (pathlib.Path(directory) / 'candidate-15.json').write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Training has started'):
                experiment.prepare()

    def test_frozen_experiment_cannot_be_retuned(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(experiment, 'REPORT', pathlib.Path(directory)):
            (pathlib.Path(directory) / 'frozen.json').write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'frozen'):
                experiment.experiment()

    def test_failed_expansion_keeps_live_model_and_test_set_unopened(self):
        frozen = read(experiment.REPORT / 'frozen.json')
        self.assertEqual(frozen['selected'], 'baseline')
        self.assertEqual(sha(ROOT.parents[1] / 'app/public/models/word-classifier-v1.onnx'), frozen['modelSha256'])
        self.assertFalse(frozen['testRead'])
        with patch('train.load_split', side_effect=AssertionError('Test must stay closed')):
            with self.assertRaisesRegex(ValueError, 'No promotion'):
                experiment.final()


if __name__ == '__main__':
    unittest.main()
