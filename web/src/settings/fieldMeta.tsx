export interface FieldMeta {
	label: string;
	help?: string;
	group: string;
	order: number;
	placeholder?: string;
}

export const GROUP_META: { id: string; label: string; order: number }[] = [
	{ id: "ai", label: "AI & models", order: 1 },
	{ id: "search", label: "Search", order: 2 },
	{ id: "content", label: "Content & PDFs", order: 3 },
	{ id: "sync", label: "Courses & sync", order: 4 },
	{ id: "notifications", label: "Notifications", order: 5 },
	{ id: "advanced", label: "Advanced", order: 6 },
];

export const FIELD_META: Record<string, FieldMeta> = {
	llm_urls: {
		label: "LLM endpoint(s)",
		help: "Any OpenAI-compatible /v1 base URL. One per line; tried in order.",
		group: "ai",
		order: 1,
		placeholder: "http://localhost:11434/v1",
	},
	llm_api_key: {
		label: "API key",
		help: "Sent as a Bearer token. Leave empty if your endpoint needs no auth.",
		group: "ai",
		order: 2,
	},
	llm_model: {
		label: "Default model",
		help: "Used for chat and the digest unless a chat overrides it.",
		group: "ai",
		order: 3,
	},
	embed_model: {
		label: "Embeddings model",
		help: "Enables semantic search. Requires a reindex to take effect.",
		group: "search",
		order: 1,
	},
	rerank_model: {
		label: "Rerank model",
		group: "search",
		order: 2,
	},
	auto_extract_pdfs: {
		label: "Extract PDFs after sync",
		group: "content",
		order: 1,
	},
	office_to_pdf: {
		label: "Convert Office files to PDF",
		help: "Uses LibreOffice headless so .pptx/.docx open in the viewer.",
		group: "content",
		order: 2,
	},
	pdf_extractor_url: {
		label: "External PDF parser",
		help: "Empty = local PyMuPDF (scanned PDFs stay unsearchable).",
		group: "content",
		order: 3,
	},
	long_scan_skip_pages: {
		label: "Skip scanned PDFs at/above",
		help: "Pages. Local OCR runs ~2 min/page.",
		group: "content",
		order: 4,
	},
	institution: {
		label: "Institution",
		help: "Shown to the AI as who it works for.",
		group: "sync",
		order: 2,
	},
	timezone: {
		label: "Timezone",
		help: "Empty = the server's local time. e.g. America/Toronto",
		group: "sync",
		order: 3,
	},
	ntfy_url: {
		label: "Notification URL",
		help: "Empty = no sync notifications.",
		group: "notifications",
		order: 1,
	},
	mcp_urls: {
		label: "External MCP servers",
		help: "One URL per line. Needs an API restart to apply.",
		group: "advanced",
		order: 1,
	},
	llm_tool_choice: {
		label: "tool_choice",
		help: "Leave empty unless your endpoint requires it (e.g. auto).",
		group: "advanced",
		order: 2,
	},
	max_file_size: { label: "Max download size (bytes)", group: "advanced", order: 3 },
	max_extract_size: { label: "Max extract size (bytes)", group: "advanced", order: 4 },
	office_convert_timeout_s: { label: "Office convert timeout (s)", group: "advanced", order: 5 },
	digest_pdf_excerpt_chars: { label: "PDF excerpt for digest (chars)", group: "content", order: 5 },
	digest_announcement_days: { label: "Announcement backfill (days)", group: "advanced", order: 6 },
};

export function metaFor(key: string): FieldMeta {
	// Drift tolerance: an unknown server field renders with its raw key.
	return FIELD_META[key] ?? { label: key, group: "advanced", order: 99 };
}
