import ssl
import unittest
import urllib.request
from unittest.mock import patch, Mock
from scripts import sync_mgj_daily_consumption as daily
from scripts import audit_mgj_daily_report_source as audit

class TransportTests(unittest.TestCase):
    def test_exact_host_direct_tls_verified(self):
        opener = Mock()
        with patch.object(daily.urllib.request, 'build_opener', return_value=opener) as build:
            req = urllib.request.Request('https://vip12.meiguanjia.net/shair/bill!bill.action')
            daily.source_urlopen(req, 7)
            handlers = build.call_args.args
            self.assertEqual(handlers[0].proxies, {})
            self.assertIsInstance(handlers[1], daily.NoSourceRedirect)
            ctx = handlers[2]._context
            self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(ctx.check_hostname)
            opener.open.assert_called_once_with(req, timeout=7)
    def test_other_destinations_rejected(self):
        for url in ['http://vip12.meiguanjia.net/', 'https://example.com/', 'https://vip12.meiguanjia.net.evil/', 'https://x@vip12.meiguanjia.net/', 'https://vip12.meiguanjia.net:444/']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                daily.source_urlopen(urllib.request.Request(url), 1)
            with self.subTest(url=url), self.assertRaises(audit.AuditError):
                audit.curl_request(url, [], runner=Mock())
    def test_redirect_rejected(self):
        with self.assertRaises(ValueError):
            daily.NoSourceRedirect().redirect_request(None,None,302,'',None,'https://other.test/')
    def test_curl_only_source_direct(self):
        runner=Mock(return_value=Mock(returncode=0,stdout='ok\n200'))
        self.assertEqual(audit.curl_request(audit.DETAIL_URL,[],runner=runner),'ok')
        command=runner.call_args.args[0]
        self.assertEqual(command[command.index('--noproxy')+1], audit.SERVER)
        self.assertNotIn('-k',command)
        self.assertNotIn('--insecure',command)
        self.assertNotIn('-L',command)
if __name__=='__main__': unittest.main()
