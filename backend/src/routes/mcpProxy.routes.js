const express = require('express');
const { createHash, timingSafeEqual } = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { JWT_SECRET } = require('../config/secrets');

const router = express.Router();

const MCP_UPSTREAM_URL = (
  process.env.MCP_PUBLIC_SERVER_URL ||
  process.env.MCP_SERVER_URL ||
  'http://mcp-server:4001'
).replace(/\/$/, '');
const MCP_HTTP_AUTH_TOKEN = process.env.MCP_HTTP_AUTH_TOKEN || '';
const MCP_OAUTH_CLIENT_ID = process.env.MCP_OAUTH_CLIENT_ID || '';
const MCP_OAUTH_CLIENT_SECRET = process.env.MCP_OAUTH_CLIENT_SECRET || '';
const MCP_OAUTH_SCOPE = process.env.MCP_OAUTH_SCOPE || 'opus.mcp';

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function requestToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  const headerToken = req.headers['x-mcp-token'];
  if (headerToken) return Array.isArray(headerToken) ? headerToken[0] : headerToken;
  return String(req.query.token || '');
}

function authorize(req, res) {
  const token = requestToken(req);
  if (!token) {
    res.status(401).json({ error: 'MCP HTTP no autorizado' });
    return null;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.typ !== 'mcp_oauth_access' || !payload.sub) {
      res.status(401).json({ error: 'MCP HTTP no autorizado' });
      return null;
    }
    return { upstreamToken: MCP_HTTP_AUTH_TOKEN, actorUserId: payload.sub, transport: 'oauth' };
  } catch {
    res.status(401).json({ error: 'MCP HTTP no autorizado' });
    return null;
  }
}

function htmlEscape(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isAllowedRedirectUri(value) {
  const uri = String(value || '');
  return (
    uri.startsWith('https://chatgpt.com/connector/oauth/') ||
    uri.startsWith('https://chat.openai.com/connector/oauth/') ||
    uri.startsWith('https://chatgpt.com/aip/') ||
    uri.startsWith('https://chat.openai.com/aip/')
  );
}

function validateClient(clientId, clientSecret = null) {
  if (!MCP_OAUTH_CLIENT_ID || !safeEqual(clientId, MCP_OAUTH_CLIENT_ID)) return false;
  if (clientSecret == null) return true;
  return Boolean(MCP_OAUTH_CLIENT_SECRET) && safeEqual(clientSecret, MCP_OAUTH_CLIENT_SECRET);
}

function pkceChallenge(verifier, method) {
  if (!verifier) return '';
  if (method === 'S256') {
    return createHash('sha256').update(verifier).digest('base64url');
  }
  return verifier;
}

function withActor(body, actorUserId) {
  if (!actorUserId || body?.method !== 'tools/call') return body;
  return {
    ...body,
    params: {
      ...(body.params || {}),
      arguments: {
        ...(body.params?.arguments || {}),
        _actor_user_id: actorUserId,
      },
    },
  };
}

function issuer(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function redirectWithError(res, redirectUri, state, error, description) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
}

async function loadPasswordUser(email) {
  const { rows } = await db.query(
    `SELECT id, name, email, password_hash, role, active, account_category
       FROM users
      WHERE lower(email) = lower($1)
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

function renderAuthorizeForm(req, res, error = '') {
  const q = req.method === 'POST' ? req.body : req.query;
  res.type('html').send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Autorizar Opus MCP</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f6f2; color: #161616; }
      main { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #ded9ce; border-radius: 8px; padding: 28px; box-shadow: 0 18px 40px rgba(20, 20, 20, .08); }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { margin: 0 0 20px; color: #58524a; line-height: 1.45; }
      label { display: block; font-size: 13px; font-weight: 650; margin: 16px 0 6px; }
      input { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1px solid #cfc8bb; border-radius: 6px; font: inherit; }
      button { width: 100%; margin-top: 20px; padding: 12px; border: 0; border-radius: 6px; background: #111; color: #fff; font-weight: 700; cursor: pointer; }
      .error { color: #a33a18; background: #fff1ea; border: 1px solid #f0c2ad; padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Autorizar Opus MCP</h1>
      <p>Inicia sesión con una cuenta activa de Opus para conectar ChatGPT.</p>
      ${error ? `<div class="error">${htmlEscape(error)}</div>` : ''}
      <form method="post" action="/mcp/oauth/authorize">
        ${['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'code_challenge', 'code_challenge_method']
          .map((key) => `<input type="hidden" name="${key}" value="${htmlEscape(q[key])}" />`)
          .join('\n        ')}
        <label for="email">Correo</label>
        <input id="email" name="email" type="email" autocomplete="username" required />
        <label for="password">Contraseña</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Autorizar</button>
      </form>
    </main>
  </body>
</html>`);
}

function oauthMetadata(req, res) {
  const base = issuer(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/mcp/oauth/authorize`,
    token_endpoint: `${base}/mcp/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: [MCP_OAUTH_SCOPE],
  });
}

router.get('/.well-known/oauth-authorization-server', oauthMetadata);
router.get('/oauth-authorization-server', oauthMetadata);

router.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, state } = req.query;
  if (response_type !== 'code') {
    return redirectWithError(res, redirect_uri, state, 'unsupported_response_type');
  }
  if (!validateClient(client_id) || !isAllowedRedirectUri(redirect_uri)) {
    return res.status(400).send('Solicitud OAuth invalida');
  }
  return renderAuthorizeForm(req, res);
});

router.post('/oauth/authorize', express.urlencoded({ extended: false }), async (req, res, next) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    state,
    code_challenge,
    code_challenge_method,
    email,
    password,
  } = req.body || {};

  if (response_type !== 'code' || !validateClient(client_id) || !isAllowedRedirectUri(redirect_uri)) {
    return res.status(400).send('Solicitud OAuth invalida');
  }

  try {
    const user = await loadPasswordUser(email);
    const ok = user?.password_hash && await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok || user.active === false) {
      return renderAuthorizeForm(req, res, 'Correo o contraseña incorrectos.');
    }

    const code = jwt.sign({
      typ: 'mcp_oauth_code',
      client_id,
      redirect_uri,
      sub: user.id,
      code_challenge: code_challenge || '',
      code_challenge_method: code_challenge_method || '',
    }, JWT_SECRET, { expiresIn: '5m' });

    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    return res.redirect(url.toString());
  } catch (err) {
    return next(err);
  }
});

router.post('/oauth/token', express.urlencoded({ extended: false }), express.json(), (req, res) => {
  const auth = req.headers.authorization || '';
  let basicClientId = '';
  let basicClientSecret = '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8');
    const splitAt = decoded.indexOf(':');
    basicClientId = decoded.slice(0, splitAt);
    basicClientSecret = decoded.slice(splitAt + 1);
  }

  const clientId = basicClientId || req.body?.client_id;
  const clientSecret = basicClientSecret || req.body?.client_secret;
  if (!validateClient(clientId, clientSecret)) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  if (req.body?.grant_type !== 'authorization_code' || !req.body?.code) {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  let payload;
  try {
    payload = jwt.verify(req.body.code, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  if (
    payload.typ !== 'mcp_oauth_code' ||
    payload.client_id !== clientId ||
    payload.redirect_uri !== req.body.redirect_uri
  ) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  if (payload.code_challenge) {
    const expected = pkceChallenge(req.body.code_verifier, payload.code_challenge_method);
    if (!safeEqual(expected, payload.code_challenge)) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
  }

  const accessToken = jwt.sign({
    typ: 'mcp_oauth_access',
    sub: payload.sub,
    client_id: clientId,
    scope: MCP_OAUTH_SCOPE,
  }, JWT_SECRET, { expiresIn: '12h' });

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 43200,
    scope: MCP_OAUTH_SCOPE,
  });
});

router.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MCP-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.status(204).end();
});

router.get('/sse', async (req, res, next) => {
  const auth = authorize(req, res);
  if (!auth) return;

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    const upstream = await fetch(`${MCP_UPSTREAM_URL}/sse`, {
      headers: { Authorization: `Bearer ${auth.upstreamToken}` },
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      res.status(upstream.status).type('application/json').send(text || '{}');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder
        .decode(value, { stream: true })
        .replaceAll('data: /message?', 'data: /mcp/message?');
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    if (err.name === 'AbortError') return;
    next(err);
  }
});

router.post('/message', async (req, res, next) => {
  const auth = authorize(req, res);
  if (!auth) return;

  try {
    const body = withActor(req.body || {}, auth.actorUserId);
    const upstream = await fetch(`${MCP_UPSTREAM_URL}/message?${new URLSearchParams(req.query)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.upstreamToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.send(text);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
