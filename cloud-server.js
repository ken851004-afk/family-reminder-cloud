/**
 * 家庭提醒系統 - 本地整合服務器 (cloud-server.js)
 * 推送層統一使用 wacli（唔使 baileys / 唔使掃 QR / 唔會 14 日過期）
 *
 * 功能：
 *  - HTTP API：data / reminders / birthdays CRUD（網頁用）
 *  - 每日 07:00 HKT 經 wacli 發群組 summary 去 GROUP_ID
 *  - POST /api/send-message：經 wacli 發任意 WhatsApp 訊息
 *  - GET /wa-status、/health：回報 wacli 認證狀態
 *  - 每分鐘 cron 檢查 07:00 HKT
 *
 * 依賴：wacli（已認證，見 WACLI_PATH）
 * 唔再需要：baileys / qrcode / node-cache / pino
 *
 * 測試：DRY_RUN=1 node cloud-server.js  → 發送只記錄唔實際發
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

// ===== 常數 =====
const PORT = process.env.PORT || 3000;
const GROUP_ID = '85262218999-1474211595@g.us';
const WACLI_PATH = process.env.WACLI_PATH || process.env.WACLI ||
  'C:\\Users\\KEN85\\.workbuddy\\binaries\\wacli\\wacli.exe';
const DATA_FILE = path.join(__dirname, 'data.json');
const CLOUD_DATA_URL = 'https://jsonblob.com/api/jsonBlob/019ef495-3c34-718c-8bb5-1ccbb9182d66';
const WEB_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const CAT_ICONS = { school: '\u{1F3EB}', class: '\u{1F3A8}', special: '\u{2B50}', summer: '\u{2600}\u{FE0F}', routine: '\u{1F4C5}' };
const CAT_NAMES = { school: '\u{5B78}\u{6821}\u{9762}\u{8A66}', class: '\u{8208}\u{8DA3}\u{73ED}', special: '\u{7279}\u{5225}\u{65E5}\u{5B50}', summer: '\u{6691}\u{671F}\u{5B89}\u{6392}', routine: '\u{6052}\u{5E38}\u{65E5}\u{7A0B}' };
const DAY_NAMES = ['\u{65E5}','\u{4E00}','\u{4E8C}','\u{4E09}','\u{56DB}','\u{4E94}','\u{516D}'];
const CAREGIVERS = ['EPPIE', 'KEN', 'COFFE', '\u{674F}\u{82B1}\u{6751}'];

// ===== 全域狀態 =====
let lastReminderDate = null;
let wacliAuthenticated = false;

// ===== HTTP 工具 =====
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

function httpsPut(url, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const opts = {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(url, opts, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(url, opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ===== 數據管理 =====
function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch(e) { console.error('[DATA] 讀取失敗:', e.message); }
  return {
    reminders: [],
    birthdays: [
      { name: 'EPPIE', date: '??-??', note: '' },
      { name: 'KEN', date: '??-??', note: '' },
      { name: 'COFFE', date: '??-??', note: '' },
      { name: '\u{674F}\u{82B1}\u{6751}', date: '??-??', note: '' }
    ],
    members: CAREGIVERS,
    caregivers: CAREGIVERS
  };
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch(e) { console.error('[DATA] 寫入失敗:', e.message); }
  // 雲端同步
  httpsPut(CLOUD_DATA_URL, data).catch(() => {});
}

function uid() {
  return 'r' + Date.now() + Math.random().toString(36).slice(2, 6);
}

// ===== 雲端數據同步 =====
async function syncDataFromCloud() {
  try {
    const cloudData = await httpsGet(CLOUD_DATA_URL);
    if (cloudData && cloudData.reminders) {
      writeData(cloudData);
      console.log('[DATA] 從雲端同步成功');
      return cloudData;
    }
  } catch(e) { console.log('[DATA] 雲端同步失敗:', e.message); }
  return null;
}

// ===== wacli 整合 =====
function sendViaWacli(to, text) {
  return new Promise((resolve, reject) => {
    if (DRY_RUN) {
      console.log(`[WACLI][DRY-RUN] to=${to}\n${text}`);
      return resolve({ ok: true, dryRun: true });
    }
    const proc = spawn(WACLI_PATH, ['send', 'text', '--to', to, '--message', text], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('error', e => reject(new Error('spawn wacli 失敗: ' + e.message)));
    proc.on('close', code => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error('wacli exit ' + code + (err.trim() ? ': ' + err.trim() : '')));
    });
  });
}

function checkWacli() {
  return new Promise((resolve) => {
    if (!fs.existsSync(WACLI_PATH)) {
      wacliAuthenticated = false;
      return resolve(false);
    }
    try {
      const proc = spawn(WACLI_PATH, ['doctor'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => out += d);
      proc.on('error', () => { wacliAuthenticated = false; resolve(false); });
      proc.on('close', () => {
        wacliAuthenticated = /AUTHENTICATED\s+true/i.test(out);
        resolve(wacliAuthenticated);
      });
    } catch(e) {
      wacliAuthenticated = false;
      resolve(false);
    }
  });
}

// ===== 每日自動提醒 =====
function getDaysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target - today) / 86400000);
}

function getWeekDay(dateStr) {
  return DAY_NAMES[new Date(dateStr + 'T00:00:00').getDay()];
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function getRecurringDates(r, today, maxDays) {
  const repeat = r.repeat || 'none';
  if (repeat === 'none') {
    const daysUntil = getDaysUntil(r.date);
    if (daysUntil >= 0 && daysUntil <= maxDays) return [r.date];
    return [];
  }
  if (repeat === 'daily') {
    const startDate = new Date(r.date + 'T00:00:00');
    const start = startDate > today ? startDate : today;
    const dates = [];
    for (let i = 0; i <= maxDays; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (key >= r.date) dates.push(key);
    }
    return dates;
  }
  if (repeat === 'weekly') {
    const days = r.repeatDays || [];
    const dates = [];
    for (let i = 0; i <= maxDays; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      if (days.includes(d.getDay())) {
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (key >= r.date) dates.push(key);
      }
    }
    return dates;
  }
  if (repeat === 'monthly') {
    const targetDay = r.repeatDayOfMonth || new Date(r.date + 'T00:00:00').getDate();
    const dates = [];
    for (let i = 0; i <= maxDays; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      if (d.getDate() === targetDay) {
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (key >= r.date) dates.push(key);
      }
    }
    return dates;
  }
  return [];
}

function getRepeatText(r) {
  if (!r || r.repeat === 'none' || !r.repeat) return '';
  if (r.repeat === 'daily') return '\u{6BCF}\u{65E5}\u{91CD}\u{8907}';
  if (r.repeat === 'weekly') {
    const days = (r.repeatDays||[]).map(d => '\u{661F}\u{671F}'+DAY_NAMES[d]);
    return '\u{6BCF}\u{9031} ' + days.join('\u{3001}');
  }
  if (r.repeat === 'monthly') return '\u{6BCF}\u{6708} ' + (r.repeatDayOfMonth||'??') + ' \u{65E5}';
  return '';
}

function buildReminderMsg(r, daysUntil) {
  const icon = CAT_ICONS[r.category] || '\u{1F4CC}';
  const catName = CAT_NAMES[r.category] || '\u{5176}\u{4ED6}';
  const repeatText = getRepeatText(r);

  let prefix;
  if (daysUntil === 0) prefix = '\u{1F534} \u{4ECA}\u{65E5}';
  else if (daysUntil === 1) prefix = '\u{1F7E1} \u{660E}\u{65E5}';
  else if (daysUntil <= 3) prefix = `\u{1F7E0} ${daysUntil}\u{65E5}\u{5F8C}`;
  else prefix = `\u{1F7E2} ${daysUntil}\u{65E5}\u{5F8C}`;

  let msg = `${prefix} ${icon}\u{3010}${catName}\u{3011}${r.name}`;
  msg += `\n\u{3000}\u{3000} \u{1F4C5} ${formatDate(r._displayDate || r.date)}\u{FF08}\u{661F}\u{671F}${getWeekDay(r._displayDate || r.date)}\u{FF09}${r.time !== '00:00' ? ' ' + r.time : ''}`;
  if (repeatText) msg += `\n\u{3000}\u{3000} \u{1F501} ${repeatText}`;
  if (r.caregiver) msg += `\n\u{3000}\u{3000} \u{1F464} ${r.caregiver}`;
  if (r.note) msg += `\n\u{3000}\u{3000} \u{1F4DD} ${r.note}`;
  return msg;
}

function checkBirthdays(birthdays) {
  if (!birthdays || birthdays.length === 0) return [];
  const now = new Date();
  const upcoming = [];
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(now); d.setDate(d.getDate() + offset);
    const checkDate = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    birthdays.forEach(b => {
      if (b.date === checkDate) upcoming.push({ ...b, daysAway: offset });
    });
  }
  return upcoming;
}

async function sendDailyReminder() {
  const ok = await checkWacli();
  if (!ok) {
    console.log('[CRON] wacli 未認證，跳過提醒');
    return;
  }

  const data = readData();
  const reminders = data.reminders || [];
  const birthdays = data.birthdays || [];
  const today = new Date(); today.setHours(0,0,0,0);

  const upcoming = [];
  for (const r of reminders) {
    const dates = getRecurringDates(r, today, 7);
    dates.forEach(date => {
      const daysUntil = getDaysUntil(date);
      if (daysUntil >= 0 && daysUntil <= 7) {
        upcoming.push({ ...r, _displayDate: date, daysUntil });
      }
    });
  }
  upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

  const birthdayUpcoming = checkBirthdays(birthdays);

  if (upcoming.length === 0 && birthdayUpcoming.length === 0) {
    console.log('[CRON] 未來7天無提醒事項');
    return;
  }

  const dateStr = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}`;
  let summary = `\u{1F514} *\u{5BB6}\u{5EAD}\u{63D0}\u{9192} \u{2014} ${dateStr}*\n`;

  if (birthdayUpcoming.length > 0) {
    summary += `\n\u{1F382} *\u{751F}\u{65E5}\u{63D0}\u{9192}\u{FF1A}*\n`;
    birthdayUpcoming.forEach(b => {
      if (b.daysAway === 0) summary += `\u{1F534} \u{4ECA}\u{65E5}\u{4FC2} *${b.name}* \u{751F}\u{65E5}\u{FF01}\u{1F389}\u{1F381}\n`;
      else if (b.daysAway === 1) summary += `\u{1F7E1} \u{660E}\u{65E5}\u{4FC2} *${b.name}* \u{751F}\u{65E5}\u{FF01}\u{FF08}${b.date}\u{FF09}\n`;
      else summary += `\u{1F7E2} ${b.daysAway}\u{65E5}\u{5F8C}\u{FF1A}*${b.name}* \u{751F}\u{65E5}\u{FF08}${b.date}\u{FF09}\n`;
    });
  }

  if (upcoming.length > 0) {
    summary += `\n\u{1F4CB} \u{672A}\u{4F867}\u{65E5}\u{5171} ${upcoming.length} \u{9805}\u{4E8B}\u{9805}\u{FF1A}\n`;
    upcoming.forEach(u => { summary += `\n${buildReminderMsg(u, u.daysUntil)}`; });
  }

  summary += `\n\n\u{1F310} \u{7DB2}\u{9801}\u{67E5}\u{770B}\u{FF1A}${WEB_URL}`;
  summary += `\n\u{1F4AC} WhatsApp \u{7FA4}\u{7D44}\u{76F4}\u{63A5}\u{6307}\u{4EE4}\u{FF1A}+ \u{4E8B}\u{9805} / - \u{4E8B}\u{9805} / \u{63D0}\u{9192} / \u{5E6B}\u{52A9}`;

  try {
    await sendViaWacli(GROUP_ID, summary);
    console.log('[CRON] \u{2705} \u{63D0}\u{9192}\u{5DF2}\u{767C}\u{9001}\u{81F3}\u{7FA4}\u{7D44}');
  } catch(e) {
    console.error('[CRON] \u{767C}\u{9001}\u{5931}\u{6557}:', e.message);
  }
}

// ===== Cron: 每分鐘檢查是否到 07:00 HKT (23:00 UTC) =====
function startCron() {
  setInterval(() => {
    const now = new Date();
    const hktHour = (now.getUTCHours() + 8) % 24;
    const hktMinute = now.getUTCMinutes();
    const todayKey = now.toISOString().slice(0, 10);

    if (hktHour === 7 && hktMinute === 0 && lastReminderDate !== todayKey) {
      lastReminderDate = todayKey;
      console.log('[CRON] 07:00 HKT \u{2014} \u{767C}\u{9001}\u{6BCF}\u{65E5}\u{63D0}\u{9192}');
      sendDailyReminder();
    }
  }, 60000);
  console.log('[CRON] \u{5DF2}\u{555F}\u{52D5}\u{FF0C}\u{6BCF}\u{65E5} 07:00 HKT \u{767C}\u{9001}\u{63D0}\u{9192}');
}

// ===== HTTP Server =====
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // === 首頁 (網頁) ===
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch(e) {
      res.writeHead(500); res.end('Server Error');
    }
    return;
  }

  // === wacli 狀態頁面（取代舊 baileys QR）===
  if (req.method === 'GET' && pathname === '/qr') {
    const ok = wacliAuthenticated;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (ok) {
      res.end('<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#f0f2f5"><div style="text-align:center"><h1>\u{2705} WhatsApp 推送已就緒</h1><p>雲端推送統一經 wacli 發送，唔使掃 QR Code</p><p><a href="/">\u{1F5A8}\u{FE0F} 返回網頁</a></p></div></body></html>');
    } else {
      res.end('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp 推送</title><meta http-equiv="refresh" content="15"></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#f0f2f5"><div style="text-align:center;background:#fff;padding:30px;border-radius:20px;box-shadow:0 2px 10px rgba(0,0,0,0.1)"><h2>\u{1F4F1} wacli 未連線</h2><p style="color:#888;font-size:13px;margin-bottom:15px">雲端推送經 wacli 發送，唔使掃 QR。<br>請在本機 terminal 執行 <code>wacli auth</code> 完成登入。</p><p style="color:#aaa;font-size:11px;margin-top:10px">此頁每 15 秒自動刷新</p></div></body></html>');
    }
    return;
  }

  // === Health Check ===
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      transport: 'wacli',
      wacli_authenticated: wacliAuthenticated,
      time: new Date().toISOString()
    }));
    return;
  }

  // === WA Status (for web page) ===
  if (req.method === 'GET' && pathname === '/wa-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: wacliAuthenticated,
      transport: 'wacli',
      qr_pending: false
    }));
    return;
  }

  // === 手動發送提醒 ===
  if (req.method === 'POST' && pathname === '/send-reminder') {
    sendDailyReminder();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: '提醒已觸發' }));
    return;
  }

  // === GET /data ===
  if (req.method === 'GET' && pathname === '/data') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(readData()));
    return;
  }

  // === POST /data ===
  if (req.method === 'POST' && pathname === '/data') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // === POST /reminders ===
  if (req.method === 'POST' && pathname === '/reminders') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const item = JSON.parse(body);
        const data = readData();
        item.id = item.id || uid();
        item.notified = false;
        if (!data.reminders) data.reminders = [];
        data.reminders.push(item);
        writeData(data);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: item.id }));
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // === PUT /reminders/:id ===
  const editMatch = pathname.match(/^\/reminders\/(.+)$/);
  if (req.method === 'PUT' && editMatch) {
    const id = decodeURIComponent(editMatch[1]);
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        const data = readData();
        const idx = data.reminders.findIndex(r => r.id === id);
        if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
        data.reminders[idx] = Object.assign({}, data.reminders[idx], updates);
        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // === DELETE /reminders/:id ===
  if (req.method === 'DELETE' && editMatch) {
    const id = decodeURIComponent(editMatch[1]);
    const data = readData();
    const before = data.reminders.length;
    data.reminders = data.reminders.filter(r => r.id !== id);
    if (data.reminders.length === before) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
    writeData(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // === POST /birthdays ===
  if (req.method === 'POST' && pathname === '/birthdays') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const item = JSON.parse(body);
        const data = readData();
        if (!data.birthdays) data.birthdays = [];
        const existing = data.birthdays.findIndex(b => b.name === item.name);
        if (existing >= 0) data.birthdays[existing] = item;
        else data.birthdays.push(item);
        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // === DELETE /birthdays/:name ===
  const bdayMatch = pathname.match(/^\/birthdays\/(.+)$/);
  if (req.method === 'DELETE' && bdayMatch) {
    const name = decodeURIComponent(bdayMatch[1]);
    const data = readData();
    data.birthdays = data.birthdays.filter(b => b.name !== name);
    writeData(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // === POST /api/send-message (經 wacli 發送) ===
  if (req.method === 'POST' && pathname === '/api/send-message') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { to, text } = JSON.parse(body);
        if (!to || !text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "to" or "text"' }));
          return;
        }
        if (!wacliAuthenticated) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'wacli 未認證，請執行 wacli auth' }));
          return;
        }

        // 如果發送俾自己，自動轉發到群組
        let jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        const selfPhone = '85262218999';
        if (jid === `${selfPhone}@s.whatsapp.net` || to === selfPhone || to === `+${selfPhone}`) {
          console.log('[SEND] 自我發送，轉發到群組');
          jid = GROUP_ID;
        }

        const result = await sendViaWacli(jid, text);
        console.log(`[SEND] OK, jid=${jid}, dryRun=${!!result.dryRun}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Sent', jid, dryRun: !!result.dryRun }));
      } catch(e) {
        console.error('[SEND] ERROR:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path: pathname }));
});

// ===== 啟動 =====
async function main() {
  console.log('=================================');
  console.log('\u{1F3E0} \u{5BB6}\u{5EAD}\u{63D0}\u{9192}\u{7CFB}\u{7D71} - \u{96F2}\u{7AEF}\u{670D}\u{52D9} (wacli \u{6388}\u{9001})');
  console.log('=================================');

  // 1. 從雲端同步數據
  console.log('[INIT] \u{5F9E}\u{96F2}\u{7AEF}\u{540C}\u{6B65}\u{6578}\u{64DA}...');
  const cloudData = await syncDataFromCloud();
  if (cloudData) {
    console.log('[INIT] \u{2705} \u{6578}\u{64DA}\u{5DF2}\u{540C}\u{6B65}');
  } else {
    console.log('[INIT] \u{4F7F}\u{7528}\u{672C}\u{5730}\u{6578}\u{64DA}');
  }

  // 2. 啟動 HTTP Server
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[HTTP] \u{1F310} \u{670D}\u{52D9}\u{5668}\u{5DF2}\u{555F}\u{52D5}: http://0.0.0.0:${PORT}`);
    console.log(`[HTTP] \u{1F4F1} wacli \u{72C0}\u{614B}: http://localhost:${PORT}/qr`);
  });

  // 3. 檢查 wacli 認證（取代舊 baileys 連接）
  console.log('[WA] 檢查 wacli 認證...');
  await checkWacli();
  console.log(wacliAuthenticated
    ? '[WA] \u{2705} wacli 已認證，推送就緒'
    : '[WA] \u{26A0}\u{FE0F} wacli 未認證（請執行 wacli auth），推送會跳過');
  // 定期刷新認證狀態（wacli 唔使重連，但狀態要反映最新）
  setInterval(() => checkWacli().catch(() => {}), 60000);

  // 4. 啟動定時任務
  startCron();

  // 5. 錯誤處理
  process.on('uncaughtException', err => console.error('[ERROR] uncaught:', err.message));
  process.on('unhandledRejection', err => console.error('[ERROR] unhandled:', err));
}

main();
