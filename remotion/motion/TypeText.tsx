import type React from "react";
import { useCurrentFrame } from "remotion";
import { cadenceEnd, typeCadence, typedCount } from "./typing";
import { C, FONT } from "../theme";

/**
 * Character-by-character typing with deterministic cadence.
 * Caret: solid while typing, blinks after the last char.
 */
export const TypeText: React.FC<{
	text: string;
	start: number;
	seed?: number;
	base?: number;
	jit?: number;
	style?: React.CSSProperties;
	caret?: boolean;
	caretColor?: string;
}> = ({
	text,
	start,
	seed = 7,
	base = 3,
	jit = 2,
	style,
	caret = true,
	caretColor = C.primary,
}) => {
	const frame = useCurrentFrame();
	const times = typeCadence(text, start, { seed, base, jit });
	const n = typedCount(times, frame);
	const done = cadenceEnd(times);
	const typing = frame <= done;
	const blinkOn = frame % 60 < 30;
	const showCaret = caret && frame >= start && (typing || blinkOn);

	return (
		<span style={{ whiteSpace: "pre-wrap", fontFamily: FONT.sans, ...style }}>
			{text.slice(0, n)}
			{showCaret && (
				<span
					style={{
						display: "inline-block",
						width: 2,
						height: "1.05em",
						background: caretColor,
						verticalAlign: "text-bottom",
						marginLeft: 1,
						borderRadius: 1,
					}}
				/>
			)}
		</span>
	);
};
