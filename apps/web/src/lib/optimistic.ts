/**
 * Optimistic mutation helper (Step 56).
 * Example: cart add, wallet withdraw — update QueryClient cache immediately,
 * rollback on error, invalidate on success.
 *
 * Usage:
 *   const qc = useQueryClient();
 *   const m = useMutation({
 *     mutationFn: (item) => api("POST","/market/cart", item),
 *     onMutate: async (item) => optimisticUpdate(qc, ["cart"], (old:any[]) => [...old, item]),
 *     onError: (_e, _v, ctx) => ctx && qc.setQueryData(["cart"], ctx.previous),
 *     on Settled: () => qc.invalidateQueries({ queryKey: ["cart"] }),
 *   });
 */
import type { QueryClient } from "@tanstack/react-query";

export async function optimisticUpdate<T>(
  qc: QueryClient,
  key: unknown[],
  updater: (old: T) => T
): Promise<{ previous: T | undefined }> {
  await qc.cancelQueries({ queryKey: key });
  const previous = qc.getQueryData<T>(key);
  if (previous !== undefined) qc.setQueryData<T>(key, updater(previous));
  return { previous };
}
