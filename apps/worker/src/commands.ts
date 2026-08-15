import {
  MAX_GUILD_CHANNELS,
  MAX_GUILD_MONITORED_ROLES,
  MAX_GUILD_MONITORED_USERS,
  type YapBotRepository,
} from "@yapbot/db";
import type { RollingTriggerDetector } from "@yapbot/domain";
import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Guild,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

const ADMIN_SUBCOMMANDS = new Set([
  "setup",
  "channel-add",
  "channel-remove",
  "user-add",
  "user-remove",
  "role-add",
  "role-remove",
  "configure",
  "enable",
  "disable",
  "persona-set",
  "persona-show",
  "persona-clear",
]);

export interface CommandContext {
  allowedGuildIds: ReadonlySet<string>;
  detector: RollingTriggerDetector;
  imageContextStore?: { clearGuild(guildId: string): void };
  messageContextStore?: { clearGuild(guildId: string): void };
  repository: YapBotRepository;
}

export async function handleYapCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (
    !interaction.inCachedGuild() ||
    !context.allowedGuildIds.has(interaction.guildId)
  ) {
    await interaction.editReply("YapBot is not enabled for this guild.");
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (ADMIN_SUBCOMMANDS.has(subcommand) && !canManageGuild(interaction)) {
    await interaction.editReply(
      "You must own the guild or have Manage Server to use this command.",
    );
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(interaction, context);
      break;
    case "channel-add":
      await handleChannelAdd(interaction, context);
      break;
    case "channel-remove":
      await handleChannelRemove(interaction, context);
      break;
    case "channels":
      await handleChannels(interaction, context);
      break;
    case "user-add":
      await handleUserAdd(interaction, context);
      break;
    case "user-remove":
      await handleUserRemove(interaction, context);
      break;
    case "users":
      await handleUsers(interaction, context);
      break;
    case "role-add":
      await handleRoleAdd(interaction, context);
      break;
    case "role-remove":
      await handleRoleRemove(interaction, context);
      break;
    case "roles":
      await handleRoles(interaction, context);
      break;
    case "configure":
      await handleConfigure(interaction, context);
      break;
    case "enable":
      await handleEnable(interaction, context);
      break;
    case "disable":
      await handleDisable(interaction, context);
      break;
    case "persona-set":
      await handlePersonaSet(interaction, context);
      break;
    case "persona-show":
      await handlePersonaShow(interaction, context);
      break;
    case "persona-clear":
      await handlePersonaClear(interaction, context);
      break;
    case "status":
      await handleStatus(interaction, context);
      break;
    default:
      await interaction.editReply("Unknown YapBot command.");
  }
}

async function handleChannelAdd(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  if (channel.type !== ChannelType.GuildText) {
    await interaction.editReply("Choose a standard guild text channel.");
    return;
  }

  const diagnostic = diagnoseChannelPermissions(interaction.guild, channel.id);
  if (diagnostic) {
    await interaction.editReply(diagnostic);
    return;
  }

  const result = await context.repository.addGuildChannel({
    actorUserId: interaction.user.id,
    channelId: channel.id,
    guildId: interaction.guildId,
  });
  if (result === "not_configured") {
    await interaction.editReply("Run `/yap setup` before adding channels.");
    return;
  }
  if (result === "already_exists") {
    await interaction.editReply(`${channel.toString()} is already monitored.`);
    return;
  }
  if (result === "limit_reached") {
    await interaction.editReply(
      `YapBot supports up to ${MAX_GUILD_CHANNELS} monitored text channels per server.`,
    );
    return;
  }

  clearRuntimeState(context, interaction.guildId);
  await interaction.editReply(
    `${channel.toString()} was added. YapBot will monitor it whenever monitoring is enabled.`,
  );
}

async function handleChannelRemove(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  if (channel.type !== ChannelType.GuildText) {
    await interaction.editReply("Choose a standard guild text channel.");
    return;
  }

  const result = await context.repository.removeGuildChannel({
    actorUserId: interaction.user.id,
    channelId: channel.id,
    guildId: interaction.guildId,
  });
  if (result === "not_configured") {
    await interaction.editReply("Run `/yap setup` before removing channels.");
    return;
  }
  if (result === "not_found") {
    await interaction.editReply(`${channel.toString()} is not monitored.`);
    return;
  }
  if (result === "last_channel") {
    await interaction.editReply(
      "YapBot must retain at least one text channel. Add another channel first, or use `/yap disable`.",
    );
    return;
  }

  clearRuntimeState(context, interaction.guildId);
  await interaction.editReply(`${channel.toString()} is no longer monitored.`);
}

async function handleChannels(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const config = await context.repository.getGuildConfig(interaction.guildId);
  if (!config?.setupComplete) {
    await interaction.editReply(
      "YapBot is not configured. An administrator can run `/yap setup`.",
    );
    return;
  }

  const channelIds = await getConfiguredChannelIds(
    context.repository,
    interaction.guildId,
    config.channelId,
  );
  await interaction.editReply(
    `**Monitored text channels (${channelIds.length}/${MAX_GUILD_CHANNELS}):**\n${channelIds.map((channelId) => `<#${channelId}>`).join("\n")}`,
  );
}

async function handleUserAdd(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  if (user.bot) {
    await interaction.editReply("Choose a human user, not a bot account.");
    return;
  }

  const result = await context.repository.addGuildMonitoredUser({
    actorUserId: interaction.user.id,
    guildId: interaction.guildId,
    userId: user.id,
  });
  if (result === "not_configured") {
    await interaction.editReply(
      "Run `/yap setup` with an initial user before adding more users.",
    );
    return;
  }
  if (result === "already_exists") {
    await interaction.editReply(`${user.toString()} is already monitored.`);
    return;
  }
  if (result === "limit_reached") {
    await interaction.editReply(
      `YapBot supports up to ${MAX_GUILD_MONITORED_USERS} individually monitored users per server.`,
    );
    return;
  }

  clearRuntimeState(context, interaction.guildId);
  await interaction.editReply(
    `${user.toString()} was added to the monitored user list.`,
  );
}

async function handleUserRemove(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const result = await context.repository.removeGuildMonitoredUser({
    actorUserId: interaction.user.id,
    guildId: interaction.guildId,
    userId: user.id,
  });
  if (result === "not_configured") {
    await interaction.editReply(
      "Run `/yap setup` with an initial user before removing users.",
    );
    return;
  }
  if (result === "not_found") {
    await interaction.editReply(`${user.toString()} is not monitored.`);
    return;
  }
  if (result === "last_target") {
    await interaction.editReply(
      "YapBot must retain at least one monitored user or role. Add another target first, or use `/yap disable`.",
    );
    return;
  }

  clearRuntimeState(context, interaction.guildId);
  await interaction.editReply(
    `${user.toString()} is no longer individually monitored.`,
  );
}

async function handleUsers(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const config = await context.repository.getGuildConfig(interaction.guildId);
  if (!config?.setupComplete) {
    await interaction.editReply(
      "YapBot is not configured. An administrator can run `/yap setup`.",
    );
    return;
  }
  const userIds = await getConfiguredMonitoredUserIds(
    context.repository,
    interaction.guildId,
    config.monitoredUserId,
  );
  await interaction.editReply(
    `**Monitored users (${userIds.length}/${MAX_GUILD_MONITORED_USERS}):**\n${userIds.map((userId) => `<@${userId}>`).join("\n")}`,
  );
}

async function handleRoleAdd(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const role = interaction.options.getRole("role", true);
  if (role.id === interaction.guildId || role.managed) {
    await interaction.editReply(
      "Choose a normal guild role, not @everyone or a managed role.",
    );
    return;
  }

  const result = await context.repository.addGuildMonitoredRole({
    actorUserId: interaction.user.id,
    guildId: interaction.guildId,
    roleId: role.id,
  });
  if (result === "not_configured") {
    await interaction.editReply(
      "Run `/yap setup` with an initial user or role before adding more roles.",
    );
    return;
  }
  if (result === "already_exists") {
    await interaction.editReply(`${role.toString()} is already monitored.`);
    return;
  }
  if (result === "limit_reached") {
    await interaction.editReply(
      `YapBot supports up to ${MAX_GUILD_MONITORED_ROLES} monitored roles per server.`,
    );
    return;
  }

  clearRuntimeState(context, interaction.guildId);
  await interaction.editReply(
    `${role.toString()} was added to the monitored role list.`,
  );
}

async function handleRoleRemove(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const role = interaction.options.getRole("role", true);
  const result = await context.repository.removeGuildMonitoredRole({
    actorUserId: interaction.user.id,
    guildId: interaction.guildId,
    roleId: role.id,
  });
  if (result === "not_configured") {
    await interaction.editReply(
      "Run `/yap setup` with an initial user or role before removing roles.",
    );
    return;
  }
  if (result === "not_found") {
    await interaction.editReply(`${role.toString()} is not monitored.`);
    return;
  }
  if (result === "last_target") {
    await interaction.editReply(
      "YapBot must retain at least one monitored user or role. Add another target first, or use `/yap disable`.",
    );
    return;
  }

  clearRuntimeState(context, interaction.guildId);
  await interaction.editReply(`${role.toString()} is no longer monitored.`);
}

async function handleRoles(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const config = await context.repository.getGuildConfig(interaction.guildId);
  if (!config?.setupComplete) {
    await interaction.editReply(
      "YapBot is not configured. An administrator can run `/yap setup`.",
    );
    return;
  }

  const roleIds = await getConfiguredMonitoredRoleIds(
    context.repository,
    interaction.guildId,
    config.monitoredRoleId,
  );
  await interaction.editReply(
    `**Monitored roles (${roleIds.length}/${MAX_GUILD_MONITORED_ROLES}):**\n${roleIds.map((roleId) => `<@&${roleId}>`).join("\n")}`,
  );
}

async function handlePersonaSet(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const description = interaction.options.getString("description", true).trim();

  if (user.bot) {
    await interaction.editReply("Choose a human user, not a bot account.");
    return;
  }
  if (description.length === 0 || description.length > 2_000) {
    await interaction.editReply(
      "Persona descriptions must contain 1-2,000 non-whitespace characters.",
    );
    return;
  }

  await context.repository.setUserPersona({
    actorUserId: interaction.user.id,
    description,
    guildId: interaction.guildId,
    userId: user.id,
  });
  await interaction.editReply(
    `Persona saved for ${user.toString()}. It will be added as request-time context when that user triggers YapBot.`,
  );
}

async function handlePersonaShow(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const persona = await context.repository.getUserPersona(
    interaction.guildId,
    user.id,
  );

  if (!persona) {
    await interaction.editReply(
      `No persona is configured for ${user.toString()}.`,
    );
    return;
  }

  const safeDescription = persona.description.replaceAll("@", "@\u200b");
  await interaction.editReply({
    allowedMentions: { parse: [] },
    content: `**Persona for ${user.toString()}:**\n${safeDescription}`,
  });
}

async function handlePersonaClear(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const deleted = await context.repository.deleteUserPersona({
    actorUserId: interaction.user.id,
    guildId: interaction.guildId,
    userId: user.id,
  });

  await interaction.editReply(
    deleted
      ? `Persona removed for ${user.toString()}.`
      : `No persona was configured for ${user.toString()}.`,
  );
}

function canManageGuild(
  interaction: ChatInputCommandInteraction<"cached">,
): boolean {
  return (
    interaction.guild.ownerId === interaction.user.id ||
    interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
  );
}

async function handleSetup(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  const role = interaction.options.getRole("role");
  const user = interaction.options.getUser("user");

  if ((role === null) === (user === null)) {
    await interaction.editReply("Choose exactly one target: a role or a user.");
    return;
  }

  if (role && (role.id === interaction.guildId || role.managed)) {
    await interaction.editReply(
      "Choose a normal guild role, not @everyone or a managed role.",
    );
    return;
  }
  if (user?.bot) {
    await interaction.editReply("Choose a human user, not a bot account.");
    return;
  }
  if (channel.type !== ChannelType.GuildText) {
    await interaction.editReply("Choose a standard guild text channel.");
    return;
  }

  const setupBase = {
    actorUserId: interaction.user.id,
    channelId: channel.id,
    guildId: interaction.guildId,
  };
  if (role) {
    await context.repository.setupGuild({
      ...setupBase,
      monitoredRoleId: role.id,
      targetType: "role",
    });
  } else if (user) {
    await context.repository.setupGuild({
      ...setupBase,
      monitoredUserId: user.id,
      targetType: "user",
    });
  }
  clearRuntimeState(context, interaction.guildId);
  const target = role?.toString() ?? user?.toString() ?? "the selected target";
  await interaction.editReply(
    `Setup saved for ${target} in ${channel.toString()}. Monitoring remains disabled until \`/yap enable\`.`,
  );
}

async function handleConfigure(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const threshold = interaction.options.getInteger("threshold");
  const windowSeconds = interaction.options.getInteger("window-seconds");
  const cooldownSeconds = interaction.options.getInteger("cooldown-seconds");
  const pingTarget = interaction.options.getBoolean("ping-target");
  const update = {
    ...(threshold === null ? {} : { threshold }),
    ...(windowSeconds === null ? {} : { windowSeconds }),
    ...(cooldownSeconds === null ? {} : { cooldownSeconds }),
    ...(pingTarget === null ? {} : { pingTarget }),
  };

  if (Object.keys(update).length === 0) {
    await interaction.editReply("Provide at least one setting to update.");
    return;
  }

  const updated = await context.repository.configureGuild({
    actorUserId: interaction.user.id,
    guildId: interaction.guildId,
    update,
  });
  if (!updated) {
    await interaction.editReply("Run `/yap setup` before configuring YapBot.");
    return;
  }

  clearRuntimeState(context, interaction.guildId);
  await interaction.editReply(
    "YapBot configuration updated. Runtime counters were reset.",
  );
}

async function handleEnable(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const config = await context.repository.getGuildConfig(interaction.guildId);
  if (!config?.setupComplete || !config.channelId) {
    await interaction.editReply("Run `/yap setup` before enabling YapBot.");
    return;
  }

  const [monitoredUserIds, monitoredRoleIds] = await Promise.all([
    getConfiguredMonitoredUserIds(
      context.repository,
      interaction.guildId,
      config.monitoredUserId,
    ),
    getConfiguredMonitoredRoleIds(
      context.repository,
      interaction.guildId,
      config.monitoredRoleId,
    ),
  ]);
  const targetReady = monitoredUserIds.length + monitoredRoleIds.length > 0;
  if (!targetReady) {
    await interaction.editReply("Run `/yap setup` before enabling YapBot.");
    return;
  }

  const channelIds = await getConfiguredChannelIds(
    context.repository,
    interaction.guildId,
    config.channelId,
  );
  if (channelIds.length === 0) {
    await interaction.editReply("Run `/yap setup` before enabling YapBot.");
    return;
  }
  const channelDiagnostic = channelIds
    .map((channelId) => ({
      channelId,
      diagnostic: diagnoseChannelPermissions(interaction.guild, channelId),
    }))
    .find((result) => result.diagnostic);
  if (channelDiagnostic?.diagnostic) {
    await interaction.editReply(
      `<#${channelDiagnostic.channelId}>: ${channelDiagnostic.diagnostic}`,
    );
    return;
  }

  await context.repository.setGuildEnabled({
    actorUserId: interaction.user.id,
    enabled: true,
    guildId: interaction.guildId,
  });
  clearRuntimeState(context, interaction.guildId);
  await interaction.editReply("YapBot monitoring is enabled.");
}

async function handleDisable(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const updated = await context.repository.setGuildEnabled({
    actorUserId: interaction.user.id,
    enabled: false,
    guildId: interaction.guildId,
  });
  clearRuntimeState(context, interaction.guildId);
  await interaction.editReply(
    updated
      ? "YapBot monitoring is disabled."
      : "YapBot has not been set up in this guild.",
  );
}

function clearRuntimeState(context: CommandContext, guildId: string): void {
  context.detector.clearGuild(guildId);
  context.imageContextStore?.clearGuild(guildId);
  context.messageContextStore?.clearGuild(guildId);
}

async function handleStatus(
  interaction: ChatInputCommandInteraction<"cached">,
  context: CommandContext,
): Promise<void> {
  const config = await context.repository.getGuildConfig(interaction.guildId);
  if (!config) {
    await interaction.editReply(
      "YapBot is not configured. An administrator can run `/yap setup`.",
    );
    return;
  }

  const triggersToday = await context.repository.countTriggersToday(
    interaction.guildId,
  );
  const channelIds = await getConfiguredChannelIds(
    context.repository,
    interaction.guildId,
    config.channelId,
  );
  const channelDiagnostics = channelIds
    .map((channelId) => ({
      channelId,
      diagnostic: diagnoseChannelPermissions(interaction.guild, channelId),
    }))
    .filter(
      (result): result is { channelId: string; diagnostic: string } =>
        result.diagnostic !== undefined,
    );
  const [monitoredUserIds, monitoredRoleIds] = await Promise.all([
    getConfiguredMonitoredUserIds(
      context.repository,
      interaction.guildId,
      config.monitoredUserId,
    ),
    getConfiguredMonitoredRoleIds(
      context.repository,
      interaction.guildId,
      config.monitoredRoleId,
    ),
  ]);
  await interaction.editReply(
    [
      `**Enabled:** ${config.enabled ? "yes" : "no"}`,
      `**Monitored users (${monitoredUserIds.length}):** ${monitoredUserIds.length > 0 ? monitoredUserIds.map((userId) => `<@${userId}>`).join(", ") : "none"}`,
      `**Monitored roles (${monitoredRoleIds.length}):** ${monitoredRoleIds.length > 0 ? monitoredRoleIds.map((roleId) => `<@&${roleId}>`).join(", ") : "none"}`,
      `**Channels (${channelIds.length}):** ${channelIds.length > 0 ? channelIds.map((channelId) => `<#${channelId}>`).join(", ") : "not configured"}`,
      `**Threshold:** ${config.threshold} messages / ${config.windowSeconds} seconds`,
      `**Cooldown:** ${config.cooldownSeconds} seconds`,
      `**Ping target:** ${config.pingTarget ? "yes" : "no"}`,
      `**Triggers today (UTC):** ${triggersToday}`,
      `**Permissions:** ${channelDiagnostics.length === 0 ? "ready" : channelDiagnostics.map((result) => `<#${result.channelId}>: ${result.diagnostic}`).join("; ")}`,
    ].join("\n"),
  );
}

async function getConfiguredChannelIds(
  repository: YapBotRepository,
  guildId: string,
  legacyChannelId: string | null,
): Promise<string[]> {
  const channelIds = await repository.getGuildChannelIds(guildId);
  if (channelIds.length > 0) {
    return channelIds;
  }

  return legacyChannelId ? [legacyChannelId] : [];
}

async function getConfiguredMonitoredUserIds(
  repository: YapBotRepository,
  guildId: string,
  legacyUserId: string | null,
): Promise<string[]> {
  const userIds = await repository.getGuildMonitoredUserIds(guildId);
  if (userIds.length > 0) {
    return userIds;
  }

  return legacyUserId ? [legacyUserId] : [];
}

async function getConfiguredMonitoredRoleIds(
  repository: YapBotRepository,
  guildId: string,
  legacyRoleId: string | null,
): Promise<string[]> {
  const roleIds = await repository.getGuildMonitoredRoleIds(guildId);
  if (roleIds.length > 0) {
    return roleIds;
  }

  return legacyRoleId ? [legacyRoleId] : [];
}

function diagnoseChannelPermissions(
  guild: Guild,
  channelId: string,
): string | undefined {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return "Configured text channel is missing or inaccessible.";
  }

  const self = guild.members.me;
  const permissions = self ? channel.permissionsFor(self) : undefined;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    return "YapBot cannot view the configured channel.";
  }
  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    return "YapBot cannot send messages in the configured channel.";
  }
  if (!permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
    return "YapBot cannot read message history in the configured channel.";
  }

  return undefined;
}
