// 背景処理の時計（タブが裏に回っても、映像が止まりにくいように別スレッドで刻む）
let t = null;
self.onmessage = (e) => {
  if (t) clearInterval(t);
  const ms = Math.max(20, Math.min(200, Number(e.data && e.data.ms) || 42));
  t = setInterval(() => self.postMessage(0), ms);
};
