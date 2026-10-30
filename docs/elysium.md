# Elysium (Kinetiq) — L2 Hyperliquid: fakta, koreksi, dan peluang

*Disusun 30 Oktober 2026, 10 hari sebelum target mainnet. Ini catatan riset, bukan saran investasi.
Banyak klaim yang beredar berasal dari materi marketing Kinetiq atau rangkuman AI; setiap angka di
bawah diberi sumbernya, dan klaim yang **belum terbukti** ditandai.*

## 0. Ringkasan

> **Elysium bukan "beli dan tunggu".** Mekanisme burn KNTQ dari fee sequencer secara struktural kecil
> selama gas murah. Edge yang nyata ada di (1) kHYPE sebagai posisi dasar, (2) membangun di atas
> precompile HyperCore setelah upgrade ±4 minggu pasca-mainnet, dan (3) LP selektif di minggu-minggu
> pertama — dengan modal kecil dan bridge risk yang dipahami.

---

## 1. Fakta terverifikasi

| Data | Nilai | Sumber |
|---|---|---|
| Pengembang | Kinetiq (penerbit kHYPE, token tata kelola KNTQ) | Kinetiq blog, Bankless |
| Stack | Arbitrum Orbit (Nitro / ArbOS), dioperasikan Conduit | Kinetiq docs, repo riset testnet |
| Parent chain | **HyperEVM** (bukan Ethereum) | Kinetiq docs |
| Token gas | **HYPE** — tidak ada token gas baru | Kinetiq, crypto.news |
| Data availability | AnyTrust: data penuh ke komite, hanya sertifikat ke HyperEVM; fallback ke posting data penuh bila komite gagal | Dwellir, Chainstack |
| Bridge | Canonical bridge (ERC-20 HyperEVM ↔ Elysium) + **mirror bridge** (token asli Elysium → HyperEVM → HyperCore) | Chainstack |
| Node Hyperliquid | Rencana node di **TheHUB, Equinix TY15 Tokyo** untuk meneruskan state HyperCore/HyperEVM | TokenPost |
| Target throughput | 300 Mgas/s, blok 100–200 ms (target turun ke ±100 ms) | Kinetiq docs |
| Pembagian revenue sequencer | **50%** beli KNTQ di pasar → dikirim ke Hyperliquid Assistance Fund (burn) · **25%** ke aplikasi yang memakai blockspace · **25%** treasury | Kinetiq docs, BitRss |
| Mainnet | **9 November 2026** (ditetapkan 19 Okt) | TokenPost, Bankless, TechFlow |
| Token / poin Elysium | **Tidak ada** token Elysium maupun program poin resmi | Bankless |
| Testnet | Live, chain ID 99801, RPC `testnet-rpc.elysium.kinetiq.xyz` | repo riset testnet |
| KNTQ | ATH **$0,4547** (28 Okt); ±280 jt beredar dari 1 M max → mcap ±$117–127 jt | TokenPost, DefiLlama, X |
| kHYPE | TVL ±$0,93–1,04 M; model exchange-rate (non-rebasing); fee performa 10%, sejak 9 Apr 2026 **70% fee itu buyback KNTQ** | DefiLlama, yearn, Yellow |

### Sumber yang saling bertentangan

- Listing TradingView/CoinMarketCal menyebut mainnet "20 Okt 2026". Pada 23 Okt akun Elysium menyatakan
  mainnet **belum** rilis; tanggal yang berlaku adalah **9 Nov**.
- Satu cuplikan CoinMarketCap menyebut OP Stack — salah; semua sumber primer menyebut Arbitrum Orbit.
- Operator sequencer: dokumentasi menyebut Conduit, satu listing ekosistem menyebut framework lain.
  Anggap **satu sequencer terpusat** saat peluncuran.

---

## 2. Koreksi atas tesis yang beredar

| Klaim | Status | Kenyataan |
|---|---|---|
| "Blok 100–200 ms" | ⚠️ Target, belum terbukti | Pengukuran testnet (26 Sep): **±420–600 ms** per blok, rata-rata ±440 ms; build node masih `vdevelopment` |
| "Kontrak bisa membaca orderbook HyperCore real-time" | ⚠️ Belum saat launch | Precompile market-data HyperCore + `ElysiumCoreWriter` dijadwalkan via upgrade ArbOS **±4 minggu setelah mainnet** (±awal Desember). Tidak ada di testnet |
| "300 juta gas/detik" | ⚠️ Belum terbukti | Testnet praktis kosong (±2 tx/blok, pemakaian gas ~0%) — angka ini belum pernah diuji beban |
| "50% fee membakar KNTQ" | ✅ Benar | Tapi skalanya kecil — lihat §3 |
| "25% fee untuk builder" | ✅ Benar, nuansa | Dibayarkan ke **aplikasi yang mengonsumsi blockspace**, bukan hadiah untuk bot. Mekanisme klaimnya belum dipublikasikan |
| "Ada airdrop Elysium" | ❌ Spekulasi | Tidak ada token/poin resmi (Bankless). Aktivitas awal mungkin berguna, tapi tidak dijanjikan apa-apa |

---

## 3. Ekonomi burn KNTQ — hitungan kasar

Di testnet: base fee flat **0,01 gwei**, biaya ±**1,5e-6 HYPE** per transaksi (repo riset testnet).
Asumsi HYPE $93, base fee tidak berubah:

| Transaksi / hari | Fee / hari | 50% → beli KNTQ / tahun | % dari mcap KNTQ (~$120 jt) |
|---|---|---|---|
| 1 jt | ~$140 | ~$25 rb | 0,02% |
| 10 jt | ~$1,4 rb | ~$255 rb | 0,2% |
| 100 jt | ~$14 rb | ~$2,5 jt | 2,1% |

Pembanding: buyback dari **kHYPE** (TVL ~$1 M × APR staking ~2,4% × fee 10% × 70%) ≈ **$1,7 jt / tahun** —
sudah berjalan hari ini dan setara dengan skenario Elysium 70 jt tx/hari.

Kesimpulan:

1. Burn hanya material bila **harga gas naik** (kongesti, priority fee dari bot HFT yang berebut urutan,
   atau base fee dinaikkan) — bukan hanya jumlah transaksi. Pantau **total fee dalam HYPE**, bukan jumlah tx.
2. Revenue sequencer kemungkinan dihitung **neto** setelah biaya posting sertifikat ke HyperEVM.
3. KNTQ sudah naik ±28% ke ATH menjelang launch → risiko klasik *buy the rumor, sell the news*.
   Entry lebih masuk akal setelah data fee 2–4 minggu pertama ada.

---

## 4. Peluang, diurutkan dari risiko terendah

### 4.1 kHYPE sebagai posisi dasar (risiko: rendah–menengah)

- HYPE yang menganggur di Rabby bisa ditukar ke kHYPE: imbal hasil validator terakumulasi lewat
  exchange rate (1 kHYPE ≈ 1,018 HYPE per Mei 2026), tetap likuid.
- APY yang dilaporkan **bertentangan** (2,4% – 6%; vault Kinetiq Earn ±6%). Angka 100%+ di halaman
  pool DefiLlama adalah insentif, bukan yield dasar.
- Gas Elysium tetap butuh **HYPE native** — sisakan HYPE untuk gas sebelum bridge.
- Risiko: depeg kHYPE/HYPE di pasar sekunder saat stres, antrean unstake, smart contract (audit Cantina 2025).
- Bonus: setiap fee kHYPE ikut membiayai buyback KNTQ — eksposur tidak langsung ke tesis Kinetiq
  tanpa membeli KNTQ di ATH.

### 4.2 KNTQ (risiko: tinggi)

- Dua sumber value accrual: buyback kHYPE (berjalan) + burn dari fee Elysium (mulai 9 Nov).
- Pemicu yang perlu dikonfirmasi: total fee harian Elysium dalam HYPE, TVL yang di-bridge, jumlah
  PropAMM aktif, dan apakah upgrade precompile rilis tepat waktu.
- Unlock/vesting KNTQ (±72% supply belum beredar) adalah tekanan jual yang perlu dicek sebelum entry.

### 4.3 LP di fase awal / PropAMM (risiko: tinggi)

- Elysium dirancang untuk **PropAMM** — AMM yang dioperasikan market maker profesional, dengan oracle
  HyperCore "top-of-block" gratis sebagai bahan bakar kuotasi.
- Konsekuensi: LP pasif di AMM biasa akan bersaing dengan market maker yang lebih cepat dan
  ter-colocate → **adverse selection** tinggi. Fee premium minggu pertama sering tidak menutup IL.
- Siklus "token baru di AMM Elysium → volume spot → listing HyperCore" masih hipotesis; jalur
  mirror bridge ke HyperCore (`HyperCoreDepositWallet`) belum punya alamat yang dipublikasikan.
- Jika ikut: pair dengan HYPE/kHYPE/USDC, modal kecil, keluar sebelum emisi insentif berhenti.

### 4.4 Bot / builder (risiko: tinggi, butuh skill)

- Data testnet: untuk AMM dengan spread 30 bp, dislokasi yang dibutuhkan ±**33,5 bp**, sementara
  pergerakan harga p99 dalam 440 ms hanya **4,7 bp (HYPE)**, 2,1 bp (BTC), 4,5 bp (ETH), 9,8 bp (SOL),
  **29,9 bp (PURR)**. Arbitrase cross-venue murni **tipis** kecuali di aset volatil atau saat event.
- Fee taker HyperCore ±3,5–4,3 bp; maker umumnya rebate → strategi maker lebih realistis daripada taker.
- Node-RED / skrip interaktif cocok untuk **monitoring dan alert**, bukan eksekusi sub-detik. Bot
  eksekusi serius butuh RPC dekat Tokyo, transaksi raw yang ditandatangani lokal, dan manajemen nonce.
- Pemenang kemungkinan: aplikasi yang **menghasilkan volume gas besar** (mengambil bagian 25%),
  bukan bot arbitrase kecil. Mulai dari testnet sekarang; precompile datang ±4 minggu setelah mainnet.

---

## 5. Risiko utama

1. **Sequencer tunggal** (Conduit) → titik gagal & sensor tunggal; tidak ada force-inclusion yang teruji.
2. **AnyTrust**: riwayat tidak bisa direkonstruksi dari HyperEVM saja — bergantung pada komite DA.
3. **Bridge**: mirror bridge baru dan belum diaudit publik; batas penarikan & waktu finalitas belum dipublikasikan.
4. **Parent chain**: HyperEVM sendiri relatif muda; insiden di HyperEVM menular ke Elysium.
5. **Timeline**: block time dan precompile bisa meleset dari klaim; minggu pertama adalah fase uji coba nyata.
6. **Konsentrasi**: kHYPE + KNTQ + LP Elysium semuanya eksposur ke satu tim (Kinetiq).

---

## 6. Checklist pemantauan (H+0 → H+30)

- [ ] Mainnet live 9 Nov; RPC & explorer resmi tersedia
- [ ] Block time rata-rata aktual (target ≤200 ms)
- [ ] Total fee harian dalam HYPE & alamat burn KNTQ ke Assistance Fund (verifikasi on-chain)
- [ ] TVL yang di-bridge dan jumlah PropAMM aktif
- [ ] Upgrade ArbOS: precompile HyperCore + `ElysiumCoreWriter` (±awal Des)
- [ ] Mekanisme klaim 25% builder dipublikasikan
- [ ] Jadwal unlock KNTQ vs. volume buyback
- [ ] Spread kHYPE/HYPE di pasar sekunder

---

## Sumber

- [Kinetiq — Elysium: A New Era for Hyperliquid](https://kinetiq.xyz/blog/elysium-hyperliquid-l2)
- [Kinetiq docs — Elysium technical overview](https://kinetiq.xyz/docs/elysium-technical-overview)
- [Bankless — Elysium sets Nov. 9 mainnet](https://www.bankless.com/read/news/kinetiqs-elysium-l2-sets-nov-9-mainnet-launch)
- [TokenPost — KNTQ $0.4547 record ahead of Elysium](https://www.tokenpost.com/news/investing/42626)
- [TokenPost — Elysium plans Tokyo node](https://www.tokenpost.com/news/technology/39597)
- [TechFlow — Elysium launches on November 9](https://www.techflowpost.com/en-US/article/34725)
- [The Industry Spread — Elysium settles on HyperEVM, HYPE gas](https://theindustryspread.com/elysium-settles-on-hyperevm-with-hype-as-gas/)
- [BitRss — Elysium turns fees into KNTQ buybacks](https://bitrss.com/kinetiq-s-elysium-l2-turns-hyperliquid-trading-fees-into-kntq-buybacks-244780)
- [Chainstack — What is Elysium](https://chainstack.com/what-is-elysium/)
- [Dwellir — What is Elysium](https://www.dwellir.com/blog/what-is-elysium)
- [reubinkincaid/elysium-testnet — measured testnet data](https://github.com/reubinkincaid/elysium-testnet)
- [DefiLlama — Kinetiq kHYPE](https://defillama.com/protocol/kinetiq-khype) · [KNTQ](https://defillama.com/token/KNTQ)
- [yearn — Kinetiq kHYPE report](https://curation.yearn.fi/report/kinetiq-khype/)
- [crypto.news — Kinetiq unveils Elysium with HYPE gas](https://crypto.news/kinetiq-unveils-elysium-l2-with-hype-gas/)
