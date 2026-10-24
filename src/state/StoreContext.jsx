import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { environmentFor, environmentDate } from '../sim/daylight.js';

const Ctx = createContext(null);
export function StoreProvider({ store, children }) { return <Ctx.Provider value={store}>{children}</Ctx.Provider>; }

export function useApp() {
  const store = useContext(Ctx);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { store, state, actions: store.actions, q: store.queries, sim: store.sim };
}

/** Browser local time, ticking every second (display only — never used by replays). */
export function useLocalClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const h = setInterval(() => setNow(new Date()), intervalMs); return () => clearInterval(h); }, [intervalMs]);
  return now;
}

/** Day/night environment: automatic = browser local time (re-evaluated every 30 s), manual = chosen time/date. */
export function useEnvironment(settings) {
  const now = useLocalClock(30000);
  const time = { mode: settings.timeMode, time: settings.manualTime, date: settings.manualDate };
  const date = environmentDate(time, now);
  const key = `${settings.timeMode}|${settings.manualTime}|${settings.manualDate}|${settings.latitude}|${date.getHours()}:${date.getMinutes()}`;
  const env = useMemo(() => environmentFor(date, { latitude: settings.latitude }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { env, date };
}

export function useReducedMotion(settings) {
  const [sys, setSys] = useState(() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } });
  useEffect(() => {
    let mq; try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return undefined; }
    const on = (e) => setSys(e.matches); mq.addEventListener?.('change', on); return () => mq.removeEventListener?.('change', on);
  }, []);
  return settings.reducedMotion === 'on' ? true : settings.reducedMotion === 'off' ? false : sys;
}
