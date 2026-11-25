"""Check investigation coverage, source identities and model-comparison frames."""
import importlib.util
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
spec = importlib.util.spec_from_file_location('candidate_audit', ROOT/'tools/binary-candidate-audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class CandidateAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = audit.investigate(write=False)
        cls.by_record = {c['record']: c for c in cls.report['candidates']}

    def test_report_reproduces_and_covers_every_original_candidate(self):
        saved = json.loads((ROOT/'data/binary-candidate-audit.json').read_text())
        self.assertEqual(self.report, saved)
        self.assertEqual(len(self.by_record), 115)
        selection = json.loads((ROOT/'data/binary-selection.json').read_text())
        pending = {c['record'] for c in selection['candidates'] if c['status'].startswith('pending')}
        self.assertEqual(pending, {c['record'] for c in self.report['candidates'] if c['status'] != 'accepted-reviewed-model'})
        self.assertEqual(sum(self.report['summary']['outcomes'].values()), 115)

    def test_all_relative_models_match_published_ephemerides(self):
        self.assertEqual(self.report['summary']['relativeEphemeridesChecked'], 575)
        self.assertTrue(all(c['relativeOrbitCheck']['passed'] for c in self.report['candidates']))
        polar = self.by_record['wds04100+8042a.png']['relativeOrbitCheck']
        self.assertGreater(max(r['unprecessedPositionAngleErrorDegrees'] for r in polar['samples']), .8)
        self.assertLess(polar['maxPositionAngleErrorDegrees'], .1)

    def test_wrong_hip_is_preserved_but_not_used(self):
        c = self.by_record['wds20591+0418c.png']
        self.assertEqual(c['identity']['printedHip'], '103579')
        self.assertEqual(c['identity']['reviewedHip'], '103569')
        self.assertGreater(c['identity']['printedHipOffsetFromSourceArcsec'], 140000)
        self.assertLess(c['identity']['reviewedHipOffsetFromSourceArcsec'], 2)
        self.assertTrue(c['identity']['matchingHD'])
        selection = json.loads((ROOT/'data/binary-selection.json').read_text())
        corrected = next(r for r in selection['candidates'] if r['record']==c['record'])
        self.assertEqual(corrected['primaryHip'], '103569')
        self.assertEqual(corrected['cataloguePrimaryHip'], '103579')

    def test_photometric_ratio_does_not_accept_a_model(self):
        c = self.by_record['wds14514+1906i.png']
        self.assertEqual(c['massEvidence'], 'photometric-estimate-only-in-reviewed-catalogue')
        self.assertIn('reviewed-dynamical-or-adopted-subsystem-mass-ratio-needed', c['blockers'])
        self.assertNotEqual(c['status'], 'accepted-reviewed-model')
        c = next(c for c in self.report['candidates'] if c['identity']['reviewedHip']=='78727')
        self.assertEqual(c['status'], 'missing-absolute-astrometry')

    def test_distinct_levels_of_same_system_require_hierarchy_review(self):
        pairs = [c for c in self.report['candidates'] if c['wds']=='08468+0625']
        self.assertEqual(len(pairs), 2)
        self.assertTrue(all(c['hierarchyScopeFlag'] for c in pairs))
        self.assertEqual(sum(c['status']=='accepted-reviewed-model' for c in self.report['candidates']), 1)
        self.assertEqual(self.by_record['wds04301+1538c.png']['status'], 'accepted-reviewed-model')


if __name__ == '__main__':
    unittest.main()
