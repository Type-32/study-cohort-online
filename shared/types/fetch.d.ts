import type {Invite, UserRole} from "#shared/types/db"

export interface GetUsersOptions {
	name?: string;
	role?: UserRole;
	banned?: boolean;
}

/** What `GET /api/v1/invites/:code` reveals about a usable invite. */
export interface InviteInfo {
	kind: 'signup' | 'reentry';
	/** The member a re-entry link signs in as. */
	username?: string;
}

/** A row of the host's invite list: a re-entry link's member, and who joined through a signup link. */
export type InviteListItem = Invite & {
	user: { username: string } | null;
	joined: { id: string; username: string }[];
};
