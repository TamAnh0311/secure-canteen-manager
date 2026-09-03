import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ApiError } from '@/lib/api-client';

interface QueryState<T> {
  data: T | undefined;
  error: ApiError | Error | null;
  loading: boolean;
}

type Action<T> =
  | { type: 'loading' }
  | { type: 'success'; data: T }
  | { type: 'error'; error: ApiError | Error };

function reducer<T>(state: QueryState<T>, action: Action<T>): QueryState<T> {
  switch (action.type) {
    case 'loading':
      return { ...state, loading: true, error: null };
    case 'success':
      return { data: action.data, error: null, loading: false };
    case 'error':
      return { ...state, error: action.error, loading: false };
  }
}

export interface UseQueryResult<T> {
  data: T | undefined;
  error: ApiError | Error | null;
  loading: boolean;
  refetch: () => void;
}

export function useQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
): UseQueryResult<T> {
  const [state, dispatch] = useReducer(reducer<T>, {
    data: undefined,
    error: null,
    loading: true,
  });

  // Incrementing this counter reruns the effect without changing external deps.
  const [refetchCount, incrementRefetch] = useReducer((n: number) => n + 1, 0);

  // Keep the latest fetcher without forcing effect re-runs on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'loading' });

    fetcherRef.current()
      .then((data) => {
        if (!cancelled) dispatch({ type: 'success', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          dispatch({
            type: 'error',
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // refetchCount is the manual-refetch trigger; deps are caller-supplied keys.
    // fetcherRef.current is intentionally excluded — it's always up-to-date via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchCount, ...deps]);

  const refetch = useCallback(() => incrementRefetch(), []);

  return { data: state.data, error: state.error, loading: state.loading, refetch };
}
