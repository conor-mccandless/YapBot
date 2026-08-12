alter table guild_config
  add column monitored_user_id varchar(20),
  add column target_type varchar(16);

update guild_config
set target_type = 'role'
where monitored_role_id is not null;

alter table guild_config
  drop constraint guild_config_setup_check;

alter table guild_config
  add constraint guild_config_target_type_check check (
    target_type is null or target_type in ('role', 'user')
  ),
  add constraint guild_config_setup_check check (
    not setup_complete or (
      channel_id is not null and (
        (target_type = 'role' and monitored_role_id is not null and monitored_user_id is null)
        or
        (target_type = 'user' and monitored_user_id is not null and monitored_role_id is null)
      )
    )
  );

create table llm_daily_usage (
  guild_id varchar(20) not null,
  usage_date date not null,
  generation_count integer not null default 0,
  primary key (guild_id, usage_date)
);
