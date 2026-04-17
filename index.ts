/**
 * Recap plugin — periodic + event-driven conversation recap.
 *
 * Displays a brief status summary above the editor input,
 * auto-dismisses after configurable seconds, then sends as info toast.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadRecapConfig } from "./config.js";
import { collectMessages } from "./collect.js";
import { generateRecap } from "./summarize.js";
import type { RecapConfig } from "./config.js";

const WIDGET_KEY = "recap";

const INSTANCE_KEY = "__recap_plugin_active__";

export default async function recap(pi: ExtensionAPI): Promise<void> {
	const g = globalThis as Record<string, unknown>;
	if (g[INSTANCE_KEY]) return; // already loaded
	g[INSTANCE_KEY] = true;

	const config = await loadRecapConfig(process.cwd());
	if (!config.enabled) {
		g[INSTANCE_KEY] = false;
		return;
	}

	let latestCtx: ExtensionContext | null = null;
	let lastRecapTimestamp: string | null = null;
	let lastRecapMessageCount = 0;
	let recapInProgress = false;
	let dismissTimer: ReturnType<typeof setTimeout> | null = null;
	let intervalTimer: ReturnType<typeof setInterval> | null = null;

	/**
	 * Core recap logic: collect messages, call LLM, display widget.
	 */
	async function doRecap(): Promise<void> {
		const ctx = latestCtx;
		if (!ctx || recapInProgress) return;

		const collected = collectMessages(
			ctx.sessionManager,
			lastRecapTimestamp,
		);

		// Skip if no new messages since last recap
		if (collected.messageCount === 0) return;
		// Skip if message count hasn't changed (no new activity)
		if (collected.messageCount === lastRecapMessageCount && lastRecapTimestamp) return;

		recapInProgress = true;

		try {
			const summary = await generateRecap(
				collected.text,
				config.model,
				ctx.modelRegistry,
			);

			if (!summary) {
				recapInProgress = false;
				return;
			}

			lastRecapTimestamp = new Date().toISOString();
			lastRecapMessageCount = collected.messageCount;

			// Show widget
			ctx.ui.setWidget(WIDGET_KEY, [`📋 ${summary}`], {
				placement: "aboveEditor",
			});

			// Clear any existing dismiss timer
			if (dismissTimer) clearTimeout(dismissTimer);

			// Auto-dismiss after configured seconds
			if (config.displaySeconds > 0) {
				dismissTimer = setTimeout(() => {
					ctx.ui.setWidget(WIDGET_KEY, undefined);
					ctx.ui.notify(`recap: ${summary}`, "info");
					dismissTimer = null;
				}, config.displaySeconds * 1000);
			}
		} finally {
			recapInProgress = false;
		}
	}

	// Capture latest ctx from any event
	function captureCtx(ctx: ExtensionContext): void {
		latestCtx = ctx;
	}

	// Trigger on agent_end
	if (config.onAgentEnd) {
		pi.on("agent_end", async (_event, ctx) => {
			captureCtx(ctx);
			await doRecap();
		});
	}

	// Also capture ctx from turn_end (keeps ctx fresh)
	pi.on("turn_end", async (_event, ctx) => {
		captureCtx(ctx);
	});

	// Capture ctx from agent_start too
	pi.on("agent_start", async (_event, ctx) => {
		captureCtx(ctx);
	});

	// Timer-based recap
	if (config.intervalMinutes > 0) {
		const intervalMs = config.intervalMinutes * 60 * 1000;
		intervalTimer = setInterval(async () => {
			const ctx = latestCtx;
			if (!ctx) return;
			// Only recap when idle
			if (!ctx.isIdle()) return;
			await doRecap();
		}, intervalMs);
	}
}
