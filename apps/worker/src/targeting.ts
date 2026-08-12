export interface TargetConfiguration {
  monitoredRoleId: string | null;
  monitoredUserId: string | null;
  targetType: string | null;
}

export function matchesConfiguredTarget(
  config: TargetConfiguration,
  authorId: string,
  authorHasRole: (roleId: string) => boolean,
): boolean {
  if (config.targetType === "user") {
    return config.monitoredUserId === authorId;
  }

  if (config.targetType === "role" && config.monitoredRoleId) {
    return authorHasRole(config.monitoredRoleId);
  }

  return false;
}
