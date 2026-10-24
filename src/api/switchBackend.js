// HTTP client for the canonical SWITCH API (Person 2 deterministic backend + integrated Person 3C routes).
// No Alexa, Amazon or physical device is ever contacted from here: the only host is VITE_SWITCH_API_URL.
// All results (PASS/FAIL/INCONCLUSIVE) come only from the backend evaluator.

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const SWITCH_API_BASE = (ENV.VITE_SWITCH_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
// DEMO-ONLY token seeded by the backend in SWITCH_ENV=demo. Not a secret; never use outside a local demo.
export const SWITCH_DEMO_TOKEN = ENV.VITE_SWITCH_DEMO_TOKEN || 'demo-owner-token';

export class SwitchApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = [] } = {}) { super(message); this.status = status; this.code = code; this.details = details; }
}

export async function switchRequest(path, { method = 'GET', body, token = SWITCH_DEMO_TOKEN, timeoutMs = 15000, base = SWITCH_API_BASE } = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (e) {
    throw new SwitchApiError(e?.name === 'AbortError' ? `SWITCH API timed out after ${timeoutMs} ms` : `SWITCH API unreachable at ${base}`, { code: e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' });
  } finally {
    if (timer) clearTimeout(timer);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new SwitchApiError(payload?.error?.message || `SWITCH API request failed (${response.status})`,
      { status: response.status, code: payload?.error?.code || 'HTTP_ERROR', details: payload?.error?.details || [] });
  }
  return payload;
}

export async function getHealth({ base = SWITCH_API_BASE, timeoutMs = 4000 } = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const r = await fetch(`${base}/health`, controller ? { signal: controller.signal } : {});
    if (!r.ok) throw new SwitchApiError(`Health endpoint returned ${r.status}`, { status: r.status, code: 'HTTP_ERROR' });
    return r.json();
  } catch (e) {
    if (e instanceof SwitchApiError) throw e;
    throw new SwitchApiError(`SWITCH API unreachable at ${base}`, { code: 'NETWORK_ERROR' });
  } finally { if (timer) clearTimeout(timer); }
}

export async function getBackendOverview() {
  const health = await getHealth();
  const [routines, requirements, candidates] = await Promise.all([switchRequest('/routines'), switchRequest('/requirements'), switchRequest('/candidates')]);
  return { health, routines, requirements, candidates };
}

const enc = encodeURIComponent;
// --- catalog / routines / scenarios ---
export const getCatalog = () => switchRequest('/catalog');
export const listRoutines = () => switchRequest('/routines');
export const getRoutineDiff = (routineId, from, to) => switchRequest(`/routines/${enc(routineId)}/diff?from=${from}&to=${to}`);
export const listScenarios = () => switchRequest('/scenarios');
// --- requirements lifecycle ---
export async function listRequirements(params = {}) {
  const q = new URLSearchParams();
  for (const k of ['status', 'device', 'routine_id', 'last_result']) if (params[k]) q.set(k, params[k]);
  const qs = q.toString();
  return switchRequest(`/requirements${qs ? `?${qs}` : ''}`);
}
export const getRequirement = (rid) => switchRequest(`/requirements/${enc(rid)}`);
export const getRequirementVersions = (rid) => switchRequest(`/requirements/${enc(rid)}/versions`);
/** Read-only interpretation (Person 3C on the canonical catalog). Nothing is stored. */
export const interpretCorrection = (text, { context, answers } = {}) => switchRequest('/requirements/interpret', { method: 'POST', body: { text, ...(context ? { context } : {}), ...(answers ? { answers } : {}) } });
/** body: { source_correction, structured?, interpreter?: 'p3c'|'rule_based_fallback', scenario_ids?, routine_ids? } -> DRAFT */
export const createDraft = (body) => switchRequest('/requirements/drafts', { method: 'POST', body });
export const confirmRequirement = (rid, version) => switchRequest(`/requirements/${enc(rid)}/confirm`, { method: 'POST', body: { version } });
export const patchRequirement = (rid, body) => switchRequest(`/requirements/${enc(rid)}`, { method: 'PATCH', body });
// --- candidates ---
export const listCandidates = () => switchRequest('/candidates');
export const getCandidate = (cid) => switchRequest(`/candidates/${enc(cid)}`);
export const getCandidateDiff = (cid) => switchRequest(`/candidates/${enc(cid)}/diff`);
export const suggestFix = (cid, repair_ops) => switchRequest(`/candidates/${enc(cid)}/suggest-fix`, { method: 'POST', body: repair_ops ? { repair_ops } : {} });
export const previewRepair = (cid) => switchRequest('/person3c/repair/propose', { method: 'POST', body: { candidate_id: cid } });
export const reviewCandidate = (cid, decision, note) => switchRequest(`/candidates/${enc(cid)}/review`, { method: 'POST', body: { decision, ...(note ? { note } : {}) } });
export const approveCandidate = (cid, decision, note) => switchRequest(`/candidates/${enc(cid)}/approve`, { method: 'POST', body: { decision, note } });
// --- replays / reports ---
export async function runReplay({ candidate_id, requirement_ids, compare_to_run_id, extra_scenario_ids, via = 'web_ui' } = {}) {
  return switchRequest('/replays', { method: 'POST', body: { candidate_id, via,
    ...(requirement_ids ? { requirement_ids } : {}), ...(compare_to_run_id ? { compare_to_run_id } : {}), ...(extra_scenario_ids?.length ? { extra_scenario_ids } : {}) } });
}
export const listReplays = (candidate_id) => switchRequest(`/replays${candidate_id ? `?candidate_id=${enc(candidate_id)}` : ''}`);
export const getReplay = (run_id) => switchRequest(`/replays/${enc(run_id)}`);
export const getReplayReport = (run_id) => switchRequest(`/replays/${enc(run_id)}/report`);
export const verifyReplay = (run_id) => switchRequest(`/replays/${enc(run_id)}/verify`);
// --- demo / integrations ---
export const resetDemo = (profile = 'journey') => switchRequest('/demo/reset', { method: 'POST', body: { profile } });
export const getPerson3CStatus = () => switchRequest('/person3c/status');
export const getAlexaStatus = () => switchRequest('/integrations/alexa/status');
export const testAlexaIntegration = () => switchRequest('/integrations/alexa/test', { method: 'POST' });
let rpcId = 0;
/** JSON-RPC call to the SIMULATED Alexa+ adapter (Route C). Returns the JSON-RPC response object. */
export const alexaRpc = (method, params) => switchRequest('/integrations/alexa/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) } });
export const alexaTool = async (name, args = {}) => {
  const r = await alexaRpc('tools/call', { name, arguments: args });
  if (r.error) throw new SwitchApiError(r.error.message, { code: `JSONRPC_${r.error.code}` });
  return r.result;
};

/**
 * The API surface the store uses, bound to one base URL (injectable so Node tests can target a backend on any port).
 * Every method maps 1:1 to a documented backend route; no client-side evaluation happens here.
 */
export function createBackendApi({ base = SWITCH_API_BASE, token = SWITCH_DEMO_TOKEN } = {}) {
  const rq = (path, opts = {}) => switchRequest(path, { ...opts, base, token });
  let id = 0;
  const api = {
    base,
    getHealth: () => getHealth({ base }),
    listRoutines: () => rq('/routines'),
    listScenarios: () => rq('/scenarios'),
    getCatalog: () => rq('/catalog'),
    listRequirements: () => rq('/requirements'),
    getRequirementVersions: (rid) => rq(`/requirements/${enc(rid)}/versions`),
    interpretCorrection: (text, { context, answers } = {}) => rq('/requirements/interpret', { method: 'POST', body: { text, ...(context ? { context } : {}), ...(answers ? { answers } : {}) } }),
    createDraft: (body) => rq('/requirements/drafts', { method: 'POST', body }),
    confirmRequirement: (rid, version) => rq(`/requirements/${enc(rid)}/confirm`, { method: 'POST', body: { version } }),
    patchRequirement: (rid, body) => rq(`/requirements/${enc(rid)}`, { method: 'PATCH', body }),
    listCandidates: () => rq('/candidates'),
    suggestFix: (cid) => rq(`/candidates/${enc(cid)}/suggest-fix`, { method: 'POST', body: {} }),
    previewRepair: (cid) => rq('/person3c/repair/propose', { method: 'POST', body: { candidate_id: cid } }),
    reviewCandidate: (cid, decision, note) => rq(`/candidates/${enc(cid)}/review`, { method: 'POST', body: { decision, ...(note ? { note } : {}) } }),
    runReplay: ({ candidate_id, extra_scenario_ids, via = 'web_ui' }) => rq('/replays', { method: 'POST', body: { candidate_id, via, ...(extra_scenario_ids?.length ? { extra_scenario_ids } : {}) } }),
    listReplays: () => rq('/replays'),
    getReplayReport: (run_id) => rq(`/replays/${enc(run_id)}/report`),
    verifyReplay: (run_id) => rq(`/replays/${enc(run_id)}/verify`),
    resetDemo: (profile = 'journey') => rq('/demo/reset', { method: 'POST', body: { profile } }),
    getPerson3CStatus: () => rq('/person3c/status'),
    getAlexaStatus: () => rq('/integrations/alexa/status'),
    testAlexaIntegration: () => rq('/integrations/alexa/test', { method: 'POST' }),
    alexaRpc: (method, params) => rq('/integrations/alexa/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) } }),
    async alexaTool(name, args = {}) {
      const r = await api.alexaRpc('tools/call', { name, arguments: args });
      if (r.error) throw new SwitchApiError(r.error.message, { code: `JSONRPC_${r.error.code}` });
      return r.result;
    },
  };
  return api;
}
export const backendApi = createBackendApi();
