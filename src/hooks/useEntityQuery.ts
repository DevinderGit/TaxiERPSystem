import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';

/**
 * Generic TanStack Query wrapper per entity (Code Architecture §4.1:
 * useEntityQuery). Returns a small façade of:
 *   list()       → reactive useQuery result (call inside a component)
 *   get(id)      → Promise-based fetch via queryClient.fetchQuery
 *   create()     → mutation (call `.mutate(payload)`)
 *   update()     → mutation
 *   delete()     → mutation
 *   invalidate() → force-refetch the list (call after any manual write)
 *
 * DB row types are `any` until the schema is generated from Supabase
 * (`supabase gen types typescript`, planned in M14). Treat the typed
 * shape as unknown — caller does its own narrowing via Zod.
 *
 * Caching key shape: `['entity', entityName, 'list', filter]?` so the
 * `invalidate()` call only busts the list, not single-row gets.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

export function useEntityQuery(entity: string) {
  const queryClient = useQueryClient();
  const entityKey = ['entity', entity] as const;

  // --- list() — reactive, auto-refetched, cached -------------------------
  const listQuery = useQuery({
    queryKey: [...entityKey, 'list'],
    queryFn: async () => {
      const { data, error } = await supabase.from(entity).select('*');
      if (error) throw error;
      return (data ?? []) as AnyRow[];
    },
  });

  // --- create() — POST + invalidate list ---------------------------------
  const createMutation = useMutation({
    mutationFn: async (payload: AnyRow) => {
      const { data, error } = await supabase.from(entity).insert(payload).select().single();
      if (error) throw error;
      return data as AnyRow;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: entityKey });
    },
  });

  // --- update() — PATCH + invalidate list --------------------------------
  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number | string; payload: AnyRow }) => {
      const { data, error } = await supabase.from(entity).update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data as AnyRow;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: entityKey });
    },
  });

  // --- delete() — DELETE + invalidate list ------------------------------
  const deleteMutation = useMutation({
    mutationFn: async (id: number | string) => {
      const { error } = await supabase.from(entity).delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: entityKey });
    },
  });

  // --- get(id) — imperative, Promise-based. Safe to call from any handler.
  // Uses fetchQuery under the hood so the result is also cached (key:
  // ['entity', entity, 'get', id]).
  const get = (id: number | string) =>
    queryClient.fetchQuery({
      queryKey: [...entityKey, 'get', id],
      queryFn: async () => {
        const { data, error } = await supabase.from(entity).select('*').eq('id', id).single();
        if (error) throw error;
        return data as AnyRow | null;
      },
    });

  // --- invalidate() — manual cache bust ----------------------------------
  const invalidate = () => queryClient.invalidateQueries({ queryKey: entityKey });

  return {
    /** Reactive query result. Use `data`, `isLoading`, `isError`, `error`. */
    list: () => listQuery,
    /** Imperative single-row fetch. Awaits the row (or null). */
    get,
    /** Mutation trigger — pass the row payload, mutate fires POST. */
    create: createMutation.mutate,
    /** Mutation trigger — pass `{id, payload}`. */
    update: updateMutation.mutate,
    /** Mutation trigger — pass the id. */
    delete: deleteMutation.mutate,
    /** Force-refetch the list cache (use after manual writes / external invalidation). */
    invalidate,
    /** Raw mutation objects for components that need isPending / error. */
    _createState: createMutation,
    _updateState: updateMutation,
    _deleteState: deleteMutation,
  };
}
