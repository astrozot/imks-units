"""Regression checks for ORB6 photometry and reviewed barycentric anchors."""
import copy
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from binary_expansion import component_magnitudes, screened_candidates, hip_barycentric_system


class BinaryExpansionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.review = json.loads((ROOT / 'data/binary-reviewed-additions.json').read_text())
        cls.refs = {r['name']: r['elements'] for r in json.loads((ROOT / 'tests/fixtures/binary-orbits.json').read_text())}
        raw = (ROOT / 'js/stardata.js').read_text()
        cls.chart = json.loads(raw[raw.index('[\n'):raw.rfind(']') + 1])

    def test_faint_secondary_retains_tens_digit(self):
        self.assertEqual(component_magnitudes(self.refs['Procyon']), [.46, 10.8])
        self.assertEqual(component_magnitudes(self.refs['μ Cassiopeiae']), [5.3, 10.7])
        self.assertEqual(component_magnitudes(self.refs['Sirius'])[0], -1.47)

    def test_screen_uses_secondary_flag_and_configured_limits(self):
        line = self.refs['μ Cassiopeiae']
        selection = self.review['selection']
        self.assertEqual(len(screened_candidates([line], selection)), 1)
        # T79 is the secondary band flag, independent of the spacer at T80.
        infrared = line[:78] + 'k' + line[79:]
        self.assertEqual(screened_candidates([infrared], selection), [])
        unknown = line[:73] + '    .' + line[78:]
        self.assertEqual(screened_candidates([unknown], selection), [])
        tighter = dict(selection, secondaryVisualMagnitudeMax=10)
        self.assertEqual(screened_candidates([line], tighter), [])

    def test_primary_and_photocentre_are_not_barycentres(self):
        cfg = next(c for c in self.review['systems'] if c['name'] == 'μ Cassiopeiae')
        data = json.loads((ROOT / 'data/binary-hipparcos-sources.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'data').mkdir()
            for flag in ['A', '*', '']:
                source = copy.deepcopy(data)
                source['records']['5336']['AstroRef'] = flag
                (root / 'data/binary-hipparcos-sources.json').write_text(json.dumps(source))
                with self.assertRaises(AssertionError):
                    hip_barycentric_system(root, cfg, self.refs[cfg['name']], self.chart)

    def test_mass_sum_must_match_orbit_and_distance(self):
        cfg = copy.deepcopy(next(c for c in self.review['systems'] if c['name'] == 'μ Cassiopeiae'))
        cfg['masses'] = [1, 1]
        with self.assertRaises(AssertionError):
            hip_barycentric_system(ROOT, cfg, self.refs[cfg['name']], self.chart)


if __name__ == '__main__':
    unittest.main()
