import { submissionsSupabase } from "@/lib/submissions-supabase";

const AGENCY_COLUMNS = "id,name,accent,logo_url,external_only";
const BATTLE_COLUMNS = "id,agency_id,week_start,day,creator_username,manager,size,power_ups,requested_time,actual_time,opponent_battle_id,created_at,cancelled_at,cancelled_by";

function time(value: string | null) { const stored = String(value || "").slice(0, 5); return stored === "00:00" ? "ANY TIME" : stored; }
function currentWeekStart() {
  const date = new Date();
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date.toISOString().slice(0, 10);
}
function recentWeekStart() {
  const date = new Date();
  date.setDate(date.getDate() - 14);
  return date.toISOString().slice(0, 10);
}

export function toAgency(row: Record<string, unknown>) {
  return { id: String(row.id), name: String(row.name), accent: String(row.accent), logoUrl: String(row.logo_url || ""), externalOnly: Boolean(row.external_only) };
}

export function toBattle(row: Record<string, unknown>) {
  return {
    id: String(row.id), agencyId: String(row.agency_id), weekStart: String(row.week_start || ""), day: String(row.day),
    creatorUsername: String(row.creator_username), manager: String(row.manager), size: String(row.size), powerUps: String(row.power_ups) === "NPU" ? "NPU" : "POWER-UPS ALLOWED",
    requestedTime: time(row.requested_time as string), actualTime: time(row.actual_time as string), opponentBattleId: row.opponent_battle_id ? String(row.opponent_battle_id) : undefined, createdAt: String(row.created_at || ""), cancelledAt: row.cancelled_at ? String(row.cancelled_at) : undefined, cancelledBy: row.cancelled_by ? String(row.cancelled_by) : undefined,
  };
}

export type BattleNetworkInitialData = { agencies: ReturnType<typeof toAgency>[]; battles: ReturnType<typeof toBattle>[]; cardLayout?: unknown; cardTypography?: unknown; managerSettings?: unknown; incompatibilities?: unknown; posterMade?: unknown; error?: string };

export async function getBattleNetworkInitialData(): Promise<BattleNetworkInitialData> {
  const startedAt = performance.now();
  let agenciesResult;
  let battlesResult;
  let settingsResult;
  try {
    [agenciesResult, battlesResult, settingsResult] = await Promise.race([
      Promise.all([
        submissionsSupabase.from("battle_network_agencies").select(AGENCY_COLUMNS).order("name"),
        // Generated load-test rows are deliberately hidden from the live
        // network while the database cleanup completes.
        submissionsSupabase.from("battle_network_battles").select(BATTLE_COLUMNS).gte("week_start", recentWeekStart()).not("creator_username", "ilike", "test-%").order("created_at", { ascending: false }),
        submissionsSupabase.from("poster_templates").select("template_json").eq("name", "battle-network-settings").maybeSingle(),
      ]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
    ]);
  } catch {
    return { agencies: [], battles: [], error: "BATTLE NETWORK DATA COULD NOT LOAD. PLEASE REFRESH." };
  }
  const error = agenciesResult.error || battlesResult.error || settingsResult.error;
  if (error) return { agencies: [], battles: [], error: error.message };
  const settings = (settingsResult.data?.template_json || {}) as { cardLayout?: unknown; cardTypography?: unknown; managerSettings?: unknown; incompatibilities?: unknown; posterMade?: unknown };
  console.info(`[battle-network] initial parallel queries ${Math.round(performance.now() - startedAt)}ms`);
  return { agencies: (agenciesResult.data || []).map(toAgency), battles: (battlesResult.data || []).map(toBattle), cardLayout: settings.cardLayout, cardTypography: settings.cardTypography, managerSettings: settings.managerSettings, incompatibilities: settings.incompatibilities, posterMade: settings.posterMade };
}

export { AGENCY_COLUMNS, BATTLE_COLUMNS };
