// 起動: npm start  （環境変数 PORT, DATA_DIR で変更可）
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createApp } from './lib/app.js';
import { Store } from './lib/store.js';

const port = Number(process.env.PORT) || 3000;
const dataDir = process.env.DATA_DIR || path.resolve('data');
const app = createApp({ store: new Store(dataDir) });

const server = http.createServer((req, res) => app.handle(req, res));
server.listen(port, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  console.log(`☕ 注文システムを起動しました`);
  console.log(`   オーナー画面 : http://localhost:${port}/admin`);
  if (lan) console.log(`   店内LANから  : http://${lan}:${port}/admin`);
  console.log(`   データ保存先 : ${dataDir}`);
});

const shutdown = () => { app.store.saveNow(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
