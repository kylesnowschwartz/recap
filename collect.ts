/**
 * Collect recent messages from session for recap summarization.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export interface CollectedContext {
	/** Formatted conversation snippet for the LLM. */
	text: string;
	/** Number of message entries found. */
	messageCount: number;
}

/**
 * Extract recent messages from the current session branch.
 * Returns a formatted text block suitable for recap summarization.
 */
export function collectMessages(
	sessionManager: ExtensionContext["sessionManager"],
	sinceTimestamp: string | null,
): CollectedContext {
	const entries = sessionManager.getBranch();
	const lines: string[] = [];
	let count = 0;

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		if (sinceTimestamp && entry.timestamp <= sinceTimestamp) continue;

		const msg = entry.message;
		count++;

		if (msg.role === "user") {
			const text = typeof msg.content === "string"
				? msg.content
				: msg.content
					.filter((b): b is { type: "text"; text: string } => b.type === "text")
					.map((b) => b.text)
					.join("");
			lines.push(`[User]: ${text.slice(0, 500)}`);
		} else if (msg.role === "assistant") {
			for (const block of msg.content) {
				if (block.type === "text") {
					lines.push(`[Assistant]: ${block.text.slice(0, 500)}`);
				} else if (block.type === "toolCall") {
					lines.push(`[Tool call]: ${block.name}(${JSON.stringify(block.arguments).slice(0, 200)})`);
				}
			}
		} else if (msg.role === "toolResult") {
			const text = msg.content
				.filter((b): b is { type: "text"; text: string } => b.type === "text")
				.map((b) => b.text)
				.join("");
			if (text) {
				lines.push(`[Tool ${msg.toolName}]: ${text.slice(0, 200)}`);
			}
		}
	}

	return { text: lines.join("\n"), messageCount: count };
}
