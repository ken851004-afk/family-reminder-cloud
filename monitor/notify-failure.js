#!/usr/bin/env node
/**
 * monitor/notify-failure.js
 * 可重用嘅 wacli 封裝 —— 發送失敗警報 WhatsApp 訊息到 +85262218999。
 *
 * 用法：
 *   node notify-failure.js --message "警報內容"
 *   node notify-failure.js -m "警報內容"
 *   node notify-failure.js "警報內容"          # 位置參數
 *   echo "警報內容" | node notify-failure.js   # 由 stdin 讀
 *
 * 亦可被其它腳本 require：const { sendAlert } = require('./notify-failure.js');
 *
 * 註：wacli 係 Windows binary，得喺用家部機（已認證）先發到。
 *     雲端 GitHub runner（Linux）無 wacli → 誠實失敗並 exit 2，
 *     由呼叫方用 continue-on-error 處理。
 */

const { spawn } = require('child_process');
const fs = require('fs');

const WACLI_PATH = process.env.WACLI_PATH || process.env.WACLI ||
  'C:\\Users\\KEN85\\.workbuddy\\binaries\\wacli\\wacli.exe';
// 報警對象：用家本人（與 reminder-watchdog.ps1 一致）
const TARGET = process.env.WA_ALERT_TO || '85262218999@s.whatsapp.net';

function parseMessage() {
  const args = process.argv.slice(2);
  const mi = args.findIndex(a => a === '--message' || a === '-m');
  if (mi !== -1 && args[mi + 1]) return args[mi + 1];
  // 位置參數（跳過開頭嘅 flag）
  const positional = args.filter(a => !a.startsWith('-') && a !== '');
  if (positional.length) return positional.join(' ');
  // stdin（pipe 模式）
  if (!process.stdin.isTTY) {
    try {
      const data = fs.readFileSync(0, 'utf8');
      if (data && data.trim()) return data.trim();
    } catch { /* ignore */ }
  }
  return null;
}

function sendAlert(message) {
  return new Promise((resolve, reject) => {
    if (!message) return reject(new Error('無訊息內容'));
    if (!fs.existsSync(WACLI_PATH)) {
      return reject(new Error('wacli 唔存在: ' + WACLI_PATH + ' （雲端 runner / 非 Windows 環境無法發送）'));
    }
    const proc = spawn(WACLI_PATH, ['send', 'text', '--to', TARGET, '--message', message], {
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('wacli exit ' + code)));
  });
}

async function main() {
  const msg = parseMessage();
  if (!msg) {
    console.error('用法: node notify-failure.js --message "內容"');
    process.exit(2);
  }
  try {
    await sendAlert(msg);
    console.log('✅ WhatsApp 報警已發送 → ' + TARGET);
    process.exit(0);
  } catch (e) {
    console.error('❌ WhatsApp 報警失敗: ' + e.message);
    process.exit(2);
  }
}

module.exports = { sendAlert, TARGET, WACLI_PATH };

if (require.main === module) {
  main();
}
