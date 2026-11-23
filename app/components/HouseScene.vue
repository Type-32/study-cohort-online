<script setup lang="ts">
// The site's Content Security Policy blocks eval; this installs pixi's eval-free code paths.
import "pixi.js/unsafe-eval";
import { Application, Assets, Container, Graphics, Sprite, Text } from "pixi.js";
import type { Texture } from "pixi.js";
import { seatMembers, themeFiles } from "#shared/utils/theme";
import type { ThemePack } from "#shared/utils/theme";
import type { MemberState } from "#shared/utils/realtime";

/**
 * The room (step 12): the theme's backdrop and furniture, a door per member present along the nook
 * wall (lit by their door), and the members whose door is open on the seats; empty seats are rings
 * you can click to sit. Client only, drawn with PixiJS, `aria-hidden`: the page says the same in
 * words and has a seat picker. It draws only when something changes, not every frame: the house
 * sits in a background tab for hours.
 */
const props = defineProps<{ pack: ThemePack; asset: (file: string) => string; members: MemberState[]; me?: string; canSit: boolean }>();
/** `layout`: where the pack's design space lands in this element, so the page can place the radio and panel. */
const emit = defineEmits<{ sit: [slot: string]; layout: [layout: { scale: number; x: number; y: number }] }>();

const host = useTemplateRef<HTMLDivElement>("host");
const app = new Application();
let initialized: Promise<void> | undefined;
const world = new Container();
const room = new Container();
const people = new Container();
world.addChild(room, people);
let textures: Record<string, Texture> = {};
let ready = false;

const render = () => ready && app.render();

/** Fits the design space in the element, centred, keeping its shape. */
function fit() {
	const { width, height } = app.screen;
	const { width: w, height: h } = props.pack.size;
	const scale = Math.min(width / w, height / h);
	const x = (width - w * scale) / 2;
	const y = (height - h * scale) / 2;
	world.scale.set(scale);
	world.position.set(x, y);
	emit("layout", { scale, x, y });
	render();
}

async function drawRoom() {
	const pack = props.pack;
	const files = themeFiles(pack);
	// Rasterized at twice their size, so they stay sharp on high-density screens and when the window is big.
	const loaded: Record<string, Texture> = await Assets.load(files.map((file) => ({ alias: props.asset(file), src: props.asset(file), data: { resolution: 2 } })));
	textures = Object.fromEntries(files.map((file) => [file, loaded[props.asset(file)]!]));
	for (const child of room.removeChildren()) child.destroy();
	app.renderer.background.color = pack.background;
	const backdrop = new Sprite(textures[pack.backdrop]);
	backdrop.setSize(pack.size.width, pack.size.height);
	room.addChild(backdrop);
	for (const object of [...pack.objects].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
		const sprite = new Sprite(textures[object.src]);
		sprite.position.set(object.x, object.y);
		sprite.setSize(object.width, object.height);
		room.addChild(sprite);
	}
}

function label(text: string, size: number, color: string) {
	return new Text({
		text,
		anchor: { x: 0.5, y: 0 },
		style: { fontFamily: getComputedStyle(document.body).fontFamily, fontSize: size, fill: color, stroke: { color: "#000000", width: Math.max(2, size / 5) } },
	});
}

/** A member: a circle with their initial, their name under it. Yours has a light ring. */
function avatar(member: MemberState, x: number, y: number, size: number) {
	const { avatar: look, nooks } = props.pack;
	const group = new Container({ x, y });
	const r = size / 2;
	group.addChild(new Graphics().circle(0, 0, r).fill(look.color).stroke({ width: Math.max(2, size / 16), color: member.userId === props.me ? nooks.light : "#1b1820" }));
	const initial = new Text({ text: member.username.slice(0, 1).toUpperCase(), anchor: 0.5, style: { fontFamily: getComputedStyle(document.body).fontFamily, fontSize: size * 0.45, fontWeight: "700", fill: "#1b1820" } });
	const name = label(member.username, Math.max(12, size * 0.26), nooks.label);
	name.y = r + 4;
	group.addChild(initial, name);
	return group;
}

function drawPeople() {
	const pack = props.pack;
	for (const child of people.removeChildren()) child.destroy({ children: true });
	const present = [...props.members].sort((a, b) => a.username.localeCompare(b.username));

	// The nook wall: a door per member present, as big as fits, standing on the rect's bottom edge.
	const { nooks } = pack;
	const door = textures[nooks.door]!;
	const aspect = door.width / door.height;
	const gap = 16;
	const labelSpace = 28;
	let doorH = nooks.height - labelSpace;
	let doorW = doorH * aspect;
	const n = present.length;
	if (n && n * doorW + (n - 1) * gap > nooks.width) {
		doorW = (nooks.width - (n - 1) * gap) / n;
		doorH = doorW / aspect;
	}
	const bottom = nooks.y + nooks.height;
	const x0 = nooks.x + (nooks.width - (n * doorW + (n - 1) * gap)) / 2;
	const doorX = new Map<string, number>();
	present.forEach((member, i) => {
		const x = x0 + i * (doorW + gap);
		const y = bottom - doorH;
		doorX.set(member.userId, x);
		const sprite = new Sprite(door);
		sprite.position.set(x, y);
		sprite.setSize(doorW, doorH);
		const lights = new Graphics();
		if (member.door === "open") {
			// Out in the commons: the door stands open on a dark doorway.
			lights.rect(x, y, doorW, doorH).fill({ color: "#0b0910", alpha: 0.9 });
			sprite.alpha = 0.22;
			people.addChild(lights, sprite);
		} else if (member.door === "ajar") {
			// Lamp on: a warm halo on the wall and a bright gap at the door's edge.
			lights.ellipse(x + doorW / 2, y + doorH * 0.45, doorW * 1.1, doorH * 0.7).fill({ color: nooks.light, alpha: 0.12 });
			const gapLine = new Graphics().rect(x + doorW - Math.max(3, doorW * 0.06), y, Math.max(3, doorW * 0.06), doorH).fill({ color: nooks.light, alpha: 0.95 });
			people.addChild(lights, sprite, gapLine);
		} else {
			// Closed: only a light under the door, spilling onto the floor.
			const strip = new Graphics()
				.ellipse(x + doorW / 2, bottom + 6, doorW * 0.7, 10).fill({ color: nooks.light, alpha: 0.22 })
				.rect(x + doorW * 0.06, bottom - 4, doorW * 0.88, 4).fill({ color: nooks.light, alpha: 0.95 });
			people.addChild(sprite, strip);
		}
		const name = label(member.username, Math.max(11, Math.min(18, doorW * 0.18)), nooks.label);
		name.anchor.set(0.5, 1);
		name.position.set(x + doorW / 2, y - 4);
		people.addChild(name);
	});

	// The commons: open doors sit on seats; empty seats are rings to click while your door is open.
	const { seated, standing } = seatMembers(pack.seats, present);
	const size = pack.avatar.size;
	for (const seat of pack.seats) {
		const member = seated.get(seat.id);
		if (member) {
			people.addChild(avatar(member, seat.x, seat.y, size));
			continue;
		}
		if (!props.canSit) continue;
		const ring = new Graphics().circle(seat.x, seat.y, size / 2).fill({ color: pack.avatar.color, alpha: 0.08 }).stroke({ width: 2, color: pack.avatar.color, alpha: 0.55 });
		ring.eventMode = "static";
		ring.cursor = "pointer";
		ring.alpha = 0.7;
		ring.on("pointerover", () => ((ring.alpha = 1), render()));
		ring.on("pointerout", () => ((ring.alpha = 0.7), render()));
		ring.on("pointertap", () => emit("sit", seat.id));
		people.addChild(ring);
	}
	// More open doors than seats: they stand in their own doorway.
	for (const member of standing) people.addChild(avatar(member, doorX.get(member.userId)! + doorW / 2, bottom - size * 0.55, size * 0.8));
	render();
}

onMounted(() => {
	initialized = (async () => {
		await app.init({ resizeTo: host.value!, autoStart: false, antialias: true, autoDensity: true, resolution: window.devicePixelRatio, background: props.pack.background });
		host.value!.appendChild(app.canvas);
		app.stage.addChild(world);
		await drawRoom();
		ready = true;
		drawPeople();
		app.renderer.on("resize", fit);
		fit();
	})();
});
// The plugin only hears window resizes; the element also changes size with the layout.
useResizeObserver(host, () => ready && app.queueResize());

watch(() => props.pack, async () => {
	if (!ready) return;
	ready = false;
	await drawRoom();
	ready = true;
	drawPeople();
	fit();
});
watch(() => [props.members, props.me, props.canSit], () => ready && drawPeople(), { deep: true });

onBeforeUnmount(() => {
	ready = false;
	initialized?.then(() => app.destroy({ removeView: true }, { children: true }));
});
</script>

<template>
	<div ref="host" class="size-full overflow-hidden [&>canvas]:block" aria-hidden="true" />
</template>
