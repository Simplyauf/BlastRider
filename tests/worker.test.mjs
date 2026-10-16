import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

function database() {
  const rows = new Map();
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async all() { return { results: [...rows.values()].sort((a, b) => b.score - a.score).slice(0, 10) }; },
        async run() {
          const [playerId, name, score, kills, chips, survived, victory] = values;
          const old = rows.get(playerId);
          if (!old || score > old.score) rows.set(playerId, { name, score, kills, chips, survived, victory });
          return { success: true };
        },
        async first() {
          if (sql.includes('WHERE player_id')) return rows.get(values[0]);
          return { place: [...rows.values()].filter(row => row.score > values[0]).length + 1 };
        }
      };
    }
  };
}

test('serves the game and downloadable source', async () => {
  const home = await worker.fetch(new Request('https://example.test/'), {});
  assert.equal(home.status, 200);
  assert.match(await home.text(), /HOW TO PLAY/);
  const source = await worker.fetch(new Request('https://example.test/source.zip'), {});
  assert.equal(source.status, 200);
  assert.equal(source.headers.get('content-type'), 'application/zip');
});

test('accepts valid score, computes points, and returns top ten', async () => {
  const env = { DB: database() };
  const response = await worker.fetch(new Request('https://example.test/api/leaderboard', {
    method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: 'e87f91a7-9f9e-452a-a5de-c0ba6c237a91', name: 'Island Ace', survived: 122, kills: 2, chips: 1, victory: true })
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { score: 712, rank: 1 });
  const list = await worker.fetch(new Request('https://example.test/api/leaderboard'), env);
  const data = await list.json();
  assert.equal(data.entries[0].name, 'Island Ace');
  assert.equal(data.entries[0].score, 712);
});

test('rejects invalid names and cross-origin score posts', async () => {
  const env = { DB: database() };
  const invalid = await worker.fetch(new Request('https://example.test/api/leaderboard', {
    method: 'POST', headers: { origin: 'https://example.test' },
    body: JSON.stringify({ playerId: 'e87f91a7-9f9e-452a-a5de-c0ba6c237a91', name: '<script>', survived: 1, kills: 0, chips: 0, victory: false })
  }), env);
  assert.equal(invalid.status, 400);
  const foreign = await worker.fetch(new Request('https://example.test/api/leaderboard', {
    method: 'POST', headers: { origin: 'https://elsewhere.test' }, body: '{}' 
  }), env);
  assert.equal(foreign.status, 403);
});
