import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).with_name("check_mgj_sync_health.py")
WATCH_PATH = pathlib.Path(__file__).with_name("mgj_sync_health_watch.sh")
SPEC = importlib.util.spec_from_file_location("check_mgj_sync_health", SCRIPT_PATH)
HEALTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HEALTH)


class HealthAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        self.repo = root / "repo"
        self.hermes = root / "hermes"
        (self.repo / "scripts").mkdir(parents=True)
        (self.hermes / "scripts").mkdir(parents=True)
        self.now = dt.datetime(2026, 7, 30, 22, 30, tzinfo=dt.timezone(dt.timedelta(hours=8)))

        for _, source_name, runtime_name in HEALTH.RUNTIME_PAIRS:
            content = f"{source_name}\n"
            (self.repo / "scripts" / source_name).write_text(content, encoding="utf-8")
            (self.hermes / "scripts" / runtime_name).write_text(content, encoding="utf-8")

        config = {
            "runtime_enabled": True,
            "shops": {
                "自由手艺人": {"enabled": True},
                "向里造型": {"enabled": False, "products": {}},
            },
        }
        text = json.dumps(config, ensure_ascii=False)
        (self.repo / "scripts" / "care_outbound_store_config.json").write_text(text, encoding="utf-8")
        (self.hermes / "scripts" / "care_outbound_store_config.json").write_text(text, encoding="utf-8")

        for _, filename, _ in HEALTH.STATUS_RULES:
            (self.hermes / filename).write_text(
                json.dumps({
                    "status": "healthy",
                    "updated_at": (self.now - dt.timedelta(minutes=5)).isoformat(),
                }),
                encoding="utf-8",
            )

    def tearDown(self):
        self.temp.cleanup()

    def test_healthy_local_runtime_passes(self):
        report = HEALTH.run_audit(
            self.repo,
            self.hermes,
            now=self.now,
            network=False,
        )
        self.assertEqual(report["status"], "healthy")
        self.assertEqual(report["issues"], [])

    def test_watchdog_defaults_to_current_canonical_checkout(self):
        text = WATCH_PATH.read_text(encoding="utf-8")
        self.assertIn("/Users/a1/Documents/Codex/2026-06-20/perm-pages", text)
        self.assertNotIn("2026-07-29/new-chat/meiguanjia-sync-fix", text)

    def test_fresh_running_is_healthy_but_stuck_running_is_reported(self):
        path = self.hermes / "sync_status.json"
        path.write_text(
            json.dumps({
                "status": "running",
                "updated_at": (self.now - dt.timedelta(minutes=5)).isoformat(),
            }),
            encoding="utf-8",
        )
        fresh = HEALTH.run_audit(
            self.repo,
            self.hermes,
            now=self.now,
            network=False,
        )
        self.assertEqual(fresh["status"], "healthy")

        path.write_text(
            json.dumps({
                "status": "running",
                "updated_at": (self.now - dt.timedelta(minutes=11)).isoformat(),
            }),
            encoding="utf-8",
        )
        stuck = HEALTH.run_audit(
            self.repo,
            self.hermes,
            now=self.now,
            network=False,
        )
        self.assertEqual(stuck["status"], "degraded")
        self.assertTrue(any("running超过10分钟" in issue for issue in stuck["issues"]))

    def test_xiangli_enablement_is_critical(self):
        path = self.hermes / "scripts" / "care_outbound_store_config.json"
        config = json.loads(path.read_text(encoding="utf-8"))
        config["shops"]["向里造型"]["enabled"] = True
        path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
        report = HEALTH.run_audit(
            self.repo,
            self.hermes,
            now=self.now,
            network=False,
        )
        self.assertEqual(report["status"], "degraded")
        self.assertTrue(any("向里自动出库未保持关闭" in issue for issue in report["issues"]))

    def test_runtime_drift_and_stale_status_are_reported(self):
        (self.hermes / "scripts" / "sync_mgj_all.py").write_text("drift\n", encoding="utf-8")
        (self.hermes / "sync_status.json").write_text(
            json.dumps({
                "status": "healthy",
                "updated_at": (self.now - dt.timedelta(hours=2)).isoformat(),
            }),
            encoding="utf-8",
        )
        report = HEALTH.run_audit(
            self.repo,
            self.hermes,
            now=self.now,
            network=False,
        )
        self.assertEqual(report["status"], "degraded")
        self.assertTrue(any("运行副本不一致" in issue for issue in report["issues"]))
        self.assertTrue(any("超过45分钟未更新" in issue for issue in report["issues"]))

    def test_single_partial_failure_is_tolerated_but_repeated_partial_is_reported(self):
        path = self.hermes / "sync_status.json"
        path.write_text(
            json.dumps({
                "status": "partial",
                "consecutive_failures": 1,
                "updated_at": (self.now - dt.timedelta(minutes=5)).isoformat(),
            }),
            encoding="utf-8",
        )
        first = HEALTH.run_audit(self.repo, self.hermes, now=self.now, network=False)
        self.assertEqual(first["status"], "healthy")

        status = json.loads(path.read_text(encoding="utf-8"))
        status["consecutive_failures"] = 2
        path.write_text(json.dumps(status), encoding="utf-8")
        repeated = HEALTH.run_audit(self.repo, self.hermes, now=self.now, network=False)
        self.assertEqual(repeated["status"], "degraded")
        self.assertTrue(any("连续部分失败2次" in issue for issue in repeated["issues"]))

    def test_retry_queue_old_backlog_and_manual_review_are_reported(self):
        (self.hermes / "mgj_sync_retry.json").write_text(
            json.dumps({
                "items": [
                    {
                        "phone": "masked-1",
                        "status": "pending",
                        "first_failed_at": (self.now - dt.timedelta(minutes=61)).isoformat(),
                    },
                    {"phone": "masked-2", "status": "needs_review"},
                ],
            }),
            encoding="utf-8",
        )
        report = HEALTH.run_audit(self.repo, self.hermes, now=self.now, network=False)
        self.assertEqual(report["status"], "degraded")
        self.assertTrue(any("需人工检查" in issue for issue in report["issues"]))
        self.assertTrue(any("等待61分钟" in issue for issue in report["issues"]))

    def test_duplicate_customer_schedulers_are_reported(self):
        (self.hermes / "cron").mkdir()
        (self.hermes / "cron" / "jobs.json").write_text(
            json.dumps({
                "jobs": [{
                    "id": "duplicate",
                    "enabled": True,
                    "script": "sync_mgj_all.py",
                }],
            }),
            encoding="utf-8",
        )
        issues = []
        details = {}
        HEALTH.audit_schedulers(
            self.hermes,
            issues,
            details,
            crontab_text="*/30 * * * * python3 sync_mgj_all.py\n",
        )
        self.assertEqual(details["customer_sync_schedulers"]["active_count"], 2)
        self.assertTrue(any("当前2个" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
