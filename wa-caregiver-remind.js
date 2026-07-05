/**
 * GitHub Actions: 照顧者個人 WhatsApp 提醒
 * - 提早 1 天提醒（每日 09:00 HKT 發送）
 * - 提早 3 小時提醒（每小時檢查）
 * 
 * 資料來源：GitHub API data.json
 * 發送方式：wacli CLI（唔使 baileys，唔使 WA_CREDS_B64）
 */

const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const WACLI = process.env.WACLI_PATH || 'wacli';

// ===== 照顧者電話對照表 =====
const CAREGIVER_PHONES = {
  'KEN':         { phone: '85262218999', name: 'KEN' },
  'EPPIE':       { phone: '85297510047',  name: '🐑 EPPIE（太太）' },
  'Kenny Yam':   { phone: '85291339336',  name: 'Kenny Yam' },
  'Rosanna Mok': { phone: '85293398522',  name: 'Rosanna Mok' },
  'COFFE':       { phone: '85266713322',  name: 'COFFE' },
  '老豆':        { phone: '85262269100',  name: '老豆' }
};

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_PAT;
const GITHUB_REPO = 'ken851004-afk/family-reminder-cloud';

const CAT_ICONS = { school: '🏫', class: '🎨', special: '⭐', summer: '☀️', routine: '📅' };
const DAY_NAMES = ['日','一','二','三','四','五','六'];

// ===== GitHub API helpers =====
function githubApiGet(apiPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: '/repos/' + GITHUB_REPO + '/contents/' + apiPath,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + GITHUB_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'wa-caregiver-remind'
      }
    };
    const req = https.request(opts, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function githubApiPut(apiPath, content, sha, message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message: message,
      content: content,
      sha: sha,
      branch: 'master'
    });
    const opts = {
      hostname: 'api.github.com',
      path: '/repos/' + GITHUB_REPO + '/contents/' + apiPath,
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + GITHUB_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'wa-caregiver-remind'
      }
    };
    const req = https.request(opts, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ===== wacli send helper =====
function sendWhatsAppMessage(phone, message) {
  try {
    const result = execSync(
      `"${WACLI}" send text --to "${phone}" --message "${message.replace(/"/g, '\\"')}" --json`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const json = JSON.parse(result);
    if (json.success) {
      console.log(`[WA] Sent to ${phone}: ${json.data.id}`);
      return true;
    } else {
      console.error(`[WA] Failed to send to ${phone}:`, json.error);
      return false;
    }
  } catch (e) {
    console.error(`[WA] Error sending to ${phone}:`, e.message);
    return false;
  }
}

// ===== 時間工具 =====
function getHKTNow() {
  const now = new Date();
  const hktMs = now.getTime() + (8 * 3600 * 1000);
  return new Date(hktMs);
}

function parseDateStr(ds) {
  if (!ds) return null;
  if (ds.includes('/')) {
    const [y, m, d] = ds.split('/');
    return new Date(+y, +m - 1, +d);
  }
  return new Date(ds);
}

function getNextOccurrence(r) {
  if (!r.repeat || r.repeat === 'none') return parseDateStr(r.date);
  const today = getHKTNow();
  today.setHours(0, 0, 0, 0);
  if (r.repeat === 'daily') {
    const next = new Date(today);
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (r.repeat === 'weekly') {
    const days = (r.repeatDays || []).map(Number);
    if (!days.length) return null;
    const nowDay = today.getDay();
    days.sort((a, b) => a - b);
    let nextDay = days.find(d => d > nowDay);
    if (!nextDay) nextDay = days[0] + 7;
    else nextDay = nextDay - nowDay;
    const next = new Date(today);
    next.setDate(next.getDate() + nextDay);
    return next;
  }
  if (r.repeat === 'monthly') {
    const targetDay = r.repeatDayOfMonth || parseInt(r.date.split('-')[2]);
    const next = new Date(today.getFullYear(), today.getMonth(), targetDay);
    if (next <= today) next.setMonth(next.getMonth() + 1);
    return next;
  }
  return null;
}

// ===== Main =====
async function main() {
  console.log('[START] Caregiver WhatsApp Reminder');
  console.log('[TIME] HKT:', getHKTNow().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }));
  
  // 1. Get data.json from GitHub
  console.log('[DATA] Fetching data.json...');
  const fileData = await githubApiGet('data.json');
  const sha = fileData.sha;
  const raw = Buffer.from(fileData.content, 'base64').toString('utf8');
  const data = JSON.parse(raw);
  
  const now = getHKTNow();
  const hkHour = now.getHours();
  const hkMin = now.getMinutes();
  const todayStr = now.toISOString().split('T')[0];
  
  let dataChanged = false;
  const toNotify = [];
  
  // 2. Find reminders that need notification
  (data.reminders || []).forEach(r => {
    if (r.done || r.deleted) return;
    
    const occ = getNextOccurrence(r);
    if (!occ) return;
    
    const occStr = occ.toISOString().split('T')[0];
    const daysUntil = Math.floor((occ - now) / 86400000);
    const hoursUntil = Math.floor((occ - now) / 3600000);
    
    // Check 1-day reminder
    if (daysUntil === 1 && !r.notified1d) {
      toNotify.push({ r, type: '1d', occ, occStr });
    }
    
    // Check 3-hour reminder
    if (hoursUntil <= 3 && hoursUntil > 0 && !r.notified3h) {
      toNotify.push({ r, type: '3h', occ, occStr });
    }
  });
  
  console.log(`[NOTIFY] Found ${toNotify.length} reminders to send`);
  
  // 3. Send via wacli
  let sent = 0;
  for (const { r, type, occ, occStr } of toNotify) {
    const caregivers = r.caregivers || (r.caregiver ? [r.caregiver] : []);
    if (!caregivers.length) continue;
    
    for (const cg of caregivers) {
      const phoneInfo = CAREGIVER_PHONES[cg];
      if (!phoneInfo) continue;
      
      const occDayName = DAY_NAMES[occ.getDay()];
      const msg = `🔔 提醒：${r.name}\n📅 ${occStr}（星期${occDayName}）\n${type === '1d' ? '⏰ 明日' : '⏰ ' + (occ.getHours() || '全日') + '時'}\n\n${r.note || ''}`;
      
      const ok = sendWhatsAppMessage(phoneInfo.phone, msg);
      if (ok) {
        sent++;
        if (type === '1d') r.notified1d = true;
        if (type === '3h') r.notified3h = true;
        dataChanged = true;
      }
    }
  }
  
  console.log(`[SENT] ${sent} messages sent`);
  
  // 4. Save data.json
  if (dataChanged) {
    console.log('[DATA] Saving data.json...');
    const newContent = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    await githubApiPut('data.json', newContent, sha, 'Update notification flags (via wacli)');
    console.log('[DATA] Saved');
  }
  
  console.log('[DONE]');
}

main().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});
