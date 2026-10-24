export interface ParsedPagination {
  page: number;
  limit: number;
  skip: number;
}

/** Reject ambiguous, non-integer, unsafe, or excessive pagination inputs. */
export function parsePagination(pageValue: unknown, limitValue: unknown): ParsedPagination | null {
  const parse = (value: unknown, fallback: number): number | null => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  const page = parse(pageValue, 1);
  const limit = parse(limitValue, 20);
  if (page === null || limit === null || page < 1 || page > 1_000_000 || limit < 1 || limit > 100) return null;
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) return null;
  return { page, limit, skip };
}
