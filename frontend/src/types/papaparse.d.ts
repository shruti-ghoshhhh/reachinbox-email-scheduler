declare module 'papaparse' {
  const Papa: {
    parse<T>(input: string, config?: { skipEmptyLines?: boolean }): { data: T[] };
  };
  export default Papa;
}
