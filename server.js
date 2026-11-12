// FLACKO — BitChord Addon
// Protokol resmi BitChord (https://bitchord.kushagrasingh.in/docs):
//   GET /manifest.json  -> identitas + kemampuan addon
//   GET /search?q=...   -> cari lagu di katalog sendiri
//   GET /stream/{id}    -> URL audio yang bisa langsung diputar
// BitChord TIDAK pernah download / eksekusi kode addon.
// Dia cuma panggil server ini lewat HTTP, baca JSON, lalu putar URL yang dikembalikan.
//
// Cara pakai:
//   1. Taruh file musik kamu (FLAC diutamakan, MP3/M4A/WAV juga bisa)
//      di folder ./music dengan nama:  "Artis - Judul.flac"
//   2. Jalankan:  node server.js   (atau: npm start)
//   3. Di BitChord: Settings -> Sources -> Add an addon,
//      tempel:  http://<host-kamu>:3000/manifest.json
//      Untuk HP, pakai URL publik (Render / VPS / ngrok), bukan localhost.
//
// Tanpa dependensi sama sekali — cuma Node.js bawaan.
// Node >= 18.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = path.join(__dirname, "music");
const CACHE_DIR = path.join(__dirname, "cache");
const PORT = Number(process.env.PORT || 3000);
// Render otomatis ngasih RENDER_EXTERNAL_URL, misal https://flacko-bitchord-addon.onrender.com
// PUBLIC_URL tetap bisa dipakai buat override manual.
const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).replace(/\/$/, "");

const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8")
);

// ---------------------------------------------------------------- katalog
const EXT_TO_FORMAT = {
  ".flac": "flac",
  ".alac": "alac",
  ".m4a": "alac",
  ".mp3": "mp3",
  ".aac": "aac",
  ".wav": "wav",
  ".ogg": "ogg",
};

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "track";
}

function parseFileName(file) {
  const base = file.replace(/\.[^.]+$/, "");
  // "Artis - Judul" atau "Judul" saja
  const m = base.match(/^(.+?)\s*-\s*(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim(), album: "FLACKO" };
  return { artist: "FLACKO", title: base.trim(), album: "FLACKO" };
}

function scanTracks() {
  if (!fs.existsSync(MUSIC_DIR)) return [];
  const files = fs.readdirSync(MUSIC_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return EXT_TO_FORMAT[ext] && !f.startsWith(".");
  });
  return files
    .sort()
    .map((file) => {
      const ext = path.extname(file).toLowerCase();
      const meta = parseFileName(file);
      const format = EXT_TO_FORMAT[ext];
      const isLossless = ["flac", "alac", "wav"].includes(format);
      return {
        id: slugify(path.basename(file, ext)),
        file,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        // durasi tidak ditebak — BitChord tetap bisa match dari judul/artis/album.
        // Kalau mau durasi akurat, isi di tracks.json (lihat README).
        duration: 0,
        format,
        audioQuality: isLossless ? "LOSSLESS" : "HIGH",
      };
    });
}

// Metadata opsional dari tracks.json (judul/album/durasi/artwork per id)
function applyOverrides(tracks) {
  const overridePath = path.join(__dirname, "tracks.json");
  if (!fs.existsSync(overridePath)) return tracks;
  try {
    const overrides = JSON.parse(fs.readFileSync(overridePath, "utf8"));
    const byId = Object.fromEntries((overrides.tracks || []).map((t) => [t.id, t]));
    return tracks.map((t) => ({ ...t, ...(byId[t.id] || {}) }));
  } catch {
    return tracks;
  }
}

function publicTracks(req, qualityRaw) {
  const quality = normalizeQuality(qualityRaw);
  return applyOverrides(scanTracks()).map(
    ({ id, title, artist, album, duration, format, audioQuality }) => ({
      id,
      title,
      artist,
      album,
      ...(duration ? { duration } : {}),
      // Quality yang diminta BitChord mengubah format yang kita laporkan:
      // lossless -> FLAC asli, high/low -> MP3 hasil transcode.
      format: quality === "lossless" ? format : "mp3",
      audioQuality:
        quality === "lossless" ? audioQuality : quality === "high" ? "HIGH" : "LOW",
    })
  );
}

// ---------------------------------------------------------------- quality
// BitChord kirim ?quality=... di /search dan /stream, sesuai pilihan
// di Settings -> Sources. v1.0.0 dulu MENGABAIKAN parameter ini, jadi
// selalu balik FLAC lossless — itu kenapa quality di BitChord nggak
// ke-update. Sekarang tiap quality benar-benar beda file:
//   lossless -> file asli (FLAC/ALAC/WAV)
//   high     -> MP3 320 kbps (transcode, disimpan di cache/)
//   low      -> MP3 128 kbps (transcode, disimpan di cache/)
function normalizeQuality(raw) {
  const q = String(raw || "lossless").toLowerCase().trim();
  if (["high", "320", "normal"].includes(q)) return "high";
  if (["low", "128", "96", "min"].includes(q)) return "low";
  return "lossless"; // lossless, max, hires, cd, flac, kosong, dll.
}

function rendition(track, qualityRaw) {
  const quality = normalizeQuality(qualityRaw);
  const srcPath = path.join(MUSIC_DIR, track.file);
  if (quality === "lossless" || !["flac", "alac", "wav", "mp3"].includes(track.format)) {
    return {
      quality,
      filePath: srcPath,
      fileName: track.file,
      format: track.format,
      codec: track.format,
      container: track.format,
      qualityLabel: "Lossless · FLAC",
      extra: { sampleRate: 44100, bitDepth: 16 },
    };
  }
  // high / low: MP3 transcode, di-cache biar cuma sekali kerja.
  const kbps = quality === "high" ? 320 : 128;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${track.id}-${kbps}.mp3`);
  if (!fs.existsSync(cacheFile)) {
    try {
      execFileSync("ffmpeg", [
        "-y", "-v", "error", "-i", srcPath,
        "-codec:a", "libmp3lame", "-b:a", `${kbps}k`, cacheFile,
      ], { timeout: 120000 });
    } catch {
      // Kalau ffmpeg nggak ada (misal di host tertentu), fallback ke
      // file asli daripada gagal total.
      return rendition({ ...track, format: track.format }, "lossless");
    }
  }
  return {
    quality,
    filePath: cacheFile,
    fileName: `${track.id}-${kbps}.mp3`,
    format: "mp3",
    codec: "mp3",
    container: "mp3",
    qualityLabel: quality === "high" ? "High · MP3 320 kbps" : "Low · MP3 128 kbps",
    extra: { bitrate: kbps * 1000 },
  };
}

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------- helpers
function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, body, status = 200) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------------------------------------------------------------- server
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    // 1) Manifest — BitChord baca ini dulu saat addon ditambahkan
    if (pathname === "/manifest.json") {
      return sendJson(res, MANIFEST);
    }

    // 2) Search — GET /search?q=midnight&quality=lossless
    if (pathname === "/search") {
      const q = (url.searchParams.get("q") || "").toLowerCase().trim();
      let tracks = publicTracks(req, url.searchParams.get("quality"));
      if (q) {
        const words = q.split(/\s+/);
        tracks = tracks.filter((t) => {
          const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
      }
      // BitChord yang menilai kecocokan recording — kita kembalikan
      // hasil dalam urutan kita, maksimal 20 biar cepat.
      return sendJson(res, { tracks: tracks.slice(0, 20) });
    }

    // 3) Stream — GET /stream/{id}?quality=lossless
    //    404 = "lagu ini nggak ada di addon FLACKO", BitChord lanjut ke source berikutnya.
    if (pathname.startsWith("/stream/")) {
      const id = pathname.slice("/stream/".length).split("/")[0];
      const track = applyOverrides(scanTracks()).find((t) => t.id === id);
      if (!track) return sendJson(res, { error: "track not found in FLACKO" }, 404);

      const quality = normalizeQuality(url.searchParams.get("quality"));
      const r = rendition(track, quality);
      return sendJson(res, {
        url: `${baseUrl(req)}/media/${encodeURIComponent(id)}?quality=${r.quality}`,
        format: r.format,
        quality: r.qualityLabel,
        codec: r.codec,
        container: r.container,
        manifest: "none",
        encrypted: false,
        ...r.extra,
      });
    }

    // 4) Media — file audio (sesuai quality ?quality=...), dukung Range
    if (pathname.startsWith("/media/")) {
      const id = pathname.slice("/media/".length).split("/")[0];
      const track = scanTracks().find((t) => t.id === id);
      if (!track) {
        res.writeHead(404);
        return res.end("not found");
      }
      const r = rendition(track, url.searchParams.get("quality"));
      const filePath = r.filePath;
      const stat = fs.statSync(filePath);
      const mime =
        r.format === "flac"
          ? "audio/flac"
          : r.format === "mp3"
            ? "audio/mpeg"
            : r.format === "wav"
              ? "audio/wav"
              : "audio/mp4";

      const range = req.headers.range;
      if (range) {
        const m = range.match(/bytes=(\d*)-(\d*)/);
        const start = m && m[1] ? Number(m[1]) : 0;
        const end = m && m[2] ? Number(m[2]) : stat.size - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": mime,
        });
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    // 5) Health check — buat ngecek addon hidup atau nggak
    if (pathname === "/health") {
      const tracks = publicTracks(req);
      return sendJson(res, { ok: true, name: "FLACKO", version: MANIFEST.version, tracks: tracks.length });
    }

    // 6) Landing page
    if (pathname === "/" || pathname === "/index.html") {
      const tracks = publicTracks(req);
      const rows = tracks
        .map((t) => `<li><b>${escapeHtml(t.title)}</b> — ${escapeHtml(t.artist)} <span>(${t.format.toUpperCase()} · ${t.audioQuality})</span></li>`)
        .join("") || "<li><i>Belum ada lagu. Taruh file .flac di folder music/</i></li>";
      return sendHtml(
        res,
        `<!doctype html><html><head><meta charset="utf-8"><title>FLACKO — BitChord Addon</title>
        <style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.6}code{background:#eee;padding:2px 6px;border-radius:4px}h1{margin-bottom:0}</style></head>
        <body><h1>FLACKO</h1><p>Addon BitChord — mainkan koleksi musik kamu sendiri di BitChord, lossless.</p>
        <p>Tempel ini di BitChord → Settings → Sources → Add an addon:</p>
        <p><code>${baseUrl(req)}/manifest.json</code></p>
        <h2>Lagu (${tracks.length})</h2><ul>${rows}</ul>
        <p><a href="/manifest.json">manifest.json</a> · <a href="/health">health</a></p>
        </body></html>`
      );
    }

    res.writeHead(404);
    res.end("not found");
  } catch (e) {
    console.error(e);
    sendJson(res, { error: "internal error" }, 500);
  }
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

server.listen(PORT, () => {
  const tracks = scanTracks();
  console.log(`FLACKO addon jalan di http://localhost:${PORT}`);
  console.log(`Manifest: http://localhost:${PORT}/manifest.json`);
  console.log(
    PUBLIC_URL
      ? `URL publik: ${PUBLIC_URL}/manifest.json`
      : `Set PUBLIC_URL kalau di-deploy, contoh: PUBLIC_URL=https://flacko.onrender.com`
  );
  console.log(`Lagu ditemukan: ${tracks.length}`);
  for (const t of tracks) console.log(` - ${t.artist} - ${t.title} (${t.format})`);
});
