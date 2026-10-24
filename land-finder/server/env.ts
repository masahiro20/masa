// .env があれば読み込む（ANTHROPIC_API_KEY, PORT など）。他のモジュールより先に import すること。
import path from 'node:path';
import { ROOT_DIR } from './paths';

try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  // .env がなければ環境変数のみを使う
}
