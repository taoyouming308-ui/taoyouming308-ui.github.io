"""Synthetic narrow-turn integration: no runtime locks, credentials or network."""
import base64
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
import urllib.parse
from unittest import mock

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.dont_write_bytecode = True
TURN_STUB = types.ModuleType('mgj_source_turns')
TURN_STUB.booking_request = lambda **_kwargs: (_ for _ in ()).throw(AssertionError('unmocked turn forbidden'))
SPEC = importlib.util.spec_from_file_location('booking_turn_fixture', Path(__file__).with_name('sync_mgj_bookings.py'))
s = importlib.util.module_from_spec(SPEC)
with mock.patch.dict(sys.modules, {'mgj_source_turns': TURN_STUB}):
    SPEC.loader.exec_module(s)


class TurnBusy(RuntimeError):
    pass


class TurnUnsafe(RuntimeError):
    pass


class BookingTurnTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.wait = 0
        self.active = False
        self.turns = []
        self.events = []
        self.patches = [mock.patch.object(s, 'RUN_DEADLINE', 90),
                        mock.patch.object(s.time, 'monotonic', side_effect=lambda: self.now),
                        mock.patch.object(s.time, 'sleep', side_effect=self.sleep),
                        mock.patch.object(s.source_turns, 'booking_request', side_effect=self.guard),
                        mock.patch.object(s, 'source_urlopen', side_effect=AssertionError('unmocked source forbidden')),
                        mock.patch.object(s.urllib.request, 'urlopen', side_effect=AssertionError('unmocked cloud forbidden'))]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)

    def sleep(self, seconds):
        self.assertFalse(self.active, 'network retry sleeps must release intent and request gate')
        self.events.append(('sleep', seconds))
        self.now += seconds

    @contextmanager
    def guard(self, deadline=None, **kwargs):
        self.assertFalse(self.active, 'source turns must not nest or wrap the entire batch')
        self.turns.append({'deadline': deadline, **kwargs})
        self.now += self.wait
        self.active = True
        self.events.append(('turn', 'enter'))
        try:
            yield
        finally:
            self.events.append(('turn', 'exit'))
            self.active = False

    def response(self, value, guarded=True, read_error=None):
        case = self
        class Response:
            def __enter__(self):
                case.assertEqual(case.active, guarded)
                return self
            def read(self):
                case.assertEqual(case.active, guarded, 'the complete response body stays inside its turn')
                case.events.append(('read', guarded))
                if read_error:
                    raise read_error
                return json.dumps(value).encode()
            def __exit__(self, *_args):
                case.assertEqual(case.active, guarded, 'close source response before releasing turn')
        return Response()

    def test_source_http_and_complete_body_are_guarded(self):
        def source(request, timeout):
            self.assertTrue(self.active)
            self.assertEqual(request.full_url, 'https://vip12.meiguanjia.net/shair/metedata!reservationMetadata.action')
            self.assertEqual(request.get_header('Cookie'), 'synthetic-cookie')
            self.assertEqual(timeout, 10)
            return self.response({'code': 0})
        with mock.patch.object(s, 'source_urlopen', side_effect=source):
            self.assertEqual(s.request_json('https://vip12.meiguanjia.net/shair/metedata!reservationMetadata.action',
                                            cookie='synthetic-cookie', timeout=10), {'code': 0})
        self.assertEqual(self.turns, [{'deadline': 90}])
        self.assertEqual(self.events, [('turn', 'enter'), ('read', True), ('turn', 'exit')])

    def test_timeout_recomputed_after_existing_customer_finishes(self):
        self.wait = 9.9
        with mock.patch.object(s, 'RUN_DEADLINE', 15), mock.patch.object(s, 'source_urlopen', return_value=self.response({'code': 0})) as source:
            self.assertEqual(s.request_json('https://vip12.meiguanjia.net/shair/reservation!list.action'), {'code': 0})
        self.assertEqual(source.call_args.kwargs['timeout'], 5)
        self.assertEqual(source.call_count, 1, 'waiting for a customer does not repeat the source request')

    def test_deadline_exhausted_during_wait_never_sends_http(self):
        self.wait = 1
        with mock.patch.object(s, 'RUN_DEADLINE', 1), mock.patch.object(s, 'source_urlopen') as source:
            with self.assertRaises(TimeoutError):
                s.request_json('https://vip12.meiguanjia.net/shair/reservation!list.action')
        source.assert_not_called()
        self.assertEqual(len(self.turns), 1)
        self.assertFalse(self.active)

    def test_transient_source_retries_release_turn_before_one_and_three_second_sleeps(self):
        calls = []
        def source(_request, timeout):
            self.assertTrue(self.active)
            calls.append(timeout)
            if len(calls) < 3:
                raise TimeoutError('synthetic source timeout')
            return self.response({'code': 0})
        with mock.patch.object(s, 'source_urlopen', side_effect=source):
            self.assertEqual(s.request_json('https://vip12.meiguanjia.net/shair/reservation!list.action'), {'code': 0})
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(self.turns), 3)
        self.assertEqual([event for event in self.events if event[0] == 'sleep'], [('sleep', 1), ('sleep', 3)])

    def test_body_failure_releases_turn_before_existing_retry(self):
        with mock.patch.object(s, 'source_urlopen', side_effect=[self.response({}, read_error=TimeoutError('synthetic body timeout')),
                                                               self.response({'code': 0})]) as source:
            self.assertEqual(s.request_json('https://vip12.meiguanjia.net/shair/reservation!list.action'), {'code': 0})
        self.assertEqual(source.call_count, 2)
        self.assertEqual(len(self.turns), 2)
        self.assertFalse(self.active)

    def test_busy_or_unsafe_turn_cannot_send_or_replay_source_request(self):
        for error in (TurnBusy('turn_busy'), TurnUnsafe('turn_unsafe')):
            with self.subTest(code=str(error)), mock.patch.object(s.source_turns, 'booking_request', side_effect=error) as guard, mock.patch.object(s, 'source_urlopen') as source:
                with self.assertRaises(type(error)):
                    s.request_json('https://vip12.meiguanjia.net/shair/reservation!list.action')
                source.assert_not_called()
                self.assertEqual(guard.call_count, 1)
        self.assertFalse(any(event[0] == 'sleep' for event in self.events))

    def test_login_http_body_and_cookie_jar_remain_guarded_with_same_payload(self):
        self.wait = 9.9
        jar = [types.SimpleNamespace(name='JSESSIONID', value='synthetic-session')]
        def open_login(request, timeout):
            self.assertTrue(self.active)
            self.assertEqual(timeout, 5)
            self.assertEqual(request.full_url, 'https://vip12.meiguanjia.net/shair/loginAction!ajaxLogin.action?v=mgj')
            self.assertEqual(urllib.parse.parse_qs(request.data.decode())['login'], ['synthetic-user'])
            self.assertEqual(urllib.parse.parse_qs(request.data.decode())['passwd'], ['synthetic-password'])
            return self.response({'code': 7})
        opener = mock.Mock()
        opener.open.side_effect = open_login
        with mock.patch.object(s, 'RUN_DEADLINE', 15), mock.patch.object(s.http.cookiejar, 'CookieJar', return_value=jar), mock.patch.object(s.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(s.login('vip12.meiguanjia.net', 'synthetic-user', 'synthetic-password'), 'JSESSIONID=synthetic-session')
        self.assertEqual(opener.open.call_count, 1)
        self.assertEqual(len(self.turns), 1)

    def test_expired_login_deadline_sends_nothing(self):
        self.wait = 1
        opener = mock.Mock()
        with mock.patch.object(s, 'RUN_DEADLINE', 1), mock.patch.object(s.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaises(TimeoutError):
                s.login('vip12.meiguanjia.net', 'synthetic-user', 'synthetic-password')
        opener.open.assert_not_called()
        self.assertFalse(self.active)

    def test_failed_login_body_does_not_retry_or_retain_turn(self):
        opener = mock.Mock()
        opener.open.return_value = self.response({}, read_error=TimeoutError('synthetic login body'))
        with mock.patch.object(s.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaises(TimeoutError):
                s.login('vip12.meiguanjia.net', 'synthetic-user', 'synthetic-password')
        self.assertEqual(opener.open.call_count, 1)
        self.assertFalse(self.active)
        self.assertFalse(any(event[0] == 'sleep' for event in self.events))

    def test_signed_begin_commit_abort_and_cloud_body_do_not_use_source_turn(self):
        key = Ed25519PrivateKey.generate()
        for operation in ('begin', 'commit', 'abort'):
            payload = {'protocol': 2, 'operation': operation, 'shop_id': '1009951', 'date': '2026-11-20',
                       'lease_id': 'b9d51143-5e01-473e-a9d5-e43c00c5b90a', 'bookings': []}
            result = {**payload, 'generation': 1, 'upserted': 0, 'deleted': 0,
                      'expires_at': (datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat()}
            with self.subTest(operation=operation), mock.patch.object(s.urllib.request, 'urlopen', return_value=self.response(result, guarded=False)) as cloud:
                self.assertEqual(s.signed_protocol_request(payload, key), result)
                request = cloud.call_args.args[0]
                stamp, signature = request.get_header('X-booking-sync-ts'), request.get_header('X-booking-sync-signature')
                key.public_key().verify(base64.urlsafe_b64decode(signature + '=='), stamp.encode() + b'.' + request.data)
        self.assertEqual(self.turns, [])

    def test_cloud_retry_sleep_never_announces_source_intent(self):
        payload = {'protocol': 2, 'operation': 'abort', 'shop_id': '1009951', 'date': '2026-11-20', 'lease_id': 'fixture-lease'}
        response = self.response(payload, guarded=False)
        with mock.patch.object(s.urllib.request, 'urlopen', side_effect=[TimeoutError('synthetic cloud timeout'), response]) as cloud:
            self.assertEqual(s.signed_protocol_request(payload, Ed25519PrivateKey.generate()), payload)
        self.assertEqual(cloud.call_count, 2)
        self.assertEqual(self.turns, [])
        self.assertEqual([event for event in self.events if event[0] == 'sleep'], [('sleep', 1)])

    def test_existing_run_lock_scheduled_budget_and_attempt_cadence_are_unchanged(self):
        self.assertEqual(s.RUN_LOCK_PATH, '/tmp/sync_mgj_bookings.lock')
        self.assertEqual(s.RUN_BUDGET_SECONDS, 105)
        for scheduled, budget in ((True, 90), (False, 105)):
            lock = object()
            args = ['sync_mgj_bookings.py'] + (['--scheduled'] if scheduled else [])
            with self.subTest(scheduled=scheduled), mock.patch.object(s.sys, 'argv', args), mock.patch.object(s.os, 'getuid', return_value=501), mock.patch.object(s.os, 'geteuid', return_value=501), mock.patch.object(s, 'acquire_lock', return_value=lock) as acquire, mock.patch.object(s, 'release_lock') as release, mock.patch.object(s, 'load_json', return_value={'dates': {}}), mock.patch.object(s, 'scheduled_dates', return_value=['2026-11-20']), mock.patch.object(s, 'atomic_write_json') as write, mock.patch.object(s, 'sync_bookings', return_value=0), mock.patch.object(s.time, 'time', return_value=1000):
                self.assertEqual(s.main(), 0)
                self.assertEqual(s.RUN_DEADLINE, budget)
                acquire.assert_called_once_with('/tmp/sync_mgj_bookings.lock')
                release.assert_called_once_with(lock)
                self.assertEqual(write.call_args.args[1]['attempt_at'], 1000)
        self.assertEqual(self.turns, [])


if __name__ == '__main__':
    unittest.main()
