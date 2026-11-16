import importlib.util
import io
import pathlib
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from unittest import mock


SCRIPT_PATH = pathlib.Path(__file__).with_name("sync_mgj_customer_profiles.py")
SPEC = importlib.util.spec_from_file_location("sync_mgj_customer_profiles", SCRIPT_PATH)
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


class MergeProfileTests(unittest.TestCase):
    def setUp(self):
        self.existing = {
            "phone": "18626895050",
            "name": "张小姐",
            "shop_name": "自由手艺人",
            "barber_name": "无名",
            "total_visits": 17,
            "total_consumption": 12410,
            "last_visit_date": "2026-06-25 20:41",
            "card_packages": [{"id": "p1", "name": "酸护套餐", "left": 2, "total": 4}],
            "service_history": [{
                "id": "b1",
                "source_id": "b1",
                "date": "2026-06-25",
                "time": "20:41",
                "items": [{"name": "酸护套餐"}],
                "barber": "无名",
            }],
            "notes": "老客户备注",
        }

    def test_partial_failure_never_erases_arrays(self):
        incoming = {
            "phone": "18626895050",
            "name": "张小姐",
            "card_packages": [],
            "service_history": [],
            "_packages_complete": False,
            "_history_complete": False,
        }
        merged = SYNC.merge_profile(self.existing, incoming)
        self.assertEqual(merged["card_packages"], self.existing["card_packages"])
        self.assertEqual(merged["service_history"], self.existing["service_history"])
        self.assertEqual(merged["total_visits"], 17)

    def test_authoritative_empty_packages_can_clear_used_packages(self):
        incoming = {
            "phone": "18626895050",
            "card_packages": [],
            "_packages_complete": True,
            "_history_complete": False,
        }
        merged = SYNC.merge_profile(self.existing, incoming)
        self.assertEqual(merged["card_packages"], [])

    def test_history_deduplicates_and_keeps_existing_detail(self):
        incoming = {
            "phone": "18626895050",
            "service_history": [{
                "id": "b1",
                "source_id": "b1",
                "date": "2026-06-25",
                "time": "20:41",
                "items": [],
                "amount": 0,
            }],
            "_packages_complete": False,
            "_history_complete": True,
        }
        merged = SYNC.merge_profile(self.existing, incoming)
        self.assertEqual(len(merged["service_history"]), 1)
        self.assertEqual(merged["service_history"][0]["items"], [{"name": "酸护套餐"}])
        self.assertEqual(merged["service_history"][0]["barber"], "无名")

    def test_notes_preserve_existing_content(self):
        incoming = {
            "phone": "18626895050",
            "avg_fee": 730,
            "source_customer_id": "162098687",
            "_packages_complete": False,
            "_history_complete": False,
        }
        merged = SYNC.merge_profile(self.existing, incoming)
        self.assertIn("老客户备注", merged["notes"])
        self.assertIn("均消¥730", merged["notes"])
        self.assertIn("美管加客户ID:162098687", merged["notes"])

    def test_backfill_mode_preserves_all_existing_nonempty_fields(self):
        incoming = {
            "phone": "18626895050",
            "name": "新名字",
            "total_visits": 99,
            "total_consumption": 99999,
            "card_packages": [{"id": "new"}],
            "service_history": [{"id": "new"}],
            "_packages_complete": True,
            "_history_complete": True,
        }
        merged = SYNC.merge_profile(self.existing, incoming, fill_missing_only=True)
        self.assertEqual(merged["name"], "张小姐")
        self.assertEqual(merged["total_visits"], 17)
        self.assertEqual(merged["total_consumption"], 12410)
        self.assertEqual(merged["card_packages"], self.existing["card_packages"])
        self.assertEqual(merged["service_history"], self.existing["service_history"])

    def test_backfill_mode_fills_empty_arrays(self):
        existing = dict(self.existing)
        existing["card_packages"] = []
        existing["service_history"] = []
        incoming = {
            "phone": "18626895050",
            "card_packages": [{"id": "p2", "name": "剪发卡"}],
            "service_history": [{"id": "b2", "date": "2026-06-28"}],
            "_packages_complete": True,
            "_history_complete": True,
        }
        merged = SYNC.merge_profile(existing, incoming, fill_missing_only=True)
        self.assertEqual(merged["card_packages"][0]["id"], "p2")
        self.assertEqual(merged["service_history"][0]["id"], "b2")


class MemberCardSelectionTests(unittest.TestCase):
    def test_skips_default_empty_card_when_customer_has_multiple_cards(self):
        cards = [
            {"id": 100, "cardtypeid": "20151212"},
            {"id": 200, "cardtypeid": "VIP"},
        ]
        self.assertEqual(SYNC.choose_member_card(cards, 999), 200)

    def test_uses_first_normal_card(self):
        cards = [{"id": 300, "cardtypeid": "VIP"}, {"id": 400, "cardtypeid": "OTHER"}]
        self.assertEqual(SYNC.choose_member_card(cards, 999), 300)

    def test_uses_search_fallback_when_detail_has_no_cards(self):
        self.assertEqual(SYNC.choose_member_card([], 999), 999)


class HistorySessionRoutingTests(unittest.TestCase):
    @mock.patch.object(SYNC, "multipart_post")
    @mock.patch.object(SYNC, "session_shop_id", return_value="1009951")
    def test_bill_history_uses_isolated_read_only_session(self, session_shop_id, post):
        post.return_value = {"code": 0, "content": [], "count": 0, "pageIndex": 1}
        config_path = "/tmp/read-only-history-session.json"

        self.assertEqual(
            SYNC.fetch_service_history(
                "customer-1",
                123,
                "1837032",
                detail_calls=0,
                config_path=config_path,
            ),
            [],
        )
        session_shop_id.assert_called_once_with(config_path)
        self.assertEqual(post.call_args.kwargs["config_path"], config_path)

    def test_recent_bill_rotation_does_not_waste_calls_on_old_history(self):
        history = [
            {"id": "newest", "date": "2026-07-30"},
            {"id": "recent-1", "date": "2026-07-20"},
            {"id": "recent-2", "date": "2026-07-15"},
            {"id": "old", "date": "2025-01-01"},
        ]
        indexes = SYNC.select_history_detail_indexes(
            history,
            detail_calls=2,
            recent_days=45,
            slot=1,
            today=SYNC.datetime(2026, 7, 30).date(),
        )
        self.assertEqual(indexes[0], 0)
        self.assertIn(indexes[1], (1, 2))
        self.assertNotIn(3, indexes)

    def test_service_refresh_can_enrich_multiple_recent_bills_per_customer(self):
        history = [
            {"id": f"bill-{index}", "date": f"2026-07-{30-index:02d}"}
            for index in range(10)
        ]
        indexes = SYNC.select_history_detail_indexes(
            history,
            detail_calls=8,
            recent_days=45,
            slot=0,
            today=SYNC.datetime(2026, 7, 30).date(),
        )
        self.assertEqual(len(indexes), 8)
        self.assertEqual(len(indexes), len(set(indexes)))


class SessionIdentityTests(unittest.TestCase):
    def test_reads_employee_id_from_current_session_cookie(self):
        with mock.patch.object(SYNC, "load_config", return_value={}), \
             mock.patch.object(SYNC, "load_cookies", return_value="JSESSIONID=x; userId=831819; shopId=1009951"):
            self.assertEqual(SYNC.session_employee_id(), "831819")

    def test_explicit_employee_id_overrides_cookie(self):
        with mock.patch.object(SYNC, "load_config", return_value={"emp_id": "900001"}), \
             mock.patch.object(SYNC, "load_cookies", return_value="userId=831819"):
            self.assertEqual(SYNC.session_employee_id(), "900001")


class SyncWindowTests(unittest.TestCase):
    def test_incremental_batch_fits_hermes_execution_window(self):
        self.assertEqual(SYNC.INCREMENTAL_SYNC_LIMIT, 8)

    def test_rotates_and_wraps_without_duplicates(self):
        phones = [f"phone-{index}" for index in range(7)]
        selected = SYNC.select_sync_window(phones, limit=3, slot=2)
        self.assertEqual(selected, ["phone-6", "phone-0", "phone-1"])
        self.assertEqual(len(selected), len(set(selected)))

    def test_retry_customers_consume_capacity_without_exceeding_batch_limit(self):
        retry_phones = ["retry-1", "retry-2"]
        normal = SYNC.select_sync_window(
            [f"normal-{index}" for index in range(10)],
            limit=SYNC.INCREMENTAL_SYNC_LIMIT - len(retry_phones),
            slot=0,
        )
        self.assertEqual(len(retry_phones + normal), SYNC.INCREMENTAL_SYNC_LIMIT)

    def test_keeps_short_list_unchanged(self):
        phones = ["a", "b"]
        self.assertEqual(SYNC.select_sync_window(phones, limit=3, slot=10), phones)

    def test_service_refresh_reserves_capacity_for_hair_form_customers(self):
        selected = SYNC.select_service_refresh_phones(
            ["hair-1", "hair-2", "hair-3"],
            ["booking-1", "hair-1", "booking-2"],
            limit=3,
            slot=0,
        )
        self.assertEqual(len(selected), 3)
        self.assertEqual(len([phone for phone in selected if phone.startswith("hair-")]), 2)
        self.assertEqual(len(selected), len(set(selected)))


class NetworkRetryTests(unittest.TestCase):
    def tearDown(self):
        SYNC.RUN_DEADLINE = None

    @mock.patch.object(SYNC.time, "sleep")
    def test_transient_timeout_retries_then_succeeds(self, sleep):
        operation = mock.Mock(side_effect=[TimeoutError("slow"), {"ok": True}])
        self.assertEqual(SYNC.with_network_retries(operation, 10), {"ok": True})
        self.assertEqual(operation.call_count, 2)
        sleep.assert_called_once_with(1)

    @mock.patch.object(SYNC.time, "sleep")
    def test_non_transient_http_error_is_not_retried(self, sleep):
        error = urllib.error.HTTPError("https://example.invalid", 400, "bad", {}, io.BytesIO())
        operation = mock.Mock(side_effect=error)
        try:
            with self.assertRaises(urllib.error.HTTPError):
                SYNC.with_network_retries(operation, 10)
            self.assertEqual(operation.call_count, 1)
            sleep.assert_not_called()
        finally:
            error.close()


class RetryQueueTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 8, 6, 18, 0, tzinfo=timezone(timedelta(hours=8)))

    def test_failure_is_persisted_and_success_removes_it(self):
        queue = SYNC.update_retry_queue(
            {"version": 1, "items": []},
            [{"phone": "13800000000", "success": False, "error": "timeout"}],
            now=self.now,
        )
        self.assertEqual(queue["items"][0]["attempts"], 1)
        self.assertEqual(queue["items"][0]["status"], "pending")
        recovered = SYNC.update_retry_queue(
            queue,
            [{"phone": "13800000000", "success": True}],
            now=self.now,
        )
        self.assertEqual(recovered["items"], [])

    def test_fifth_failure_requires_manual_review(self):
        queue = {
            "version": 1,
            "items": [{
                "phone": "13800000000",
                "attempts": 4,
                "status": "pending",
                "first_failed_at": self.now.isoformat(),
            }],
        }
        updated = SYNC.update_retry_queue(
            queue,
            [{"phone": "13800000000", "success": False, "error": "still failing"}],
            now=self.now,
        )
        self.assertEqual(updated["items"][0]["status"], "needs_review")
        self.assertNotIn("next_retry_at", updated["items"][0])

    def test_queue_file_is_private_and_atomic(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "queue.json"
            SYNC.save_retry_queue({"version": 1, "items": []}, str(path))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_corrupt_queue_is_not_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "queue.json"
            path.write_text("not-json", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "补偿队列不可读"):
                SYNC.load_retry_queue(str(path))
            self.assertEqual(path.read_text(encoding="utf-8"), "not-json")


class BookingPhoneQueryTests(unittest.TestCase):
    @mock.patch.object(SYNC, "supabase_get", side_effect=TimeoutError("offline"))
    def test_all_phone_sources_failing_is_not_reported_as_empty_success(self, get):
        with self.assertRaisesRegex(RuntimeError, "预约手机号查询全部失败"):
            SYNC.get_booking_phones(days_back=1, days_forward=2)
        self.assertEqual(get.call_count, 2)

    def test_expired_budget_skips_without_calling_customer_api(self):
        SYNC.RUN_DEADLINE = SYNC.time.monotonic() - 1
        try:
            with mock.patch.object(SYNC, "get_customer_full") as fetch:
                ok, fail, skipped, outcomes = SYNC.sync_phones(["a", "b"])
            self.assertEqual((ok, fail, skipped), (0, 0, 2))
            self.assertTrue(all(item["skipped"] for item in outcomes))
            fetch.assert_not_called()
        finally:
            SYNC.RUN_DEADLINE = None


class ServiceReconciliationTests(unittest.TestCase):
    def test_classifies_perm_dye_and_care_from_bill_items(self):
        item = {"items": [
            {"name": "热塑烫"},
            {"name": "健康染"},
            {"name": "歌薇酸性护理"},
        ]}
        self.assertEqual(SYNC.service_types_for_history(item), ["perm", "dye", "care"])

    def test_does_not_guess_from_bill_without_line_items(self):
        item = {"comment": "顾客可能做了烫发", "items": []}
        self.assertEqual(SYNC.service_types_for_history(item), [])

    def test_builds_stable_reconciliation_row(self):
        profile = {
            "phone": "18626895050",
            "name": "张小姐",
            "shop_name": "自由手艺人",
            "service_history": [{
                "source_id": "bill-1",
                "bill_no": "MGJ001",
                "date": "2026-07-14",
                "time": "18:20",
                "amount": 680,
                "shop": "自由手艺人",
                "staff": ["无名", "技师甲"],
                "items": [{"name": "热塑烫", "quantity": 1}],
            }],
        }
        rows = SYNC.build_service_records(profile)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source_id"], "bill-1")
        self.assertEqual(rows[0]["service_types"], ["perm"])
        self.assertEqual(rows[0]["customer_phone"], "18626895050")



class CustomerSourceTransportTests(unittest.TestCase):
    def test_exact_destination_and_tls(self):
        import ssl
        import urllib.request
        req = urllib.request.Request('https://vip12.meiguanjia.net/shair/consumerHelp!find.action', data=b'x=1')
        with mock.patch.object(SYNC.urllib.request, 'build_opener') as build:
            SYNC.source_urlopen(req, 9)
            handlers = build.call_args.args
            self.assertEqual(handlers[0].proxies, {})
            self.assertIsInstance(handlers[1], SYNC.NoSourceRedirect)
            self.assertEqual(handlers[2]._context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(handlers[2]._context.check_hostname)
            build.return_value.open.assert_called_once_with(req, timeout=9)

    def test_reject_other_destinations_before_network(self):
        import urllib.request
        for url in ['http://vip12.meiguanjia.net/shair/consumerHelp!find.action',
                    'https://other.test/shair/consumerHelp!find.action',
                    'https://vip12.meiguanjia.net/shair/member!delete.action',
                    'https://vip12.meiguanjia.net/shair/consumerHelp!find.action?x=1',
                    'https://u:p@vip12.meiguanjia.net/shair/consumerHelp!find.action',
                    'https://vip12.meiguanjia.net:444/shair/consumerHelp!find.action']:
            with self.subTest(url=url), mock.patch.object(SYNC.urllib.request, 'build_opener') as build:
                with self.assertRaises(ValueError): SYNC.source_urlopen(urllib.request.Request(url), 2)
                build.assert_not_called()

    def test_redirect_denied(self):
        with self.assertRaises(ValueError):
            SYNC.NoSourceRedirect().redirect_request(None,None,302,'',{},'https://other.test')

    def test_form_uses_browser_header_and_source_route(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'ok'
        with mock.patch.object(SYNC,'load_cookies',return_value='fixture'), mock.patch.object(SYNC,'source_urlopen',return_value=response) as call:
            self.assertEqual(SYNC.form_post('consumerHelp!find.action',{'keyword':'fixture'}),'ok')
            self.assertEqual(call.call_args.args[0].get_header('User-agent'),SYNC.SOURCE_USER_AGENT)

    def test_network_failure_not_not_found(self):
        with mock.patch.object(SYNC,'form_post',side_effect=TimeoutError('fixture')):
            with self.assertRaisesRegex(RuntimeError,'不能判定客户不存在'): SYNC.search_customer('fixture')

    def test_partial_failure_not_not_found(self):
        with mock.patch.object(SYNC,'form_post',side_effect=[TimeoutError('fixture'),'<html></html>']):
            with self.assertRaises(RuntimeError): SYNC.search_customer('fixture')

    def test_completed_empty_is_not_found(self):
        with mock.patch.object(SYNC,'form_post',return_value='<html></html>'):
            self.assertIsNone(SYNC.search_customer('fixture'))

    def test_match_preserves_identity(self):
        with mock.patch.object(SYNC,'form_post',return_value="checkAllow('1','2','3',"):
            self.assertEqual(SYNC.search_customer('fixture'),('3','1','1009951'))

class MultipartSourceTransportTests(unittest.TestCase):
    def test_verified_tls_exact_bypass_and_no_redirects(self):
        with mock.patch.object(SYNC,'load_cookies',return_value='fixture-secret'), mock.patch.object(SYNC.subprocess,'check_output',return_value=b'{"code":0}\n__MGJ_HTTP_STATUS__:200') as call:
            SYNC.multipart_post('memberDetail!detail.action',{},'fixture',retries=0)
            cmd=call.call_args.args[0]
            self.assertEqual(cmd[1],'--disable')
            self.assertNotIn('-k',cmd)
            self.assertNotIn('-L',cmd)
            self.assertEqual(cmd[cmd.index('--noproxy')+1],'vip12.meiguanjia.net')
            self.assertEqual(cmd[cmd.index('--proto')+1],'=https')

    def test_body_uses_stdin_without_temporary_file(self):
        with mock.patch.object(SYNC, 'load_cookies', return_value='fixture'), mock.patch.object(SYNC.subprocess, 'check_output', return_value=b'{"code":0}\n__MGJ_HTTP_STATUS__:200') as call, mock.patch.object(SYNC.tempfile, 'NamedTemporaryFile') as temporary:
            SYNC.multipart_post('memberDetail!detail.action', {'fixture': 1}, 'fixture', retries=0)
            self.assertEqual(call.call_args.args[0][-1], '@-')
            self.assertIn(b'"fixture": 1', call.call_args.kwargs['input'])
            temporary.assert_not_called()

    def test_source_rate_limit_yields_batch_without_retry(self):
        with mock.patch.object(SYNC, 'RUN_DEADLINE', None), mock.patch.object(SYNC, 'load_cookies', return_value='fixture'), mock.patch.object(SYNC.subprocess, 'check_output', return_value=b'{"code":429}\n__MGJ_HTTP_STATUS__:200') as call, mock.patch.object(SYNC.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, '429'):
                SYNC.multipart_post('memberDetail!detail.action', {}, 'fixture')
            self.assertFalse(SYNC.run_budget_available())
            self.assertEqual(call.call_count, 1)
            sleep.assert_not_called()

    def test_http_429_non_json_stops_once(self):
        with mock.patch.object(SYNC, 'RUN_DEADLINE', None), mock.patch.object(SYNC, 'load_cookies', return_value='fixture'), mock.patch.object(SYNC.subprocess, 'check_output', return_value=b'too many requests\n__MGJ_HTTP_STATUS__:429') as call:
            with self.assertRaises(SYNC.SourceRateLimitError):
                SYNC.multipart_post('memberDetail!detail.action', {}, 'fixture')
            self.assertEqual(call.call_count, 1)
            self.assertFalse(SYNC.run_budget_available())

    def test_missing_http_metadata_rejected(self):
        with mock.patch.object(SYNC, 'load_cookies', return_value='fixture'), mock.patch.object(SYNC.subprocess, 'check_output', return_value=b'{"code":0}'):
            with self.assertRaisesRegex(RuntimeError, 'missing HTTP status'):
                SYNC.multipart_post('memberDetail!detail.action', {}, 'fixture')

    def test_search_http429_stops_without_second_shop_or_retry(self):
        import urllib.error
        with mock.patch.object(SYNC, 'RUN_DEADLINE', None), mock.patch.object(SYNC, 'load_cookies', return_value='fixture'), mock.patch.object(SYNC.urllib.request, 'build_opener') as build, mock.patch.object(SYNC.time, 'sleep') as sleep:
            build.return_value.open.side_effect = urllib.error.HTTPError('https://vip12.meiguanjia.net',429,'limited',{},None)
            with self.assertRaises(SYNC.SourceRateLimitError): SYNC.search_customer('fixture')
            self.assertEqual(build.return_value.open.call_count, 1)
            sleep.assert_not_called()
            self.assertFalse(SYNC.run_budget_available())

    def test_write_destination_rejected(self):
        with mock.patch.object(SYNC.subprocess,'check_output') as call:
            with self.assertRaises(ValueError): SYNC.multipart_post('member!delete.action',{},'fixture')
            call.assert_not_called()

    def test_subprocess_error_does_not_leak_cookie(self):
        import subprocess
        with mock.patch.object(SYNC,'load_cookies',return_value='fixture-secret'), mock.patch.object(SYNC.subprocess,'check_output',side_effect=subprocess.CalledProcessError(1,['curl','Cookie: fixture-secret'])):
            with self.assertRaises(RuntimeError) as caught: SYNC.multipart_post('bill!detail.action',{},'fixture',retries=0)
            self.assertNotIn('fixture-secret',str(caught.exception))

class BoundedHistoryWindowsTests(unittest.TestCase):
    def test_windows_cover_all_days_once_and_keep_read_session(self):
        calls=[]
        def read(path,data,shop,**kw):
            calls.append(data)
            self.assertEqual(path,'member!queryMemberBillListnew.action')
            self.assertEqual(kw['config_path'],'fixture-session')
            self.assertEqual(data['timeUnLimit'],0)
            return {'content':[], 'count':0, 'pageIndex':1}
        with mock.patch.object(SYNC,'multipart_post',side_effect=read), mock.patch.object(SYNC,'session_shop_id',return_value='fixture'), mock.patch.object(SYNC,'HISTORY_START_DATE','2020-02-28'):
            self.assertEqual(SYNC.fetch_service_history('fixture',1,'fixture',0,'fixture-session'),[])
        self.assertEqual(calls[0]['endDate'],datetime.now().strftime('%Y-%m-%d'))
        self.assertEqual(calls[-1]['startDate'],'2020-02-28')
        for i,row in enumerate(calls):
            start=datetime.strptime(row['startDate'],'%Y-%m-%d').date();end=datetime.strptime(row['endDate'],'%Y-%m-%d').date()
            self.assertLessEqual((end-start).days,364)
            if i:self.assertEqual(end+timedelta(days=1),datetime.strptime(calls[i-1]['startDate'],'%Y-%m-%d').date())

    def test_failed_window_never_returns_partial_history(self):
        with mock.patch.object(SYNC,'multipart_post',side_effect=[{'content':[], 'count':0, 'pageIndex':1},TimeoutError('fixture')]), mock.patch.object(SYNC,'session_shop_id',return_value='fixture'):
            with self.assertRaises(TimeoutError):SYNC.fetch_service_history('fixture',1,'fixture',0)

    def test_expired_budget_stops_before_next_request(self):
        with mock.patch.object(SYNC,'multipart_post') as call, mock.patch.object(SYNC,'session_shop_id',return_value='fixture'), mock.patch.object(SYNC,'run_budget_available',return_value=False):
            with self.assertRaises(TimeoutError):SYNC.fetch_service_history('fixture',1,'fixture',0)
            call.assert_not_called()

    def test_out_of_window_rejected(self):
        with mock.patch.object(SYNC,'multipart_post',return_value={'content':[{}], 'count':1, 'pageIndex':1}), mock.patch.object(SYNC,'session_shop_id',return_value='fixture'), mock.patch.object(SYNC,'map_bill_summary',return_value={'id':'fixture','date':'1900-01-01'}):
            with self.assertRaisesRegex(RuntimeError,'超出'):SYNC.fetch_service_history('fixture',1,'fixture',0)

    def test_duplicate_identical_rows_are_not_repeated(self):
        day=datetime.now().strftime('%Y-%m-%d')
        with mock.patch.object(SYNC,'multipart_post',return_value={'content':[{},{}], 'count':2, 'pageIndex':1}), mock.patch.object(SYNC,'session_shop_id',return_value='fixture'), mock.patch.object(SYNC,'HISTORY_START_DATE',day), mock.patch.object(SYNC,'map_bill_summary',return_value={'id':'fixture','date':day}):
            rows=SYNC.fetch_service_history('fixture',1,'fixture',0)
            self.assertEqual(len(rows),1)

    def test_conflicting_duplicate_rejected(self):
        day=datetime.now().strftime('%Y-%m-%d')
        with mock.patch.object(SYNC,'multipart_post',return_value={'content':[{},{}], 'count':2, 'pageIndex':1}), mock.patch.object(SYNC,'session_shop_id',return_value='fixture'), mock.patch.object(SYNC,'HISTORY_START_DATE',day), mock.patch.object(SYNC,'map_bill_summary',side_effect=[{'id':'fixture','date':day,'amount':1},{'id':'fixture','date':day,'amount':2}]):
            with self.assertRaisesRegex(RuntimeError,'冲突'):SYNC.fetch_service_history('fixture',1,'fixture',0)

class PartialCompletionTests(unittest.TestCase):
    def test_incomplete_history_stays_in_retry_queue(self):
        profile={'found':True,'total_visits':1,'total_consumption':10,'_history_complete':False,'_packages_complete':True}
        with mock.patch.object(SYNC,'get_customer_full',return_value=profile), mock.patch.object(SYNC,'upsert_customer',return_value=(True,'updated')):
            ok,failed,skipped,outcomes=SYNC.sync_phones(['fixture'])
        self.assertEqual((ok,failed,skipped),(0,1,0))
        self.assertFalse(outcomes[0]['success'])
        queue=SYNC.update_retry_queue({'version':1,'items':[]},outcomes)
        self.assertEqual(queue['items'][0]['phone'],'fixture')

    def test_projection_error_not_reported_success(self):
        with mock.patch.object(SYNC,'supabase_get',return_value=[]), mock.patch.object(SYNC,'supabase_post',return_value=204), mock.patch.object(SYNC,'upsert_service_records',side_effect=TimeoutError('fixture')):
            ok,msg=SYNC.upsert_customer({'phone':'fixture','found':True,'_history_complete':True,'_packages_complete':True})
        self.assertFalse(ok)
        self.assertIn('保留重试',msg)


class HistoryPageCountTests(unittest.TestCase):
    def test_total_mismatch_rejected(self):
        with mock.patch.object(SYNC,'multipart_post',return_value={'content':[], 'count':1, 'pageIndex':1}), mock.patch.object(SYNC,'session_shop_id',return_value='fixture'):
            with self.assertRaisesRegex(RuntimeError,'分页'):SYNC.fetch_service_history('fixture',1,'fixture',0)

    def test_missing_total_not_assumed_complete(self):
        with mock.patch.object(SYNC,'multipart_post',return_value={'content':[]}), mock.patch.object(SYNC,'session_shop_id',return_value='fixture'):
            with self.assertRaises(RuntimeError):SYNC.fetch_service_history('fixture',1,'fixture',0)

if __name__ == '__main__':
    unittest.main()
