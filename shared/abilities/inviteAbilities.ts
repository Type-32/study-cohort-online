import type {User} from "#shared/types/db";
import {satisfies} from "#shared/utils/roles";

export function inviteAbilities() {
	return {
		manageInvites: defineAbility((user: User) => {
			return satisfies(user, { minRole: 'admin' })
		}),

		// Anyone may make a re-entry link for themselves ("sign in on another device"); only the host for others.
		createReentryLink: defineAbility((user: User, userId?: string) => {
			return satisfies(user, { minRole: 'admin' }) || (satisfies(user) && user.id === userId)
		}),
	}
}
