"""Export an isolated synthetic candidate for browser regression; no real review."""
import json
import sys
from pathlib import Path
from test_publish_academy import PublisherTests, p, DATE

fixture = PublisherTests()
fixture.setUp()
try:
    p.run(fixture.root, DATE, Path(sys.argv[1]))
    print(json.dumps({"date": DATE, "scope": "SYNTHETIC fixture only"}))
finally:
    fixture.doCleanups()
