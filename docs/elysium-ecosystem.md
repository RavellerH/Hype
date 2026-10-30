# Ekosistem Elysium — validasi daftar proyek & peluang

*Disusun 30 Oktober 2026 dari PDF "elysium_ecosystem_2026-10-29" (108 akun X). Ini catatan riset, bukan
saran investasi. Bacaan dasar: [Elysium — fakta & koreksi](elysium.md).*

**Cara validasi.** Situs proyek, x.com, chainlist, dan RPC di PDF **diblokir** dari lingkungan riset
ini, jadi tidak ada yang bisa dibuka atau di-ping langsung. Setiap klaim dicek lewat pencarian web
terhadap sumber independen (media, dokumentasi penyedia RPC, GitHub). Label:

- ✅ **Terkonfirmasi**: ada sumber independen
- 🟡 **Klaim sendiri**: hanya dari akun/situs proyek atau post komunitas
- ⚪ **Tidak ditemukan**: tidak ada sumber sama sekali
- 🚩 **Red flag**

---

## 0. Temuan terpenting

> **Ada chain "pre-launch" yang sudah berjalan, dan itu BUKAN mainnet resmi.** Chain ID **99901**
> muncul di PR GitHub DRPC (di-deploy Conduit), tapi Kinetiq belum mempublikasikannya. Alchemy dan
> Chainstack sama-sama menyatakan mainnet belum rilis. Semua RPC di PDF (`rpc-live.elysp.com`,
> `elyspump-live-rpc.fly.dev`) dan semua bridge selain milik Kinetiq adalah **pihak ketiga**.

Yang sudah terjadi di chain itu:

- Tracker ronspad: **500+ token**, ±$1,6 jt volume 24 jam, 7.000+ trade di pasar *unofficial*
  pre-launch (Fabius DeFi). Narasi "10x" berasal dari post itu sendiri, tanpa data harga.
- ElysPump (elysp.com) menyatakan diri **tidak berafiliasi** dengan Kinetiq/Elysium/Conduit:
  deposit **satu arah**, penarikan butuh challenge period yang belum dikonfirmasi Elysium. Akun
  mereka sendiri menulis *"Kinetiq is coming after us again"* dan memakai domain cadangan.
- ElysPump menawarkan **OTC desk** untuk melewati penarikan 6 hari: fee **3% ke wallet admin**, dan
  mode auto-settle mempercayakan secret hashlock ke keeper mereka.
- NFT "pertama di mainnet" (Elysian Field, mint 27.10; Punks/asphodel "live on mainnet") dicetak di
  chain pra-rilis ini.

**Risikonya:** chain bisa di-*reset* sebelum mainnet resmi, likuiditas tipis, dan dana bisa
terkunci. Ada preseden: komentar KuCoin mencatat ±$2 jt hilang lewat bridge tidak resmi di chain
lain (Giwa). **Jangan bridge apa pun sebelum 9 November lewat jalur selain bridge Kinetiq.**

> **Catatan 6 hari.** Penarikan "6 hari" kemungkinan besar adalah challenge period bawaan Arbitrum
> Nitro (±6,4 hari). Artinya, keluar dari Elysium ke HyperEVM lewat bridge **resmi** pun kemungkinan
> butuh ±6 hari, kecuali ada layanan fast-withdrawal. Rencanakan likuiditas dengan asumsi itu.

---

## 1. Validasi per kategori

### Core

| Akun | Status | Catatan |
|---|---|---|
| @Enter_Elysium | ✅ | Akun resmi chain. Mainnet 9 Nov dikonfirmasi Bankless/TokenPost |
| @Kinetiq_xyz | ✅ | Tim pengembang, kHYPE |
| @ElysiumEco | 🟡 | Komunitas, **tidak resmi** (diakui di PDF) |

### Launchpad

| Akun | Status | Catatan |
|---|---|---|
| @AscendLaunch | ✅ / 🚩 sebagian | Launchpad flagship, co-founder CryptoTomYT, proyek pertama yang umumkan deploy di Elysium, kontrak live di testnet. **"Diaudit Cantina" TIDAK terkonfirmasi**: Ascend sendiri bilang kontrak staking "sudah dikirim ke auditor independen" dan hasilnya akan dipublikasikan sebelum mainnet. **Tidak ada token platform.** Tanpa bonding curve; token langsung masuk hook pool, harga awal dalam USDC/RWA |
| @Boxa_Elysium | 🚩 | "Live di Elysium" = chain pra-rilis; bridge pihak ketiga |
| @TheKleos_ | 🚩 | Idem; bridge batch tiap 3 jam |
| @ElysiumPump | 🚩 | Lihat §0: tidak berafiliasi, ada sengketa dengan Kinetiq, OTC 3% |
| @citadeldotxyz | ✅ | citadel-elysium.xyz ada; fair launch memakai pool Uniswap V3 terkunci |
| @MontraXYZ | ⚪ | Klaim "25% airdrop $MONTRA" dan routing ke kHYPE tidak ditemukan di sumber mana pun |
| @ronspadfun | 🟡 | Tracker pasar pre-launch (sumber angka 500+ token); bridge sendiri, kecil |
| @arka_fun | 🟡 | Klaim fee untuk burn $KNTQ, akun 30 follower |
| Lainnya (SignalFam, CorePad, perpme, Neuriio, Chainzy, Bunnypad, kilnpad, Torus, Valhalla, asphodel, apogee, oxley) | ⚪ | Tidak ada sumber independen |

### DEX / Trading

| Akun | Status | Catatan |
|---|---|---|
| @fomo | ✅ | "Exclusive trading partner" + dukungan hari pertama (TokenPost, Bankless). Cakupan eksklusivitas tidak dijelaskan |
| **Pump.fun** | ✅ **tidak ada di PDF** | Mengumumkan trading Elysium di aplikasinya **mulai 9 Nov** (Bankless, KuCoin, ChainCatcher) |
| @Uniswap | 🟡 diperdebatkan | Router V2 + V4 dikonfirmasi di testnet, tapi CryptoBriefing mencatat **belum ada dukungan resmi Uniswap Labs**, hanya deployment on-chain |
| @KyberNetwork, @0xProject | 🟡 | Routing hari pertama, hanya dari post Kinetiq |
| @kalosfun | ✅ | NFT marketplace + DEX + launchpad di testnet; stake KALOS → stKALOS. Angka "33,6K user" tidak terverifikasi. **Airdrop belum dikonfirmasi** |
| @NestExchange | ✅ (HyperEVM) | ve(3,3) MetaDEX yang ada di HyperEVM (likuiditas NEST/WHYPE ±$515K). Deploy Elysium belum terverifikasi |
| @HybraFinance | ✅ (HyperEVM) | CL DEX ve(3,3) di HyperEVM, poin pra-TGE. Likuiditas tipis |
| @HyperFlow_fun | ⚪ | |
| @Elysdex | 🚩 | Akun 2015 yang **diganti nama** |
| Mosaic, Atlas, shift, DexDaCosta, Mirage ("1000x"), twoprint | ⚪ | "1000x leverage on any asset" = waspada |

### DeFi / Prediksi, NFT, Games, Memecoin

| Grup | Status | Catatan |
|---|---|---|
| @Pantheonindex | 🟡 | Repo GitHub "PANTHEON: index of Ascend" ada dan menguji kontrak testnet Ascend |
| Pindar, Temporal, aegis, monarchy, Elypact, speculate, hyperflip, Ropes | ⚪ | Tidak ada sumber independen |
| NFT (Elytra, AtlasHL, Elysian Field, Bitizens, dll.) | 🟡 / 🚩 | Yang "minted / live on mainnet" berada di chain pra-rilis. @dystomfersOnHL: bio tanpa Elysium |
| Games (eloscape, tilt, archunt, Hyperion…) | ⚪ | Tilt & playelysa = kasino/18+ |
| @Elysium_Cat ($ECAT) | 🚩🚩 | Akun 2012 yang **diganti nama**, plus bridge pihak ketiga. Pola klasik |
| $KLEOS, $BOXA, $ELYSP, $BLOB, $kNuts, $MONKO | 🚩 | Token pre-launch di chain tidak resmi |
| @AgentKinetiq ($AK) | 🟡 | "Maskot intern Kinetiq": belum ada konfirmasi bahwa ini resmi dari Kinetiq |
| $EPEPE, @AgentEly_ | 🟡 | Mengklaim launch **9 Nov di Ascend**: lebih bersih daripada pre-launch, tetap spekulatif |

### Bridge & Infra

| Item | Status | Catatan |
|---|---|---|
| Bridge canonical Kinetiq | ✅ | Bridge token standar Arbitrum Nitro + mirror bridge. Halaman yang terverifikasi baru `elysium.kinetiq.xyz/testnet-bridge` |
| boxa.pro, thekleos.xyz, elysp.com, elysiumcat.com, ronspad | 🚩 | Pihak ketiga ke chain pra-rilis |
| Alchemy, QuickNode, Chainstack, Dwellir | ✅ | Mendukung **testnet** (99801). Alchemy: mainnet belum rilis. QuickNode: partner hari pertama mainnet |
| @cantinasecurity | 🟡 | Cantina pernah mengaudit kHYPE (2025). Peran "security partner Elysium" tidak ditemukan di sumber independen |
| Goldsky, serialized, liquidterminal, ElysiumRadar, ElysiumNames, minecurve | ⚪ | |
| Chain ID 99901 | 🟡 | Hanya di PR DRPC dan repo pihak ketiga. Kinetiq belum mempublikasikan |
| RPC elysp / fly.dev | 🚩 | Milik ElysiumPump, bukan resmi |

**Skor PDF:** dari ±108 entri, hanya ±15 yang punya sumber independen. Mayoritas akun berusia kurang
dari 3 bulan dengan follower di bawah 1.000. Kolom "Mentions" mengukur keramaian di feed, bukan legitimasi.

---

## 2. Peluang, diurutkan dari risiko terendah

### A. Sekarang sampai 9 Nov: aktivitas testnet (modal ±0)

- **Kalos**: poin dihitung dari beli/jual NFT, mint berbayar di Drops, dan post/like sosial.
  Swap/LP/stake **tidak** dihitung. Ada rencana whitelist Genesis NFT untuk user awal.
- **Ascend testnet**: kontrak sudah live. Ascend tidak punya token sendiri, jadi peluangnya ada di
  token yang diluncurkan, bukan airdrop platform.
- Elysium sendiri: **tidak ada token/poin resmi**. Aktivitas testnet hanya taruhan pada airdrop
  level aplikasi (Kalos, Montra, dll.), bukan Kinetiq.
- Gunakan **wallet terpisah** (bukan Rabby utama) untuk semua interaksi testnet dan dApp baru.

### B. 9 Nov (hari H): arus ritel terbesar

- **Pump.fun + fomo** membuka trading Elysium hari pertama → gelombang token baru dan volatilitas
  tinggi. Ini adalah momen fee sequencer dan burn KNTQ pertama kali terlihat.
- Launch Ascend (mis. $EPEPE, AgentEly) di chain resmi. Aturan main: modal kecil, ambil untung
  cepat, karena mayoritas token launch hari pertama turun dalam seminggu.
- **Hanya** lewat bridge resmi Kinetiq. Cek chain ID dan URL bridge dari @Enter_Elysium/@Kinetiq_xyz
  pada hari itu, bukan dari link di reply atau grup TG.
- Sisakan HYPE untuk gas, dan ingat penarikan ±6 hari: jangan bridge dana yang mungkin dibutuhkan minggu itu.

### C. H+2 sampai H+4 minggu: data dulu, lalu posisi

- **KNTQ**: masuk setelah ada data fee harian dalam HYPE (lihat hitungan di [doc utama](elysium.md)).
- **LP**: hanya di DEX yang terverifikasi (Uniswap V3/V4, Nest bila deploy) dengan pair HYPE/kHYPE/USDC.
- **kHYPE**: tetap posisi dasar paling rendah risiko.

### D. Builder: celah yang terlihat dari PDF

- Infra analitik masih tipis: hanya liquidterminal (dashboard 24 jam) dan ElysiumRadar (44 follower).
  Dashboard ini (Hype) bisa menambah **tab Elysium**: fee harian, burn KNTQ, TVL bridge, dan launch
  baru di Ascend/Pump.fun, setelah RPC resmi tersedia.
- Precompile HyperCore datang ±4 minggu pasca-mainnet. Alat yang membandingkan harga AMM Elysium
  dengan HyperCore akan punya pengguna.

---

## 3. Hindari

1. Bridge / RPC / token apa pun di chain 99901 sebelum Kinetiq mengumumkan mainnet.
2. OTC desk "lewati 6 hari" (fee 3% ke admin, keeper memegang secret).
3. Akun lama yang diganti nama (@Elysium_Cat 2012, @Elysdex 2015).
4. Klaim "diaudit X" tanpa link laporan audit (termasuk Ascend × Cantina, sampai laporannya terbit).
5. "1000x leverage", kasino, dan klaim airdrop tanpa sumber.

## 4. Verifikasi sendiri (dari komputer Anda)

Cek chain ID sebuah RPC sebelum menambahkannya ke wallet:

```
curl -s -X POST <RPC_URL> -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

`0x185d9` = 99801 (testnet resmi), `0x1863d` = 99901 (chain pra-rilis). Pada 9 Nov, cocokkan chain
ID dengan pengumuman resmi Kinetiq.

---

## Sumber

- [Fabius DeFi: snapshot pasar pre-launch dari ronspad](https://x.com/FabiusDefi/status/2115690164853109160)
- [ElysPump: bridge (pernyataan non-afiliasi)](https://elysp.com/) · [ElysP OTC](https://otc.elysp.com/) · [@ElysiumPump](https://x.com/ElysiumPump)
- [DRPC PR #291: Elysium mainnet & testnet](https://github.com/drpcorg/public/pull/291)
- [Alchemy: Elysium API FAQ](https://www.alchemy.com/docs/reference/elysium-api-faq) · [Alchemy testnet RPC](https://www.alchemy.com/rpc/elysium-testnet.md)
- [Chainstack: Elysium tooling](https://docs.chainstack.com/docs/elysium-tooling) · [QuickNode: Elysium](https://www.quicknode.com/docs/elysium)
- [Kinetiq: token bridging on Elysium](https://elysium.kinetiq.xyz/docs/token-bridging-on-elysium) · [Kinetiq ecosystem](https://elysium.kinetiq.xyz/ecosystem)
- [TokenPost: fomo day-one support](https://www.tokenpost.com/news/business/43778) · [Bankless: Pump.fun & fomo sign on](https://www.bankless.com/read/news/pump-fun-fomo-sign-on-elysium-day-one)
- [KuCoin: Pump.fun launches Elysium trading Nov 9](https://www.kucoin.com/news/flash/pump-fun-to-launch-elysium-trading-on-november-9) · [ChainCatcher](https://www.chaincatcher.com/en/article/2299678)
- [CryptoBriefing: Uniswap coming to Elysium](https://cryptobriefing.com/uniswap-coming-to-elysium-hype-chain/)
- [@AscendLaunch](https://x.com/ascendlaunch) · [KuCoin insight: Ascend](https://www.kucoin.com/news/insight/HYPE/6ae417aabbcb520007452058) · [PANTHEON repo](https://github.com/daraijaola/pantheon)
- [KuCoin insight: the Giwa unofficial bridge loss](https://www.kucoin.com/news/insight/HYPE/6adbb9783f52a20007f3f2a4)
- [Bitrue: Kalos testnet guide](https://www.bitrue.com/blog/kalos-testnet-airdrop-guide) · [airdrops.io: Kalos](https://airdrops.io/kalos/)
- [Citadel](https://citadel-elysium.xyz/) · [Alchemy dapps: Nest](https://dapps.alchemy.com/dapps/nest-exchange) · [Hybra (airdropalert)](https://airdropalert.com/airdrops/hybra-finance/)
