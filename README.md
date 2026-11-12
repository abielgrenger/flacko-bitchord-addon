# FLACKO — Addon BitChord

> **LINK PUBLIK (sementara, 60 menit):**
> Tempel ini di BitChord → Settings → Sources → Add an addon:
> `https://ryodx-2a04-4e41-14-7fd1--6ff8-ffd1.run.pinggy-free.link/manifest.json`
>
> Link ini dibuat 12 Nov 2026 ~20:10 WIB lewat tunnel Pinggy gratis, dan
> mati ~60 menit kemudian (~21:10 WIB) — juga mati kalau server/tunnel
> di laptop ini berhenti. Buat link permanen, deploy ke Render (lihat
> bagian 3, Opsi A). Link dites dari internet 20:11 WIB: manifest,
> search, stream, dan download FLAC semuanya jalan.

Addon BitChord buat mainin **koleksi musik kamu sendiri** di BitChord, lossless (FLAC).
Bukan layanan streaming, bukan sumber lagu bajakan — FLACKO cuma jembatan antara
file musik di server kamu dan aplikasi BitChord di HP kamu.

Ikut protokol resmi BitChord: https://bitchord.kushagrasingh.in/docs

```
GET /manifest.json   -> identitas addon
GET /search?q=...    -> cari lagu di katalog kamu
GET /stream/{id}     -> URL audio yang langsung bisa diputar
GET /media/{id}      -> file audio asli (dukung Range / seek)
GET /health          -> cek addon hidup atau nggak
```

## Isi paket

| File | Fungsi |
| --- | --- |
| `server.js` | Server addon, tanpa dependensi (cuma Node.js bawaan) |
| `manifest.json` | Identitas addon: id `com.flacko.bitchord`, nama `FLACKO`, v1.0.0 |
| `tracks.json` | Metadata opsional (judul / album / durasi) per lagu |
| `music/` | Taruh file musik kamu di sini |
| `render.yaml` | Deploy 1 klik ke Render |
| `Dockerfile` | Deploy ke Northflank (free Sandbox, always-on, nggak tidur) — Node 20 + ffmpeg |
| `package.json` | `npm start` = `node server.js` |

2 lagu demo sudah included di `music/` — itu nada test yang di-generate pakai
ffmpeg, bukan lagu berhak cipta. Buat ngetes aja, boleh dihapus.

## 1. Jalanin di laptop (tes)

```bash
cd flacko-bitchord-addon
node server.js
# atau: npm start
```

Cek di browser / terminal:

```bash
curl http://localhost:3000/manifest.json
curl "http://localhost:3000/search?q=midnight"
curl http://localhost:3000/health
```

Hasil tes terakhir (12 Nov 2026): semua endpoint jalan —
manifest ✅, search `midnight` ketemu 1 lagu, search `flacko` ketemu 2 lagu,
stream balikin FLAC 16-bit / 44.1 kHz ✅, lagu nggak ada balikin 404 ✅,
media dukung Range (206) ✅.

## 2. Tambah lagu kamu sendiri

1. Taruh file `.flac` (paling bagus), `.mp3`, `.m4a`, atau `.wav` di folder `music/`
2. Namain: `Artis - Judul.flac` — contoh: `Hindia - Evaluasi.flac`
3. Restart server. Selesai, langsung kebaca di `/search`.

Mau durasi / album yang akurat? Tambahin di `tracks.json`, id-nya dari nama file
yang di-slug (huruf kecil, spasi jadi `-`), contoh `hindia-evaluasi`:

```json
{ "tracks": [{ "id": "hindia-evaluasi", "title": "Evaluasi", "artist": "Hindia", "album": "Menari dengan Bayangan", "duration": 245 }] }
```

## 3. Pasang di BitChord (HP)

> **Penting:** HP kamu nggak bisa buka `localhost` di laptop. Addon harus punya
> URL publik HTTPS. Paling gampang: deploy ke Render (gratis), atau buat tes
> cepat pakai ngrok.

**Opsi A — Northflank (buat dipakai terus, gratis, selalu nyala):**
1. Upload folder ini ke GitHub (repo baru, misal `flacko-bitchord-addon`)
2. Daftar di northflank.com (sign-in GitHub paling gampang), verifikasi kartu saat diminta — Sandbox-nya gratis, kartu cuma buat verifikasi, nggak di-charge kalau nggak upgrade.
3. Buat Project, lalu Create new → Service → Build & deploy from Git repository → pilih repo `flacko-bitchord-addon`, branch `main`.
4. Build type: **Dockerfile** (otomatis ke-detect, `Dockerfile` sudah ada di repo — Node 20 + ffmpeg, biar quality High/Low tetap bisa transcode MP3).
5. Networking → Ports: tambah port internal `3000`, enable **Publicly expose** — Northflank kasih URL `https://<service>-<project>.code.run`.
6. Nggak perlu set env manual — Northflank otomatis isi `PORT`, server.js baca itu, dan URL publik diambil dari Host header request.
7. Deploy, buka `https://<service>-<project>.code.run/health` — harus `{"ok":true,...}`. Link addon-nya: `https://<service>-<project>.code.run/manifest.json`
8. Beda dengan Render free: Northflank Sandbox always-on, nggak tidur.

**Opsi A2 — Render (gratis, link permanen, tapi tidur):**
1. Upload folder ini ke GitHub (repo baru, misal `flacko-bitchord-addon`)
2. Di Render: New → Web Service → pilih repo itu
   (atau New → Blueprint, pilih repo — `render.yaml` sudah ada, jadi
   nama, plan free, build & start terisi otomatis)
3. Build: `npm install`, Start: `npm start`
4. Nggak perlu set env manual — Render otomatis isi `PORT` dan
   `RENDER_EXTERNAL_URL`, server.js pakai itu sebagai URL publik.
5. Tunggu deploy selesai, buka `https://<nama-service>.onrender.com/health`
   — harus `{"ok":true,...}`. Link addon-nya:
   `https://<nama-service>.onrender.com/manifest.json`
6. Render free tidur setelah 15 menit idle, request pertama bisa
   lambat 30–60 detik. Itu normal.

**Opsi B — ngrok (tes cepat, URL berubah tiap restart):**
```bash
node server.js
ngrok http 3000
# pakai URL https://xxxx.ngrok-free.app yang muncul
```

**Terus di BitChord:**
1. Buka BitChord → akun (pojok kanan atas) → Settings → Sources
2. Add an addon → tempel: `https://<domain-kamu>/manifest.json`
3. Save. FLACKO muncul sebagai source. Naikin ke paling atas biar
   lagu kamu diprioritaskan, sisanya fallback ke YouTube Music.
4. Cari lagu kamu, play. Harusnya muncul badge lossless.

## 4. Catatan soal `bitchordAuth`

Manifest FLACKO sudah declare `"bitchordAuth": true` biar nggak muncul
tulisan "Outdated addon" di BitChord 1.9.1+. Server v1.0.0 ini belum
memverifikasi token BitChord-nya (request tetap dilayani) — itu sesuai
dokumen resmi, tapi belum proteksi penuh. Kalau mau proteksi penuh
(cuma aplikasi BitChord resmi yang bisa pakai), ikuti langkah di
https://bitchord.kushagrasingh.in/docs bagian "Addon auth" — tinggal
tambah file verifier yang mereka sediakan, tanpa ubah `server.js` ini.

## Troubleshooting

- **Addon nggak muncul / search kosong:** cek `/health` dulu. Kalau `tracks: 0`,
  berarti folder `music/` kosong atau nama file nggak kebaca. Restart server.
- **Lagu nggak ke-play, fallback ke YouTube:** cek `/stream/<id>` di browser.
  Harus balikin JSON dengan `url` absolut (ada `https://` + host). Kalau masih
  `localhost`, berarti `PUBLIC_URL` belum di-set waktu deploy.
- **Render free tier tidur:** request pertama setelah lama nggak dipakai
  bisa lambat 30–60 detik. Itu normal di free tier.
- **Mau download di BitChord:** `allowDownloads: 1` di manifest, jadi
  lagu dari FLACKO boleh di-download. Ubah ke `0` kalau cuma mau streaming.
