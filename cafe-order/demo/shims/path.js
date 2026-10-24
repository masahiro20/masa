// ブラウザ版デモ用の最小限の node:path 代替（静的ファイル配信は使わない）
const join = (...a) => a.filter(Boolean).join('/').replace(/\/+/g, '/');
export default {
  sep: '/', join, resolve: join, normalize: (s) => s, dirname: (s) => s.replace(/\/[^/]*$/, '') || '/',
  basename: (s) => s.replace(/^.*\//, ''), extname: (s) => (s.match(/\.[^./]*$/) || [''])[0],
};
