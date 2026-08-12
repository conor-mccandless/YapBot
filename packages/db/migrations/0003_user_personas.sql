create table user_persona (
  guild_id varchar(20) not null,
  user_id varchar(20) not null,
  description varchar(500) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);
