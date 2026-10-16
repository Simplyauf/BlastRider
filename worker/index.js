const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

async function leaderboard(request, env) {
  if (!env.DB) return json({ error: 'Leaderboard storage is unavailable.' }, 503);
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT name, score, kills, chips, survived, victory FROM leaderboard ORDER BY score DESC, created_at ASC LIMIT 10').all();
    return json({ entries: rows.results || [] });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Wrong origin.' }, 403);
  const bodyText = await request.text();
  if (bodyText.length > 2048) return json({ error: 'Score request is too large.' }, 413);
  let body;
  try { body = JSON.parse(bodyText); } catch { return json({ error: 'Invalid score request.' }, 400); }
  const { playerId, name, survived, kills, chips, victory } = body || {};
  if (typeof playerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(playerId) || typeof name !== 'string' || !/^[A-Za-z0-9 _-]{2,16}$/.test(name.trim()) ||
    !Number.isInteger(survived) || survived < 0 || survived > 360 || !Number.isInteger(kills) || kills < 0 || kills > 7 ||
    !Number.isInteger(chips) || chips < 0 || chips > 7 || typeof victory !== 'boolean') return json({ error: 'Invalid score details.' }, 400);
  const score = survived + kills * 80 + chips * 30 + (victory ? 400 : 0);
  await env.DB.prepare('INSERT INTO leaderboard (player_id, name, score, kills, chips, survived, victory) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET name=excluded.name, score=excluded.score, kills=excluded.kills, chips=excluded.chips, survived=excluded.survived, victory=excluded.victory, created_at=CURRENT_TIMESTAMP WHERE excluded.score > leaderboard.score')
    .bind(playerId, name.trim(), score, kills, chips, survived, victory ? 1 : 0).run();
  const saved = await env.DB.prepare('SELECT score FROM leaderboard WHERE player_id = ?').bind(playerId).first();
  const rank = await env.DB.prepare('SELECT COUNT(*) + 1 AS place FROM leaderboard WHERE score > ?').bind(saved.score).first();
  return json({ score: saved.score, rank: rank.place });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/leaderboard') {
      try { return await leaderboard(request, env); }
      catch { return json({ error: 'Leaderboard is temporarily unavailable.' }, 503); }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = Object.hasOwn(ASSETS, path) ? ASSETS[path] : null;
    if (!asset) return new Response('Not found', { status: 404 });
    const bytes = Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0));
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
      'content-type': asset.type,
      'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      ...(path === '/source.zip' ? { 'content-disposition': 'attachment; filename="blastwater-source.zip"' } : {})
    } });
  }
};
