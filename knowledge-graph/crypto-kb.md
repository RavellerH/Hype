# Crypto Intelligence Knowledge Graph
**Last updated:** 2026-05-17 01:39 UTC  
**Source:** cryptowatch.id

---

## Entity Map

```mermaid
graph TD
    REGIME["🔴 CAUTION REGIME<br/>Score: -1/+10<br/>2026-05-17 01:39 UTC"]

    %% Macro Layer
    BTC["₿ BTC<br/>$77,925–$77,967<br/>HTF: BULL<br/>Cycle: Mid Accum"]
    ETH["Ξ ETH<br/>~$2,175<br/>HTF: BEAR"]
    SOL["◎ SOL<br/>~$85.84<br/>HTF: BEAR"]
    HYPE["⚡ HYPE<br/>~$41.54<br/>HTF: BULL"]

    %% Regime Drivers
    BTCD["BTC.D: 60.4%<br/>Day 1 of move<br/>+3.92% 30d"]
    HEAT["Heat: 41.8<br/>Cool / Opportunity"]
    FUNDING["Funding: +2.8% APR<br/>Calm, no crowding"]
    WHALE["Whale Flow: -$1.19M<br/>46% buy pressure<br/>200 swaps/50min"]
    STABLES["Stablecoins: $267.6B<br/>+2.31% 30d — expanding"]

    %% Narratives
    RWA["🌱 RWA<br/>SEEDLING<br/>7d -11.0%<br/>Lead: ONDO"]
    L1S["L1s #1<br/>Score 19<br/>DECAYING -6.9%"]
    AI_NAR["AI #2<br/>Score 17<br/>DECAYING -11.6%"]
    MEMES["Memecoins #3<br/>Score 16<br/>DECAYING -11.0%"]
    PERPS["Perps DEX #6<br/>Score 14<br/>DECAYING -11.0%"]

    %% RWA Tokens
    ONDO["ONDO<br/>ENTRY<br/>Mindshare 0.24<br/>7d -18%"]
    ENA["ENA<br/>HOLD<br/>7d -17.8%<br/>Mindshare 0"]
    POLYX["POLYX<br/>HOLD<br/>7d +3.1%"]

    %% Smart Ape Buys
    SMWALLET["Smart Wallet<br/>0xd8da...6045"]
    YOLO["YOLO<br/>ETH 7.1h old<br/>UNKNOWN safety<br/>18:27 UTC-5 May16"]
    BAPABAPA["BAPABAPA<br/>ETH 7.9h old<br/>UNKNOWN safety"]
    OCTAVIUS["OCTAVIUS<br/>ETH 8.3h old<br/>UNKNOWN safety"]
    C93["C93<br/>ETH 8.5h old<br/>UNKNOWN safety"]

    %% Regime connections
    REGIME --> BTCD
    REGIME --> HEAT
    REGIME --> FUNDING
    REGIME --> WHALE

    %% Macro
    BTCD -->|"dominates"| BTC
    BTCD -->|"suppresses"| ETH
    BTCD -->|"suppresses"| SOL
    STABLES -->|"dry powder"| REGIME

    %% Narrative → Token
    RWA -->|"lead"| ONDO
    RWA -->|"secondary beta"| ENA
    RWA -->|"continuation"| POLYX
    L1S --> BTC
    L1S --> SOL
    PERPS --> HYPE

    %% Smart wallet buys
    SMWALLET -->|"bought 18:27"| YOLO
    SMWALLET -->|"bought 17:41"| BAPABAPA
    SMWALLET -->|"bought 17:15"| OCTAVIUS
    SMWALLET -->|"bought 17:06"| C93

    %% Regime → Narrative
    REGIME -->|"attention > price"| RWA
    REGIME -->|"all decaying"| L1S
    REGIME -->|"all decaying"| AI_NAR
    REGIME -->|"all decaying"| MEMES
```

---

## Knowledge Nodes

### Regime Node
```
REGIME_20260517
  score: -1
  max: +10
  label: CAUTION
  heat: 41.8
  btc_dominance: 60.4%
  btc_dom_day: 1
  altcoin_breadth: 16%
  smart_money: idle
  whale_net_flow_50min: -$1.19M
  buy_pressure: 46%
  timestamp: 2026-05-17T01:39Z
```

### BTC Node
```
BTC_20260517
  price_range: [$77,925, $77,967]
  posture: WAIT (-1)
  confidence: 70%
  cycle_phase: mid_accumulation
  cycle_score: 39.9/100
  months_since_halving: 24.9
  days_to_next_halving: 705
  bottom_proximity: 28%
  bottom_radar: 84/100
  lth_accumulation_30d: +131,133 BTC
  etf_flow_7d: -$1.14B
  etf_flow_30d: +$1.50B
  key_levels:
    realized_price: $54,230
    lth_realized_price: $45,011
    tmm: $75,336
    sth_cost: $81,345
    ma_200w: $61,074
    max_pain: $79,000
    ema_50w: $85,809
    ema_20w: $78,270
  on_chain:
    mvrv_z: 0.9187
    nupl: 0.3297
    puell: 0.9953
    ahr999: 0.5286
    reserve_risk: 0.001214
    lth_mvrv: 1.685
    aviv: 1.035
    lth_sopr: 0.94
  options:
    dvol: 40.5
    skew_25d: -13.8
    vrp: +2.94
    iv_term: steep_contango
  macro:
    m2_yoy: +4.57%
    dxy_3m: -1.01%
    vix: 17.26
    hy_spread: 2.76%
    copper_90d: +19.1%
    stablecoin_supply: $267.6B
    eth_btc: 0.02918
```

### Smart Wallet Node
```
SMART_WALLET_0xd8da6045
  address: 0xd8da...6045
  buys_16may2026:
    - token: YOLO    | ca: 0xbb24...0468 | time: 16May 18:27 | age: 7.1h
    - token: BAPABAPA| ca: 0x7795...affe | time: 16May 17:41 | age: 7.9h
    - token: OCTAVIUS| ca: 0x1350...dced | time: 16May 17:15 | age: 8.3h
    - token: C93     | ca: 0x0c01...d497 | time: 16May 17:06 | age: 8.5h
  chain: eth-mainnet
  safety_all: UNKNOWN
  pattern: single_wallet_cluster_4_new_tokens_1day
  risk: HIGH — no safety verification
```

### Narrative Nodes
```
NARRATIVE_RWA
  rank: 7
  score: 11
  status: SEEDLING
  performance_7d: -11.0%
  lead_token: ONDO
  mindshare_status: leading_price
  signal: attention_before_price_setup
  plays:
    entry: ONDO (mindshare 0.24, 7d -18%)
    hold: ENA (7d -17.8%, zero mindshare)
    hold: POLYX (7d +3.1%, continuation only)

NARRATIVE_L1S
  rank: 1
  score: 19
  status: DECAYING
  performance_7d: -6.9%

NARRATIVE_MEMECOINS
  rank: 3
  score: 16
  status: DECAYING
  performance_7d: -11.0%

NARRATIVE_PERPS_DEX
  rank: 6
  score: 14
  status: DECAYING
  performance_7d: -11.0%
  lead: HYPE
```

---

## Relationship Map (Text)

```
REGIME(CAUTION -1)
├── driven_by → BTC.D(60.4% rising, day 1)
├── driven_by → WHALE_FLOW(-$1.19M net sell)
├── driven_by → SMART_MONEY(idle)
├── supported_by → HEAT(41.8 = opportunity zone)
├── supported_by → STABLECOINS($267.6B, +2.31%)
│
├── narrative_attention → RWA(SEEDLING)
│   ├── lead_token → ONDO [ENTRY: mindshare 0.24, 7d -18%]
│   ├── secondary → ENA [HOLD: 7d -17.8%, zero mindshare]
│   └── continuation → POLYX [HOLD: 7d +3.1%]
│
├── suppress → ALL_ALTS (BTC.D climbing)
│   ├── ETH/BTC = 0.02918 (structural downtrend, 16.5% below floor)
│   └── breadth = 16% (risk-off)
│
└── smart_ape_activity → 0xd8da...6045
    ├── YOLO (0xbb24...0468, 18:27 UTC)
    ├── BAPABAPA (0x7795...affe, 17:41 UTC)
    ├── OCTAVIUS (0x1350...dced, 17:15 UTC)
    └── C93 (0x0c01...d497, 17:06 UTC)

BTC_CYCLE
├── phase = Mid Accumulation (39.9/100)
├── bottom_radar = 84/100 (strong cluster)
├── lth = accumulating (+131K BTC/30d)
├── etf = distributing (-$1.14B/7d)
└── posture = WAIT (short-term flat, long-term accumulate)
```

---

## Trigger Conditions (Watch List)

| Trigger | Current | Threshold | Action |
|---------|---------|-----------|--------|
| BTC.D | 60.4% | > 61% | Pause RWA adds |
| BTC.D | 60.4% | < 55% (weekly close) | Altseason precondition |
| Heat Index | 41.8 | > 60 (without ONDO move) | Thesis broken — exit |
| Heat Index | 41.8 | < 35 | Reset — wait |
| ONDO range | — | Fails 3-5d | Cut entry |
| SM print | Idle | Any RWA accum | Size up |
| ENA mindshare | 0 | Ticks up | Rotation broadening |
| ETH/BTC | 0.02918 | > 0.034 | ETH overweight trigger 1/4 |

---

## Falsifiable Forecasts Log

| Date | Forecast | Ticker | Confidence | Resolution |
|------|----------|--------|------------|------------|
| 2026-05-17 | Leading narrative = RWA (T+1) | RWA | 55% | Pending |
| 2026-05-17 | Best major = BTC (T+1) | BTC | 55% | Pending |
| 2026-05-17 | Top gainer = BILL (T+1) | BILL | 35% | Pending |
| 2026-05-17 | ONDO outperforms BTC >5% (T+7) | ONDO | 45% | Pending |
| 2026-05-17 | Leading narrative = RWA (T+7) | RWA | 50% | Pending |
| 2026-05-17 | Deathtouch TCG survives as CT term (T+7) | — | 45% | Pending |
