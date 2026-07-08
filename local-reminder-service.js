/*
 * local-reminder-service.js
 * Family Reminder — WhatsApp 自動提醒服務 (本地常駐)
 *
 * 數據結構 (真實 data.json):
 *   reminders[]: { id, name, date "YYYY-MM-DD", time "HH:MM", category,
 *                  caregiver (string, e.g. "KEN"), note, repeat, repeatDays[],
 *                  caregiverNotified1d, caregiverNotified3h, notified, address }
 *   members[]:   { id, name, role, phone, color }
 *   settings:    { wa_auto, pre_day, pre_3h, on_time, browser_push, ... }
 *   pendingMessages[]: { phone, text, at }   (UI 手動發送佇列)
 *
 * 依賴: wacli (已認證, 用家已重新連線)
 * 用法:
 *   node local-reminder-service.js            # 常駐, 每 60s 檢查
 *   node local-reminder-service.js --once     # 只跑一次即退出 (測試用)
 *   node local-reminder-service.js --dry-run  # 只記錄, 實際唔發送
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const DATA_URL = process.env.DATA_URL || 'https://raw.githubusercontent.com/ken851004-afk/family-reminder-cloud/master/data.json';
const WACLI_PATH = process.env.WACLI_PATH || process.env.WACLI || 'C:\\Users\\KEN85\\.workbuddy\\binaries\\wacli\\wacli.exe';
const STATE_FILE = path.join(__dirname, 'reminder-state.json');
const LOG_FILE = path.join(__dirname, 'reminder-log.txt');

const DRY_RUN = process.argv.includes('--dry-run');
const ONCE = process.argv.includes('--once');

// ---------- 狀態 (本地去重, 避免重複發送) ----------
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { sent: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function log(m) {
  const l = `[${new Date().toISOString()}] ${m}\n`;
  try { fs.appendFileSync(LOG_FILE, l); } catch {}
  console.log(l.trim());
}

// ---------- 下載 data.json ----------
function isLocalPath(u) {
  return u.startsWith('file://') || u.startsWith('/') || /^[A-Za-z]:[\\/]/.test(u);
}
function fetchData() {
  if (isLocalPath(DATA_URL)) {
    try {
      const p = DATA_URL.replace(/^file:\/\//, '');
      return Promise.resolve(JSON.parse(fs.readFileSync(p, 'utf-8')));
    } catch (e) { return Promise.reject(e); }
  }
  return new Promise((resolve, reject) => {
    const url = new URL(DATA_URL);
    const req = https.get({
      hostname: url.hostname, path: url.pathname, timeout: 10000
    }, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ---------- members 查表 ----------
function buildMemberMap(members) {
  const map = {};
  (members || []).forEach(m => {
    const id = (m.id || '').toString().toLowerCase();
    const name = (m.name || '').toString().toLowerCase().replace(/[^\w]/g, '');
    if (id) map[id] = m;
    if (name) map[name] = m;
    if (id) map[id.toUpperCase()] = m;
  });
  return map;
}
function findMember(map, key) {
  if (!key) return null;
  return map[key] || map[key.toLowerCase()] || map[key.toUpperCase()] ||
         map[key.toLowerCase().replace(/[^\w]/g, '')] || null;
}

// ---------- 時間 ----------
function parseReminderDt(r) {
  const [y, mo, d] = String(r.date).split('-').map(Number);
  const [h, mi] = String(r.time || '09:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function repeatText(r) {
  if (!r.repeat || r.repeat === 'none') return '';
  if (r.repeat === 'weekly' && Array.isArray(r.repeatDays))
    return '每週 ' + r.repeatDays.map(d => WD[d]).join('、');
  if (r.repeat === 'weekdays') return '平日';
  return { daily: '每日', weekly: '每週', monthly: '每月', yearly: '每年' }[r.repeat] || r.repeat;
}

function formatMsg(r, member) {
  const lines = ['🔔 家庭提醒', ''];
  lines.push(`📌 ${r.name}`);
  if (r.date) lines.push(`📅 ${r.date} ${r.time || ''}`);
  if (r.address) lines.push(`📍 ${r.address}`);
  if (r.note) lines.push(`📝 ${r.note}`);
  const rep = repeatText(r);
  if (rep) lines.push(`🔁 ${rep}`);
  if (member) lines.push(`👤 負責：${member.name}`);
  return lines.join('\n');
}

// 返還依家要發送嘅項目 [{key, flag, label}]
function dueNow(r, member, settings, state) {
  const now = new Date();
  const nowMs = now.getTime();
  const dtMs = parseReminderDt(r).getTime();
  const out = [];
  const preDay = settings.pre_day !== false;
  const pre3h = settings.pre_3h !== false;
  const onTime = settings.on_time !== false;
  const k = r.id + ':' + (member.id || '?');

  if (preDay && !r.caregiverNotified1d && !state.sent[k + ':1d']) {
    const t = dtMs - 24 * 3600 * 1000;
    if (nowMs >= t && nowMs <= t + 3600 * 1000) out.push({ key: k + ':1d', label: '1日前' });
  }
  if (pre3h && !r.caregiverNotified3h && !state.sent[k + ':3h']) {
    const t = dtMs - 3 * 3600 * 1000;
    if (nowMs >= t && nowMs <= t + 3600 * 1000) out.push({ key: k + ':3h', label: '3小時前' });
  }
  if (onTime && !r.notified && !state.sent[k + ':ot']) {
    if (nowMs >= dtMs && nowMs <= dtMs + 5 * 60 * 1000) out.push({ key: k + ':ot', label: '準時' });
  }
  return out;
}

// ---------- 發送 ----------
function sendWhatsApp(phone, message) {
  return new Promise((resolve, reject) => {
    const p = phone.startsWith('+') ? phone : '+' + phone;
    const proc = spawn(WACLI_PATH, ['send', 'text', '--to', p, '--message', message], {
      stdio: DRY_RUN ? 'ignore' : 'inherit', windowsHide: true
    });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('exit ' + code)));
    proc.on('error', reject);
  });
}

async function runCycle() {
  let data;
  try { data = await fetchData(); }
  catch (e) { log('下載 data.json 失敗: ' + e.message); return; }

  const settings = data.settings || {};
  if (settings.wa_auto === false) { log('wa_auto 關閉，跳過'); return; }

  const memberMap = buildMemberMap(data.members);
  const state = loadState();
  let fired = 0;

  // 排程提醒
  for (const r of (data.reminders || [])) {
    if (r.isDone || r.isArchived || r.archived) continue;
    const isAll = String(r.caregiver || '').toUpperCase() === 'ALL';
    let targets = [];
    if (isAll) {
      targets = (data.members || []).filter(m => m && m.phone);
    } else {
      const m = findMember(memberMap, r.caregiver);
      if (m && m.phone) targets = [m];
    }
    if (!targets.length) {
      log(`跳過「${r.name}」: 搵唔到照顧者 ${r.caregiver} 嘅電話`);
      continue;
    }
    for (const member of targets) {
      const todos = dueNow(r, member, settings, state);
      for (const t of todos) {
        const msg = formatMsg(r, member);
        if (DRY_RUN) {
          log(`[DRY-RUN][${t.label}] 會發送「${r.name}」→ ${member.name} (${member.phone})`);
        } else {
          try {
            await sendWhatsApp(member.phone, msg);
            log(`✅ [${t.label}] 已發送「${r.name}」→ ${member.name} (${member.phone})`);
            await new Promise(r => setTimeout(r, 1500));
          } catch (e) {
            log(`❌ [${t.label}] 發送失敗「${r.name}」: ${e.message}`);
          }
        }
        state.sent[t.key] = Date.now();
        fired++;
      }
    }
  }

  // 手動佇列 (UI sendWhatsApp)
  const pend = data.pendingMessages || [];
  for (const pm of pend) {
    const key = 'pm:' + (pm.at || JSON.stringify(pm));
    if (state.sent[key]) continue;
    if (DRY_RUN) {
      log(`[DRY-RUN] 會發送手動訊息 → ${pm.phone}`);
    } else {
      try {
        await sendWhatsApp(pm.phone, pm.text);
        log(`✅ 已發送手動訊息 → ${pm.phone}`);
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        log(`❌ 手動訊息失敗 → ${pm.phone}: ${e.message}`);
      }
    }
    state.sent[key] = Date.now();
    fired++;
  }

  saveState(state);
  if (fired > 0) log(`本輪完成，發送 ${fired} 則`);
}

// ---------- 主循環 ----------
async function main() {
  log('🚀 Family Reminder 本地服務啟動' + (DRY_RUN ? ' (DRY-RUN)' : ''));
  log(`wacli: ${WACLI_PATH}`);

  if (ONCE) {
    await runCycle();
    log('✅ 單次執行完畢');
    return;
  }

  await runCycle(); // 啟動即檢查一次
  setInterval(() => runCycle().catch(e => log('ERROR: ' + e.message)), 60000);
  log('✅ 常駐中 (每 60s 檢查)');
}

main().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
