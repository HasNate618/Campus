import React from "react";
import { useCurrentFrame } from "remotion";
import { streamCues } from "./typing";

/**
 * Word-chunk streaming (~60 chars/s) — mimics LLM token streaming.
 */
export const StreamText: React.FC<{
	text: string;
	start: number;
	seed?: number;
	style?: React.CSSProperties;
}> = ({ text, start, seed = 11, style }) => {
	const frame = useCurrentFrame();
	const tokens = React.useMemo(() => text.split(/(?<=\s)|(?<=—)/), [text]);
	const times = React.useMemo(
		() => streamCues(text, start, seed),
		[text, start, seed],
	);
	let n = 0;
	while (n < times.length && times[n] <= frame) n++;
	return (
		<span style={{ whiteSpace: "pre-wrap", ...style }}>
			{tokens.slice(0, n).join("")}
		</span>
	);
};
