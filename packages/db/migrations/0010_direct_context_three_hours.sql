alter table guild_config
  alter column direct_context_minutes set default 180;

-- Move guilds still using the previous default to three hours. Other configured
-- windows are preserved; this runs only once through the migration ledger.
update guild_config
  set direct_context_minutes = 180
  where direct_context_minutes = 30;
