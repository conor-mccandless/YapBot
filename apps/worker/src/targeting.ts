export interface TargetConfiguration {
  monitoredRoleId: string | null;
  monitoredUserId: string | null;
  targetType: string | null;
}

export function matchesConfiguredTarget(
  config: TargetConfiguration,
  authorId: string,
  authorHasRole: (roleId: string) => boolean,
  authorIsListedUser = config.monitoredUserId === authorId,
): boolean {
  if (config.targetType === "user") {
    return authorIsListedUser;
  }

  if (config.targetType === "role" && config.monitoredRoleId) {
    return authorHasRole(config.monitoredRoleId);
  }

  return false;
}
