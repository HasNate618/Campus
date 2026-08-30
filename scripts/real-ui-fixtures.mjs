const CS = {
	id: 1,
	code: "CS 1100A",
	name: "Introduction to Programming",
	term: "2026F",
	instructor: "J. Morgan",
	color: "#8b5cf6",
	is_pilot: 1,
	is_active: 1,
	file_count: 14,
	assignment_count: 2,
	last_sync_at: "2026-08-27T15:42:00",
};

const MATH = {
	id: 3,
	code: "MATH 1600A",
	name: "Linear Algebra for Engineers",
	term: "2026F",
	instructor: "R. Patel",
	color: "#0ea5e9",
	is_pilot: 1,
	is_active: 1,
	file_count: 11,
	assignment_count: 1,
	last_sync_at: "2026-08-27T15:42:00",
};

const ENG = {
	id: 5,
	code: "ENG 3300A",
	name: "Software Engineering",
	term: "2026F",
	instructor: "A. Chen",
	color: "#f59e0b",
	is_pilot: 1,
	is_active: 1,
	file_count: 9,
	assignment_count: 1,
	last_sync_at: "2026-08-27T15:42:00",
};

export const DEMO_COURSES = [CS, MATH, ENG];

const baseEvents = [
	{
		id: 101,
		course_id: 3,
		course_code: "MATH 1600A",
		kind: "class",
		title: "MATH 1600A Lecture",
		starts_at: "2026-08-28T08:30:00",
		ends_at: "2026-08-28T09:30:00",
	},
	{
		id: 102,
		course_id: 1,
		course_code: "CS 1100A",
		kind: "class",
		title: "CS 1100A Lab",
		starts_at: "2026-08-29T14:00:00",
		ends_at: "2026-08-29T16:00:00",
	},
	{
		id: 103,
		course_id: 1,
		course_code: "CS 1100A",
		kind: "assignment",
		title: "Assignment 1 — Control Flow",
		starts_at: "2026-08-29T23:59:00",
		ends_at: null,
	},
	{
		id: 104,
		course_id: 5,
		course_code: "ENG 3300A",
		kind: "assignment",
		title: "Lab Report 1 — Requirements",
		starts_at: "2026-08-30T23:59:00",
		ends_at: null,
	},
	{
		id: 105,
		course_id: 3,
		course_code: "MATH 1600A",
		kind: "assignment",
		title: "Problem Set 1 — Vectors",
		starts_at: "2026-09-01T17:00:00",
		ends_at: null,
	},
];

export function demoEvents(extended = false) {
	return baseEvents.map((event) =>
		event.id === 103 && extended
			? {
					...event,
					starts_at: "2026-08-31T23:59:00",
				}
			: { ...event },
	);
}

export const DEMO_DIGEST = {
	generated_at: "2026-08-27T15:42:00",
	source: "sync",
	markdown:
		"**3 deadlines** in the next 7 days.\\n\\n- **2 announcements** need a look in CS 1100A.\\n- Lab A moved to Lab C for Week 2.\\n- Your next focus: Assignment 1 — Control Flow.",
};

export const DEMO_SYNC_RUN = {
	id: 42,
	started_at: "2026-08-27T15:42:00",
	finished_at: "2026-08-27T15:42:18",
	status: "success",
	trigger: "manual",
	courses_processed: 3,
	files_new: 7,
	files_changed: 2,
	announcements_new: 4,
	facts_added: 3,
	log_path: "sync/42.md",
	error: null,
};

export const DEMO_SYNC_LOG = {
	markdown:
		"## Sync run 42\\n\\n- CS 1100A — 14 files scanned, 2 updated\\n- MATH 1600A — 11 files scanned\\n- ENG 3300A — 9 files scanned, 1 updated\\n- 4 announcements indexed\\n\\n**Status:** complete",
};

export const DEMO_HUB = {
	course: CS,
	announcements: [
		{
			id: 301,
			course_id: 1,
			course_code: "CS 1100A",
			title: "Assignment 1 Q&A Session",
			body: "Q&A for Assignment 1 on Friday at 4pm in Room 1120.",
			author: "J. Morgan",
			posted_at: "2026-08-26T14:30:00",
		},
		{
			id: 302,
			course_id: 1,
			course_code: "CS 1100A",
			title: "Lab A moved to Lab C for Week 2",
			body: "The lab is in Lab C this week due to maintenance.",
			author: "J. Morgan",
			posted_at: "2026-08-26T09:00:00",
		},
		{
			id: 303,
			course_id: 1,
			course_code: "CS 1100A",
			title: "Welcome to CS 1100A",
			body: "Install Python 3.12 before the first lecture.",
			author: "J. Morgan",
			posted_at: "2026-08-24T10:00:00",
		},
	],
	events: [demoEvents()[1]],
	assignments_upcoming: [
		{
			id: 401,
			course_id: 1,
			title: "Assignment 1 — Control Flow",
			description: "Branching, loops, and defensive input handling.",
			due_at: "2026-08-29T23:59:00",
			weight: 10,
			status: "open",
			closed: false,
			category: null,
		},
		{
			id: 402,
			course_id: 1,
			title: "Assignment 2 — Functions and Testing",
			description: "Write pure functions and a small test suite.",
			due_at: "2026-09-05T23:59:00",
			weight: 15,
			status: "open",
			closed: false,
			category: null,
		},
	],
	memory_facts: [
		{
			id: 501,
			fact: "Generated code must be understood line by line before submission.",
			category: "policy",
		},
	],
	recent_files: [
		{
			id: 201,
			course_id: 1,
			content_node_id: 102,
			path: "2026F/CS1100A/content/Module 1 - Course Overview/syllabus.md",
			kind: "markdown",
			processed: 1,
		},
		{
			id: 202,
			course_id: 1,
			content_node_id: 111,
			path: "2026F/CS1100A/content/Module 2 - Control Flow/lecture-04.pdf",
			kind: "pdf",
			processed: 1,
		},
	],
	stats: {
		file_count: 14,
		assignment_count: 2,
		processed_files: 14,
	},
};

export const DEMO_CONTENT_TREE = {
	nodes: [
		{
			id: 100,
			course_id: 1,
			parent_id: null,
			node_type: "module",
			title: "Module 1 — Course Overview",
			description: null,
			url: null,
			sort_order: 0,
		},
		{
			id: 101,
			course_id: 1,
			parent_id: 100,
			node_type: "topic",
			topic_type: "html",
			title: "Unit Introduction",
			description: "<p>Welcome to CS 1100A. Start here for the course map.</p>",
			url: null,
			sort_order: 0,
		},
		{
			id: 102,
			course_id: 1,
			parent_id: 100,
			node_type: "topic",
			topic_type: "file",
			title: "Syllabus",
			description: null,
			url: null,
			sort_order: 1,
		},
		{
			id: 110,
			course_id: 1,
			parent_id: null,
			node_type: "module",
			title: "Module 2 — Control Flow",
			description: null,
			url: null,
			sort_order: 1,
		},
		{
			id: 111,
			course_id: 1,
			parent_id: 110,
			node_type: "topic",
			topic_type: "file",
			title: "Lecture 04 — Functions & Testing",
			description: null,
			url: null,
			sort_order: 0,
		},
		{
			id: 120,
			course_id: 1,
			parent_id: null,
			node_type: "module",
			title: "Module 3 — Functions",
			description: null,
			url: null,
			sort_order: 2,
		},
	],
	files: [
		{
			id: 201,
			course_id: 1,
			content_node_id: 102,
			path: "2026F/CS1100A/content/Module 1 - Course Overview/syllabus.md",
			kind: "markdown",
			processed: 1,
		},
		{
			id: 202,
			course_id: 1,
			content_node_id: 111,
			path: "2026F/CS1100A/content/Module 2 - Control Flow/lecture-04.pdf",
			kind: "pdf",
			processed: 1,
		},
	],
	file_topics: [],
};

export const DEMO_FILE_CONTENT = {
	201: {
		content:
			"# CS 1100A — Introduction to Programming\\n\\n_Fall 2026 · J. Morgan · Mon/Wed 10:00, Room 1120_\\n\\n## Late policy\\n\\nAssignments submitted up to 48 hours late incur a penalty of 10 percent per day.\\n\\n## Collaboration\\n\\nDiscuss ideas freely — write your own code. Cite anything you use.\\n\\n## Academic integrity\\n\\nGenerated code must be understood line by line before submission.",
		format: "markdown",
		rawUrl: null,
	},
	202: {
		content:
			"# Lecture 04 — Functions & Testing\\n\\nA function maps inputs to outputs with no hidden state. Pure functions compose, test, and fail loudly.\\n\\n## Testing\\n\\nAssert on a table of inputs — the assertion is the spec.",
		format: "markdown",
		rawUrl: null,
	},
};

export const DEMO_SCHEDULE = [
	{
		id: 1,
		code: "CS 1100A",
		name: "Introduction to Programming",
		credit: "0.50",
		mode: "In person",
		blocks: [
			{
				type: "LEC",
				section: "A01",
				crn: 11001,
				instructor: "J. Morgan",
				meetings: [
					{ day: "M", start: "10:00 AM", end: "11:30 AM", room: "Room 1120" },
					{ day: "W", start: "10:00 AM", end: "11:30 AM", room: "Room 1120" },
				],
			},
			{
				type: "LAB",
				section: "L01",
				crn: 11002,
				instructor: "J. Morgan",
				meetings: [
					{ day: "F", start: "2:00 PM", end: "4:00 PM", room: "Lab A" },
				],
			},
		],
	},
	{
		id: 3,
		code: "MATH 1600A",
		name: "Linear Algebra for Engineers",
		credit: "0.50",
		mode: "In person",
		blocks: [
			{
				type: "LEC",
				section: "A01",
				crn: 16001,
				instructor: "R. Patel",
				meetings: [
					{ day: "M", start: "8:30 AM", end: "9:30 AM", room: "Room 1010" },
					{ day: "W", start: "8:30 AM", end: "9:30 AM", room: "Room 1010" },
					{ day: "F", start: "8:30 AM", end: "9:30 AM", room: "Room 1010" },
				],
			},
		],
	},
	{
		id: 5,
		code: "ENG 3300A",
		name: "Software Engineering",
		credit: "0.50",
		mode: "In person",
		blocks: [
			{
				type: "LEC",
				section: "A01",
				crn: 33001,
				instructor: "A. Chen",
				meetings: [
					{ day: "M", start: "3:30 PM", end: "5:00 PM", room: "Room 1210" },
					{ day: "W", start: "3:30 PM", end: "5:00 PM", room: "Room 1210" },
				],
			},
		],
	},
];

export function fixtureFor(url, extended = false) {
	const parsed = new URL(url);
	const path = parsed.pathname;
	if (path === "/api/auth/me") return { authenticated: true };
	if (path === "/api/courses" && !path.endsWith("/schedule")) {
		return DEMO_COURSES;
	}
	if (path === "/api/courses/schedule") return DEMO_SCHEDULE;
	if (path === "/api/courses/1") return CS;
	if (path === "/api/courses/1/hub") {
		return {
			...DEMO_HUB,
			assignments_upcoming: DEMO_HUB.assignments_upcoming.map((assignment) =>
				assignment.id === 401 && extended
					? { ...assignment, due_at: "2026-08-31T23:59:00", status: "extended" }
					: { ...assignment },
			),
		};
	}
	if (path === "/api/courses/1/content-tree") return DEMO_CONTENT_TREE;
	if (path === "/api/digest/latest") return DEMO_DIGEST;
	if (path === "/api/events/next-7-days") return demoEvents(extended);
	if (path === "/api/events") return demoEvents(extended);
	if (path === "/api/sync/status") {
		return { status: "idle", last_run: DEMO_SYNC_RUN, token_valid: true };
	}
	if (path === "/api/sync/runs") return [DEMO_SYNC_RUN];
	if (path === `/api/sync/runs/${DEMO_SYNC_RUN.id}/log`) return DEMO_SYNC_LOG;
	if (path === "/api/chat/models") {
		return {
			models: ["campus-demo/replay"],
			contexts: { "campus-demo/replay": 32_000 },
		};
	}
	if (path === "/api/chat/sessions") return [];
	if (path.startsWith("/api/files/") && path.endsWith("/content")) {
		const id = Number(path.split("/")[3]);
		return DEMO_FILE_CONTENT[id] ?? null;
	}
	return null;
}
