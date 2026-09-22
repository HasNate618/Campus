import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { useKeyNav, zoneForPath } from "@/lib/keynav";
import { SettingsBody } from "./SettingsBody";

export function SettingsDrawer({
	open,
	onClose,
	onLogout,
}: {
	open: boolean;
	onClose: () => void;
	onLogout: () => void;
}) {
	// The drawer owns a keynav zone: while it is open, sidebar j/k must not
	// drive (and scroll) the list behind the backdrop while the drawer's own
	// fields keep working. Closing hands the zone back to the route's zone —
	// not a hardcoded 'sidebar', which would strand /courses or /chat.
	const { setZone } = useKeyNav();
	const { pathname } = useLocation();
	useEffect(() => {
		if (!open) return;
		setZone("settings");
		return () => setZone(zoneForPath(pathname));
	}, [open, pathname, setZone]);

	const [dirty, setDirty] = useState(false);

	// Every close a user can start — the X button, the backdrop, the second
	// Escape — confirms first while edits are unsaved: "explicit Save" cuts both
	// ways, and a backdrop click is the most reflexive accidental close. No
	// confirm on unmount: that is not a user-initiated close.
	const requestClose = useCallback(() => {
		if (dirty && !window.confirm("Discard unsaved settings changes?")) return;
		onClose();
	}, [dirty, onClose]);

	// Escape closes only when no field is focused: web/src/lib/keynav.tsx blurs
	// a focused input on Escape without stopping propagation, so without this
	// guard the first Escape would both blur the field and discard the drawer.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			const el = document.activeElement;
			const typing =
				!!el &&
				((el as HTMLElement).tagName === "INPUT" ||
					(el as HTMLElement).tagName === "TEXTAREA");
			if (typing) return;
			requestClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, requestClose]);

	if (!open) return null;
	return (
		<>
			<div className="settings-backdrop" onClick={requestClose} />
			{/* data-kbd-zone keeps sidebar j/k from scrolling the list behind it */}
			<aside className="settings-drawer" data-kbd-zone="settings">
				<header className="settings-drawer-head">
					<h1>Settings</h1>
					<button className="icon-btn" onClick={requestClose} aria-label="Close settings">
						<X size={17} />
					</button>
				</header>
				<div className="settings-drawer-scroll">
					<SettingsBody
						variant="drawer"
						onLogout={onLogout}
						onDirtyChange={setDirty}
					/>
				</div>
			</aside>
		</>
	);
}
