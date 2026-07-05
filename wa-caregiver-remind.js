// wa-caregiver-remind.js
// Uses wacli CLI (pre-authenticated session required)

const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_URL = 'https://raw.githubusercontent.com/ken851004-afk/family-reminder-cloud/master/data.json';
const DATA_FILE = path.join(__dirname, 'data.json');
const WACLI = process.env.WACLI_PATH || 'C:\\Users\\KEN85\\.workbuddy\\binaries\\wacli\\wacli.exe';

function downloadData() {
  return new Promise((resolve, reject) => {
    const req = https.get(DATA_URL, (res) => {
      if (res.statusCode === 200) {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            fs.writeFileSync(DATA_FILE, JSON.stringify(json, null, 2));
            resolve(json);
          } catch (e) { reject(e); }
        });
      } else {
        if (fs.existsSync(DATA_FILE)) resolve(JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')));
        else reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', (err) => {
      if (fs.existsSync(DATA_FILE)) resolve(JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')));
      else reject(err);
    });
  });
}

function sendWhatsApp(phone, message) {
  return new Promise((resolve, reject) => {
    const proc = spawn(WACLI, ['send', 'text', '--phone', phone, '--message', message], {
      timeout: 30000,
      windowsHide: true
    });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(err || out || `code ${code}`));
    });
    proc.on('error', reject);
  });
}

function formatMsg(r, next) {
  const lines = ['🔔 家庭提醒 🔔', ''];
  lines.push(`📌 ${r.title}`);
  if (r.note) lines.push(`📝 ${r.note}`);
  if (r.details && r.details.length) {
    lines.push('', '📋 列明事項：');
    r.details.forEach((d, i) => lines.push(`  ${i + 1}. ${d}`));
  }
  if (next) lines.push('', `📅 下一次：<ADDRESS_REDACTED>
  lines.push('', '⏰ 請盡快處理！');
  return lines.join('\n');
}

function getNextOcc(r) {
  const d = new Date(r.date);
  const n = new Date();
  if (d > n) return r.date;
  if (!r.repeatType || r.repeatType === 'none') return null;
  let next = new Date(d);
  while (next <= n) {
    switch (r.repeatType) {
      case 'daily': next.setDate(next.getDate() + 1); break;
      case 'weekly': next.setDate(next.getDate() + 7); break;
      case 'biweekly': next.setDate(next.getDate() + 14); break;
      case 'monthly': next.setMonth(next.getMonth() + 1); break;
      case 'yearly': next.setFullYear(next.getFullYear() + 1); break;
      default: return null;
    }
  }
  return next.toISOString().split('T')[0];
}

function shouldNotify(r) {
  const now = new Date();
  const d = new Date(r.date);
  const days = r.notifyDaysBefore || 1;
  const nd = new Date(d); nd.setDate(nd.getDate() - days);
  if (nd.toISOString().split('T')[0] === now.toISOString().split('T')[0]) return true;
  if (!r.repeatType || r.repeatType === 'none') return false;
  let next = new Date(d);
  while (next < now) {
    switch (r.repeatType) {
      case 'daily': next.setDate(next.getDate() + 1); break;
      case 'weekly': next.setDate(next.getDate() + 7); break;
      case 'biweekly': next.setDate(next.getDate() + 14); break;
      case 'monthly': next.setMonth(next.getMonth() + 1); break;
      case 'yearly': next.setFullYear(next.getFullYear() + 1); break;
      default: return false;
    }
  }
  const n2 = new Date(next); n2.setDate(n2.getDate() - days);
  return n2.toISOString().split('T')[0] === now.toISOString().split('T')[0];
}

async function main() {
  console.log(`[${new Date().toISOString()}] Start`);
  
  if (!fs.existsSync(WACLI)) {
    console.error(`wacli not found: ${WACLI}`);
    process.exit(1);
  }

  let data;
  try { data = await downloadData(); }
  catch (e) { console.error('Load data fail:', e.message); process.exit(1); }

  const caregivers = (data.contacts || []).filter(c => c.isCaregiver);
  if (!caregivers.length) { console.log('No caregivers'); return; }

  let sent = 0, errs = 0;
  for (const r of (data.reminders || [])) {
    if (r.isDone || r.isArchived || !shouldNotify(r)) continue;
    const next = getNextOcc(r);
    const msg = formatMsg(r, next);
    for (const c of caregivers) {
      try {
        await sendWhatsApp(c.phone, msg);
        sent++; console.log(`✅ ${c.name}`);
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        errs++; console.error(`❌ ${c.name}: ${e.message}`);
      }
    }
  }
  console.log(`Done. Sent:${sent} Err:${errs}`);
}

main().catch(e => { console.error(e); process.exit(1); });
