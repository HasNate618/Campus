import { useCallback, useEffect, useMemo, useState } from "react";

export type FieldValue =
	| string
	| number
	| boolean
	| string[]
	| Record<string, unknown>
	| null;

export interface SettingsField {
	key: string;
	group: string;
	kind: "text" | "secret" | "bool" | "int" | "json" | "url" | "list";
	value: FieldValue;
	source: "default" | "config" | "env" | "settings";
	inherited_value?: FieldValue;
	inherited_from?: string | null;
	secret: boolean;
	restart: boolean;
}

export interface SettingsPayload {
	fields: SettingsField[];
	settings_file: string;
	settings_writable: boolean;
	settings_file_error: string | null;
	auth_enabled: boolean;
	version: string;
	search_index?: { chunks: number; embed_model: string | null; stale: boolean };
	readonly: Record<string, { value: string; from: string }>;
}

export interface SettingsError {
	key: string;
	message: string;
}

/**
 * One GET, one PUT. Kept out of api/client.ts on purpose: that module throws
 * `${status} ${statusText}` without reading the body, which would hide the
 * per-field validation errors this panel exists to show.
 */
export function useSettings() {
	const [payload, setPayload] = useState<SettingsPayload | null>(null);
	const [edits, setEdits] = useState<Record<string, FieldValue>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveErrors, setSaveErrors] = useState<SettingsError[]>([]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch("/api/settings");
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			setPayload((await res.json()) as SettingsPayload);
			setEdits({});
			setSaveErrors([]);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const byKey = useMemo(
		() => new Map((payload?.fields ?? []).map((f) => [f.key, f])),
		[payload],
	);

	/** Effective value for rendering: the pending edit wins over the server's. */
	const valueOf = useCallback(
		(key: string): FieldValue => (key in edits ? edits[key] : (byKey.get(key)?.value ?? null)),
		[edits, byKey],
	);

	const setValue = useCallback((key: string, value: FieldValue) => {
		setEdits((prev) => ({ ...prev, [key]: value }));
	}, []);

	/** null tells the server to delete the key (inherit again). */
	const resetField = useCallback((key: string) => {
		setEdits((prev) => ({ ...prev, [key]: null }));
	}, []);

	const discard = useCallback(() => {
		setEdits({});
		setSaveErrors([]);
	}, []);

	const save = useCallback(async () => {
		if (!Object.keys(edits).length) return true;
		setSaving(true);
		setSaveErrors([]);
		try {
			const res = await fetch("/api/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ values: edits }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as
					| { detail?: { errors?: SettingsError[] } }
					| null;
				setSaveErrors(
					body?.detail?.errors ?? [
						{ key: "", message: `${res.status} ${res.statusText}` },
					],
				);
				return false;
			}
			setPayload((await res.json()) as SettingsPayload);
			setEdits({});
			return true;
		} catch (e) {
			setSaveErrors([{ key: "", message: e instanceof Error ? e.message : String(e) }]);
			return false;
		} finally {
			setSaving(false);
		}
	}, [edits]);

	return {
		payload,
		byKey,
		valueOf,
		edits,
		dirty: Object.keys(edits).length > 0,
		loading,
		error,
		saving,
		saveErrors,
		setValue,
		resetField,
		discard,
		save,
		reload: load,
	};
}
