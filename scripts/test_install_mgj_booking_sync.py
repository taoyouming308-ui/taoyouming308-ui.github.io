import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch
from scripts import install_mgj_booking_sync as installer

class InstallerTests(unittest.TestCase):
    def test_preflight_rejects_unknown_runtime_and_duplicate_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            jobs=root/'jobs.json'; jobs.write_text('{"jobs":[]}')
            consumption=root/'consumption.plist'; consumption.write_bytes(b'existing')
            with patch.multiple(installer,RUNTIME=root,PLIST=root/'booking.plist',JOBS=jobs,CONSUMPTION_PLIST=consumption), patch.object(installer.os,'getuid',return_value=501), patch.object(installer.os,'geteuid',return_value=501), patch.object(installer.subprocess,'run') as run:
                run.return_value.returncode=0;run.return_value.stdout='';run.return_value.stderr=''
                files={'sync_mgj_bookings.py':b'canonical'}
                installer.preflight(files,b'plist')
                runtime=root/'sync_mgj_bookings.py';runtime.write_bytes(b'unknown')
                with self.assertRaisesRegex(RuntimeError,'unknown_runtime'):installer.preflight(files,b'plist')
                runtime.write_bytes(b'canonical')
                installer.preflight(files,b'plist')
                jobs.write_text(json.dumps({'jobs':[{'enabled':True,'script':'sync_bookings_wrapper.sh'}]}))
                with self.assertRaisesRegex(RuntimeError,'existing_hermes'):installer.preflight(files,b'plist')
                jobs.write_text('{"jobs":[]}');run.return_value.stdout='* * * * * sync_bookings_wrapper.sh'
                with self.assertRaisesRegex(RuntimeError,'existing_os'):installer.preflight(files,b'plist')
                run.return_value.stdout='';run.return_value.returncode=1;run.return_value.stderr='permission denied'
                with self.assertRaisesRegex(RuntimeError,'unavailable'):installer.preflight(files,b'plist')

    def test_task_uses_fixed_interpreter_and_preserves_separate_consumption(self):
        task=plistlib.loads(installer.plist_bytes())
        self.assertEqual(task['StartInterval'],60)
        self.assertEqual(task['ProgramArguments'],['/usr/bin/python3','/Users/a1/.hermes/scripts/sync_mgj_bookings.py','--scheduled'])
        files=installer.desired_files()
        self.assertNotIn('sync_mgj_daily_consumption.py',files)
        self.assertNotIn('meiguanjia-config.json',files)
        self.assertIn(b'runpy.run_path',files['sync_bookings_v2.py'])

    def test_atomic_install_keeps_exact_bytes_and_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'script.py';p.write_bytes(b'old')
            installer.atomic_write(p,b'new',0o700)
            self.assertEqual(p.read_bytes(),b'new')
            self.assertEqual(p.stat().st_mode&0o777,0o700)

if __name__=='__main__':unittest.main()
