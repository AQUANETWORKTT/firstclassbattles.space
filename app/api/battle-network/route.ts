import { NextResponse } from "next/server";
import { submissionsSupabase } from "@/lib/submissions-supabase";
import { AGENCY_COLUMNS, BATTLE_COLUMNS, toAgency, toBattle } from "@/lib/battle-network-data";

const SETTINGS_NAME = "battle-network-settings";
const EXTERNAL_PASSWORD = "BATTLE";
const MASTER_PASSWORDS = new Set(["DAN44"]);
const clean = (value: unknown) => String(value || "").trim().replace(/^@/, "");
const key = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const creatorKey = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const ANY_TIME = "ANY TIME";
// The database column is a SQL time field, so "00:00" is reserved internally
// for the flexible Any Time option and converted back before it reaches the UI.
const ANY_TIME_STORAGE = "00:00";
const time = (value: unknown) => String(value || "").trim().toUpperCase() === ANY_TIME ? ANY_TIME_STORAGE : String(value || "").slice(0, 5);
const isAnyTime = (value: string) => value.trim().toUpperCase() === ANY_TIME;
const timeMinutes = (value: string) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
const isFixedEveningTime = (value: string) => !isAnyTime(value) && timeMinutes(value) >= 18 * 60 && timeMinutes(value) < 24 * 60;
const isExactOrAnyTimeMatch = (first: string, second: string) => first === second ? !isAnyTime(first) : (isAnyTime(first) && isFixedEveningTime(second)) || (isAnyTime(second) && isFixedEveningTime(first));
const resolvedMatchTime = (first: string, second: string) => isFixedEveningTime(first) ? first : isFixedEveningTime(second) ? second : first;
const currentWeekStart = () => { const date = new Date(); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date.toISOString().slice(0, 10); };
const recentWeekStart = () => { const date = new Date(); date.setDate(date.getDate() - 14); return date.toISOString().slice(0, 10); };
const historyWeekStart = (weekStart: string) => { const date = new Date(`${weekStart}T12:00:00`); date.setDate(date.getDate() - 14); return date.toISOString().slice(0, 10); };
const endWeekStart = (weekStart: string) => { const date = new Date(`${weekStart}T12:00:00`); date.setDate(date.getDate() + 7); return date.toISOString().slice(0, 10); };
type WeeklySchedule = { id: string; agencyId: string; creatorUsername: string; manager: string; day: string; requestedTime: string; size: string; powerUps: string; active?: boolean };
const weeklySchedules = (value: Record<string, unknown>) => Array.isArray(value.weeklySchedules) ? value.weeklySchedules as WeeklySchedule[] : [];
const weekAfter = (weekStart: string) => { const date = new Date(`${weekStart}T12:00:00`); date.setDate(date.getDate() + 7); return date.toISOString().slice(0, 10); };
const occurrenceKey = (scheduleId: string, weekStart: string) => `${scheduleId}:${weekStart}`;
async function ensureWeeklySchedules(current: Record<string, unknown>) {
  const schedules = weeklySchedules(current).filter((schedule) => schedule.active !== false);
  const skips = new Set(Array.isArray(current.weeklyScheduleSkips) ? current.weeklyScheduleSkips.map(String) : []);
  const weeks = [currentWeekStart(), weekAfter(currentWeekStart())];
  for (const schedule of schedules) for (const weekStart of weeks) {
    if (skips.has(occurrenceKey(schedule.id, weekStart))) continue;
    const { data: existing, error: existingError } = await submissionsSupabase.from("battle_network_battles").select("id,creator_username").eq("agency_id", schedule.agencyId).eq("week_start", weekStart).eq("day", schedule.day).eq("requested_time", schedule.requestedTime);
    if (existingError) throw new Error(existingError.message);
    if (existing?.some((row) => creatorKey(row.creator_username) === creatorKey(schedule.creatorUsername))) continue;
    const { error } = await submissionsSupabase.from("battle_network_battles").insert({ id: crypto.randomUUID(), agency_id: schedule.agencyId, week_start: weekStart, day: schedule.day, creator_username: schedule.creatorUsername, manager: schedule.manager, size: schedule.size, power_ups: schedule.powerUps, requested_time: schedule.requestedTime, actual_time: schedule.requestedTime });
    if (error) throw new Error(error.message);
  }
}
const payload = (battle: Record<string, unknown>) => ({
  id: battle.id || crypto.randomUUID(), agency_id: key(battle.agencyId), week_start: battle.weekStart,
  day: String(battle.day || "MONDAY"), creator_username: clean(battle.creatorUsername), manager: clean(battle.manager), size: String(battle.size || "LESS THAN 1K"),
  power_ups: String(battle.powerUps).toUpperCase() === "NPU" ? "NPU" : "POWER-UPS ALLOWED", requested_time: time(battle.requestedTime), actual_time: time(battle.actualTime || battle.requestedTime),
});
const TWO_V_TWO_PREFIX = "__2V2__:";
type TwoVTwoParticipant = { username: string; agencyId: string; agencyName?: string };
const twoVTwoParticipants = (value: unknown): TwoVTwoParticipant[] | null => {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value || "").slice(TWO_V_TWO_PREFIX.length));
    if (!Array.isArray(parsed) || (parsed.length !== 2 && parsed.length !== 4)) return null;
    const participants = parsed.map((item) => { const agencyName = clean(item?.agencyName); return { username: clean(item?.username), agencyId: key(item?.agencyId) || (agencyName ? `manual-${key(agencyName)}` : ""), agencyName }; });
    return participants.every((item) => item.username && item.agencyId) ? participants : null;
  } catch { return null; }
};
const battleBelongsToAgency = (row: { agencyId: string; manager: string }, agencyId: string) => row.agencyId === agencyId || Boolean(twoVTwoParticipants(row.manager)?.some((participant) => participant.agencyId === agencyId));

async function settings() {
  const { data, error } = await submissionsSupabase.from("poster_templates").select("template_json").eq("name", SETTINGS_NAME).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.template_json || {}) as Record<string, unknown>;
}
type Incompatibility = { first: string; second: string; reason: string };
function incompatibilities(value: unknown): Incompatibility[] { const items = (value && typeof value === "object" ? value as Record<string, unknown> : {}).incompatibilities; if (!Array.isArray(items)) return []; const seen = new Set<string>(); return items.flatMap((item): Incompatibility[] => { const row = item && typeof item === "object" ? item as Record<string, unknown> : {}; const first = creatorKey(row.first), second = creatorKey(row.second), reason = clean(row.reason); const pair = [first, second].sort().join(":"); if (!first || !second || first === second || seen.has(pair)) return []; seen.add(pair); return [{ first, second, reason }]; }); }
function incompatible(items: Incompatibility[], first: unknown, second: unknown) { const left = creatorKey(first), right = creatorKey(second); return items.find((item) => (item.first === left && item.second === right) || (item.first === right && item.second === left)); }
function bannedCreators(value: Record<string, unknown>) { return new Set((Array.isArray(value.bannedCreators) ? value.bannedCreators : []).map(creatorKey).filter(Boolean)); }
function rejectBanned(value: Record<string, unknown>, ...usernames: unknown[]) { return usernames.some((username) => bannedCreators(value).has(creatorKey(username))); }
async function saveSettings(next: Record<string, unknown>) {
  // Battles live exclusively in battle_network_battles. Strip the retired
  // settings copy so old schedules cannot bloat or delay the battle page.
  const { battles: _retiredBattleCache, agencies: _retiredAgencyCache, ...settingsOnly } = next;
  const { error } = await submissionsSupabase.from("poster_templates").upsert({ name: SETTINGS_NAME, template_json: settingsOnly, background_url: null, updated_at: new Date().toISOString() }, { onConflict: "name" });
  if (error) throw new Error(error.message);
}
async function clearPosterMade(...battleIds: Array<string | undefined>) {
  const ids = battleIds.filter((id): id is string => Boolean(id));
  if (!ids.length) return;
  const current = await settings();
  const posterMade = { ...((current.posterMade && typeof current.posterMade === "object") ? current.posterMade as Record<string, boolean> : {}) };
  ids.forEach((id) => delete posterMade[id]);
  await saveSettings({ ...current, posterMade });
}
async function battle(id: string) {
  const { data, error } = await submissionsSupabase.from("battle_network_battles").select(BATTLE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toBattle(data) : null;
}
async function recordBattleAudit(action: string, current: Awaited<ReturnType<typeof battle>>, actorAgencyId?: string, opponentBattleId?: string) {
  if (!current) return;
  const { error } = await submissionsSupabase.from("battle_network_audit_log").insert({
    action,
    actor_agency_id: actorAgencyId || current.agencyId,
    battle_id: current.id,
    opponent_battle_id: opponentBattleId || current.opponentBattleId || null,
    details: { creator: current.creatorUsername, battleAgencyId: current.agencyId, day: current.day, weekStart: current.weekStart, requestedTime: current.requestedTime },
  });
  // The audit table is optional until its one-off SQL setup has run. A battle
  // action must never look failed after the actual database change succeeded.
  if (error) console.error("Could not write battle audit record:", error.message);
}
async function hasDuplicateBattle(row: { agency_id: string; week_start: unknown; day: string; creator_username: string; requested_time: string }, excludeId?: string) {
  let query = submissionsSupabase.from("battle_network_battles").select("id").eq("agency_id", row.agency_id).eq("week_start", row.week_start).eq("day", row.day).eq("requested_time", row.requested_time).ilike("creator_username", row.creator_username);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const url = new URL(request.url);
    const includePasswords = url.searchParams.get("settings") === "1";
    const history = url.searchParams.get("history") === "1";
    const weekStart = url.searchParams.get("week") || currentWeekStart();
    const layout = await settings();
    const [agencies, battles] = await Promise.all([
      submissionsSupabase.from("battle_network_agencies").select(includePasswords ? `${AGENCY_COLUMNS},password` : AGENCY_COLUMNS).order("name"),
      submissionsSupabase.from("battle_network_battles").select(BATTLE_COLUMNS).gte("week_start", historyWeekStart(weekStart)).lte("week_start", endWeekStart(weekStart)).not("creator_username", "ilike", "test-%").order("created_at", { ascending: false }),
    ]);
    if (agencies.error || battles.error) throw new Error(agencies.error?.message || battles.error?.message);
    const response = NextResponse.json({ agencies: ((agencies.data || []) as unknown as Record<string, unknown>[]).map((agency) => includePasswords ? { ...toAgency(agency), password: String(agency.password || "") } : toAgency(agency)), battles: ((battles.data || []) as unknown as Record<string, unknown>[]).map(toBattle), cardLayout: layout.cardLayout, cardTypography: layout.cardTypography, managerSettings: layout.managerSettings || {}, weeklySchedules: weeklySchedules(layout), incompatibilities: incompatibilities(layout), bannedCreators: Array.isArray(layout.bannedCreators) ? layout.bannedCreators : [], posterMade: layout.posterMade || {} });
    response.headers.set("Server-Timing", `supabase;dur=${Math.round(performance.now() - startedAt)}`);
    return response;
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "COULD NOT LOAD BATTLE NETWORK." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Manual 2v2 claims are submitted on behalf of the selected opponent agency.
    // This keeps one paired row and avoids rejecting a home-agency source battle.
    if (body.action === "claim-2v2" && Array.isArray(body.participants) && body.participants[0]?.agencyId) body.agencyId = body.participants[0].agencyId;
    if (body.action === "external-login") return String(body.password || "").trim().toUpperCase() === EXTERNAL_PASSWORD ? NextResponse.json({ agency: { id: "external-agency", name: "EXTERNAL AGENCY", accent: "#94a3b8" } }) : NextResponse.json({ error: "ACCESS DENIED." }, { status: 401 });
    if (body.action === "external-select") { const { data, error } = await submissionsSupabase.from("battle_network_agencies").select("id,name,password,external_only").eq("id", key(body.agencyId)).maybeSingle(); if (error) throw new Error(error.message); if (!data?.external_only || String(data.password || "").toUpperCase() !== clean(body.password).toUpperCase()) return NextResponse.json({ error: "ACCESS DENIED." }, { status: 401 }); return NextResponse.json({ ok: true, agency: { id: data.id, name: data.name } }); }
    if (body.action === "login") { const password = String(body.password || "").trim().toUpperCase(); const selectedAgencyId = key(body.agencyId); const query = submissionsSupabase.from("battle_network_agencies").select("id,name,accent,logo_url,external_only,password").eq("external_only", false); const { data, error } = await (selectedAgencyId ? query.eq("id", selectedAgencyId).maybeSingle() : query.eq("password", password).maybeSingle()); if (error) throw new Error(error.message); const allowed = data && (String(data.password || "").toUpperCase() === password || MASTER_PASSWORDS.has(password)); return allowed ? NextResponse.json({ agency: toAgency(data) }) : NextResponse.json({ error: "ACCESS DENIED." }, { status: 401 }); }
    if (body.action === "save-card-layout") { const current = await settings(); const next = { ...current, cardLayout: body.cardLayout, cardTypography: body.cardTypography }; await saveSettings(next); return NextResponse.json({ cardLayout: body.cardLayout, cardTypography: body.cardTypography }); }
    if (body.action === "save-manager-settings") { const current = await settings(); const next = { ...current, managerSettings: body.managerSettings || {} }; await saveSettings(next); return NextResponse.json({ managerSettings: next.managerSettings }); }
    if (body.action === "save-banned-creators") { const current = await settings(); const bannedCreators = [...new Set((Array.isArray(body.bannedCreators) ? body.bannedCreators : []).map(clean).filter(Boolean))]; await saveSettings({ ...current, bannedCreators }); return NextResponse.json({ bannedCreators }); }
    if (body.action === "save-poster-status") { const current = await settings(); const posterMade = { ...((current.posterMade && typeof current.posterMade === "object") ? current.posterMade as Record<string, boolean> : {}), [String(body.battleId)]: Boolean(body.completed) }; await saveSettings({ ...current, posterMade }); return NextResponse.json({ posterMade }); }
    if (body.action === "register" || body.action === "register-external-agency") { const name = clean(body.name).toUpperCase(), id = key(name), external = body.action === "register-external-agency"; if (!id || (!external && !clean(body.password))) return NextResponse.json({ error: "COMPLETE THE AGENCY DETAILS." }, { status: 400 }); const { data, error } = await submissionsSupabase.from("battle_network_agencies").insert({ id, name, accent: body.accent || "#94a3b8", logo_url: body.logoUrl || "", external_only: external, password: clean(body.password).toUpperCase() }).select(AGENCY_COLUMNS).single(); if (error) return NextResponse.json({ error: error.message.includes("duplicate") ? "THAT AGENCY IS ALREADY ON THE LIST." : error.message }, { status: 409 }); return NextResponse.json({ agency: toAgency(data) }); }
    if (body.action === "make-internal-agency") { const id = key(body.agencyId); const { data, error } = await submissionsSupabase.from("battle_network_agencies").update({ name: clean(body.name).toUpperCase(), password: clean(body.password).toUpperCase(), logo_url: String(body.logoUrl || ""), external_only: false, accent: body.accent || "#d4af37" }).eq("id", id).select(AGENCY_COLUMNS).limit(1); if (error || !data?.[0]) throw new Error(error?.message || "AGENCY NOT FOUND."); return NextResponse.json({ agency: toAgency(data[0]) }); }
    if (body.action === "rename-agency") { const id = key(body.agencyId); const name = clean(body.name).toUpperCase(); if (!id || !name) return NextResponse.json({ error: "COMPLETE THE AGENCY NAME." }, { status: 400 }); const { data, error } = await submissionsSupabase.from("battle_network_agencies").update({ name }).eq("id", id).select(AGENCY_COLUMNS).single(); if (error) throw new Error(error.message); return NextResponse.json({ agency: toAgency(data) }); }
    if (body.action === "save-external-agency" || body.action === "save-agency") { const agency = body.agency || {}; const id = key(agency.id); const { data, error } = await submissionsSupabase.from("battle_network_agencies").update({ name: clean(agency.name).toUpperCase(), accent: agency.accent || "#94a3b8", logo_url: agency.logoUrl || "", password: clean(agency.password).toUpperCase() }).eq("id", id).select(AGENCY_COLUMNS).single(); if (error) throw new Error(error.message); return NextResponse.json({ agency: toAgency(data) }); }
    if (body.action === "delete-agency") { const agencyId = key(body.agencyId); const { data: agencyBattles, error: listError } = await submissionsSupabase.from("battle_network_battles").select("id").eq("agency_id", agencyId); if (listError) throw new Error(listError.message); const battleIds = (agencyBattles || []).map((row) => String(row.id)); if (battleIds.length) { const { error: unlinkError } = await submissionsSupabase.from("battle_network_battles").update({ opponent_battle_id: null }).in("opponent_battle_id", battleIds); if (unlinkError) throw new Error(unlinkError.message); const { error: deleteBattlesError } = await submissionsSupabase.from("battle_network_battles").delete().eq("agency_id", agencyId); if (deleteBattlesError) throw new Error(deleteBattlesError.message); } const { error } = await submissionsSupabase.from("battle_network_agencies").delete().eq("id", agencyId); if (error) throw new Error(error.message); return NextResponse.json({ ok: true }); }
    if (body.action === "external-withdraw") { const current = await battle(String(body.battleId)); if (!current?.cancelledAt) return NextResponse.json({ error: "CANCELLED BATTLE NOT FOUND." }, { status: 404 }); const { error: unlinkError } = await submissionsSupabase.from("battle_network_battles").update({ opponent_battle_id: null }).eq("opponent_battle_id", current.id); if (unlinkError) throw new Error(unlinkError.message); const { error } = await submissionsSupabase.from("battle_network_battles").delete().eq("id", current.id); if (error) throw new Error(error.message); await recordBattleAudit("external-withdraw", current, key(body.agencyId)); return NextResponse.json({ ok: true }); }
    if (body.action === "create-weekly-schedule") { const schedule: WeeklySchedule = { id: crypto.randomUUID(), agencyId: key(body.agencyId), creatorUsername: clean(body.creatorUsername), manager: clean(body.manager), day: String(body.day || "MONDAY"), requestedTime: time(body.requestedTime), size: String(body.size || "1 - 5K"), powerUps: String(body.powerUps || "POWER-UPS ALLOWED"), active: true }; if (!schedule.agencyId || !schedule.creatorUsername || !schedule.manager || !schedule.requestedTime) return NextResponse.json({ error: "COMPLETE THE SCHEDULE DETAILS." }, { status: 400 }); const current = await settings(); const next = { ...current, weeklySchedules: [...weeklySchedules(current), schedule] }; await saveSettings(next); await ensureWeeklySchedules(next); return NextResponse.json({ schedule }); }
    if (body.action === "cancel-weekly-schedule") { const scheduleId = String(body.scheduleId || ""); const current = await settings(); const schedule = weeklySchedules(current).find((item) => item.id === scheduleId); if (!schedule) return NextResponse.json({ error: "SCHEDULE NOT FOUND." }, { status: 404 }); const { data: occurrences, error: occurrenceError } = await submissionsSupabase.from("battle_network_battles").select(BATTLE_COLUMNS).eq("agency_id", schedule.agencyId).gte("week_start", currentWeekStart()).eq("day", schedule.day).eq("requested_time", schedule.requestedTime).ilike("creator_username", schedule.creatorUsername); if (occurrenceError) throw new Error(occurrenceError.message); const openBattles = (occurrences || []).map(toBattle).filter((item) => !item.opponentBattleId); if (openBattles.length) { const { error } = await submissionsSupabase.from("battle_network_battles").delete().in("id", openBattles.map((item) => item.id)); if (error) throw new Error(error.message); await Promise.all(openBattles.map((item) => recordBattleAudit("cancel-weekly-schedule", item, key(body.agencyId)))); } const next = { ...current, weeklySchedules: weeklySchedules(current).map((item) => item.id === scheduleId ? { ...item, active: false } : item) }; await saveSettings(next); return NextResponse.json({ ok: true, removed: openBattles.length }); }
    if (body.action === "save-battle") { const row = payload(body.battle || {}); if (!row.agency_id || !row.creator_username || !row.manager || !row.requested_time) return NextResponse.json({ error: "COMPLETE BATTLE DETAILS." }, { status: 400 }); if (rejectBanned(await settings(), row.creator_username)) return NextResponse.json({ error: "THIS CREATOR IS BANNED FROM BATTLES." }, { status: 403 }); if (await hasDuplicateBattle(row, String(row.id))) return NextResponse.json({ error: "A BATTLE FOR THIS CREATOR AT THIS TIME ALREADY EXISTS." }, { status: 409 }); const { data, error } = await submissionsSupabase.from("battle_network_battles").upsert(row).select(BATTLE_COLUMNS).single(); if (error) throw new Error(error.message); return NextResponse.json({ battle: toBattle(data) }); }
    if (body.action === "save-2v2-battle") {
      const participants = twoVTwoParticipants(body.participants);
      const battle = body.battle || {};
      if (!participants || !battle.weekStart || !battle.day || !time(battle.requestedTime)) return NextResponse.json({ error: "COMPLETE ALL FOUR CREATORS, AGENCIES AND THE TIME." }, { status: 400 });
      const row = payload({ ...battle, agencyId: key(battle.agencyId) || participants[0].agencyId, creatorUsername: participants[0].username, manager: `${TWO_V_TWO_PREFIX}${JSON.stringify(participants)}`, powerUps: battle.powerUps });
      const { data, error } = await submissionsSupabase.from("battle_network_battles").upsert(row).select(BATTLE_COLUMNS).single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ battle: toBattle(data) });
    }
    if (body.action === "update-2v2-match") {
      const participants = twoVTwoParticipants(body.participants);
      const current = await battle(String(body.battleId));
      const opponent = await battle(String(body.opponentBattleId || current?.opponentBattleId || ""));
      const battleData = body.battle || {};
      if (!participants || participants.length !== 4 || !current || !opponent || current.opponentBattleId !== opponent.id || opponent.opponentBattleId !== current.id) return NextResponse.json({ error: "COMPLETE ALL FOUR CREATORS AND AGENCIES FOR THE MATCH." }, { status: 400 });
      const left = participants.slice(0, 2), right = participants.slice(2, 4);
      const shared = { week_start: battleData.weekStart || current.weekStart, day: String(battleData.day || current.day), size: String(battleData.size || current.size), power_ups: String(battleData.powerUps).toUpperCase() === "NPU" ? "NPU" : "POWER-UPS ALLOWED", requested_time: time(battleData.requestedTime || current.requestedTime), actual_time: time(battleData.actualTime || battleData.requestedTime || current.actualTime) };
      const updates = [
        submissionsSupabase.from("battle_network_battles").update({ ...shared, agency_id: left[0].agencyId, creator_username: left[0].username, manager: `${TWO_V_TWO_PREFIX}${JSON.stringify(left)}` }).eq("id", current.id),
        submissionsSupabase.from("battle_network_battles").update({ ...shared, agency_id: right[0].agencyId, creator_username: right[0].username, manager: `${TWO_V_TWO_PREFIX}${JSON.stringify(right)}` }).eq("id", opponent.id),
      ];
      const results = await Promise.all(updates);
      const updateError = results.find((result) => result.error)?.error;
      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "claim-2v2") { const source = await battle(String(body.sourceId)); const sourceParticipants = source ? twoVTwoParticipants(source.manager) : null; const participants = twoVTwoParticipants(body.participants); if (!source || source.opponentBattleId || !sourceParticipants || !participants) return NextResponse.json({ error: "COMPLETE BOTH 2V2 OPPONENTS." }, { status: 409 }); const requestedTime = isAnyTime(source.requestedTime) ? time(body.requestedTime) : source.requestedTime; if (isAnyTime(source.requestedTime) && !isFixedEveningTime(requestedTime)) return NextResponse.json({ error: "SELECT AN ACTUAL TIME BETWEEN 6 PM AND MIDNIGHT." }, { status: 409 }); const row = payload({ id: crypto.randomUUID(), agencyId: key(body.agencyId) || participants[0].agencyId, weekStart: source.weekStart, day: source.day, creatorUsername: participants[0].username, manager: `${TWO_V_TWO_PREFIX}${JSON.stringify(participants)}`, size: source.size, powerUps: source.powerUps, requestedTime, actualTime: requestedTime }); const { data, error } = await submissionsSupabase.from("battle_network_battles").insert({ ...row, opponent_battle_id: source.id }).select(BATTLE_COLUMNS).single(); if (error) throw new Error(error.message); const { error: updateError } = await submissionsSupabase.from("battle_network_battles").update({ opponent_battle_id: data.id, requested_time: requestedTime, actual_time: requestedTime }).eq("id", source.id); if (updateError) throw new Error(updateError.message); return NextResponse.json({ battle: toBattle(data) }); }
    if (body.action === "delete-battle") { let current = await battle(String(body.battleId)); if (current?.opponentBattleId && !await battle(current.opponentBattleId)) { const { error: repairError } = await submissionsSupabase.from("battle_network_battles").update({ opponent_battle_id: null, actual_time: current.requestedTime, cancelled_at: null, cancelled_by: null }).eq("id", current.id); if (repairError) throw new Error(repairError.message); current = { ...current, opponentBattleId: undefined, actualTime: current.requestedTime }; } if (!current || current.agencyId !== key(body.agencyId) || current.opponentBattleId) return NextResponse.json({ error: "BATTLE NOT FOUND OR LOCKED." }, { status: 409 }); const currentSettings = await settings(); const schedule = weeklySchedules(currentSettings).find((item) => item.active !== false && item.agencyId === current.agencyId && item.creatorUsername.toLowerCase() === current.creatorUsername.toLowerCase() && item.day === current.day && item.requestedTime === current.requestedTime); if (schedule) await saveSettings({ ...currentSettings, weeklyScheduleSkips: [...new Set([...(Array.isArray(currentSettings.weeklyScheduleSkips) ? currentSettings.weeklyScheduleSkips.map(String) : []), occurrenceKey(schedule.id, current.weekStart)])] }); const { error } = await submissionsSupabase.from("battle_network_battles").delete().eq("id", current.id); if (error) throw new Error(error.message); await recordBattleAudit("delete-battle", current, key(body.agencyId)); return NextResponse.json({ ok: true }); }
    if (body.action === "admin-delete-battle") { const current = await battle(String(body.battleId)); if (!current || current.opponentBattleId || current.cancelledAt) return NextResponse.json({ error: "ONLY OPEN BATTLES CAN BE DELETED." }, { status: 409 }); const { error } = await submissionsSupabase.from("battle_network_battles").delete().eq("id", current.id); if (error) throw new Error(error.message); await recordBattleAudit("admin-delete-battle", current, key(body.agencyId)); return NextResponse.json({ ok: true }); }
    if (body.action === "cancel-match") { const current = await battle(String(body.battleId)); if (!current || current.agencyId !== key(body.agencyId) || !current.opponentBattleId) return NextResponse.json({ error: "MATCHED BATTLE NOT FOUND." }, { status: 404 }); const opponent = await battle(current.opponentBattleId); if (!opponent) return NextResponse.json({ error: "OPPONENT NOT FOUND." }, { status: 404 }); const { data: opponentAgency, error: agencyError } = await submissionsSupabase.from("battle_network_agencies").select("external_only").eq("id", opponent.agencyId).maybeSingle(); if (agencyError) throw new Error(agencyError.message); const resetHome = submissionsSupabase.from("battle_network_battles").update({ opponent_battle_id: null, actual_time: current.requestedTime, cancelled_at: null, cancelled_by: null }).eq("id", current.id); if (opponent.manager.startsWith("MANUAL:") || opponentAgency?.external_only) { const results = await Promise.all([resetHome, submissionsSupabase.from("battle_network_battles").delete().eq("id", opponent.id)]); const error = results.find((result) => result.error)?.error; if (error) throw new Error(error.message); await clearPosterMade(current.id, opponent.id); await Promise.all([recordBattleAudit("cancel-match", current, key(body.agencyId), opponent.id), recordBattleAudit("cancelled-opponent", opponent, key(body.agencyId), current.id)]); return NextResponse.json({ ok: true, opponentDeleted: true }); } const opponentUpdate = submissionsSupabase.from("battle_network_battles").update({ opponent_battle_id: null, actual_time: opponent.requestedTime, cancelled_at: null, cancelled_by: null }).eq("id", opponent.id); const results = await Promise.all([resetHome, opponentUpdate]); const error = results.find((result) => result.error)?.error; if (error) throw new Error(error.message); await clearPosterMade(current.id, opponent.id); await Promise.all([recordBattleAudit("cancel-match", current, key(body.agencyId), opponent.id), recordBattleAudit("cancelled-opponent", opponent, key(body.agencyId), current.id)]); return NextResponse.json({ ok: true }); }
    if (body.action === "match") { const [first, second, currentSettings] = await Promise.all([battle(String(body.firstId)), battle(String(body.secondId)), settings()]); const close = Boolean(body.close); const activeAgencyId = key(body.agencyId); const difference = first && second ? Math.abs(timeMinutes(first.requestedTime) - timeMinutes(second.requestedTime)) : 0; if (!first || !second || first.opponentBattleId || second.opponentBattleId) return NextResponse.json({ error: "THAT BATTLE IS NO LONGER AVAILABLE." }, { status: 409 }); if (!activeAgencyId || !battleBelongsToAgency(first, activeAgencyId)) return NextResponse.json({ error: "YOU CAN ONLY MATCH FROM YOUR OWN AGENCY BATTLE." }, { status: 403 }); if (Boolean(twoVTwoParticipants(first.manager)) !== Boolean(twoVTwoParticipants(second.manager))) return NextResponse.json({ error: "2V2 BATTLES CAN ONLY BE MATCHED WITH ANOTHER COMPLETE 2V2 PAIR." }, { status: 409 }); if (creatorKey(first.creatorUsername) === creatorKey(second.creatorUsername)) return NextResponse.json({ error: "A CREATOR CANNOT BE MATCHED AGAINST THEMSELVES." }, { status: 409 }); if (incompatible(incompatibilities(currentSettings), first.creatorUsername, second.creatorUsername)) return NextResponse.json({ error: "⚠ INCOMPATIBLE CREATORS — THIS BATTLE CANNOT BE MATCHED." }, { status: 409 }); if (first.weekStart !== second.weekStart || first.day !== second.day || first.size !== second.size || first.powerUps !== second.powerUps || (!close && !isExactOrAnyTimeMatch(first.requestedTime, second.requestedTime)) || (close && (!isFixedEveningTime(first.requestedTime) || !isFixedEveningTime(second.requestedTime) || difference === 0 || difference > 15))) return NextResponse.json({ error: "BATTLES MUST MATCH ON THE SAME DATE, TIME, SIZE AND POWER-UP RULES." }, { status: 409 }); const actualTime = close ? second.requestedTime : resolvedMatchTime(first.requestedTime, second.requestedTime); const updates = [{ id: first.id, opponent_battle_id: second.id, requested_time: actualTime, actual_time: actualTime }, { id: second.id, opponent_battle_id: first.id, requested_time: actualTime, actual_time: actualTime }]; const results = await Promise.all(updates.map(({ id, ...update }) => submissionsSupabase.from("battle_network_battles").update(update).eq("id", id))); const error = results.find((result) => result.error)?.error; if (error) throw new Error(error.message); return NextResponse.json({ ok: true }); }
    const source = await battle(String(body.sourceId));
    if (["claim-battle", "external-claim", "add-manual-opponent"].includes(body.action)) {
      if (!source || source.opponentBattleId) return NextResponse.json({ error: "THAT BATTLE IS NO LONGER AVAILABLE." }, { status: 409 });
      const requestedTime = isAnyTime(source.requestedTime) ? time(body.requestedTime) : source.requestedTime;
      if (isAnyTime(source.requestedTime) && !isFixedEveningTime(requestedTime)) return NextResponse.json({ error: "SELECT AN ACTUAL TIME BETWEEN 6 PM AND MIDNIGHT." }, { status: 409 });
      if (twoVTwoParticipants(source.manager)) return NextResponse.json({ error: "A 2V2 MUST BE CLAIMED WITH TWO OPPONENTS AND THEIR AGENCIES." }, { status: 409 });
      let agencyId = body.action === "claim-battle" ? key(body.agencyId) : key(body.opponentAgencyId || String(body.creatorUsername || "").split("::")[0]);
      const username = body.action === "external-claim" ? clean(String(body.creatorUsername || "").split("::").pop()) : clean(body.creatorUsername);
      const manualAgencyName = clean(body.displayAgencyName);
      const isTypedManualAgency = body.action === "add-manual-opponent" && agencyId === "external-agency";
      // A typed agency name belongs only to this one pairing. It must never
      // create an internal agency or appear in the manager-assignment list.
      if (isTypedManualAgency && manualAgencyName) agencyId = "manual-opponent";
      const manualAgency = isTypedManualAgency && manualAgencyName
        ? submissionsSupabase.from("battle_network_agencies").upsert({ id: agencyId, name: "MANUAL OPPONENT", accent: "#7dd3fc", logo_url: "", external_only: true }, { onConflict: "id" }).select(AGENCY_COLUMNS).single()
        : null;
      const { data: agency, error: agencyError } = manualAgency
        ? await manualAgency
        : await submissionsSupabase.from("battle_network_agencies").select(AGENCY_COLUMNS).eq("id", agencyId).maybeSingle();
      if (agencyError) throw new Error(agencyError.message); if (!agency || !username) return NextResponse.json({ error: "COMPLETE THE OPPONENT DETAILS." }, { status: 409 }); if (rejectBanned(await settings(), source.creatorUsername, username)) return NextResponse.json({ error: "A BANNED CREATOR CANNOT BE ADDED TO A BATTLE." }, { status: 403 }); if (incompatible(incompatibilities(await settings()), source.creatorUsername, username)) return NextResponse.json({ error: "⚠ INCOMPATIBLE CREATORS — THIS BATTLE CANNOT BE CLAIMED." }, { status: 409 }); if (await hasDuplicateBattle({ agency_id: agencyId, week_start: source.weekStart, day: source.day, creator_username: username, requested_time: requestedTime })) return NextResponse.json({ error: "A BATTLE FOR THIS CREATOR AT THIS TIME ALREADY EXISTS." }, { status: 409 });
      const { data: created, error: insertError } = await submissionsSupabase.from("battle_network_battles").insert({ agency_id: agencyId, week_start: source.weekStart, day: source.day, creator_username: username, manager: body.action === "claim-battle" ? clean(body.manager) : body.action === "add-manual-opponent" ? `MANUAL: ${clean(body.displayAgencyName) || "MANUAL AGENCY"}` : agency.name, size: source.size, power_ups: source.powerUps, requested_time: requestedTime, actual_time: requestedTime, opponent_battle_id: source.id }).select(BATTLE_COLUMNS).single();
      if (insertError) throw new Error(insertError.message); const { error: updateError } = await submissionsSupabase.from("battle_network_battles").update({ opponent_battle_id: created.id, requested_time: requestedTime, actual_time: requestedTime }).eq("id", source.id); if (updateError) throw new Error(updateError.message); return NextResponse.json({ battle: toBattle(created), agency: toAgency(agency) });
    }
    return NextResponse.json({ error: "UNKNOWN BATTLE NETWORK ACTION." }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "COULD NOT SAVE BATTLE NETWORK." }, { status: 500 }); }
}
