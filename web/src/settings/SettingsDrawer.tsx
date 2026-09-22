import { useEffect } from "react";
import { X } from "lucide-react";
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
			onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;
	return (
		<>
			<div className="settings-backdrop" onClick={onClose} />
			{/* data-kbd-zone keeps sidebar j/k from scrolling the list behind it */}
			<aside className="settings-drawer" data-kbd-zone="settings">
				<header className="settings-drawer-head">
					<h1>Settings</h1>
					<button className="icon-btn" onClick={onClose} aria-label="Close settings">
						<X size={17} />
					</button>
				</header>
				<div className="settings-drawer-scroll">
					<SettingsBody variant="drawer" onLogout={onLogout} />
				</div>
			</aside>
		</>
	);
}
