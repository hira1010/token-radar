# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hira1010/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hira1010/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads the sealed DefiLlama snapshot of 758 protocols and ranks the ones that record no token yet — all 40 protocols on the snapshot's watchlist, plus 154 more below its $50M floor that pass the same independence screen — by the value a token would carry if the protocol's record stayed as it is: 194 rows, each with a six-step plan for farming it before a launch.

The implied value is a model, not a guess at names: **TVL × category multiple × growth factor × age factor**, every input from the snapshot's own figures. The multiple is the market's own answer — the median market-cap-to-TVL ratio of the protocols in the same category that already trade (144 tokenized comps; a category needs at least three before its own median is trusted, otherwise the global median of 0.1689 stands in), clamped to [0.02, 2.5]. The growth factor rewards a rising seven-day TVL change, clamped so one wild print cannot carry a board; the age factor pays more of the multiple the longer a protocol has run with no token on record. Nothing is hardcoded per protocol, and the same snapshot always produces the same board, byte for byte.

The dashboard is a single offline page: a sortable, filterable board (search, category, chain, minimum TVL, watchlist-only), a detail view per protocol showing the model's arithmetic and the farm plan, and a comparables section listing the tokenized protocols the multiples were calibrated on — the tokens that already trade, kept separate from the ones still to come.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=90569862&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
