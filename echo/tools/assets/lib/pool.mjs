// Runs a job per item, a few at a time, and reports each as it settles. Resolves with how many failed.
export const pool = async (items, limit, job) => {
  let next = 0, failed = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        console.log(await job(item));
      } catch (e) {
        failed++;
        console.log(`${item}: FAILED ${e?.message ?? e}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return failed;
};
