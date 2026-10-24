const test = require('node:test');
const assert = require('node:assert/strict');
const { collectAllSearchIds } = require('../src/services/searchPagination');
const { reconcileRows } = require('../src/services/batchReconciliation');

test('search pagination follows search_after until every matching id is collected', async () => {
  const calls = [];
  const pages = [
    { ids: ['a', 'b'], after: ['b'] },
    { ids: ['c', 'd'], after: ['d'] },
    { ids: ['e'] },
  ];
  const ids = await collectAllSearchIds(async (after) => {
    calls.push(after);
    return pages.shift();
  });

  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(calls, [undefined, ['b'], ['d']]);
});

test('backfill walks bounded pages and indexes all persisted rows', async () => {
  const rows = Array.from({ length: 1201 }, (_, index) => ({ id: String(index).padStart(4, '0') }));
  const indexed = [];
  const cursors = [];
  const count = await reconcileRows({
    batchSize: 500,
    fetchBatch: async (cursor) => {
      cursors.push(cursor);
      const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
      return rows.slice(start, start + 500);
    },
    indexBatch: async (batch) => indexed.push(...batch.map((row) => row.id)),
  });

  assert.equal(count, 1201);
  assert.equal(indexed.length, 1201);
  assert.equal(new Set(indexed).size, 1201);
  assert.deepEqual(cursors, [undefined, '0499', '0999']);
});

test('failed backfill page rejects so a later full pass can retry from PostgreSQL', async () => {
  const rows = [{ id: 'one' }, { id: 'two' }];
  let attempts = 0;
  const fetchedCursors = [];
  await assert.rejects(reconcileRows({
    batchSize: 500,
    fetchBatch: async (cursor) => {
      fetchedCursors.push(cursor);
      return rows;
    },
    indexBatch: async () => {
      attempts += 1;
      throw new Error('Elasticsearch unavailable');
    },
  }), /Elasticsearch unavailable/);
  assert.equal(attempts, 1);

  const recovered = await reconcileRows({
    batchSize: 500,
    fetchBatch: async (cursor) => {
      fetchedCursors.push(cursor);
      return rows;
    },
    indexBatch: async () => { attempts += 1; },
  });
  assert.equal(recovered, rows.length);
  assert.deepEqual(fetchedCursors, [undefined, undefined]);
});
