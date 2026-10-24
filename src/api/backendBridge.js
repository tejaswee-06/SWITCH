// Compatibility module for the earlier integration panels. The application now reads canonical data through the
// store (src/state/appStore.js) using the pure mapping in ./canonicalMap.js; this file keeps the previously exported
// helper names working and re-exports the API base (its missing export broke `npm run build` in the handed-over ZIP).
import { getHealth, listRequirements, listCandidates, listReplays, getReplayReport, SWITCH_API_BASE } from './switchBackend.js';
import { requirementToView, feId, roomOfCanon, viewDevice } from './canonicalMap.js';

export { SWITCH_API_BASE };
export const backendDeviceToFe = (id) => feId(id) ?? id;
export const backendRoomFor = (id) => roomOfCanon(id);
export { viewDevice };

export async function probeBackend() {
  try { return { ok: true, health: await getHealth(), base: SWITCH_API_BASE }; }
  catch (e) { return { ok: false, error: e.message || String(e), base: SWITCH_API_BASE }; }
}
export async function fetchBackendRequirements() { return (await listRequirements()).map((r) => requirementToView(r)); }
export async function fetchBackendCandidates() { return listCandidates(); }
export async function fetchBackendReports() {
  const rows = await listReplays();
  return Promise.all(rows.map(async (row) => ({ ...(await getReplayReport(row.run_id)), summary_row: row })));
}
