#!/usr/bin/env node
/**
 * monitor/health-check.js
 * 本地自動監控 + 自癒（喺用家部機跑，排程每幾分鐘一次）。
 *
 * 探測：
 *  1) GitHub Pages 線上網站  → HTTP 200 且 HTML 含「HomeMemo」
 *  2) data.json raw URL      → HTTP 200
 *  3) 本地 API :3747         → /healthz（fallback /）回 200
 *  4) wacli doctor           → 輸出含 AUTHENTICATED 即已連線
 *
 * 自癒（失敗即重啟對應本地服務）：
 *  - API 離線   → 重啟 server.js（+ cloud-server.js 若原先在跑）
 *  - WA 未連線  → 重啟 local-reminder-service.js（wacli 推送；cloud-server 已唔再維持 WA 連線）
 *
 * 報警：任何失敗經 notify-failure.js 發 WhatsApp 去 +85262218999
 *       （每類警報 30 分鐘冷卻，避免狂轟）。
 */

const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sendAlert } = require('./notify-failure.js');

const REPO_DIR = path.resolve(__dirname, '..');
const STATE_FILE = path.join(__dirname, 'health-state.json');
const LOG_FILE = path.join(__dirname, 'health-check.log');
const WACLI_PATH = process.env.WACLI_PATH || process.env.WACLI ||
  'C:\\Users\\KEN85\\.workbuddy\\binaries\\wacli\\wacli.exe';

const LIVE_URL = process.env.LIVE_URL || 'https://aibizlab-hub.github.io/family-reminder-cloud/';
const DATA_URL = process.env.DATA_URL || 'https://raw.githubusercontent.com/aibizlab-hub/family-reminder-cloud/master/data.json';
const API_HOST = '127.0.0.1';
const API_PORT = process.env.API_PORT || 3747;
const TITLE_MARK = 'HomeMemo';
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 分鐘內唔重複報同一類

const NODE_EXE = fs.existsSync('C:\\Users\\KEN85\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe')
  ? 'C:\\Users\\KEN85\\.workbuddy\\binaries\\node\\versions\\22.22.2\\node.exe'
  : 'node';

function log(m) {
  const l = `[${new Date().toISOString()}] ${m}`;
  try { fs.appendFileSync(LOG_FILE, l + '\n'); } catch { /* ignore */ }
  console.log(l);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch { /* ignore */ }
}

function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'family-reminder-health/1.0' } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, code: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 0, body: '', timeout: true }); });
    req.on('error', e => resolve({ ok: false, code: 0, body: '', error: e.message }));
  });
}

// 探測本地 API：先 /healthz，再 fallback /
async function checkLocalApi() {
  for (const p of ['/healthz', '/']) {
    const r = await httpGet(`http://${API_HOST}:${API_PORT}${p}`, 5000);
    if (r.ok) return { ok: true, path: p };
  }
  return { ok: false };
}

function runWacliDoctor() {
  return new Promise((resolve) => {
    if (!fs.existsSync(WACLI_PATH)) { resolve({ ok: false, reason: 'wacli 唔存在' }); return; }
    try {
      const proc = spawn(WACLI_PATH, ['doctor'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => out += d);
      proc.on('error', e => resolve({ ok: false, reason: e.message }));
      proc.on('close', () => {
        const authenticated = /AUTHENTICATED/i.test(out);
        resolve({ ok: authenticated, reason: authenticated ? '' : '未認證 (AUTHENTICATED 唔喺輸出)' });
      });
    } catch (e) { resolve({ ok: false, reason: e.message }); }
  });
}

// 列舉 node 進程（Windows）—— 寫 .ps1 避開 shell 引號地獄
function listNodeProcesses() {
  try {
    const tmp = path.join(os.tmpdir(), 'fr-procs-' + Date.now() + '.ps1');
    fs.writeFileSync(tmp, "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation");
    const csv = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, { encoding: 'utf8' });
    fs.unlinkSync(tmp);
    const lines = csv.trim().split(/\r?\n/).slice(1); // 跳過 header
    const procs = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const m = line.match(/^"(\d+)"\s*,\s*"(.*)"$/);
      if (m) procs.push({ pid: parseInt(m[1], 10), cmd: m[2] || '' });
    }
    return procs;
  } catch (e) { log('列舉進程失敗: ' + e.message); return []; }
}

// 用 regex 確保匹配成個檔名（避免 server.js 誤中 cloud-server.js）
function findPid(scriptName) {
  const esc = scriptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?<![A-Za-z0-9_-])' + esc + '\\b');
  const hit = listNodeProcesses().find(p => p.cmd && re.test(p.cmd));
  return hit ? hit.pid : null;
}

function killPid(pid) {
  try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// onlyIfRunning=true → 冇跑到就唔勉強起（例如 cloud-server.js 可能冇喺本地跑）
function restartService(scriptName, onlyIfRunning = false) {
  const scriptPath = path.join(REPO_DIR, scriptName);
  if (!fs.existsSync(scriptPath)) { log(`⚠️ 搵唔到 ${scriptName}，跳過`); return false; }
  const oldPid = findPid(scriptName);
  if (!oldPid) {
    if (onlyIfRunning) { log(`ℹ️ ${scriptName} 冇在跑，按設定唔自啟`); return false; }
  } else {
    log(`🔪 殺舊 ${scriptName} (PID ${oldPid})`);
    killPid(oldPid);
  }
  try {
    const child = spawn(NODE_EXE, [scriptPath], { detached: true, windowsHide: true, cwd: REPO_DIR, stdio: 'ignore' });
    child.unref();
    log(`🔄 已${oldPid ? '重啟' : '啟動'} ${scriptName} (PID ${child.pid})`);
    return true;
  } catch (e) {
    log(`❌ ${oldPid ? '重啟' : '啟動'} ${scriptName} 失敗: ${e.message}`);
    return false;
  }
}

async function maybeAlert(key, message) {
  const state = loadState();
  const last = state[key] || 0;
  const now = Date.now();
  if (now - last < ALERT_COOLDOWN_MS) {
    log(`💤 ${key} 報警冷卻中，跳過 WhatsApp（上次 ${new Date(last).toISOString()}）`);
    return;
  }
  try {
    await sendAlert(message);
    state[key] = now;
    saveState(state);
    log(`📲 WhatsApp 報警已發送 (${key})`);
  } catch (e) {
    log(`❌ WhatsApp 報警失敗 (${key}): ${e.message}`);
    state[key] = now; // 記低時間，避免瘋狂重試，冷卻後再試
    saveState(state);
  }
}

async function main() {
  log('=== 健康檢查開始 ===');
  const failures = [];

  // 1) 線上網站
  const site = await httpGet(LIVE_URL, 15000);
  const siteOk = site.ok && site.body.includes(TITLE_MARK);
  log(`網站 ${LIVE_URL} → HTTP ${site.code} ${siteOk ? 'OK' : 'FAIL'}`);
  if (!siteOk) failures.push('site');

  // 2) data.json raw
  const data = await httpGet(DATA_URL, 15000);
  log(`data.json → HTTP ${data.code} ${data.ok ? 'OK' : 'FAIL'}`);
  if (!data.ok) failures.push('data');

  // 3) 本地 API :3747
  const api = await checkLocalApi();
  log(`本地 API :${API_PORT} → ${api.ok ? 'OK (' + api.path + ')' : 'FAIL'}`);
  if (!api.ok) failures.push('api');

  // 4) wacli 認證
  const wa = await runWacliDoctor();
  log(`WhatsApp (wacli doctor) → ${wa.ok ? 'AUTHENTICATED' : 'DISCONNECTED (' + (wa.reason || '?') + ')'}`);
  if (!wa.ok) failures.push('wa');

  // ── 自癒 ──
  const healed = [];
  if (failures.includes('api')) {
    if (restartService('server.js', false)) healed.push('server.js');
    if (restartService('cloud-server.js', true)) healed.push('cloud-server.js');
  }
  if (failures.includes('wa')) {
    // cloud-server 已唔再維持 WA 連線（改經 wacli），只重啟 local-reminder-service.js
    if (restartService('local-reminder-service.js', false)) healed.push('local-reminder-service.js');
  }

  // ── 報警 ──
  if (failures.length) {
    const parts = [];
    if (failures.includes('site')) parts.push('🌐 網站離線 / 標題缺失');
    if (failures.includes('data')) parts.push('📄 data.json 不可達');
    if (failures.includes('api')) parts.push(`🔌 本地 API :${API_PORT} 離線`);
    if (failures.includes('wa')) parts.push('📱 WhatsApp 未連線 (wacli)');
    const msg = '🚨 家庭提醒健康監控異常：\n' + parts.join('\n') +
      (healed.length ? '\n🔧 已自動重啟: ' + healed.join(', ') : '');
    for (const f of failures) await maybeAlert('alert_' + f, msg);
  } else {
    log('✅ 全部檢查通過');
  }
  log('=== 健康檢查結束 ===');
}

main().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
