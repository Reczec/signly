"""Small transfer-attempt checks; no test data or webcam required."""
import unittest
import torch
from data import ROOT, read, sha
from train import WordClassifier
from transfer_v4 import ExtendedClassifier, REPORT


class TransferTests(unittest.TestCase):
    def test_training_additions_cannot_change_original_logits(self):
        base = WordClassifier(list(range(13))).eval()
        model = ExtendedClassifier(base).eval()
        inputs = torch.randn(2, 32, 162)
        with torch.no_grad(): reference = base(inputs).clone()
        optimizer = torch.optim.Adam(model.additions.parameters(), lr=.02)
        optimizer.zero_grad()
        torch.nn.functional.cross_entropy(model(inputs), torch.tensor([13, 14])).backward()
        optimizer.step()
        with torch.no_grad():
            torch.testing.assert_close(model(inputs)[:, :13], reference, rtol=0, atol=0)
        self.assertEqual(sum(p.numel() for p in model.parameters() if p.requires_grad), 130)
        self.assertTrue(all(p.grad is None for p in base.parameters()))

    def test_failed_attempt_keeps_deployed_model(self):
        result = read(REPORT / 'result.json')
        frozen = read(REPORT / 'frozen.json')
        self.assertFalse(result['passesPromotionRule'])
        self.assertEqual(frozen['selected'], 'baseline')
        self.assertFalse(result['testRead'])
        self.assertEqual(frozen['modelSha256'], sha(ROOT.parents[1] / 'app/public/models/word-classifier-v1.onnx'))


if __name__ == '__main__': unittest.main()
