create extension if not exists pgcrypto;

create type public.merchant_category as enum ('kasap', 'manav', 'fırın', 'market');
create type public.task_status as enum (
  'parsing',
  'discovering',
  'quoting',
  'presenting',
  'awaiting_selection',
  'awaiting_approval',
  'funding_escrow',
  'monitoring',
  'completed',
  'refunded',
  'cancelled',
  'error'
);
create type public.payment_status as enum ('pending', 'settled', 'failed');
create type public.order_status as enum (
  'quoted',
  'funded',
  'preparing',
  'ready',
  'completed',
  'refunded',
  'disputed',
  'cancelled'
);

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 1 and 120),
  category public.merchant_category not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  quality_score numeric(3, 1) not null check (quality_score between 0 and 10),
  can_negotiate boolean not null default false,
  can_reserve boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  sku text not null,
  name text not null,
  price_micro_usdc bigint not null check (price_micro_usdc >= 0),
  stock_milli bigint not null check (stock_milli >= 0),
  unit text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, sku)
);

create index products_sku_active_lookup_idx on public.products (sku, merchant_id)
  where stock_milli > 0;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_wallet text not null check (user_wallet ~ '^0x[0-9a-fA-F]{40}$'),
  prompt text not null check (char_length(prompt) between 1 and 500),
  status public.task_status not null default 'parsing',
  user_lat double precision not null check (user_lat between -90 and 90),
  user_lng double precision not null check (user_lng between -180 and 180),
  skus jsonb,
  options jsonb,
  selected_option jsonb,
  research_cap_micro_usdc bigint not null default 10000 check (research_cap_micro_usdc >= 0),
  research_reserved_micro_usdc bigint not null default 0 check (research_reserved_micro_usdc >= 0),
  research_spent_micro_usdc bigint not null default 0 check (research_spent_micro_usdc >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (research_reserved_micro_usdc + research_spent_micro_usdc <= research_cap_micro_usdc)
);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  sequence bigint not null,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (task_id, sequence)
);

create index task_events_replay_idx on public.task_events (task_id, sequence);

create table public.budget_reservations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id),
  endpoint text not null,
  amount_micro_usdc bigint not null check (amount_micro_usdc > 0 and amount_micro_usdc <= 2000),
  actual_amount_micro_usdc bigint check (actual_amount_micro_usdc >= 0),
  status public.payment_status not null default 'pending',
  idempotency_key text not null unique,
  payment_id text unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index budget_reservations_task_idx on public.budget_reservations (task_id, status);

create table public.quotes (
  id uuid primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id),
  items jsonb not null,
  items_hash text not null check (items_hash ~ '^0x[0-9a-fA-F]{64}$'),
  total_micro_usdc bigint not null check (total_micro_usdc >= 0),
  signature text not null check (signature ~ '^0x[0-9a-fA-F]+$'),
  recovered_signer text not null check (recovered_signer ~ '^0x[0-9a-fA-F]{40}$'),
  valid_until timestamptz not null,
  nonce text not null unique check (nonce ~ '^0x[0-9a-fA-F]{64}$'),
  is_used boolean not null default false,
  created_at timestamptz not null default now()
);

create index quotes_task_valid_idx on public.quotes (task_id, valid_until)
  where is_used = false;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id),
  buyer_wallet text not null check (buyer_wallet ~ '^0x[0-9a-fA-F]{40}$'),
  merchant_wallet text not null check (merchant_wallet ~ '^0x[0-9a-fA-F]{40}$'),
  items jsonb not null,
  total_micro_usdc bigint not null check (total_micro_usdc > 0),
  status public.order_status not null default 'quoted',
  delivery_code_hash text not null check (delivery_code_hash ~ '^0x[0-9a-fA-F]{64}$'),
  pickup_deadline timestamptz not null,
  escrow_tx_hash text check (escrow_tx_hash is null or escrow_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  release_tx_hash text check (release_tx_hash is null or release_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_task_idx on public.orders (task_id);
create index orders_merchant_status_idx on public.orders (merchant_id, status);

create or replace function public.reserve_research_budget(
  p_task_id uuid,
  p_merchant_id uuid,
  p_endpoint text,
  p_amount_micro_usdc bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_reservation_id uuid;
begin
  if p_amount_micro_usdc <= 0 or p_amount_micro_usdc > 2000 then
    raise exception 'invalid research payment amount';
  end if;

  update public.tasks
  set research_reserved_micro_usdc = research_reserved_micro_usdc + p_amount_micro_usdc,
      updated_at = now()
  where id = p_task_id
    and research_spent_micro_usdc + research_reserved_micro_usdc + p_amount_micro_usdc
      <= research_cap_micro_usdc
  returning id into v_task_id;

  if v_task_id is null then
    raise exception 'research budget exceeded';
  end if;

  insert into public.budget_reservations (
    task_id,
    merchant_id,
    endpoint,
    amount_micro_usdc,
    idempotency_key
  ) values (
    p_task_id,
    p_merchant_id,
    p_endpoint,
    p_amount_micro_usdc,
    p_idempotency_key
  )
  returning id into v_reservation_id;

  return v_reservation_id;
end;
$$;

create or replace function public.settle_research_budget(
  p_reservation_id uuid,
  p_actual_amount_micro_usdc bigint,
  p_payment_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_reserved_amount bigint;
begin
  update public.budget_reservations
  set status = 'settled',
      actual_amount_micro_usdc = p_actual_amount_micro_usdc,
      payment_id = p_payment_id,
      settled_at = now()
  where id = p_reservation_id and status = 'pending'
  returning task_id, amount_micro_usdc into v_task_id, v_reserved_amount;

  if v_task_id is null then
    raise exception 'reservation is not pending';
  end if;
  if p_actual_amount_micro_usdc <> v_reserved_amount then
    raise exception 'settled amount does not match reservation';
  end if;

  update public.tasks
  set research_reserved_micro_usdc = research_reserved_micro_usdc - v_reserved_amount,
      research_spent_micro_usdc = research_spent_micro_usdc + p_actual_amount_micro_usdc,
      updated_at = now()
  where id = v_task_id;
end;
$$;

create or replace function public.fail_research_budget(
  p_reservation_id uuid,
  p_failure_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_reserved_amount bigint;
begin
  update public.budget_reservations
  set status = 'failed', failure_reason = left(p_failure_reason, 500)
  where id = p_reservation_id and status = 'pending'
  returning task_id, amount_micro_usdc into v_task_id, v_reserved_amount;

  if v_task_id is null then
    raise exception 'reservation is not pending';
  end if;

  update public.tasks
  set research_reserved_micro_usdc = research_reserved_micro_usdc - v_reserved_amount,
      updated_at = now()
  where id = v_task_id;
end;
$$;

revoke all on function public.reserve_research_budget(uuid, uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.settle_research_budget(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.fail_research_budget(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_research_budget(uuid, uuid, text, bigint, text) to service_role;
grant execute on function public.settle_research_budget(uuid, bigint, text) to service_role;
grant execute on function public.fail_research_budget(uuid, text) to service_role;

alter table public.merchants enable row level security;
alter table public.products enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.budget_reservations enable row level security;
alter table public.quotes enable row level security;
alter table public.orders enable row level security;

revoke all on table public.merchants from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.task_events from anon, authenticated;
revoke all on table public.budget_reservations from anon, authenticated;
revoke all on table public.quotes from anon, authenticated;
revoke all on table public.orders from anon, authenticated;

grant all on table public.merchants to service_role;
grant all on table public.products to service_role;
grant all on table public.tasks to service_role;
grant all on table public.task_events to service_role;
grant all on table public.budget_reservations to service_role;
grant all on table public.quotes to service_role;
grant all on table public.orders to service_role;

alter publication supabase_realtime add table public.orders, public.task_events;
