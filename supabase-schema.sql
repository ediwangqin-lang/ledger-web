create table if not exists public.expenses (
  id uuid primary key,
  group_id text not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null,
  payer text not null default '小王',
  note text,
  date date not null,
  member_name text,
  created_at timestamptz not null default now()
);

alter table public.expenses
  add column if not exists payer text not null default '小王';

create index if not exists expenses_group_date_idx
  on public.expenses (group_id, date desc);

alter table public.expenses enable row level security;

drop policy if exists "anon shared ledger access" on public.expenses;
create policy "anon shared ledger access"
  on public.expenses
  for all
  using (true)
  with check (true);
