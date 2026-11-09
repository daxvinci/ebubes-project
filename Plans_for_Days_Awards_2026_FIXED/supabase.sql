-- Award Night 2026 database setup for Supabase
create extension if not exists pgcrypto;

create table if not exists event_settings (
  id integer primary key default 1,
  event_name text not null default 'Plans for Days x The Boys Awards 2026',
  opening_at timestamptz,
  closing_at timestamptz,
  admin_password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text not null,
  photo text default '',
  created_at timestamptz not null default now()
);

create table if not exists awards (
  id uuid primary key default gen_random_uuid(),
  sort_order integer not null default 0,
  category text not null check (category in ('Personality','Wild / Funny','Inspirational')),
  title text not null,
  type text not null default 'person' check (type in ('person','duo')),
  created_at timestamptz not null default now()
);

create table if not exists voters (
  id uuid primary key default gen_random_uuid(),
  person_id uuid unique not null references people(id) on delete cascade,
  password_hash text not null,
  submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  voter_id uuid not null references voters(id) on delete cascade,
  award_id uuid not null references awards(id) on delete cascade,
  answer text not null,
  updated_at timestamptz not null default now(),
  unique(voter_id, award_id)
);

alter table event_settings enable row level security;
alter table people enable row level security;
alter table awards enable row level security;
alter table voters enable row level security;
alter table votes enable row level security;

-- The app talks to Supabase through the Netlify function using the service key.
-- No public browser access policies are needed.
insert into event_settings(event_name,admin_password_hash)
select 'Plans for Days x The Boys Awards 2026', encode(digest('EbubeAdmin123','sha256'),'hex')
where not exists(select 1 from event_settings);

insert into people(name,color) values
('Chioma','#F3EEE6'),('Jonathan','#F5D447'),('Chinekwu','#EE8FBA'),
('Ebube','#7C2637'),('Odinaka','#4F9B61'),('Emma','#2FAEAA'),
('Josh','#4B7DDD'),('Siraj','#8964C7'),('Emeka','#EE9348')
on conflict(name) do nothing;

insert into awards(sort_order,category,title,type) values
(1,'Personality','Most Dramatic','person'),
(2,'Wild / Funny','Most Likely to Start an Argument','person'),
(3,'Inspirational','Most Likely to Succeed','person'),
(4,'Wild / Funny','Duo Most Likely to Get Into a Fight','duo')
on conflict do nothing;
