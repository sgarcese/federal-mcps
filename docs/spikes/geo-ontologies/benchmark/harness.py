"""UGEO-Bench harness.

Generate shuffled question batches for a run, then score graded results by
category and by the semantic-layer relation each item tests.

Usage:
    python harness.py batches [batch_size]   # write runs/batch_N.txt
    python harness.py score graded.json      # print aggregate scores

`graded.json` is a JSON array of {"id": "A01", "score": 1.0} objects
(score in {0, 0.5, 1}).

Batches are seeded so a run is reproducible, and shuffled so that items from
the same category do not cluster within a batch — clustered traps prime the
model being evaluated and inflate its score.
"""

import collections
import json
import pathlib
import random
import sys

BASE = pathlib.Path(__file__).parent
BENCH = json.load(open(BASE / "benchmark.json"))
ITEMS = BENCH["items"]
SEED = 20260809


def make_batches(batch_size=7, seed=SEED):
    items = list(ITEMS)
    random.Random(seed).shuffle(items)
    return [items[i:i + batch_size] for i in range(0, len(items), batch_size)]


def render_batch(batch):
    return "\n\n".join(f"[{it['id']}] {it['question']}" for it in batch)


def score(graded):
    by_id = {it["id"]: it for it in ITEMS}
    missing = [g["id"] for g in graded if g["id"] not in by_id]
    if missing:
        raise ValueError(f"unknown item ids in graded input: {missing}")

    cat = collections.defaultdict(list)
    rel = collections.defaultdict(list)
    atype = collections.defaultdict(list)
    for g in graded:
        it = by_id[g["id"]]
        cat[it["category"]].append(g["score"])
        rel[it["kg_relation"]].append(g["score"])
        atype[it["answer_type"]].append(g["score"])

    agg = lambda d: {
        k: {"n": len(v), "acc": round(sum(v) / len(v), 3)} for k, v in sorted(d.items())
    }
    return {
        "n": len(graded),
        "n_expected": len(ITEMS),
        "overall": round(sum(g["score"] for g in graded) / len(graded), 3),
        "by_category": agg(cat),
        "by_kg_relation": agg(rel),
        "by_answer_type": agg(atype),
        "zeros": sorted(g["id"] for g in graded if g["score"] == 0),
    }


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "batches"

    if cmd == "batches":
        size = int(sys.argv[2]) if len(sys.argv) > 2 else 7
        outdir = BASE / "runs"
        outdir.mkdir(exist_ok=True)
        for i, b in enumerate(make_batches(size), start=1):
            (outdir / f"batch_{i}.txt").write_text(render_batch(b))
            print(f"batch {i}: {len(b)} items -> {[x['id'] for x in b]}")

    elif cmd == "score":
        print(json.dumps(score(json.load(open(sys.argv[2]))), indent=2))

    else:
        print(__doc__)
        sys.exit(1)
