# JAGENT (BSC) — catatan early minter & top wallet

*Disusun 30 Oktober 2026 dari PDF "jagent_top_wallets" (snapshot 2026-10-30 13:09 UTC, blok BSC
130670604). Ini catatan riset, bukan saran investasi. Data mentah 100 wallet:
[`docs/data/jagent-top-wallets.csv`](https://github.com/RavellerH/Hype/blob/gh-pages/docs/data/jagent-top-wallets.csv).*

## 0. Ringkasan

> JAGENT adalah meme coin **fair-mint** di BNB Smart Chain. Mint-nya hanya bisa dilakukan oleh pemegang
> **Binance .ai Agent ID** (Binance Agentic Wallet). Mcap-nya melewati **$8 jt** pada 30 Okt (TokenPost).
> Dari **4.942** early minter (epoch 1–4), hanya **153** yang punya saldo likuid ≥ $500 dan ≥ 20 tx.
> 100 teratas ada di CSV. Daftar ini paling berguna sebagai **watchlist wallet aktif yang punya modal**,
> bukan sebagai bukti profit dari JAGENT.

---

## 1. Proyek & mekanisme mint

| Item | Nilai | Sumber |
|---|---|---|
| Chain | BNB Smart Chain | jager.live |
| Syarat mint | Wallet dengan Binance **.ai Agent ID** | jager.live, TokenPost |
| Jatah | 10 share per Agent ID, +1 per invitee yang mint pertama, +1 per tugas sosial | jager.live |
| Total share | 4.440.000 | jager.live |
| Harga | Naik per epoch. Dari PDF: epoch 1 ≈ 1 USDT/share, epoch 2 ≈ 1,1–2 USDT, epoch 4 ≈ 2,34 USDT | jager.live, PDF |
| Alokasi pembayaran | **80%** ke pool PancakeSwap (dibuka di 10.000 share), **20%** treasury | jager.live |
| Kontrak mint | `0x3643A907f875fA9B740e1C0747E91b5aA5222aB8` | jager.live (klaim sendiri) |
| Kontrak token | `0x8e6442663A4F8C50b6132c68d42A30E7DFE4Ae15` | jager.live (klaim sendiri) |
| Harga snapshot | JAGENT $0,000008298 (PancakeSwap JAGENT/USDT), BNB $699,77 | PDF |
| Market cap | > $8 jt (30 Okt) | TokenPost |

**Peringatan:**

- Kontrak dan mekanisme di atas hanya bersumber dari situs proyek. Afiliasi dengan Binance **tidak terverifikasi**.
- Ada proyek tiruan/serupa, **BNAGENT** (kontrak `0xD6aF…9Cf0`), yang juga mensyaratkan .ai Agent ID dan
  menyatakan tidak berafiliasi dengan Binance. Jangan tertukar.
- Ada **bot sniper mint** publik di GitHub (Ha1o/BSCAgentMint). Epoch awal hampir pasti sebagian dikuasai bot.
- Situs mint memperingatkan: jangan kirim BNB/USDT ke alamat token. Approve USDT lalu panggil fungsi `mint`.

---

## 2. Statistik 100 wallet teratas

| Metrik | Nilai |
|---|---|
| Total saldo likuid (BNB+USDT+USDC) | **$118.002** (median $904) |
| Total dibayar untuk mint | **$1.263** untuk 984 share |
| Epoch | 59 di epoch 2 · 33 di epoch 1 · 4 di epoch 3 · 4 di epoch 4 |
| Jumlah share | 80 wallet tepat **10 share** (jatah dasar, tanpa invite/tugas) |
| Masih pegang JAGENT | Hanya **23 / 100** (total ±$5,2 rb) |
| Komposisi saldo | 72 wallet didominasi BNB. Total 118,9 BNB + $34,8 rb USDT, USDC ≈ 0 |
| Nonce (tx terkirim) | Median 222. Lima wallet > 1.000 tx |
| Bayar 0 USDT | 4 wallet (wymask, tat, 0xjl1222, latte): share dari invite/tugas |

### Cara membaca angka ini

1. **"Liquid $" bukan profit.** Itu saldo wallet saat ini. Rasio saldo/biaya mint (median ±73×) hanya
   menunjukkan bahwa minter ini punya modal, bukan bahwa mereka untung 73× dari JAGENT.
2. **77% top wallet tidak memegang JAGENT** → kemungkinan besar sudah menjual jatahnya, atau
   jatahnya belum didistribusikan. Ini tekanan jual yang sudah terealisasi, bukan yang akan datang.
3. **64 wallet memegang tepat 500 jt JAGENT** (di luar tabel karena tidak lolos filter likuiditas).
   Saldo identik dalam jumlah besar adalah pola distribusi otomatis: bisa jatah mint standar,
   bisa juga sybil farm. Belum bisa dibedakan tanpa melacak asal transfer.

---

## 3. Pola yang patut dicatat

### Kemungkinan cluster sybil / satu operator

- **afeng123.ai & afeng456.ai**: keduanya epoch 2, 10 share, bayar 13 USDT, saldo hanya BNB.
- **chesenas.ai & chesenas1.ai**: keduanya epoch 2, 10 share, bayar 15 USDT.
- Delapan ID numerik (8785, 0589, 918918, 077, 66666, 152597, 101111, 1518).
- Banyak wallet epoch 2 dengan profil identik: 10 share, bayar 11–20 USDT, saldo 0,9–3 BNB, tanpa USDT.
  Ini konsisten dengan satu operator yang mendanai banyak Agent ID.

### Wallet paling aktif (nonce > 1.000) — kandidat bot/trader

| Agent ID | Wallet | Tx | Catatan |
|---|---|---|---|
| 0xjl1222.ai | `0xb24a…7a31` | 3.858 | Bayar 0, pegang 25 jt JAGENT |
| vivian0610.ai | `0x5a1f…ecc3` | 2.712 | |
| yuki888.ai | `0x16b3…511c` | 1.955 | |
| ianever.ai | `0x1a91…9f12` | 1.673 | Pegang 69 jt JAGENT ($574) |
| baizhou.ai | `0x0103…81df` | 1.072 | Saldo 3,8 BNB |

### Pemegang JAGENT terbesar di daftar

| Agent ID | JAGENT | Nilai |
|---|---|---|
| kk1314.ai | 135 jt | $1.120 |
| ianever.ai | 69,2 jt | $574 |
| 918918.ai | 65,3 jt | $542 |
| minhlinh96.ai | 55,1 jt | $457 |
| czheyi.ai | 45,2 jt | $375 |

### Saldo terbesar

svo.ai ($4,19 rb, hampir semua USDT) · afeng123.ai ($3,41 rb) · aabbccdd.ai ($3,18 rb) ·
bigdick.ai ($2,70 rb) · baizhou.ai ($2,68 rb).

---

## 4. Implikasi & cara memakai data ini

- **Sebagai watchlist:** wallet dengan nonce tinggi dan saldo besar yang masih memegang JAGENT
  (ianever, kk1314, 0xjl1222) adalah sinyal untuk dipantau. Bila mereka mulai menjual, itu peringatan
  dini. Wallet yang sudah 0 JAGENT tidak lagi relevan untuk tekanan jual.
- **Sebagai peta pemain "agentic wallet" di BSC:** minter awal yang punya modal kemungkinan juga akan
  ikut fair-mint .ai berikutnya (mis. BNAGENT). Pantau aktivitas mereka di mint baru.
- **Risiko token:** 20% pembayaran ke treasury, kontrak belum terverifikasi independen, likuiditas
  di satu pool PancakeSwap, dan sebagian besar early minter sudah keluar. Ini meme coin murni.
- **Langkah lanjut yang bisa dilakukan:**
  1. Lacak asal dana (funding source) cluster epoch 2 untuk memastikan sybil.
  2. Tambahkan wallet nonce tinggi ke tab Watchlist/Wallets (dukungan BSC belum ada di monitor).
  3. Bandingkan dengan daftar minter BNAGENT untuk menemukan operator yang sama.

---

## Sumber

- PDF "jagent_top_wallets", snapshot BSC blok 130670604 (data di `docs/data/jagent-top-wallets.csv`)
- [jager.live — $JAGENT Mint](https://jager.live/)
- [TokenPost — JAGENT market cap exceeds $8M (Oct 30)](https://www.tokenpost.com/news/investing/44371)
- [BNAGENT — fair mint for .ai Agent IDs](https://bnagent.onrender.com/)
- [Ha1o/BSCAgentMint — mint sniper](https://github.com/Ha1o/BSCAgentMint)
