// Aura AI backend (Render par chalega) - koi extra package nahi chahiye
// Render me ye 4 Environment Variables daalne hain:
//   GEMINI_KEY          -> Gemini API key
//   FIREBASE_API_KEY    -> Firebase Web API key (apiKey)
//   FIREBASE_PROJECT_ID -> aura-ai-5ad5e
//   ALLOWED_ORIGIN      -> https://manoharbishnoi29.github.io  (bina / ke)

const http = require('http');

const PORT = process.env.PORT || 3000;
const ALLOWED = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 25 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too_big')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const okOrigin = ALLOWED.includes(origin);
  const cors = {
    'Access-Control-Allow-Origin': okOrigin ? origin : (ALLOWED[0] || ''),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
  const send = (status, obj) => {
    res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const fail = (status, message) => send(status, { error: { message } });

  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('Aura API OK');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (!okOrigin) return fail(403, 'Origin allowed nahi hai');
    if (req.method !== 'POST') return fail(405, 'Sirf POST chalega');

    const path = new URL(req.url, 'http://x').pathname;
    if (!/^\/models\/[\w.\-]+:generateContent$/.test(path)) return fail(404, 'Galat path');

    // 1) Firebase login check
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return fail(401, 'Pehle login karo');
    const chk = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + process.env.FIREBASE_API_KEY,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) }
    );
    if (!chk.ok) return fail(401, 'Login expire ho gaya, dobara login karo');
    const info = await chk.json();
    const uid = info.users && info.users[0] && info.users[0].localId;
    if (!uid) return fail(401, 'User nahi mila');

    // 2) Block check (Firestore users/{uid}.blocked)
    const fs = await fetch(
      'https://firestore.googleapis.com/v1/projects/' + process.env.FIREBASE_PROJECT_ID +
        '/databases/(default)/documents/users/' + uid,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (fs.ok) {
      const d = await fs.json();
      if (d.fields && d.fields.blocked && d.fields.blocked.booleanValue === true) {
        return fail(403, 'Aapka account block hai');
      }
    }

    // 3) Gemini ko request bhejo (key yahin chhupi hai)
    const body = await readBody(req);
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_KEY },
      body
    });
    const text = await r.text();
    res.writeHead(r.status, { ...cors, 'Content-Type': 'application/json' });
    res.end(text);
  } catch (e) {
    if (e.message === 'too_big') return fail(413, 'File bahut badi hai');
    fail(500, 'Server error: ' + e.message);
  }
});

server.listen(PORT, () => console.log('Aura API running on ' + PORT));
