import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { pathFor, rootBranches, tipOf, type TreeNode } from './chatTree.ts'

const node = (
	id: string,
	parentId: string | null = null,
	extra: Partial<TreeNode> = {},
): TreeNode => ({
	id,
	parentId,
	children: [],
	role: 'user',
	...extra,
})

/** Build a tree from [id, parentId, role] triples, filling in `children`. */
const tree = (
	rows: [string, string | null, string?][],
): TreeNode[] => {
	const nodes = rows.map(([id, parentId, role]) =>
		node(id, parentId, role ? { role } : {}),
	)
	const byId = new Map(nodes.map((n) => [n.id, n]))
	for (const n of nodes) {
		if (n.parentId) byId.get(n.parentId)?.children.push(n.id)
	}
	return nodes
}

/** u1 → a1 → u2 → a2, with a regenerated answer a1b forking at u1. */
const forked = () =>
	tree([
		['u1', null, 'user'],
		['a1', 'u1', 'assistant'],
		['u2', 'a1', 'user'],
		['a2', 'u2', 'assistant'],
		['a1b', 'u1', 'assistant'],
	])

describe('pathFor', () => {
	it('walks parents up from the active node', () => {
		const nodes = forked()
		assert.deepEqual(
			pathFor({ nodes, activeNodeId: 'a2' }).map((n) => n.id),
			['u1', 'a1', 'u2', 'a2'],
		)
	})

	it('is empty with no active node, and survives a cycle', () => {
		assert.deepEqual(pathFor({ nodes: forked(), activeNodeId: null }), [])
		const cyclic = [node('a', 'b'), node('b', 'a')]
		assert.equal(pathFor({ nodes: cyclic, activeNodeId: 'a' }).length, 2)
	})
})

describe('tipOf', () => {
	// The regression: clicking the chip for the fork child pointed the reader at
	// a one-message stub and hid the rest of that branch.
	it('descends past a fork child to the end of that branch', () => {
		assert.equal(tipOf(forked(), 'a1'), 'a2')
	})

	it('stops at the leaf of the chosen branch', () => {
		assert.equal(tipOf(forked(), 'a1b'), 'a1b')
	})

	it('returns the reader to where they were inside the branch', () => {
		assert.equal(tipOf(forked(), 'a1', 'a2'), 'a2')
		// a different branch's tip is not "inside" this one
		assert.equal(tipOf(forked(), 'a1', 'a1b'), 'a2')
	})

	it('never descends into a tool node', () => {
		const nodes = tree([
			['u1', null, 'user'],
			['a1', 'u1', 'assistant'],
			['t1', 'a1', 'tool'],
		])
		assert.equal(tipOf(nodes, 'a1'), 'a1')
	})

	it('leaves an unknown start alone', () => {
		assert.equal(tipOf(forked(), 'ghost'), 'ghost')
	})
})

describe('rootBranches', () => {
	it('is a single root for a normal conversation', () => {
		assert.deepEqual(
			rootBranches(forked()).map((n) => n.id),
			['u1'],
		)
	})

	it('exposes both roots after the first message is deleted', () => {
		// deleteMessage rejoins a1 and a1b to null, leaving two starting points
		const nodes = tree([
			['a1', null, 'assistant'],
			['u2', 'a1', 'user'],
			['a2', 'u2', 'assistant'],
			['a1b', null, 'assistant'],
		])
		assert.deepEqual(
			rootBranches(nodes).map((n) => n.id),
			['a1', 'a1b'],
		)
	})

	it('skips tool nodes and mid-turn narration', () => {
		const nodes = tree([
			['a1', null, 'assistant'],
			['t1', 'a1', 'tool'],
			['n1', 'a1', 'assistant'],
		])
		nodes[2]!.intermediate = true
		assert.deepEqual(
			rootBranches(nodes).map((n) => n.id),
			['a1'],
		)
	})
})
