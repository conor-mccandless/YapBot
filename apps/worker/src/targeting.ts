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
  monitoredRoleIds = config.monitoredRoleId ? [config.monitoredRoleId] : [],
): boolean {
  return authorIsListedUser || monitoredRoleIds.some(authorHasRole);
}
