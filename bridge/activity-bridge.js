/**
 * ScanCumberland Activity Bridge – v0.2 (Auth + RBAC + Public Aggregate)
 * Dependencies: express ws chokidar csv-parse dotenv bcrypt jsonwebtoken cors
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { parse as parseCsv } from 'csv-parse';
import os from 'os';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const PORT = Number(process.env.PORT || 8091);
const WS_PATH = process.env.WS_PATH || '/activity';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const WATCH_JSON_DIR = process.env.WATCH_JSON_DIR || '';
const JSON_GLOB = process.env.JSON_GLOB || '**/*.json';
const WATCH_CSV_FILE = process.env.WATCH_CSV_FILE || '';
const CSV_HAS_HEADER = String(process.env.CSV_HAS_HEADER || 'true').toLowerCase() === 'true';
const PUBLIC_WINDOW_SEC = Number(process.env.PUBLIC_WINDOW_SEC || 300);

const app = express();
app.use(express.json());
if (ALLOWED_ORIGIN) {
  app.use(cors({ origin: ALLOWED_ORIGIN, credentials: false }));
} else {
  app.use(cors());
}

function sign(role) { return jwt.sign({ role }, JWT_SECRET, { expiresIn: JWT_EXPIRES }); }
function verifyToken(token) { if (!token) throw new Error('missing token'); return jwt.verify(token, JWT_SECRET); }
function authMiddleware(req, res, next) {
  try {
    const h = req.headers['authorization'] || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch { return res.status(401).json({ error: 'unauthorized' }); }
}

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (username !== ADMIN_USERNAME) return res.status(401).json({ error: 'invalid credentials' });
    if (!ADMIN_PASSWORD_HASH) return res.status(500).json({ error: 'server not configured' });
    const ok = await bcrypt.compare(String(password || ''), ADMIN_PASSWORD_HASH);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = sign('admin');
    return res.json({ token, role: 'admin' });
  } catch { return res.status(500).json({ error: 'login failed' }); }
});

app.get('/status', authMiddleware, (_req, res) => {
  res.json({
    host: { platform: os.platform(), release: os.release(), cpus: os.cpus().length, loadavg: os.loadavg(), freemem: os.freemem(), totalmem: os.totalmem(), uptime: os.uptime() },
    tuners: [], streams: [],
  });
});

let recentEvents = [];
function addAggregate(agency) {
  const tsMs = Date.now();
  recentEvents.push({ tsMs, agency });
  const cutoff = tsMs - PUBLIC_WINDOW_SEC * 1000;
  recentEvents = recentEvents.filter((e) => e.tsMs >= cutoff);
}
app.get('/public-aggregate', (_req, res) => {
  const now = Date.now();
  const cutoff = now - PUBLIC_WINDOW_SEC * 1000;
  const windowed = recentEvents.filter((e) => e.tsMs >= cutoff);
  const counts = { Fire:0, EMS:0, Law:0, Other:0 };
  for (const e of windowed) {
    if (e.agency === 'Fire') counts.Fire++; else if (e.agency === 'EMS') counts.EMS++; else if (e.agency === 'Law') counts.Law++; else counts.Other++;
  }
  res.json({ windowSec: PUBLIC_WINDOW_SEC, counts });
});

const server = app.listen(PORT, () => console.log(`[bridge] HTTP listening on :${PORT}`));
const wss = new WebSocketServer({ server, path: WS_PATH });
wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token') || '';
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') throw new Error('forbidden');
  } catch { ws.close(1008, 'unauthorized'); return; }
});

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    try { if (client.readyState === 1) client.send(payload); } catch {}
  }
}

let seenJson = new Map();
if (WATCH_JSON_DIR) {
  const watcher = chokidar.watch(path.join(WATCH_JSON_DIR, JSON_GLOB), { ignoreInitial: false, awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }, depth: 10 });
  watcher.on('add', onJson).on('change', onJson);
  async function onJson(fp) {
    try {
      const st = await fs.promises.stat(fp);
      const prev = seenJson.get(fp) || 0; if (st.mtimeMs <= prev) return; seenJson.set(fp, st.mtimeMs);
      const raw = await fs.promises.readFile(fp, 'utf8');
      const j = JSON.parse(raw);
      const evt = normalizeJson(j);
      console.log('[bridge] event', evt?.tg, evt?.name || '', evt?.agency || '');

      if (evt) { broadcast(evt); addAggregate(evt.agency || 'Other'); }
    } catch (e) { console.error('[bridge] JSON parse error', fp, e?.message || e); }
  }
}

if (WATCH_CSV_FILE) {
  const streamCsv = fs.createReadStream(WATCH_CSV_FILE, { encoding: 'utf8' });
  const parser = parseCsv({ columns: CSV_HAS_HEADER, relax_column_count: true });
  streamCsv.pipe(parser);
  parser.on('readable', () => { let rec; while ((rec = parser.read())) { const evt = normalizeCsv(rec); broadcast(evt); addAggregate(evt.agency || 'Other'); } });
  parser.on('error', (e) => console.error('[bridge] CSV error', e?.message || e));
}

function normalizeJson(j) {
  if (!j) return null;
  const ts = j.start ? new Date(j.start * 1000) : new Date();
  const dur = j.duration || (j.end && j.start ? (j.end - j.start) : undefined);
  return { time: ts.toLocaleTimeString(), tg: j.talkgroup || j.tgid || j.tg || null, name: j.alias || j.tg_name || '—', agency: j.agency || inferAgency(j.alias || ''), duration: dur ? `${typeof dur === 'number' ? dur.toFixed(1) : dur}s` : '—', rssi: j.rssi ? `${j.rssi} dBm` : '—', frequency: j.freq || j.frequency || null };
}
function normalizeCsv(rec) {
  return { time: rec.time || rec.timestamp || new Date().toLocaleTimeString(), tg: rec.talkgroup || rec.tgid || rec.tg || null, name: rec.name || rec.alias || '—', agency: inferAgency(rec.name || rec.alias || ''), duration: rec.duration ? `${rec.duration}s` : '—', rssi: rec.rssi ? `${rec.rssi} dBm` : '—', frequency: rec.frequency || rec.freq || null };
}
function inferAgency(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('fire')) return 'Fire';
  if (n.includes('ems') || n.includes('med') || n.includes('care') || n.includes('duke')) return 'EMS';
  if (n.includes('sheriff') || n.includes('pd') || n.includes('police') || n.includes('law')) return 'Law';
  return 'Other';
}

console.log(`[bridge] WS ready at ws://localhost:${PORT}${WS_PATH}`);
