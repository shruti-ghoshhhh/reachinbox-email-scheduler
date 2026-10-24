export async function reconcileRows<T extends { id: string }>(options: {
  fetchBatch: (cursor?: string) => Promise<T[]>;
  indexBatch: (rows: T[]) => Promise<void>;
  batchSize: number;
}): Promise<number> {
  let indexed = 0;
  let cursor: string | undefined;
  while (true) {
    const rows = await options.fetchBatch(cursor);
    if (rows.length === 0) return indexed;
    await options.indexBatch(rows);
    indexed += rows.length;
    cursor = rows[rows.length - 1].id;
    if (rows.length < options.batchSize) return indexed;
  }
}
