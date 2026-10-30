# PURR mNAV sebagai sinyal rotasi HYPE — riset mendalam

*Disusun 30 Oktober 2026. Ini catatan riset, bukan saran investasi. Angka-angka di bawah berasal dari
sumber publik yang **saling bertentangan**; setiap angka diberi sumbernya agar bisa diverifikasi ulang.*

## 0. Tesis yang diuji

> **mNAV PURR < 1 → akumulasi HYPE. mNAV PURR > 1 → jual sebagian HYPE.**

Yang ingin dibuktikan: apakah mNAV Hyperliquid Strategies (NASDAQ: PURR) adalah **leading indicator**
untuk harga HYPE (Tesis A), atau hanya **lagging/cerminan** pergerakan HYPE (Tesis B).

---

## 1. Fakta terkini (dan di mana sumbernya tidak sepakat)

| Data | Nilai | Tanggal | Sumber |
|---|---|---|---|
| HYPE dipegang PURR | **38,83 juta** | 29 Okt 2026 | DefiLlama treasury tracker |
| HYPE dipegang PURR | 38,52 juta (+1,48 jt dalam seminggu) | 8 Okt 2026 | DefiLlama (dari dashboard HypeStrat) |
| HYPE dipegang PURR | 29,4 juta · kas $133 jt · utang $0 | 19–20 Agu 2026 | Update perusahaan / SEC |
| HYPE dipegang PURR | 29,3 juta (HYPE $65,04) | 30 Jun 2026 | Laporan FY2026 |
| HYPE dipegang PURR | 20,0 juta | 29 Apr 2026 | Rilis Q3 |
| HYPE dipegang PURR | 18,8 juta · kas $113,1 jt | 31 Mar 2026 | 10-Q Q3 FY2026 |
| Modal untuk beli HYPE | $773,4 jt → ~16,5 jt HYPE, avg **$46,77** | s.d. Agu 2026 | Update perusahaan |
| Buyback saham | 3,0 jt saham @ $3,42 (Q3 FY) | Jan–Mar 2026 | 10-Q |
| Otorisasi buyback | $30 jt → **$100 jt**, ~$72 jt tersisa, s.d. 31 Okt 2027 | 23 Okt 2026 | Investing.com / CryptoBriefing |
| Harga PURR | **$12,29** (+23,3% sehari) | 29 Okt 2026 close | Motley Fool |
| Harga HYPE | ~$93,20 (+14% hari itu, berita ICE × Trade[XYZ]) | 29 Okt 2026 | CryptoTimes |
| Adjusted mNAV | **1,08x** (NAV/sh $11,39) | 29 Okt 2026 | purrmnav.com |
| Adjusted mNAV | 1,03x (HYPE $83,14) | 12 Okt 2026 | purrmnav.com |
| mNAV (mcap / crypto NAV) | 0,88x | 29 Okt 2026 | Dashboard pembanding |
| mNAV | 0,66x | 8 Okt 2026 | DefiLlama — **kemungkinan memakai jumlah saham usang** |

### Kenapa angka mNAV bisa 0,66x, 0,88x, atau 1,08x pada saat yang hampir sama?

Pembilang (market cap) dan penyebut (NAV) bergantung pada definisi:

1. **Jumlah saham.** Basic vs. fully diluted (warrant, pre-funded warrant, saham hasil ATM yang baru
   diterbitkan). Satu analisis lama menunjukkan PURR terlihat *diskon 23%* dengan saham basic, *diskon 11%*
   dengan warrant, dan *premium 1,08x* fully diluted — dari data harga yang sama.
2. **Kas, utang, pajak tangguhan.** "Adjusted NAV" memasukkan kas dan kewajiban; "crypto NAV" hanya HYPE.
3. **Waktu.** Holding HYPE diperbarui mingguan/bulanan, harga PURR per detik. Tracker yang lambat
   memperbarui jumlah saham setelah penerbitan ATM akan menunjukkan mNAV terlalu rendah.

**Konsekuensi untuk strategi:** ambang "1,00x" tidak bermakna kecuali **satu definisi dipakai secara
konsisten**. Bot di repo ini memakai `mNAV = (harga PURR × saham) / (HYPE × harga HYPE + kas − utang)`,
dikalibrasi agar cocok dengan adjusted NAV/sh purrmnav.com ($11,39 @ HYPE $93,20 pada 29 Okt).

---

## 2. Mekanisme: refleksivitas PURR → permintaan HYPE

```
 mNAV > 1 (premium)                         mNAV < 1 (diskon)
 ────────────────────                       ────────────────────
 Terbitkan saham (ATM) secara akretif       Menerbitkan saham = dilutif → berhenti
        ↓                                           ↓
 Modal baru → BELI HYPE                      Modal → BUYBACK saham PURR
        ↓                                           ↓
 Tekanan beli HYPE ↑, HYPE/saham ↑           Permintaan HYPE dari PURR ≈ 0
```

**Temuan penting yang mengubah cara membaca tesismu:**

- Saat mNAV < 1, pembeli korporasi terbesar HYPE **berhenti membeli HYPE** dan memakai uangnya untuk
  buyback (bukti: otorisasi dinaikkan ke $100 jt tepat saat saham turun ~33% di Oktober; holding hanya
  naik 38,52 jt → 38,83 jt dalam 8–29 Okt, padahal naik ~9 jt HYPE dalam 7 minggu sebelumnya).
- Jadi alasan "beli HYPE saat mNAV < 1" **bukan** karena PURR akan membeli — justru sebaliknya, aliran
  dana PURR sedang kering. Alasannya adalah **value/mean-reversion**: pasar sedang pesimis terhadap HYPE
  dan premium treasury sudah terkompresi.
- Saat mNAV > 1, PURR kembali bisa menerbitkan saham dan membeli HYPE. Menjual sebagian HYPE di zona ini
  berarti **menjual ke dalam bid institusional** — bagus untuk distribusi, tapi bisa terlalu dini bila siklus
  refleksif sedang berjalan (premium → beli → HYPE naik → premium naik).

### Seberapa besar PURR dibanding pembeli lain?

| Pembeli | Perkiraan laju | Catatan |
|---|---|---|
| PURR (Agu → awal Okt) | ~9 jt HYPE / 7 minggu ≈ **1,3 jt HYPE/minggu** | Lumpy, bergantung mNAV |
| PURR (8–29 Okt) | ~0,3 jt HYPE / 3 minggu ≈ 0,1 jt/minggu | Melambat saat diskon |
| Assistance Fund | ~$63 jt / 30 hari ≈ $2,1 jt/hari ≈ **~0,16 jt HYPE/minggu** @ $90 | Stabil, dari fee protokol (97–99%) |
| Unlock tim/kontributor | ~9,9 jt HYPE/bulan ≈ **~2,3 jt/minggu** | Sisi suplai (36Crypto) |

Kesimpulan: ketika aktif, PURR membeli **~8× lebih banyak** dari Assistance Fund — klaimmu bahwa PURR
adalah pembeli terbesar *pada periode aktif* masuk akal. Tapi permintaannya **pro-siklikal** (hanya muncul
saat premium), sementara Assistance Fund adalah bid yang konstan. Perhatikan juga bahwa unlock bulanan lebih
besar dari keduanya; angka-angka ini perlu diverifikasi on-chain (sumber berbeda memberi $1–2,1 jt/hari untuk AF).

---

## 3. Tesis A vs Tesis B — apa yang bisa disimpulkan sekarang

**Argumen mekanis untuk Tesis B (lagging):** PURR adalah ekuitas dengan beta > 1 terhadap HYPE. Saat HYPE
turun, PURR biasanya turun lebih dalam → mNAV terkompresi; saat HYPE naik, PURR naik lebih cepat → mNAV
melebar. Contoh 29 Okt: HYPE +14%, PURR +23%. Artinya **mNAV < 1 sebagian besar berarti "HYPE baru saja
turun"**. Strategi "beli saat mNAV < 1" bisa jadi hanya versi lain dari "beli saat drawdown".

**Argumen untuk Tesis A (leading):** mNAV mengukur sentimen investor ekuitas tradisional (TradFi) terhadap
HYPE, yang berbeda dari trader kripto. Jika investor TradFi capitulate lebih dulu (mNAV jatuh di bawah 1
sebelum HYPE bottom), atau masuk lebih dulu (premium muncul sebelum HYPE naik), mNAV membawa informasi
tambahan.

**Anekdot yang tersedia (bukan bukti):**
- Pertengahan Agu: PURR sempat diskon → 27 Agu update treasury, PURR +15%, siklus beli besar Agu–Okt.
- Akhir Okt: diskon + buyback $100 jt → 29 Okt PURR +23%, HYPE +14% (dipicu berita ICE, bukan PURR).

Dua episode dalam satu siklus tidak cukup. **Uji yang menentukan** adalah: *apakah mNAV memprediksi return
HYPE ke depan **setelah dikontrol dengan return HYPE sebelumnya**?* Ini yang dihitung kolom *partial r*
di `scripts/purr-backtest.mjs`. Jika partial r ≈ 0, mNAV tidak menambah informasi di luar drawdown HYPE.

---

## 4. Strategi yang disempurnakan

Zona (default bot, bisa diubah lewat `PURR_ZONES`):

| mNAV | Zona | Aksi |
|---|---|---|
| < 0,95 | **ACCUMULATE** | Beli HYPE bertahap (DCA), ukuran 2× bila < 0,85 |
| 0,95 – 1,05 | **HOLD** | Tidak ada aksi — band ini mencegah over-trading di sekitar 1,00 |
| 1,05 – 1,20 | **TRIM** | Jual sebagian kecil dari *trading stack* |
| > 1,20 | **REDUCE** | Kurangi lebih banyak, terutama jika momentum HYPE melemah |

Penyempurnaan yang direkomendasikan:

1. **Pisahkan core dan trading stack.** Tujuanmu adalah mengumpulkan HYPE untuk di-stake. Core (yang
   di-stake) jangan disentuh oleh sinyal TRIM/REDUCE; rotasi hanya untuk porsi trading.
2. **Tambahkan filter tren untuk TRIM.** Rotasi mean-reversion kalah dari buy & hold dalam uptrend kuat
   (lihat hasil demo: −31% vs buy & hold saat HYPE +190%). Jual hanya jika mNAV > 1,05 **dan** tren
   HYPE melemah (mis. di bawah EMA50 harian atau sinyal reversal dari bot).
3. **Konfirmasi dua pembacaan.** Bot hanya mengirim alert zona jika zona baru terbaca dua kali berturut-turut
   (≈ 1 jam), supaya satu quote yang aneh tidak memicu alert.
4. **Catat setiap filing.** Holding HYPE, jumlah saham, dan kas berubah setiap update perusahaan. Perbarui
   dengan `/purrset` atau ambang 1,00x akan bergeser diam-diam.

---

## 5. Risiko

- **Definisi mNAV tidak standar** — lihat §1. Ini risiko terbesar untuk strategi berbasis ambang.
- **Dilusi** — ATM di bawah NAV menurunkan HYPE/saham; buyback di atas NAV juga merusak nilai.
- **Kompresi premium struktural** — treasury company BTC/ETH (mis. MSTR mNAV ~0,86–1,1x akhir 2025)
  menunjukkan premium bisa hilang permanen; diskon bisa bertahan lama tanpa mekanisme penutup.
- **Konsentrasi** — PURR memegang ~90% HYPE milik treasury korporasi (vs Galaxy 2,23 jt, Hyperion 2,03 jt).
  Jika PURR terpaksa menjual (mis. aksi aktivis saat diskon dalam), itu overhang suplai yang besar.
- **Unlock** — ~9,9 jt HYPE/bulan, lebih besar dari buyback Assistance Fund.
- **Regulasi** — status HYPE, dan venue perps teregulasi ICE × Trade[XYZ] masih menunggu persetujuan.
- **Jam pasar** — PURR hanya diperdagangkan di jam bursa AS; mNAV di akhir pekan memakai harga PURR
  Jumat vs HYPE live, sehingga bisa bergerak tanpa ada perubahan sentimen ekuitas.

---

## 6. Yang sudah dibangun di repo ini

**Bot worker (`cloudflare/bot-worker.js`)**

| Fitur | Detail |
|---|---|
| Monitor mNAV | Setiap 30 menit: harga PURR (Yahoo → fallback Stooq) + HYPE (Hyperliquid) → mNAV, NAV/sh, HYPE/saham, harga HYPE agar mNAV = 1,00x |
| Alert Telegram | Saat **zona berubah** (dikonfirmasi 2 pembacaan) dan setiap **cross 1,00x** |
| Riwayat harian | 00:00 UTC → KV `purr:hist` (+ Supabase `purr_mnav` jika dikonfigurasi) |
| `/purr` | Snapshot mNAV di Telegram |
| `/purrset hype=N shares=N cash=N debt=N` | Update input treasury setelah filing (hanya dari chat `TG_CHAT`); `/purrset reset` kembali ke vars |
| `GET /purr` | JSON untuk dashboard (dipakai kartu PURR di tab HL Pulse) |
| `GET /purr-history` | CSV riwayat (`?format=json` untuk JSON) — input backtest |
| `GET /run-purr` | Trigger cek manual |

Konfigurasi di `cloudflare/wrangler-bot.toml`: `PURR_HYPE_HOLDINGS`, `PURR_SHARES_OUT`, `PURR_CASH_USD`,
`PURR_DEBT_USD`, `PURR_ZONES`. **`PURR_SHARES_OUT` (329,4 jt) adalah hasil kalibrasi, bukan angka resmi** —
ganti dengan jumlah saham dari 10-Q/8-K terbaru.

Tabel Supabase opsional:

```sql
create table purr_mnav (
  date date primary key,
  purr numeric, hype numeric, nav_ps numeric, mnav numeric,
  hype_holdings numeric, shares numeric, cash numeric
);
```

**Dashboard** — tab HL Pulse menampilkan kartu PURR mNAV (zona, premium, NAV/sh, HYPE/saham, sparkline
90 hari dengan garis 1,00x) bila `hype_bot_url` sudah diisi.

**Backtest** — `scripts/purr-backtest.mjs`:

```bash
node scripts/purr-backtest.mjs https://hype-bot.<subdomain>.workers.dev/purr-history
node scripts/purr-backtest.mjs data.csv --zones 0.95,1.05,1.20 --step 0.1 --fee 0.001
node scripts/purr-backtest.mjs --demo     # data sintetis untuk smoke test
```

Output: (1) korelasi lead/lag mNAV ↔ return HYPE ke depan & ke belakang, plus partial correlation yang
mengontrol return HYPE sebelumnya; (2) return HYPE ke depan per zona mNAV; (3) rotasi vs buy & hold dalam
USD dan dalam jumlah HYPE.

---

## 7. Langkah berikutnya

1. **Isi riwayat.** Riwayat bot baru mulai hari deploy. Untuk backtest 6–12 bulan, ekspor riwayat harian
   mNAV dari purrmnav.com / Blockworks (kolom minimal `date,hype,mnav`) dan jalankan skrip di atasnya.
2. **Riwayat jumlah saham.** Kumpulkan dari 10-Q (31 Mar), laporan FY (30 Jun), dan 8-K/update berikutnya
   agar mNAV bisa dihitung ulang dengan satu definisi yang konsisten.
3. **Kriteria keputusan.** Anggap Tesis A didukung hanya jika *partial r* negatif dengan |t| > 2 pada
   horizon 10–20 hari **dan** rotasi mengalahkan buy & hold dalam jumlah HYPE di luar satu episode tunggal.

## Sumber

- [DefiLlama — Hyperliquid Strategies DAT](https://defillama.com/digital-asset-treasury/PURR)
- [The Block — PURR HYPE holdings](https://www.theblock.co/treasuries/purr)
- [The Block — $1,9 miliar HYPE treasury, 27 Agu 2026](https://www.theblock.co/news/business/2026-08-27-purr-jumps-hyperliquid-strategies-1-9-billion-hype-treasury-fortress-balance-sheet-412926)
- [PURR mNAV Analytics](https://purrmnav.com/)
- [KuCoin — PURR mNAV kembali ke 1,011](https://www.kucoin.com/news/flash/hype-treasury-s-purr-mnav-returns-to-1-011-with-a-premium-of-approximately-1-1)
- [KuCoin — analisis diskon basic vs diluted](https://www.kucoin.com/news/flash/hyperliquid-strategies-purr-surpasses-microstrategy-in-hype-gains-but-is-it-worth-the-investment)
- [Investing.com — buyback dinaikkan ke $100 jt](https://www.investing.com/news/company-news/hyperliquid-strategies-increases-buyback-program-to-100-million-93CH-4970336)
- [CryptoBriefing — buyback $100 jt, saham turun >30%](https://cryptobriefing.com/hyperliquid-strategies-expands-stock-buyback-program-to-100m-as-purr-shares-fall-over-30/)
- [Crowdfund Insider — buyback & HYPE dari $95 ke $77](https://www.crowdfundinsider.com/2026/10/320423-hyperliquid-strategies-raises-share-buyback-authorization-to-100m-as-purr-stock-falls-33/)
- [Motley Fool — PURR +23% pada 29 Okt](https://www.fool.com/coverage/stock-market-today/2026/10/29/stock-market-today-oct-29-hyperliquid-strategies-stock-surges-23-as-wall-street-giant-ice-and-billionaire-stanley-druckenmiller-back-hyperliquid/)
- [StockTitan — 10-Q Q3 FY2026](https://www.stocktitan.net/sec-filings/PURR/10-q-hyperliquid-strategies-inc-quarterly-earnings-report-920d32204aed.html)
- [Yahoo Finance — laporan posisi HYPE $1,9 miliar](https://finance.yahoo.com/markets/crypto/articles/hyperliquid-strategies-shares-rise-reporting-015300070.html)
- [24/7 Wall St. — buyback harian Hyperliquid](https://247wallst.com/investing/cryptocurrency/2026/10/10/hyperliquid-buys-back-its-own-token-daily-is-this-why-hype-stays-close-to-its-high/)
- [FXEmpire — buyback $63 jt / 30 hari](https://www.fxempire.com/forecasts/article/hype-price-forecast-hyperliquids-63m-buyback-boosts-50-rally-odds-1640990)
- [36Crypto — burn, buyback harian, unlock](https://36crypto.com/hyperliquid-burns-nearly-50-million-hype-tokens-as-revenue-reaches-1-38-billion/)
- [Forbes — tren buyback kuartalan](https://www.forbes.com/sites/digital-assets/2026/05/23/why-hyperliquids-hype-is-rising-and-why-the-answer-is-not-the-etf/)
- [CryptoTimes — HYPE +14% berita ICE × Trade[XYZ]](https://cryptotimes.io/2026/10/29/hyperliquid-token-hype-price-rises-14-after-ice-and-tradexyz-announces-regulated-u-s-perpetuals-venue)
- [Blockworks — metodologi mNAV treasury company](https://blockworks.co/analytics/treasury-companies/market-data/crypto-treasury-companies-mnav)
- [BitcoinTreasuries — apa itu mNAV](https://bitcointreasuries.net/blog/what-is-mnav-and-why-does-it-matter-a27fc2da7006a52a)
