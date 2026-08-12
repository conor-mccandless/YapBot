create table guild_channel (
  guild_id varchar(20) not null references guild_config(guild_id) on delete cascade,
  channel_id varchar(20) not null,
  created_at timestamptz not null default now(),
  primary key (guild_id, channel_id)
);

insert into guild_channel (guild_id, channel_id)
select guild_id, channel_id
from guild_config
where channel_id is not null
on conflict do nothing;
