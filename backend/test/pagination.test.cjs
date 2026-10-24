const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePagination } = require('../src/services/pagination');

test('uses safe defaults when pagination parameters are omitted', () => {
  assert.deepEqual(parsePagination(undefined, undefined), { page: 1, limit: 20, skip: 0 });
});

test('accepts bounded positive integer pagination values', () => {
  assert.deepEqual(parsePagination('3', '25'), { page: 3, limit: 25, skip: 50 });
});

test('rejects malformed, negative, unsafe, repeated, and excessive pagination values', () => {
  for (const [page, limit] of [
    ['0', '20'], ['-1', '20'], ['1.5', '20'], ['1junk', '20'], ['2', '0'],
    ['2', '101'], ['999999999999999999999', '20'], [['1', '2'], '20'], ['1', ['20', '30']],
  ]) assert.equal(parsePagination(page, limit), null);
});
