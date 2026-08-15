import {
  ChannelType,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const REQUIRED_GATEWAY_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
] as const;

export const MESSAGE_CONTENT_GATEWAY_INTENT = GatewayIntentBits.MessageContent;

export const REQUIRED_BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
] as const;

export const YAP_COMMAND = new SlashCommandBuilder()
  .setName("yap")
  .setDescription("Configure and inspect YapBot")
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("setup")
      .setDescription("Choose an initial user-list member or role and channel")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Initial text channel YapBot watches")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Role whose messages YapBot counts"),
      )
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("Specific user whose messages YapBot counts"),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("channel-add")
      .setDescription("Add a text channel to YapBot monitoring")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Additional text channel YapBot watches")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("channel-remove")
      .setDescription("Remove a text channel from YapBot monitoring")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Monitored text channel to remove")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("channels")
      .setDescription("List the text channels YapBot monitors"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("user-add")
      .setDescription("Add a user to YapBot's monitored user list")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("Human user whose messages YapBot should count")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("user-remove")
      .setDescription("Remove a user from YapBot's monitored user list")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("Monitored user to remove")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("users")
      .setDescription("List individually monitored users"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("role-add")
      .setDescription("Add a role to YapBot's monitored role list")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Role whose members YapBot should count")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("role-remove")
      .setDescription("Remove a role from YapBot's monitored role list")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Monitored role to remove")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("roles").setDescription("List monitored roles"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("configure")
      .setDescription("Update threshold, window, cooldown, or ping behavior")
      .addIntegerOption((option) =>
        option
          .setName("threshold")
          .setDescription("Messages required to trigger (3-100)")
          .setMinValue(3)
          .setMaxValue(100),
      )
      .addIntegerOption((option) =>
        option
          .setName("window-seconds")
          .setDescription("Rolling message window (30-3600 seconds)")
          .setMinValue(30)
          .setMaxValue(3_600),
      )
      .addIntegerOption((option) =>
        option
          .setName("cooldown-seconds")
          .setDescription("Delay between replies per member (0-86400 seconds)")
          .setMinValue(0)
          .setMaxValue(86_400),
      )
      .addBooleanOption((option) =>
        option
          .setName("ping-target")
          .setDescription("Mention the triggering member in the reply"),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("enable")
      .setDescription("Enable monitoring after setup"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("disable")
      .setDescription("Disable monitoring immediately"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("persona-set")
      .setDescription("Set dry-humor context for one user")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("User this persona applies to")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("description")
          .setDescription(
            "Background used as comedic context (2,000 characters)",
          )
          .setMinLength(1)
          .setMaxLength(2_000)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("persona-show")
      .setDescription("Show the stored persona for one user")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("User whose persona should be shown")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("persona-clear")
      .setDescription("Remove the stored persona for one user")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("User whose persona should be removed")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Show YapBot configuration and status"),
  );

export const YAP_COMMAND_JSON = YAP_COMMAND.toJSON();
