from app.benchmark import cases

def test_benchmark_actual_results_match_expected():
    rows = cases()
    assert len(rows) == 9
    bad = [r for r in rows if not r["ok"]]
    assert not bad, bad
