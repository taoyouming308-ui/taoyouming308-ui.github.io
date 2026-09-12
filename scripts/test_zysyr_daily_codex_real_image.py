#!/usr/bin/env python3
"""Manual one-image acceptance probe for the local Codex daily bridge."""
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import zysyr_daily_codex_bridge as bridge


def build_cells():
    cells = []
    sequence = 0
    def add(section, row, name, column, role, row_number, column_number):
        nonlocal sequence
        sequence += 1
        cells.append({"id": str(uuid.UUID(int=sequence)), "section": section, "row": row,
                      "name": name, "column": column, "role": role,
                      "row_number": row_number, "column_number": column_number})
    stylist = ["点评团","抖音","洗剪吹","彩妆／造型","烫发","染发","护理","技护","头皮护理","倍柔护理","接发","美发零售","精华产品","假发定制／发片","美发辅助品","彩妆+首饰","家居品和香氛"]
    technician = ["接发","造型","基础烫发","技术烫发","基础染发","技术染发","基础护理","护理","技护","头皮护理","倍柔护理","臻黑护理","美发零售","精华产品","假发订制／发片","美发辅助品","彩妆+首饰","家居品和香氛"]
    for index in range(8):
        row=index+3
        for col,label in enumerate(stylist,2): add("stylist",f"stylist_{index+1}",f"第{index+1}行",label,"staff_value",row,col)
        add("stylist",f"stylist_{index+1}",f"第{index+1}行","小计","staff_total",row,20)
    for index in range(8):
        row=index+14
        for col,label in enumerate(technician,2): add("technician",f"technician_{index+1}",f"第{index+1}行",label,"technician_value",row,col)
        add("technician",f"technician_{index+1}",f"第{index+1}行","小计","technician_total",row,21)
        add("technician",f"technician_{index+1}",f"第{index+1}行","未结单号","unclosed_order",row,23)
    for col,label in enumerate(["现金","公-刷卡","公-支微","私-刷卡","私-支微","支付宝","微信","抖音","团购","现金流","卡金消费","总计"],9):
        add("payment","payment","支付",label,"payment_method" if label not in {"现金流","卡金消费","总计"} else {"现金流":"payment_cashflow","卡金消费":"payment_card_consumption","总计":"payment_total"}[label],33,col)
    add("payment","note","备注","备注","note",34,2)
    return cells


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: test_zysyr_daily_codex_real_image.py IMAGE")
    result = bridge._run_codex(Path(sys.argv[1]), "自由手艺人", "2026-01-03", build_cells())
    print(json.dumps(result, ensure_ascii=False, indent=2))
