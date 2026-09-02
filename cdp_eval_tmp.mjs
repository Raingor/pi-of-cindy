// Minimal CDP client: evaluate an expression in the main window and print the result.
import WebSocket from 'ws';

const [,, wsUrl, exprFile] = process.argv;
const expr = (await import('node:fs')).readFileSync(exprFile, 'utf8');
const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
let id = 0;

function send(method, params) {
  return new Promise((resolve) => {
    const mid = ++id;
    const onMsg = (raw) => {
      const m = JSON.parse(raw);
      if (m.id === mid) { ws.off('message', onMsg); resolve(m); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.on('open', async () => {
  const res = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(JSON.stringify(res, null, 1));
  process.exit(0);
});
ws.on('error', (e) => { console.error('WSERR', e.message); process.exit(1); });
