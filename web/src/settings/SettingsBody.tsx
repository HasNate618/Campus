import { useEffect, useState } from "react";
import { LogOut, PlugZap, RefreshCw, ShieldAlert } from "lucide-react";
import { metaFor, GROUP_META } from "./fieldMeta";
import { useSettings, type FieldValue, type SettingsField } from "./useSettings";

const RESTART_HINT =
	"Restart the API to apply (docker compose restart campus).";

function asText(v: FieldValue): string {
	if (v == null) return "";
	if (Array.isArray(v)) return v.join("\n");
	if (typeof v === "object") return JSON.stringify(v, null, 2);
	return String(v);
}

export function SettingsBody({
	variant,
	onLogout,
	onDirtyChange,
}: {
	variant: "modal" | "page";
	onLogout?: () => void;
	onDirtyChange?: (dirty: boolean) => void;
}) {
	const s = useSettings();

	// Report unsaved-edit state so a shell can refuse to discard it by accident.
	// Above the early returns below, so hook order stays stable while the form is
	// loading, failed or payload-less.
	useEffect(() => {
		onDirtyChange?.(s.dirty);
	}, [onDirtyChange, s.dirty]);

	if (s.loading) return <p className="settings-note">Loading…</p>;
	if (s.error) return <p className="settings-note error">Could not load settings: {s.error}</p>;
	if (!s.payload) return null;

	const grouped = new Map<string, SettingsField[]>();
	for (const f of s.payload.fields) {
		const g = metaFor(f.key).group;
		if (!grouped.has(g)) grouped.set(g, []);
		grouped.get(g)!.push(f);
	}
	const groups = [...grouped.entries()].sort(
		(a, b) =>
			(GROUP_META.find((g) => g.id === a[0])?.order ?? 99) -
			(GROUP_META.find((g) => g.id === b[0])?.order ?? 99),
	);

	// Saved ∪ pending restart-flagged keys, straight from the hook: a *saved*
	// mcp_urls still needs a restart, so this cannot be recomputed from s.edits
	// (save() clears them) without the hint vanishing on the save that made it
	// true. Session-scoped by design — see useSettings.savedRestartKeys.
	const restartPending = s.restartKeys.length > 0;
	// Hoisted: `s.payload` is re-read rather than narrowed inside the map below.
	const searchIndex = s.payload.search_index;

	return (
		<div className={`settings-body ${variant}`}>
			{!s.payload.auth_enabled && (
				<p className="settings-notice">
					<ShieldAlert size={14} /> No web password is set, so anyone who can
					reach this port can change these settings.
				</p>
			)}
			{s.payload.settings_file_error && (
				<p className="settings-notice error">
					Ignoring a broken settings file: {s.payload.settings_file_error}
				</p>
			)}
			{!s.payload.settings_writable && (
				<p className="settings-notice error">
					{s.payload.settings_file} is not writable, so settings cannot be saved.
				</p>
			)}

			{groups.map(([groupId, fields]) => (
				<section key={groupId} className="settings-group">
					<h2 className="settings-group-title">
						{GROUP_META.find((g) => g.id === groupId)?.label ?? groupId}
					</h2>
					{fields
						.sort((a, b) => metaFor(a.key).order - metaFor(b.key).order)
						.map((f) => (
							<Field
								key={f.key}
								field={f}
								value={s.valueOf(f.key)}
								changed={f.key in s.edits}
								onChange={(v) => s.setValue(f.key, v)}
								onReset={() => s.resetField(f.key)}
							/>
						))}
					{groupId === "ai" && <TestConnectionButton />}
					{groupId === "search" && searchIndex && (
						<RebuildIndexButton index={searchIndex} onDone={s.reload} />
					)}
				</section>
			))}

			{restartPending && <p className="settings-note">{RESTART_HINT}</p>}
			{s.saveErrors.length > 0 && (
				<ul className="settings-errors">
					{s.saveErrors.map((e, i) => (
						<li key={`${e.key}-${i}`}>
							{e.key && <code>{metaFor(e.key).label}: </code>}
							{e.message}
						</li>
					))}
				</ul>
			)}

			<div className="settings-actions">
				<button
					className="settings-save"
					disabled={!s.dirty || s.saving || !s.payload.settings_writable}
					onClick={() => void s.save()}
				>
					{s.saving ? "Saving…" : "Save"}
				</button>
				<button className="settings-discard" disabled={!s.dirty} onClick={s.discard}>
					Discard
				</button>
			</div>
			<div className="settings-footer">
				<p className="settings-path">{s.payload.settings_file}</p>
				{onLogout && (
					<button className="settings-logout" onClick={onLogout}>
						<LogOut size={15} /> Log out
					</button>
				)}
			</div>
		</div>
	);
}

function Field({
	field,
	value,
	changed,
	onChange,
	onReset,
}: {
	field: SettingsField;
	value: FieldValue;
	changed: boolean;
	onChange: (v: FieldValue) => void;
	onReset: () => void;
}) {
	const meta = metaFor(field.key);
	// The server sends a display mask (••••4f2a), never the key. It is a
	// placeholder, not a value: an editable mask would let a Save persist
	// "••••4f2ax" as the credential and silently break every chat turn.
	const secretMask = field.kind === "secret" ? asText(field.value) || "not set" : "";
	const shadowed =
		field.source === "settings" && field.inherited_from
			? `inherited: ${asText(field.inherited_value ?? null)} (${field.inherited_from})`
			: null;

	return (
		<div className={`settings-field${changed ? " changed" : ""}`}>
			<label className="settings-label" htmlFor={`set-${field.key}`}>
				{meta.label}
				{field.restart && <span className="settings-tag">restart</span>}
			</label>

			{field.kind === "bool" ? (
				<input
					id={`set-${field.key}`}
					type="checkbox"
					checked={value === true}
					onChange={(e) => onChange(e.target.checked)}
				/>
			) : field.kind === "list" ? (
				<textarea
					id={`set-${field.key}`}
					rows={3}
					value={asText(value)}
					placeholder={meta.placeholder}
					onChange={(e) =>
						onChange(
							e.target.value
								.split("\n")
								.map((l) => l.trim())
								.filter(Boolean),
						)
					}
				/>
			) : field.kind === "int" ? (
				<input
					id={`set-${field.key}`}
					type="number"
					value={value == null ? "" : String(value)}
					onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
				/>
			) : field.kind === "secret" ? (
				<input
					id={`set-${field.key}`}
					type="password"
					// Empty until the user types, so the only values PUT are what
					// they typed or "" (Clear, which deletes the override).
					value={changed ? asText(value) : ""}
					placeholder={secretMask}
					onChange={(e) => onChange(e.target.value)}
				/>
			) : (
				<input
					id={`set-${field.key}`}
					type="text"
					value={asText(value)}
					placeholder={meta.placeholder ?? shadowed ?? ""}
					onChange={(e) => onChange(e.target.value)}
				/>
			)}

			{meta.help && <p className="settings-help">{meta.help}</p>}
			{shadowed && !meta.placeholder && <p className="settings-help">{shadowed}</p>}
			{field.kind === "secret" && (
				<button
					className="settings-reset settings-clear"
					title="Remove the stored key; the env/config value applies again"
					onClick={() => onChange("")}
				>
					Clear
				</button>
			)}
			{field.source === "settings" && (
				<button className="settings-reset" onClick={onReset}>
					Reset to inherited
				</button>
			)}
		</div>
	);
}

/**
 * Probes GET /api/chat/models — the same endpoint the chat model selector
 * uses. It reads the *saved* layers, so it verifies what the server would use
 * now, not the pending edits.
 */
function TestConnectionButton() {
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);

	const run = async () => {
		setBusy(true);
		setMsg(null);
		try {
			const res = await fetch("/api/chat/models");
			if (!res.ok) {
				setMsg(`Request failed: ${res.status} ${res.statusText}`);
				return;
			}
			const body = (await res.json()) as { models: string[]; error?: string };
			setMsg(
				body.error
					? body.error
					: `${body.models.length} model${body.models.length === 1 ? "" : "s"} available`,
			);
		} catch (e) {
			setMsg(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="settings-field">
			<button className="settings-rebuild" disabled={busy} onClick={() => void run()}>
				<PlugZap size={14} /> {busy ? "Testing…" : "Test connection"}
			</button>
			{msg && <p className="settings-help">{msg}</p>}
			<p className="settings-help">
				Checks the saved endpoint — save your edits first to test them.
			</p>
		</div>
	);
}

function RebuildIndexButton({
	index,
	onDone,
}: {
	index: { chunks: number; embed_model: string | null; stale: boolean };
	onDone: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);

	const run = async () => {
		setBusy(true);
		setMsg(null);
		try {
			const start = await fetch("/api/search/rebuild", { method: "POST" });
			if (!start.ok) {
				setMsg(`Request failed: ${start.status} ${start.statusText}`);
				return;
			}
			const { status } = (await start.json()) as { status: string };
			if (status === "sync_running") {
				setMsg("A sync is running — try again when it finishes.");
				return;
			}
			for (let i = 0; i < 600; i++) {
				await new Promise((r) => setTimeout(r, 1000));
				const res = await fetch("/api/search/rebuild/status");
				if (!res.ok) {
					setMsg(`Request failed: ${res.status} ${res.statusText}`);
					return;
				}
				const state = (await res.json()) as {
					status: string;
					result?: { chunks: number; embedded_items: number } | null;
					error?: string | null;
				};
				if (state.status === "running") continue;
				setMsg(
					state.status === "done"
						? `Indexed ${state.result?.chunks ?? 0} chunks (${state.result?.embedded_items ?? 0} embedded).`
						: `Rebuild failed: ${state.error ?? "unknown error"}`,
				);
				onDone();
				return;
			}
			setMsg("Still running — check back later.");
		} catch (e) {
			setMsg(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="settings-field">
			<button className="settings-rebuild" disabled={busy} onClick={() => void run()}>
				<RefreshCw size={14} /> {busy ? "Rebuilding…" : "Rebuild search index"}
			</button>
			<p className="settings-help">
				{index.chunks} chunks ·{" "}
				{index.embed_model ? `vectors: ${index.embed_model}` : "no vectors"}
				{index.stale ? " · needs rebuild" : ""}
			</p>
			{msg && <p className="settings-help">{msg}</p>}
		</div>
	);
}
