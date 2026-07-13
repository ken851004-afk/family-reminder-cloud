/**
 * 本機工具：掃 QR 碼生成 WhatsApp auth state（WA_CREDS_B64）
 *
 * 用法：
 *   1. 在本機 terminal 執行：node setup-wa-auth.js
 *   2. 終端會顯示 QR 碼 + 同時產生 qr.html（用瀏覽器打開睇大圖）
 *   3. 用手機 WhatsApp → 已連結裝置 → 掃碼
 *   4. 成功連接後自動：
 *      - 打包 auth state → wa-auth.tar.gz
 *      - 輸出 base64 到 terminal + wa-auth-b64.txt
 *   5. 將 wa-auth-b64.txt 嘅內容（全部）複製
 *   6. 去 GitHub repo Settings → Secrets → 貼入 WA_CREDS_B64
 *
 * 之後每當 workflow 成功執行，會自動更新 WA_CREDS_B64
 *（baileys 會自動續期憑證，實際可維持數週唔使理）
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AUTH_DIR = path.join(__dirname, 'baileys-auth');
const TAR_GZ   = path.join(__dirname, 'wa-auth.tar.gz');
const QR_HTML  = path.join(__dirname, 'qr.html');
const B64_FILE  = path.join(__dirname, 'wa-auth-b64.txt');

async function main() {
  console.log('=== WhatsApp Auth Setup ===');
  console.log('準備掃 QR 碼登入 WhatsApp Web...\n');

  // 清理舊 auth
  if (fs.existsSync(AUTH_DIR)) {
    console.log('⚠️  發現舊嘅 baileys-auth/，清理中...');
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }

  const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('baileys');
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  let qrStr = '';
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['FamilyReminder', 'Setup', '1.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  // 擷取 QR code，產生 HTML 畀瀏覽器
  sock.ev.on('connection.update', async (update) => {
    if (update.qr) {
      qrStr = update.qr;
      console.log('\n📱 請用手機 WhatsApp 掃以下 QR 碼：\n');
      console.log('（如果終端睇唔到，請打開 qr.html 用瀏覽器睇大圖）\n');

      // 產 QR HTML（用 google charts API，唔使外部 dependency）
      const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=' + encodeURIComponent(qrStr);
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>WhatsApp QR - 請用 WhatsApp 掃碼</title>
  <style>
    body { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; font-family:sans-serif; background:#f5f5f5; margin:0; }
    .box { background:white; padding:40px; border-radius:16px; box-shadow:0 4px 20px rgba(0,0,0,0.1); text-align:center; }
    h2 { color:#25D366; }
    img { border:3px solid #25D366; border-radius:12px; margin:20px; max-width:90vw; }
    p { color:#555; }
    .hint { background:#e8f5e9; padding:12px; border-radius:8px; margin-top:20px; color:#2e7d32; }
  </style>
</head>
<body>
  <div class="box">
    <h2>📱 請用 WhatsApp 掃以下 QR 碼</h2>
    <img src="${qrUrl}" alt="WhatsApp QR Code"/>
    <p>WhatsApp → 已連結裝置 → 連結裝置 → 掃描 QR 碼</p>
    <div class="hint">此頁每 10 秒自動刷新（QR 碼有時效）</div>
  </div>
  <script>setTimeout(()=>location.reload(), 10000);</script>
</body>
</html>`;
      fs.writeFileSync(QR_HTML, html, 'utf8');
      console.log('📄 QR HTML 已寫入：' + QR_HTML);
      console.log('      → 可用瀏覽器打開該檔睇大圖 QR 碼\n');
    }

    if (update.connection === 'open') {
      const userId = update.user?.id || 'unknown';
      console.log('\n✅  WhatsApp 已成功連接！');
      console.log('   手機號碼：' + userId + '\n');

      // 等 3 秒確保 auth state 已寫入
      await new Promise(r => setTimeout(r, 3000));
      await saveCreds();

      // 打包 auth state → tar.gz
      console.log('📦  打包 auth state...');
      if (fs.existsSync(TAR_GZ)) fs.unlinkSync(TAR_GZ);
      execSync(`tar -czf "${TAR_GZ}" -C "${AUTH_DIR}" .`, { stdio: 'inherit' });

      const tarSize = fs.statSync(TAR_GZ).size;
      console.log(`✅  wa-auth.tar.gz 已生成（${Math.round(tarSize / 1024)} KB）\n`);

      // 輸出 base64
      const b64 = fs.readFileSync(TAR_GZ).toString('base64');
      console.log('📋  請將以下 base64 複製去 GitHub Secret（WA_CREDS_B64）：\n');
      console.log('══════════════════════════════════════════════');
      console.log(b64);
      console.log('══════════════════════════════════════════════\n');
      console.log('長度：' + Math.round(b64.length / 1024) + ' KB\n');

      // 同時寫入檔案方便複製
      fs.writeFileSync(B64_FILE, b64, 'utf8');
      console.log('📄  base64 已同時寫入：' + B64_FILE);
      console.log('      → 可直接複製該檔內容\n');

      console.log('下一步：');
      console.log('  1. 去 https://github.com/aibizlab-hub/family-reminder-cloud/settings/secrets/actions');
      console.log('  2. 撳 「New repository secret」');
      console.log('  3. Name 填：WA_CREDS_B64');
      console.log('  4. Secret 貼上上面嘅 base64（全部，唔好漏）');
      console.log('  5. 撳 「Add secret」\n');
      console.log('（之後 workflow 會自動執行，唔使再手動更新）\n');

      await sock.logout();
      process.exit(0);
    }

    if (update.connection === 'close') {
      const statusCode = update.lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.error('\n❌  已登出，請重新執行此 script\n');
      } else {
        const errMsg = update.lastDisconnect?.error?.message || 'unknown';
        console.error('\n❌  連接失敗：' + errMsg + '\n');
      }
      try { await sock.logout(); } catch {}
      process.exit(1);
    }
  });
}

main().catch(e => {
  console.error('❌ 嚴重錯誤：', e.message);
  process.exit(1);
});
