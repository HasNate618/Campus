import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { api } from "@/api/client";
import { useSWR } from "@/lib/useSWR";
import { dayKey, eventDayKey } from "@/lib/format";
import type { Event } from "@/types";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function CalendarCard() {
	const navigate = useNavigate();
	const now = new Date();
	// SWR-cached per month: revisiting Home paints the grid instantly. The
	// key is stable for the card's lifetime (the month at mount time).
	const [events] = useSWR<
		Event[]
	>(`events-month:${now.getFullYear()}:${now.getMonth()}`, () => {
		const from = new Date(now.getFullYear(), now.getMonth(), 1);
		const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
		return api.events({ from_dt: from.toISOString(), to_dt: to.toISOString() });
	}, []);

	const byDay = useMemo(() => {
		const m = new Map<string, number>();
		for (const e of events) {
			const k = eventDayKey(e);
			m.set(k, (m.get(k) ?? 0) + 1);
		}
		return m;
	}, [events]);

	const first = new Date(now.getFullYear(), now.getMonth(), 1);
	const offset = (first.getDay() + 6) % 7;
	const start = new Date(now.getFullYear(), now.getMonth(), 1 - offset);
	const cells = Array.from({ length: 42 }, (_, i) => {
		const d = new Date(
			start.getFullYear(),
			start.getMonth(),
			start.getDate() + i,
		);
		return { date: d, otherMonth: d.getMonth() !== now.getMonth() };
	});

	const todayKey = dayKey(now);
	const monthLabel = now.toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
	});

	return (
		<div className="card">
			<p className="card-title">
				<CalendarDays size={14} /> {monthLabel}
				<button
					className="btn btn-ghost btn-sm"
					style={{ marginLeft: "auto", padding: "2px 8px" }}
					onClick={() => navigate("/calendar")}
				>
					Open
				</button>
			</p>
			<div className="cal-grid">
				{WEEKDAYS.map((d, i) => (
					<div className="cal-head" key={i}>
						{d}
					</div>
				))}
				{cells.map(({ date, otherMonth }) => {
					const k = dayKey(date);
					const count = byDay.get(k) ?? 0;
					const cls = [
						"cal-cell",
						otherMonth && "other-month",
						k === todayKey && "today",
					]
						.filter(Boolean)
						.join(" ");
					return (
						<button
							key={k}
							className={cls}
							onClick={() => navigate("/calendar")}
						>
							{date.getDate()}
							<span className="cal-dots">
								{Array.from({ length: Math.min(count, 3) }, (_, i) => (
									<span className="cal-dot" key={i} />
								))}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
