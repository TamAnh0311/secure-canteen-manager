import { useCallback, useEffect, useRef, useState } from 'react';
import { counter } from '@/lib/api';
import type { PendingOrder } from '@/lib/types';

// No realtime infra exists, so the queue polls. 4s keeps the queue fresh without
// hammering the LAN; overlapping fetches are skipped via an in-flight guard.
const POLL_MS = 4000;

interface PendingOrdersState {
  orders: PendingOrder[];
  loading: boolean;
  error: Error | null;
}

const INITIAL: PendingOrdersState = { orders: [], loading: true, error: null };

export function usePendingOrders() {
  const [state, setState] = useState<PendingOrdersState>(INITIAL);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (inFlight.current) return; // a poll is already running — let it finish
    inFlight.current = true;
    try {
      const orders = await counter.pendingOrders();
      if (mounted.current) setState({ orders, loading: false, error: null });
    } catch (err) {
      if (mounted.current) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { orders: state.orders, loading: state.loading, error: state.error, refresh };
}
