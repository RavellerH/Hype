-- Daily Brief / Weekly Research schema
-- Mirrors the permissive anon-key RLS already used by kb_wiki / kb_trades in this
-- single-user dashboard: anon key gets full read/write, no auth flow.

create table if not exists daily_briefs (
  id               text primary key,
  date             date not null,
  headline         text,
  onchain_summary  text,
  risks            jsonb default '[]'::jsonb,
  opportunities    jsonb default '[]'::jsonb,
  news_summary     text,
  takeaway         text,
  raw_context      text,
  created_at       bigint
);
create index if not exists daily_briefs_date_idx on daily_briefs (date desc);

alter table daily_briefs enable row level security;
create policy "anon read daily_briefs"  on daily_briefs for select using (true);
create policy "anon write daily_briefs" on daily_briefs for insert with check (true);
create policy "anon update daily_briefs" on daily_briefs for update using (true);

create table if not exists weekly_research (
  id                 text primary key,
  week_start         date,
  week_end           date,
  title              text,
  summary            text,
  market_structure   text,
  onchain_trends     text,
  risks              jsonb default '[]'::jsonb,
  opportunities      jsonb default '[]'::jsonb,
  outlook            text,
  created_at         bigint
);
create index if not exists weekly_research_week_idx on weekly_research (week_start desc);

alter table weekly_research enable row level security;
create policy "anon read weekly_research"  on weekly_research for select using (true);
create policy "anon write weekly_research" on weekly_research for insert with check (true);
create policy "anon update weekly_research" on weekly_research for update using (true);
