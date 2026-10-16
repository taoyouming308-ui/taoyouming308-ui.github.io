#!/usr/bin/env python3
"""Prepare a reviewed academy PR. Never approve, push, merge, or claim online."""
import argparse
import datetime as dt
import hashlib
import html
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
INFRA = {'.github/workflows/academy-preflight.yml',
         '.github/workflows/publish-academy.yml',
         'scripts/prepare-academy-pr.py', 'scripts/test_prepare_academy_pr.py',
         'docs/perm/academy-connected-publication.md',
         'AGENT_SYNC_STATUS.md', 'CHANGELOG.md'}


def git(root, *args):
    return subprocess.run(['git', *args], cwd=root, check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def allowed(path):
    if path in INFRA:
        return True
    return bool(re.fullmatch(r'academy/(?:\d{4}-\d{2}-\d{2}\.html|catalog\.json|index\.html|'
                            r'(?:drafts|reviews)/\d{4}-\d{2}-\d{2}\.json|'
                            r'assets/\d{4}-\d{2}-\d{2}/[A-Za-z0-9_.-]+\.(?:svg|png|jpg|jpeg|webp)|'
                            r'publication-status/\d{4}-\d{2}-\d{2}\.json)', path))


def requested_dates(paths, today):
    dates = set()
    for path in paths:
        match = re.fullmatch(r'academy/(?:drafts|reviews)/(\d{4}-\d{2}-\d{2})\.json', path)
        if not match:
            match = re.fullmatch(r'academy/assets/(\d{4}-\d{2}-\d{2})/[^/]+', path)
        if match:
            date = match[1]
            if dt.date.fromisoformat(date) > today:
                raise ValueError('Future lesson cannot be prepared: ' + date)
            dates.add(date)
    return sorted(dates)


def fallback(document, catalog):
    rows = ''.join('<a class="item" href="' + html.escape(row['url'], quote=True) +
                   '"><small>' + row['date'] + ' · 第' + str(len(catalog['items']) - i).zfill(2) +
                   '课</small><strong>' + html.escape(row['title']) + '</strong></a>'
                   for i, row in enumerate(catalog['items']))
    pattern = r'(<div id="lessons">).*?(</div><p id="status">)'
    if len(re.findall(pattern, document, re.S)) != 1:
        raise ValueError('Unknown catalog fallback layout; preserve existing page')
    return re.sub(pattern, lambda m: m[1] + rows + m[2], document, count=1, flags=re.S)


def prepend_once(document, marker, note):
    return document if marker in document else marker + '\n' + note + '\n\n' + document


def prepare(root, publisher, dates, base_sha):
    # Verify every requested input BEFORE writing any output. Existing reviews are
    # consumed, never created, re-dated or marked approved by this program.
    pages, bindings = {}, {}
    for date in dates:
        if not DATE.fullmatch(date):
            raise ValueError('Invalid date')
        for relative in ('drafts/' + date + '.json', 'reviews/' + date + '.json'):
            target = root / 'academy' / relative
            if target.is_symlink() or not target.is_file():
                raise ValueError('Missing or symlinked reviewed input: ' + relative)
        draft = json.loads((root / 'academy/drafts' / (date + '.json')).read_text())
        review = json.loads((root / 'academy/reviews' / (date + '.json')).read_text())
        digests, _ = publisher.digest_draft(root, date, draft)
        publisher.validate_review(date, draft, review, digests)
        pages['academy/' + date + '.html'] = publisher.render(draft, review).encode('utf-8')
        bindings[date] = digests
    for relative in [*pages, 'academy/catalog.json', 'academy/index.html',
                     'AGENT_SYNC_STATUS.md', 'CHANGELOG.md']:
        if (root / relative).is_symlink():
            raise ValueError('Symlinked output forbidden: ' + relative)
    if not dates:
        return {'state': 'no_reviewed_input_changes', 'dates': [], 'changedPaths': []}
    # Test the fallback shape before creating any dated HTML.
    index_before = (root / 'academy/index.html').read_text()
    fallback(index_before, {'items': []})
    changed = []
    def write(relative, data):
        file = root / relative
        if not file.exists() or file.read_bytes() != data:
            file.write_bytes(data)
            changed.append(relative)
    for relative, data in pages.items():
        write(relative, data)
    catalog = publisher.catalog(root)
    write('academy/catalog.json', publisher.canonical(catalog) + b'\n')
    write('academy/index.html', fallback(index_before, catalog).encode('utf-8'))
    publisher.verify_published(root, publisher.LEGACY_20261011_SHA)
    bundle = hashlib.sha256(publisher.canonical(bindings)).hexdigest()
    marker = '<!-- academy-reviewed-inputs:' + bundle + ' -->'
    version = (root / 'version.txt').read_text().strip()
    note = ('## ' + dates[-1] + ' · Reviewed academy publication candidate (App version: v' +
            version + ' unchanged)\n\n- Current owner: ChatGPT content publisher. '
            'Last synchronized base checked: github/main ' + base_sha + '.\n'
            '- Dates: ' + ', '.join(dates) + '. Original reviewed drafts and local figures '
            'are preserved; no new scientific approval is generated.\n'
            '- Dated HTML, complete descending catalog and known-course fallback are rendered '
            'with the trusted main publisher. Existing lessons and all business code stay unchanged.\n'
            '- Cloud baseline backup is a prerequisite. Full pre-push, exact-head protected '
            'Validate shared app, normal merge and main/Pages readback are still required. '
            'Preparation is not publication.\n'
            '- A GITHUB_TOKEN preparation commit alone does not trigger the protected PR checks; '
            'the connected publisher must make the final status commit, then verify its exact head.')
    for relative in ('AGENT_SYNC_STATUS.md', 'CHANGELOG.md'):
        file = root / relative
        write(relative, prepend_once(file.read_text(), marker, note).encode('utf-8'))
    return {'state': 'candidate_prepared_not_published', 'dates': dates,
            'baseSha': base_sha, 'contentBindingSha256': bundle, 'changedPaths': changed,
            'published': False, 'fileSha256': {path: hashlib.sha256((root / path).read_bytes()).hexdigest()
                                             for path in pages}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='github/main')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    base = git(ROOT, 'rev-parse', '--verify', args.base + '^{commit}').decode().strip()
    git(ROOT, 'merge-base', '--is-ancestor', base, 'HEAD')
    if git(ROOT, 'status', '--porcelain').strip():
        raise ValueError('Preparation requires a clean candidate checkout')
    paths = git(ROOT, 'diff', '--name-only', '-z', base, 'HEAD').decode().split('\0')
    paths = [p for p in paths if p]
    if any(not allowed(p) for p in paths):
        raise ValueError('Non-academy change in content branch; stop without editing')
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
    dates = requested_dates(paths, today)
    with tempfile.TemporaryDirectory(prefix='trusted-academy-renderer-') as temp:
        module = Path(temp) / 'publisher.py'
        module.write_bytes(git(ROOT, 'show', base + ':scripts/publish-academy.py'))
        spec = importlib.util.spec_from_file_location('trusted_academy_publisher', module)
        publisher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(publisher)
        report = prepare(ROOT, publisher, dates, base)
    if report['changedPaths']:
        git(ROOT, 'add', '--', *report['changedPaths'])
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('changed=' + str(bool(report['changedPaths'])).lower() + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
