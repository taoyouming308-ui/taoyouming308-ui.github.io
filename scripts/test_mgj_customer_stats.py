"""Synthetic regression: execute only named candidate pure/isolated functions."""
import ast
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
import json
import math
import re
import time
import urllib.parse
import unittest
from types import SimpleNamespace
from unittest.mock import patch

CANDIDATE = Path(__file__).with_name("sync_mgj_customer_profiles.py")
NAMES = {
    "number", "int_number", "parse_array", "observed_nonnegative_number",
    "observed_derived_total", "member_detail_statistics", "_get_customer_full",
    "merge_notes", "merge_profile", "upsert_customer",
}
AST = ast.parse(CANDIDATE.read_text())
selected = [n for n in AST.body if isinstance(n, ast.FunctionDef) and n.name in NAMES]
assert {n.name for n in selected} == NAMES
class SourceDeferred(Exception):
    pass
class ResumeError(Exception):
    pass
def forbidden(*args, **kwargs):
    raise AssertionError("no unmocked business I/O")
NS = dict(json=json, re=re, datetime=datetime, time=time, math=math,
          urllib=urllib, MAX_PROFILE_VISITS=10_000_000, TABLE="synthetic_profiles",
          supabase_get=forbidden, supabase_patch=forbidden, supabase_post=forbidden,
          upsert_service_records=forbidden, clear_completed_deferred=lambda _:None,
          Decimal=Decimal, InvalidOperation=InvalidOperation, HISTORY_DETAIL_CALLS=2,
          search_customer=lambda _: ("synthetic-id", "synthetic-member", "synthetic-shop"),
          fetch_customer_detail=forbidden, fetch_cashier_html=forbidden,
          parse_cashier_html=lambda data: data, fetch_service_history=forbidden,
          choose_member_card=lambda *args: "synthetic-card",
          SHOP_NAMES={"synthetic-shop": "Synthetic"}, timestamp_date=lambda _: "",
          merge_history=lambda old, new: (old or []) + (new or []), log=lambda *args: None,
          SourceDeferred=SourceDeferred, history_resume=SimpleNamespace(ResumeError=ResumeError),
          history_owner_key=lambda _: ("synthetic-owner",))
exec(compile(ast.Module(body=selected, type_ignores=[]), str(CANDIDATE), "exec"), NS)

class MergeTests(unittest.TestCase):
    def setUp(self):
        self.old = dict(total_visits=12, total_consumption=700, notes="均消¥58 | keep me",
                        card_packages=[{"name":"old package"}], service_history=[{"id":"old"}])

    def read(self, fields):
        detail = {"member_info":{"membername":"Synthetic customer", **fields}, "cards":[]}
        with patch.dict(NS, fetch_customer_detail=lambda *a: detail,
                        fetch_service_history=lambda *a, **k: []):
            return NS["_get_customer_full"]("synthetic", use_resume=False)

    def merge(self, data, **kw):
        return NS["merge_profile"](self.old, {"phone":"synthetic", **data}, **kw)

    def test_missing_null_empty_other_invalid_inputs_preserve_existing(self):
        for fields in [{}, {"consumetimes": None, "avgfee": None},
                       {"consumetimes":"", "avgfee":"  "}, {"consumetimes":False,"avgfee":True},
                       {"consumetimes":-1,"avgfee":-2}, {"consumetimes":1.5,"avgfee":"nan"},
                       {"consumetimes":"1.1","avgfee":"Infinity"},
                       {"consumetimes":"n/a","avgfee":[]},
                       {"consumetimes":"1e1000","avgfee":"1e1000"},
                       {"consumetimes":"1e-10000","avgfee":"1e-10000"}]:
            with self.subTest(fields=fields):
                data=self.read(fields)
                self.assertEqual(data["_member_detail_stats"], {})
                row=self.merge(data)
                self.assertEqual((row["total_visits"],row["total_consumption"]),(12,700))
                self.assertIn("均消¥58",row["notes"])
                self.assertNotIn("avg_fee",row)

    def test_positive_subcent_total_and_false_zero_note_are_preserved(self):
        row=self.merge(self.read({"consumetimes":1, "avgfee":"0.001"}))
        self.assertEqual((row["total_visits"],row["total_consumption"]),(1,700))
        self.assertIn("均消¥58",row["notes"])
        row=self.merge(self.read({"consumetimes":10, "avgfee":"0.49"}))
        self.assertEqual(row["total_consumption"],4.9)
        self.assertIn("均消¥58",row["notes"])

    def test_visit_parser_matches_edge_limit(self):
        out=self.read({"consumetimes":"10000001","avgfee":4})["_member_detail_stats"]
        self.assertEqual(out,{"avg_fee":4.0})
        row=self.merge(self.read({"consumetimes":"10000000","avgfee":4}))
        self.assertEqual(row["total_visits"],10_000_000)
        self.assertEqual(row["total_consumption"],40_000_000)

    def test_missing_totals_use_retry_without_any_wire_write_for_new_or_legacy_null(self):
        for existing in [[],[dict(self.old,total_visits=None)],
                         [dict(self.old,total_consumption=None)],[dict(self.old,total_consumption=float("inf"))]]:
            writes=[]
            with self.subTest(existing=existing), patch.dict(
                NS,supabase_get=lambda *a:existing,
                supabase_patch=lambda *args:writes.append("PATCH"),
                supabase_post=lambda *args:writes.append("POST"),
                upsert_service_records=lambda *args:writes.append("SERVICE"),
            ):
                ok,msg=NS["upsert_customer"]({"phone":"synthetic", **self.read({})})
                self.assertFalse(ok)
                self.assertIn("未写入档案",msg)
                self.assertEqual(writes,[])

    def test_verified_zero_allows_write_for_new_and_legacy_null(self):
        for existing in [[],[dict(self.old,total_visits=None,total_consumption=None)]]:
            writes=[]
            with self.subTest(existing=existing), patch.dict(
                NS,supabase_get=lambda *a:existing,
                supabase_patch=lambda path,body:writes.append(("patch",body)),
                supabase_post=lambda path,body:writes.append(("post",body)),
                upsert_service_records=lambda _:0):
                ok,msg=NS["upsert_customer"]({"phone":"synthetic", **self.read(
                    {"consumetimes":0,"avgfee":0,"treatMentItems":[]})})
                self.assertTrue(ok,msg)
                self.assertEqual(len(writes),1)
                self.assertEqual(writes[0][0],"patch" if existing else "post")
                self.assertEqual((writes[0][1]["total_visits"],writes[0][1]["total_consumption"]),(0,0))

    def test_explicit_zeros_are_authoritative_in_normal_mode(self):
        row=self.merge(self.read({"consumetimes":0, "avgfee":"0.0"}))
        self.assertEqual((row["total_visits"],row["total_consumption"]),(0,0))
        self.assertIn("均消¥0 | keep me",row["notes"])
        self.assertNotIn("均消¥58",row["notes"])
        self.assertNotIn("avg_fee",row)

    def test_visits_enough_for_visits_not_for_derived_total(self):
        for v in [0, 23]:
            with self.subTest(v=v):
                row=self.merge(self.read({"consumetimes":v}))
                self.assertEqual((row["total_visits"],row["total_consumption"]),(v,700))
                self.assertIn("均消¥58",row["notes"])

    def test_avg_enough_for_notes_not_for_derived_total(self):
        for a in [0, 80]:
            with self.subTest(a=a):
                row=self.merge(self.read({"avgfee":a}))
                self.assertEqual((row["total_visits"],row["total_consumption"]),(12,700))
                self.assertIn(f"均消¥{a}",row["notes"])

    def test_valid_operands_derive_total(self):
        row=self.merge(self.read({"consumetimes":"12.0", "avgfee":"41.25"}))
        self.assertEqual((row["total_visits"],row["total_consumption"]),(12,495))

    def test_overflow_total_is_not_written(self):
        row=self.merge(self.read({"consumetimes":12, "avgfee":1e308}))
        self.assertEqual(row["total_consumption"],700)

    def test_legacy_zero_or_forged_derived_total_is_not_sufficient(self):
        row=self.merge({"source":"memberDetail", "total_visits":0, "total_consumption":0,
                        "avg_fee":0, "_member_detail_stats":{"total_consumption":0}})
        self.assertEqual((row["total_visits"],row["total_consumption"]),(12,700))
        self.assertIn("均消¥58",row["notes"])

    def test_cashier_keeps_old_value_and_notes_on_placeholder_zero(self):
        with patch.dict(NS, fetch_customer_detail=lambda *a: None,
                        fetch_cashier_html=lambda *a: {"name":"Synthetic", "consumefee":0}):
            data=NS["_get_customer_full"]("synthetic",use_resume=False)
        row=self.merge(data)
        self.assertEqual((row["total_visits"],row["total_consumption"]),(12,700))
        self.assertIn("均消¥58",row["notes"])
        updated=self.merge(dict(data,total_consumption=123))
        self.assertEqual(updated["total_consumption"],123)
        self.assertIn("均消¥58",updated["notes"])

    def test_fill_only_keeps_existing_positive_stats_and_notes(self):
        row=self.merge(self.read({"consumetimes":0, "avgfee":0}),fill_missing_only=True)
        self.assertEqual((row["total_visits"],row["total_consumption"]),(12,700))
        self.assertEqual(row["notes"],self.old["notes"])

    def test_missing_null_malformed_packages_do_not_erase(self):
        for fields in [{}, {"treatMentItems":None},{"treatMentItems":{}},{"treatMentItems":""},
                       {"treatMentItems":[1]},{"treatMentItems":[{"itemname":"Synthetic", "sumtimes":4}]},
                       {"treatMentItems":[{"itemname":"Synthetic","sumtimes":4,"leavetimes":1}, None]}]:
            with self.subTest(fields=fields):
                data=self.read(fields)
                self.assertFalse(data["_packages_complete"])
                self.assertEqual(self.merge(data)["card_packages"], self.old["card_packages"])

    def test_explicit_empty_packages_are_authoritative(self):
        data=self.read({"treatMentItems":[]})
        self.assertTrue(data["_packages_complete"])
        self.assertEqual(self.merge(data)["card_packages"],[])
        self.assertEqual(self.merge(data,fill_missing_only=True)["card_packages"],self.old["card_packages"])

    def test_valid_packages_keep_existing_mapping(self):
        data=self.read({"treatMentItems":[{"itemname":"Synthetic package","sumtimes":4,"leavetimes":"0"}]})
        self.assertTrue(data["_packages_complete"])
        r=self.merge(data)["card_packages"][0]
        self.assertEqual((r["name"],r["total"],r["left"],r["used"],r["status"]),
                         ("Synthetic package",4,0,4,"used"))

if __name__ == "__main__":
    unittest.main(verbosity=2)
