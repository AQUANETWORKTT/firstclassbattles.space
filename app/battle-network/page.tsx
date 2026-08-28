import BattleNetworkClient from "./BattleNetworkClient";
export const dynamic = "force-dynamic";

export default function BattleNetworkPage() {
  return <BattleNetworkClient initialData={{ agencies: [], battles: [] }} initialAgencyId="" />;
}
