alter table guild_config
  add column direct_responses_enabled boolean not null default false,
  add column direct_cooldown_seconds integer not null default 30,
  add constraint guild_config_direct_cooldown_check
    check (direct_cooldown_seconds between 0 and 3600);

create table direct_llm_daily_usage (
  guild_id varchar(20) not null,
  usage_date date not null,
  generation_count integer not null default 0 check (generation_count >= 0),
  primary key (guild_id, usage_date)
);
