/** Collect every matching id with bounded Elasticsearch pages. */
export async function collectAllSearchIds(
  fetchPage: (after?: (string | number)[]) => Promise<{
    ids: string[];
    after?: (string | number)[];
  }>,
): Promise<string[]> {
  const ids: string[] = [];
  let after: (string | number)[] | undefined;
  while (true) {
    const page = await fetchPage(after);
    ids.push(...page.ids);
    if (page.ids.length === 0 || !page.after) return ids;
    after = page.after;
  }
}
