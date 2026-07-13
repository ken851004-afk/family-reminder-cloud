# HomeMemo — 請回答我們這一家

> 雲端家庭提醒服務，支援 WhatsApp 自動通知 + GitHub Pages 永久網頁

---

## 🚀 一鍵安裝

### Windows（雙擊 `install.bat`）
```cmd
curl -o install.bat https://raw.githubusercontent.com/aibizlab-hub/family-reminder-cloud/master/install.bat && install.bat
```

### macOS / Linux / Git Bash
```bash
curl -o install.sh https://raw.githubusercontent.com/aibizlab-hub/family-reminder-cloud/master/install.sh && bash install.sh
```

**安裝過程只需 ~3 分鐘**，會自動完成：
1. ✅ Clone 代碼
2. ✅ 設定 GitHub Token
3. ✅ 建立你的 GitHub Repo
4. ✅ 啟用 GitHub Pages（永久網址）
5. ✅ 部署網頁
6. ✅ 初始化資料

完成後得到：`https://你的用戶名.github.io/family-reminder-cloud/`

---

## 📋 手動安裝

### 你需要準備
- GitHub 帳號
- GitHub Personal Access Token（Classic），需 `repo` 權限
- WhatsApp 憑證 Base64（可選，不需要 WhatsApp 提醒可跳過）

### 步驟
1. **Fork** 呢個 repo 去你嘅 GitHub 帳號
2. **Settings → Secrets and variables → Actions** 加入：
   - `GH_PAT`：你嘅 GitHub Token
   - `WA_CREDS_B64`：WhatsApp 憑證（可選）
3. **Settings → Pages** → Source: `gh-pages` branch → Save
4. 等 2 分鐘，網址生效

---

## 📱 功能

| 功能 | 說明 |
|------|------|
| 🗓️ 提醒管理 | 新增 / 編輯 / 刪除提醒事項 |
| 👥 多人分頁 | KEN、EPPIE、COFFE、Kenny、Rosanna、老豆 |
| 📂 分類系統 | 學校、課堂、暑期、常規、工作、旅遊、醫療、財務、聚餐、活動、其他 |
| 🔁 重複提醒 | 每日 / 每週 / 每月 + 連續多日 |
| 🎂 生日管理 | 家人朋友生日記錄 + 自動提醒 |
| 📜 歷史記錄 | 到期項目自動歸檔，可還原 |
| 📲 WhatsApp 通知 | 自動發送個人 WhatsApp 提醒 |
| 🌙 深色模式 | 自動適應系統主題 |
| 📱 iPad / 手機 | 完美支援移動端 |

---

## 🔧 GitHub Actions（全自動 CI/CD）

| Workflow | 用途 | 頻率 |
|----------|------|------|
| `ci-cd.yml` | **統一部署流水線**：驗證閘 → 部署 gh-pages → 上線驗證，失敗自動回滾 + 開 Issue | push `master` 時 |
| `health-monitor.yml` | 網站健康監控，異常自動開/追加 Issue 報警 | 每 15 分鐘 |
| `backup.yml` | 自動備份 `data.json` | 每 6 小時 |
| `web-push.yml` | Web Push 提醒發送 | 每 5 分鐘 |
| `caregiver-remind.yml` | 雲端 WhatsApp（已停用，改用本地服務 + watchdog） | 手動 |

> 🛡️ **本地自癒**：`reminder-watchdog.ps1` 每 5 分鐘檢查本地提醒服務，死咗自動重啟並經 WhatsApp 通知你。
> 一次性設定：以管理員開 PowerShell 跑 `setup-watchdog.ps1` 即可。

### 開發流程（你嘅角色）
1. 改完 code → `git push` 去 `master`
2. GitHub Actions 自動：驗證 → 部署 → 驗證上線
3. 壞 code 會喺驗證閘被擋住，唔會上 live；萬一上咗有問題，自動回滾上一版
4. 你全程 **唔使郁手**

---

## 📲 WhatsApp 號碼格式

```
852XXXXXXXX@s.whatsapp.net
```

例如：`85262218999@s.whatsapp.net`

---

## 🛠️ 技術棧

- **前端**：Vanilla HTML/CSS/JS（零依賴）
- **數據**：GitHub API（data.json）
- **部署**：GitHub Pages + GitHub Actions
- **WhatsApp**：Baileys（Node.js）

---

**[永久網址](https://aibizlab-hub.github.io/family-reminder-cloud/)** · **[源代碼](https://github.com/aibizlab-hub/family-reminder-cloud)**
