// Moviola: guarda i video da Google Drive senza scaricarli (streaming a pezzi)
const TOK_KEY = '/__moviola_tok';
let tok = null;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
async function getTok(){
  if (tok && tok.exp > Date.now()) return tok.tok;
  try {
    const c = await caches.open('moviola-sw'), r = await c.match(TOK_KEY);
    if (r){ tok = await r.json(); if (tok && tok.exp > Date.now()) return tok.tok; }
  } catch(e){}
  return null;
}
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'token'){
    tok = { tok:d.tok, exp:d.exp };
    e.waitUntil(caches.open('moviola-sw').then(c => c.put(TOK_KEY, new Response(JSON.stringify(tok)))).catch(() => {}));
  }
  if (d.type === 'ping' && e.source) e.source.postMessage({ type:'pong', v:1 });
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  const i = u.pathname.indexOf('/__drive/');
  if (i < 0 || u.origin !== self.location.origin) return;
  e.respondWith(proxy(e.request, decodeURIComponent(u.pathname.slice(i + 9)), +(u.searchParams.get('size') || 0), u.searchParams.get('mime') || 'video/mp4'));
});
async function proxy(req, id, size, mime){
  const t = await getTok();
  if (!t) return new Response('drive-auth', { status:401 });
  const range = req.headers.get('Range');
  const h = { Authorization:'Bearer ' + t };
  if (range) h.Range = range;
  let r;
  try { r = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media', { headers:h }); }
  catch(e){ return new Response('net', { status:502 }); }
  if (r.status === 401) return new Response('drive-auth', { status:401 });
  if (!r.ok) return new Response('err', { status:r.status });
  const len = +(r.headers.get('Content-Length') || 0);
  const out = new Headers({ 'Content-Type':mime, 'Accept-Ranges':'bytes', 'Cache-Control':'no-store' });
  if (len) out.set('Content-Length', String(len));
  if (r.status === 206){
    const m = /bytes=(\d+)-/.exec(range || ''), a = m ? +m[1] : 0;
    out.set('Content-Range', r.headers.get('Content-Range') || `bytes ${a}-${a + len - 1}/${size || '*'}`);
    return new Response(r.body, { status:206, headers:out });
  }
  return new Response(r.body, { status:200, headers:out });
}
