"""Isolated preparation regressions; synthetic inputs are never published."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest
from scripts.test_publish_academy import PublisherTests, p, DATE

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-academy-pr.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PrepareTests(PublisherTests):
    def setUp(self):
        super().setUp()
        (self.root / 'academy/index.html').write_text('<nav>UNCHANGED</nav><div id="lessons">OLD</div><p id="status">state</p>')
        (self.root / 'academy/catalog.json').write_text('{"schemaVersion":1,"items":[]}')
        (self.root / 'version.txt').write_text('635\n')
        (self.root / 'AGENT_SYNC_STATUS.md').write_text('# Agent Sync Status\nEXISTING BATON\n')
        (self.root / 'CHANGELOG.md').write_text('EXISTING CHANGELOG\n')

    def test_preparation_is_idempotent_and_preserves_records(self):
        review = (self.root / 'academy/reviews' / (DATE + '.json')).read_bytes()
        first = m.prepare(self.root, p, [DATE], 'a' * 40)
        self.assertFalse(first['published'])
        self.assertIn('academy/' + DATE + '.html', first['changedPaths'])
        self.assertEqual(m.prepare(self.root, p, [DATE], 'a' * 40)['changedPaths'], [])
        self.assertEqual((self.root / 'academy/reviews' / (DATE + '.json')).read_bytes(), review)
        self.assertIn('EXISTING BATON', (self.root / 'AGENT_SYNC_STATUS.md').read_text())
        self.assertEqual((self.root / 'version.txt').read_text(), '635\n')

    def test_invalid_review_writes_nothing(self):
        self.review['status'] = 'pending'
        self.write_review()
        before = {f: f.read_bytes() for f in self.root.rglob('*') if f.is_file()}
        with self.assertRaises(ValueError):
            m.prepare(self.root, p, [DATE], 'a' * 40)
        self.assertEqual(before, {f: f.read_bytes() for f in self.root.rglob('*') if f.is_file()})

    def test_no_dates_no_output(self):
        self.assertEqual(m.prepare(self.root, p, [], 'a' * 40)['changedPaths'], [])

    def test_unknown_fallback_does_not_overwrite(self):
        with self.assertRaises(ValueError):
            m.fallback('<p>CHANGED DESIGN</p>', {'items': []})

    def test_fallback_escapes_title(self):
        page = m.fallback('<div id="lessons">OLD</div><p id="status">',
                         {'items': [{'date': DATE, 'url': DATE + '.html', 'title': '<script>'}]})
        self.assertIn('&lt;script&gt;', page)
        self.assertNotIn('<script>', page)

    def test_scope_and_future_date_guards(self):
        for bad in ['perm-app.html', 'version.txt', 'supabase/functions/a/index.ts',
                    'academy/../perm-app.html', 'academy/assets/2026-10-16/code.js']:
            self.assertFalse(m.allowed(bad))
        for good in ['academy/drafts/2026-10-16.json', 'academy/assets/2026-10-16/figure1.svg',
                     'academy/catalog.json', 'AGENT_SYNC_STATUS.md']:
            self.assertTrue(m.allowed(good))
        with self.assertRaises(ValueError):
            m.requested_dates(['academy/drafts/2026-10-17.json'], dt.date(2026, 10, 16))
        self.assertEqual(m.requested_dates(['academy/drafts/2026-10-15.json',
                         'academy/reviews/2026-10-15.json'], dt.date(2026, 10, 16)), ['2026-10-15'])

    def test_symlinked_output_is_rejected(self):
        page = self.root / 'academy' / (DATE + '.html')
        external = self.root / 'outside'
        external.write_text('PRIVATE')
        page.symlink_to(external)
        with self.assertRaises(ValueError):
            m.prepare(self.root, p, [DATE], 'a' * 40)
        self.assertEqual(external.read_text(), 'PRIVATE')


if __name__ == '__main__':
    unittest.main()
