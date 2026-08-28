create table if not exists public.battle_network_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_agency_id text,
  battle_id uuid,
  opponent_battle_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists battle_network_audit_log_created_at_idx
  on public.battle_network_audit_log (created_at desc);

create index if not exists battle_network_audit_log_battle_id_idx
  on public.battle_network_audit_log (battle_id);
