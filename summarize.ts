/**
 * Call a small model to generate a one-line recap summary.
 */

import { completeSimple } from "@mariozechner/pi-ai";
import type { Api, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

const SYSTEM_PROMPT = [
	"The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown, all on a single line.",
	"Lead with the overall goal and current task, then the one next action.",
	"Skip root-cause narrative, fix internals, secondary to-dos, and em-dash tangents.",
].join("\n");

/**
 * Find a model by bare name from available models.
 */
function findModel(
	modelName: string,
	registry: ModelRegistry,
): Model<Api> | undefined {
	const available = registry.getAvailable();
	// Exact id match
	const exact = available.find((m) => m.id === modelName);
	if (exact) return exact;
	// Substring match (shortest id wins)
	const matches = available
		.filter((m) => m.id.includes(modelName))
		.sort((a, b) => a.id.length - b.id.length);
	return matches[0];
}

export async function generateRecap(
	conversationText: string,
	originalSystemPrompt: string | undefined,
	modelName: string,
	registry: ModelRegistry,
	signal?: AbortSignal,
): Promise<string | null> {
	const model = findModel(modelName, registry);
	if (!model) {
		console.error(`[recap] Model "${modelName}" not found in registry`);
		return null;
	}

	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		console.error(`[recap] No API key for model "${modelName}": ${auth.error}`);
		return null;
	}

	const options: SimpleStreamOptions = {
		maxTokens: 200,
		signal,
		apiKey: auth.apiKey,
		headers: auth.headers,
	};

	const userParts: string[] = [];
	if (originalSystemPrompt) {
		userParts.push(
			"--- Original system prompt given to the assistant ---",
			originalSystemPrompt,
			"--- End of original system prompt ---",
			"",
		);
	}
	userParts.push(conversationText);

	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt: SYSTEM_PROMPT,
				messages: [
					{ role: "user" as const, content: userParts.join("\n"), timestamp: Date.now() },
				],
			},
			options,
		);

		let text = "";
		for (const block of response.content) {
			if (block.type === "text") text += block.text;
		}
		return text.trim() || null;
	} catch (err) {
		if (
			signal?.aborted ||
			(err instanceof Error && err.name === "AbortError")
		) {
			return null;
		}
		console.error("[recap] LLM call failed:", err);
		return null;
	}
}
