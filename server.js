// Render.com 雲端 API Server
// 家庭提醒系統 - 永久網址，24/7 運行

const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3747;

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const init = { reminders: [], birthdays: [], members: ["EPPIE","KEN","COFFE","杏花村"], caregivers: ["EPPIE","KEN","COFFE","杏花村"] };
      fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
      return init;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('讀取資料失敗:', e.message);
    return { reminders: [], birthdays: [], members: [], caregivers: [] };
  }
}

function writeData(data) {
  // 備份舊資料
  if (fs.existsSync(DATA_FILE)) {
    try {
      fs.copyFileSync(DATA_FILE, DATA_FILE + '.backup');
    } catch (e) {}
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function uid() {
  return 'r' + Date.now() + Math.random().toString(36).slice(2, 6);
}

// ====== HTTP Server ======
const server = http.createServer((req, res) => {
  // CORS - 允許 CloudStudio 網頁存取
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.writeHead(200); res.end(); return;
  }

  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname;

  // === Health Check ===
  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: '家庭提醒系統 API', time: new Date().toISOString() }));
    return;
  }

  // === GET /data ===
  if (req.method === 'GET' && pathname === '/data') {
    res.writeHead(200);
    res.end(JSON.stringify(readData()));
    return;
  }

  // === POST /data (完整覆蓋) ===
  if (req.method === 'POST' && pathname === '/data') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        writeData(data);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        console.log('[API] 完整儲存');
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
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
        item.notified = item.notified || false;
        data.reminders.push(item);
        writeData(data);
        res.writeHead(201);
        res.end(JSON.stringify({ ok: true, id: item.id }));
        console.log('[API] 新增提醒:', item.name);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
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
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        console.log('[API] 更新提醒:', id);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
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
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
    console.log('[API] 刪除提醒:', id);
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
        const existing = data.birthdays.findIndex(b => b.name === item.name);
        if (existing >= 0) {
          data.birthdays[existing] = item;
        } else {
          data.birthdays.push(item);
        }
        writeData(data);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        console.log('[API] 更新生日:', item.name);
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
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
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
    console.log('[API] 刪除生日:', name);
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('🏠 家庭提醒 API Server (雲端)');
  console.log('📡 Port:', PORT);
  console.log('💾 Data:', DATA_FILE);
});

process.on('uncaughtException', err => console.error('[API] 錯誤:', err.message));
