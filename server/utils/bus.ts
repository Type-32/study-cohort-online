import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { db } from '@nuxthub/db'

// Every instance relays one Postgres channel to its own sockets, so a change
// written on any instance reaches every peer. See plans/online-gathering-v1.md.
const CHANNEL = 'house'

type BusPeer = { send(data: string): unknown }

const peers = new Set<BusPeer>()
let listening: Promise<unknown> | undefined

function listen() {
	const url = process.env.DATABASE_URL
	if (!url) throw new Error('[bus] DATABASE_URL is required: PGlite cannot LISTEN across connections')
	// postgres.js reserves a dedicated connection for LISTEN and re-listens after reconnecting.
	return postgres(url, { max: 1 }).listen(CHANNEL, (payload) => {
		for (const peer of peers) peer.send(payload)
	})
}

export function addPeer(peer: BusPeer) {
	peers.add(peer)
	listening ??= Promise.resolve().then(listen).catch((error) => {
		listening = undefined
		console.error(error)
	})
}

export function removePeer(peer: BusPeer) {
	peers.delete(peer)
}

/** Sends `msg` to every connected peer on every instance. */
export async function publish(msg: unknown) {
	await db.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(msg)})`)
}
