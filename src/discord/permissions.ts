export interface AccessPolicy {
  userIds: string[];
  roleIds: string[];
}

export interface Invoker {
  id: string;
  roleIds: string[];
}

/**
 * An empty policy means "no extra restriction": access is then governed only by
 * Discord's own command permissions (Server Settings > Integrations).
 */
export function isAllowed(policy: AccessPolicy, who: Invoker): boolean {
  if (policy.userIds.length === 0 && policy.roleIds.length === 0) return true;
  return policy.userIds.includes(who.id) || who.roleIds.some((r) => policy.roleIds.includes(r));
}
