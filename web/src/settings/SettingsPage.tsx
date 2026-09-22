import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { SettingsBody } from "./SettingsBody";

export function SettingsPage({ onLogout }: { onLogout?: () => void }) {
	return (
		<div className="page">
			<div className="page-col">
				<div className="page-head">
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<Link to="/" className="icon-btn" aria-label="Back">
							<ChevronLeft size={18} />
						</Link>
						<h1 className="page-title">Settings</h1>
					</div>
				</div>
				<SettingsBody variant="page" onLogout={onLogout} />
			</div>
		</div>
	);
}
