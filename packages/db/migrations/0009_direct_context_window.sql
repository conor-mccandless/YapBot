alter table guild_config
  add column direct_context_minutes integer not null default 30,
  add constraint guild_config_direct_context_minutes_check
    check (direct_context_minutes between 1 and 1440);
