create table guild_config (
  guild_id varchar(20) primary key,
  enabled boolean not null default false,
  setup_complete boolean not null default false,
  monitored_role_id varchar(20),
  channel_id varchar(20),
  threshold integer not null default 15,
  window_seconds integer not null default 300,
  cooldown_seconds integer not null default 600,
  ping_target boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guild_config_threshold_check check (threshold between 3 and 100),
  constraint guild_config_window_check check (window_seconds between 30 and 3600),
  constraint guild_config_cooldown_check check (cooldown_seconds between 0 and 86400),
  constraint guild_config_setup_check check (
    not setup_complete or (channel_id is not null and monitored_role_id is not null)
  ),
  constraint guild_config_enabled_check check (not enabled or setup_complete)
);

create table trigger_event (
  id integer generated always as identity primary key,
  guild_id varchar(20) not null,
  user_id varchar(20) not null,
  channel_id varchar(20) not null,
  message_count integer not null,
  outcome varchar(32) not null,
  latency_ms integer not null,
  created_at timestamptz not null default now()
);

create index trigger_event_guild_created_idx
  on trigger_event (guild_id, created_at);

create table admin_audit_event (
  id integer generated always as identity primary key,
  guild_id varchar(20) not null,
  actor_user_id varchar(20) not null,
  command_name varchar(64) not null,
  change jsonb not null,
  created_at timestamptz not null default now()
);

create index admin_audit_event_guild_created_idx
  on admin_audit_event (guild_id, created_at);
