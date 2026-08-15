create table guild_monitored_user (
  guild_id varchar(20) not null references guild_config(guild_id) on delete cascade,
  user_id varchar(20) not null,
  created_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

insert into guild_monitored_user (guild_id, user_id)
select guild_id, monitored_user_id
from guild_config
where target_type = 'user' and monitored_user_id is not null
on conflict do nothing;
