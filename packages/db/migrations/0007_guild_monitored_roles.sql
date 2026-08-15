create table guild_monitored_role (
  guild_id varchar(20) not null references guild_config(guild_id) on delete cascade,
  role_id varchar(20) not null,
  created_at timestamptz not null default now(),
  primary key (guild_id, role_id)
);

insert into guild_monitored_role (guild_id, role_id)
select guild_id, monitored_role_id
from guild_config
where target_type = 'role' and monitored_role_id is not null
on conflict do nothing;
