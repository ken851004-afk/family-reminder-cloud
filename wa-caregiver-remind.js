/**
 * GitHub Actions: 照顧者個人 WhatsApp 提醒 (WhatsApp Business Cloud API)
 * - 提早 1 天提醒（每日 09:00 HKT 發送）
 * - 提早 3 小時提醒（每小時檢查）
 *
 * 發送層：Meta Graph API (WhatsApp Business Cloud API)
 *   - 永遠唔使掃 QR、唔使 baileys session
 *   - 用永久 access token，set-and-forget
 *
 * Env:
 *   WA_API_TOKEN   Meta 永久 access token (system/user token)
 *   WA_PHONE_ID    WhatsApp Business 號碼 ID (Meta App > WhatsApp > 號碼)
 *   WA_TEMPLATE    模板名稱 (預設: family_reminder) — 主動提醒必須用模板
 *   WA_FREEFORM    設 1 則改用 free-form 文字 (只係 24h 客服窗口內有效，用嚟快速測試)
 *   GITHUB_TOKEN   GitHub token (讀寫 data.json)
 *   GITHUB_REPO    ken851004-afk/family-reminder-cloud
 */

const https = require('https');

// ===== 照顧者電話對照表 (E.164 without '+') =====
const CAREGIVER_PHONES = {
  'KEN':         { phone: '85262218999',  name: 'KEN' },
  'EPPIE':       { phone: '85297510047',  name: 'EPPIE（太太）' },
  'Kenny Yam':   { phone: '85291339336',  name: 'Kenny Yam' },
  'Rosanna Mok': { phone: '85293398522',  name: 'Rosanna Mok' },
  'COFFE':       { phone: '85266713322',  name: 'COFFE' },
  '老豆':        { phone: '85262269100',  name: '老豆' }
};

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_PAT;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'ken851004-afk/family-reminder-cloud';
const WA_API_TOKEN = process.env.WA_API_TOKEN;
const WA_PHONE_ID  = process.env.WA_PHONE_ID;
const WA_TEMPLATE  = process.env.WA_TEMPLATE || 'family_reminder';
const WA_FREEFORM  = process.env.WA_FREEFORM === '1';

const CAT_ICONS = { school: '🏫', class: '🎨', special: '⭐', summer: '☀️', routine: '📅' };
const DAY_NAMES = ['日','一','二','三','四','五','六'];

// ===== GitHub API helpers (keep existing) =====
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
        try {
          const j = JSON.parse(b);
          if (j.content) {
            resolve({ data: JSON.parse(Buffer.from(j.content.replace(/\n/g, ''), 'base64').toString('utf-8')), sha: j.sha });
          } else reject(new Error('GitHub API: ' + (j.message || 'unknown')));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function githubApiPut(apiPath, content, sha, message) {
  return new Promise((resolve, reject) => {
    const b64 = Buffer.from(JSON.stringify(content, null, 2), 'utf-8').toString('base64');
    const body = JSON.stringify({ message, content: b64, sha, branch: 'master' });
    const opts = {
      hostname: 'api.github.com',
      path: '/repos/' + GITHUB_REPO + '/contents/' + apiPath,
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + GITHUB_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'wa-caregiver-remind',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(b));
        else reject(new Error('GitHub PUT ' + res.statusCode + ': ' + b.substring(0, 200)));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ===== Helpers =====
function getWeekDay(dateStr) { return DAY_NAMES[new Date(dateStr + 'T00:00:00').getDay()]; }
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}
function buildCaregiverMsg(r, type) {
  const icon = CAT_ICONS[r.category] || '📌';
  const prefix = type === '1day' ? '⏰ 提早一天提醒' : '🚨 三小時後提醒';
  let msg = `${prefix}\n\n`;
  msg += `${icon} *${r.name}*\n`;
  msg += `📅 ${formatDate(r.date)}（星期${getWeekDay(r.date)}）${r.time && r.time !== '00:00' ? ' ' + r.time : ''}\n`;
  if (r.address) msg += `📍 ${r.address}\n`;
  if (r.note) msg += `📝 ${r.note}\n`;
  if (r.caregiver === 'ALL') msg += `\n👥 照顧者：全部人\n`;
  else msg += `\n👤 照顧者：${r.caregiver}\n`;
  msg += `🌐 查看全部：https://ken851004-afk.github.io/family-reminder-cloud/`;
  return msg;
}

// ===== WhatsApp Cloud API send =====
async function sendWhatsApp(to, r, type) {
  const url = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;
  const body = WA_FREEFORM
    ? { messaging_product: 'whatsapp', to, type: 'text', text: { body: buildCaregiverMsg(r, type) } }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: WA_TEMPLATE,
          language: { code: 'zh_HK' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: `${type === '1day' ? '⏰ 提早一天提醒' : '🚨 三小時後提醒'} ${r.name}` },
              { type: 'text', text: `${formatDate(r.date)} ${r.time && r.time !== '00:00' ? r.time : ''}`.trim() },
              { type: 'text', text: r.note || '—' },
            ],
          }],
        },
      };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json();
    clearTimeout(timer);
    if (json.error) {
      console.error(`[WA] ✗ ${to}: ${json.error.error_subcode || json.error.code} ${json.error.message}`);
      return false;
    }
    console.log(`[WA] ✓ ${to} (${r.name}) [${type}] id=${json.messages?.[0]?.id || 'n/a'}`);
    return true;
  } catch (e) {
    clearTimeout(timer);
    console.error(`[WA] ✗ ${to}: ${e.message}`);
    return false;
  }
}

// ===== Main =====
async function main() {
  console.log('=== Caregiver WhatsApp Reminder (Cloud API) ===');
  if (!WA_API_TOKEN || !WA_PHONE_ID) {
    console.error('WA_API_TOKEN / WA_PHONE_ID not set — cannot send');
    process.exit(1);
  }
  console.log(`[MODE] ${WA_FREEFORM ? 'free-form (24h window)' : 'template (' + WA_TEMPLATE + ')'}`);

  const now = new Date();
  const hkNow = new Date(now.getTime() + 8 * 3600000);
  const hkHour = hkNow.getUTCHours();
  const hkDateStr = `${hkNow.getUTCFullYear()}-${String(hkNow.getUTCMonth()+1).padStart(2,'0')}-${String(hkNow.getUTCDate()).padStart(2,'0')}`;
  console.log(`[TIME] HKT: ${hkDateStr} ${String(hkHour).padStart(2,'0')}:${String(hkNow.getUTCMinutes()).padStart(2,'0')}`);

  let ghResult;
  try {
    ghResult = await githubApiGet('data.json');
  } catch (e) {
    console.error('[DATA] Failed:', e.message);
    process.exit(1);
  }
  const data = ghResult.data;
  const sha = ghResult.sha;
  const reminders = data.reminders || [];
  console.log(`[DATA] Loaded ${reminders.length} reminders`);

  const toNotify = [];
  let dataChanged = false;

  for (const r of reminders) {
    if (!r.caregiver) continue;
    if (r.caregiver !== 'ALL' && !CAREGIVER_PHONES[r.caregiver]) continue;

    const eventTime = r.time || '09:00';
    const today = new Date(hkDateStr + 'T00:00:00');
    const eventDay = new Date(r.date + 'T00:00:00');
    const daysUntil = Math.ceil((eventDay - today) / 86400000);

    if (daysUntil === 1 && hkHour === 9 && !r.caregiverNotified1d) {
      toNotify.push({ reminder: r, type: '1day' });
      r.caregiverNotified1d = true;
      dataChanged = true;
      console.log(`[1DAY] ${r.name} → ${r.caregiver}`);
    }

    if (daysUntil === 0 && !r.caregiverNotified3h) {
      const [eh, em] = eventTime.split(':').map(Number);
      const eventHkTime = eh * 60 + em;
      const nowHkTime = hkHour * 60 + hkNow.getUTCMinutes();
      const diffMin = eventHkTime - nowHkTime;
      if (diffMin >= 150 && diffMin <= 210) {
        toNotify.push({ reminder: r, type: '3hour' });
        r.caregiverNotified3h = true;
        dataChanged = true;
        console.log(`[3HOUR] ${r.name} (${eventTime}) → ${r.caregiver}`);
      }
    }

    if (daysUntil < 0 && (r.caregiverNotified1d || r.caregiverNotified3h)) {
      r.caregiverNotified1d = false;
      r.caregiverNotified3h = false;
      dataChanged = true;
    }
  }

  if (dataChanged) {
    try {
      await githubApiPut('data.json', data, sha, 'Update caregiver notification flags');
      console.log('[DATA] Updated notification flags on GitHub');
    } catch (e) {
      console.error('[DATA] Failed to update flags:', e.message);
    }
  }

  if (toNotify.length === 0) {
    console.log('[CRON] No caregiver notifications needed. Exiting.');
    process.exit(0);
  }

  console.log(`[CRON] ${toNotify.length} notifications to send`);
  let sent = 0;
  for (const item of toNotify) {
    const reminder = item.reminder;
    const targets = reminder.caregiver === 'ALL'
      ? Object.values(CAREGIVER_PHONES)
      : [CAREGIVER_PHONES[reminder.caregiver]];
    for (const care of targets) {
      const ok = await sendWhatsApp(care.phone, reminder, item.type);
      if (ok) sent++;
      await new Promise(r => setTimeout(r, 800)); // rate-limit friendliness
    }
  }
  const totalTargets = toNotify.reduce((acc, it) =>
    acc + (it.reminder.caregiver === 'ALL' ? Object.keys(CAREGIVER_PHONES).length : 1), 0);
  console.log(`[WA] Done! Delivered ${sent}/${totalTargets}`);
  process.exit(0);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
