import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	capForCache,
	removedIds,
	sessionSignature,
	unionNodes,
	type MergeNode,
} from './chatMerge.ts'

const node = (id: string, extra: Record<string, unknown> = {}): MergeNode => ({
	id,
	parentId: null,
	children: [],
	role: 'user',
	content: `c-${id}`,
	...extra,
})

describe('unionNodes', () => {
	it('keeps nodes only one side has', () => {
		const local = [node('a'), node('b')]
		const server = [node('a'), node('c')]
		const ids = unionNodes(local, server).map((n) => n.id)
		assert.deepEqual(ids.sort(), ['a', 'b', 'c'])
	})

	it('is the phone-overwrites-desktop regression', () => {
		// desktop produced c; the phone never saw it
		const phone = [node('a'), node('b')]
		const server = [node('a'), node('b'), node('c')]
		const merged = unionNodes(phone, server)
		assert.equal(merged.length, 3)
		assert.ok(merged.some((n) => n.id === 'c'))
	})

	it('keeps the local copy of a shared node', () => {
		const local = [node('a', { content: 'with steps', steps: [{ k: 1 }] })]
		const server = [node('a', { content: 'older' })]
		const merged = unionNodes(local, server)
		assert.equal(merged[0].content, 'with steps')
		assert.deepEqual(merged[0].steps, [{ k: 1 }])
	})

	it('lets the server fill an empty local node', () => {
		// the stream broke after the server had already finished the answer
		const local = [node('a', { content: '', streaming: false })]
		const server = [node('a', { content: 'the full answer' })]
		const merged = unionNodes(local, server)
		assert.equal(merged[0].content, 'the full answer')
	})

	it('never overwrites a node that is still streaming', () => {
		const local = [node('a', { content: '', streaming: true })]
		const server = [node('a', { content: 'stale' })]
		assert.equal(unionNodes(local, server)[0].content, '')
	})

	it('adopts the finished answer over a local error notice', () => {
		// server finished the turn; this browser only got as far as a ⚠ notice
		const local = [
			node('a1', { role: 'assistant', content: '⚠ Stream failed: Error in input stream' }),
		]
		const server = [
			node('a1', {
				role: 'assistant',
				content:
					'Here is the full worked answer, which the server finished writing while the browser was losing the stream.',
			}),
		]
		const merged = unionNodes(local, server)
		assert.ok((merged[0]?.content ?? '').startsWith('Here is the full worked answer'))
	})

	it('keeps a shorter local user edit', () => {
		const local = [node('u', { content: 'shorter' })]
		const server = [node('u', { content: 'a much longer original question' })]
		assert.equal(unionNodes(local, server)[0].content, 'shorter')
	})

	it('unions children so a branch is not lost', () => {
		const local = [node('a', { children: ['x'] })]
		const server = [node('a', { children: ['y', 'x'] })]
		const merged = unionNodes(local, server)
		assert.deepEqual(merged[0].children, ['x', 'y'])
	})

	it('survives junk entries', () => {
		const merged = unionNodes(
			[{ nope: 1 } as never, node('a')],
			[null as never, node('b')],
		)
		assert.deepEqual(merged.map((n) => n.id).sort(), ['a', 'b'])
	})
})

describe('sessionSignature', () => {
	it('changes when content grows', () => {
		const s = { nodes: [node('a', { content: 'one' })], title: 't' }
		const grew = { nodes: [node('a', { content: 'one two' })], title: 't' }
		assert.notEqual(sessionSignature(s), sessionSignature(grew))
	})

	it('is stable for an identical session', () => {
		const s = { nodes: [node('a')], title: 't', activeNodeId: 'a' }
		const copy = { nodes: [node('a')], title: 't', activeNodeId: 'a' }
		assert.equal(sessionSignature(s), sessionSignature(copy))
	})

	it('notices a rename and a branch switch', () => {
		const base = { nodes: [node('a'), node('b')], title: 't', activeNodeId: 'a' }
		assert.notEqual(
			sessionSignature(base),
			sessionSignature({ ...base, title: 'renamed' }),
		)
		assert.notEqual(
			sessionSignature(base),
			sessionSignature({ ...base, activeNodeId: 'b' }),
		)
	})
})

describe('removedIds', () => {
	it('reports exactly what disappeared', () => {
		assert.deepEqual(removedIds(['a', 'b', 'c'], new Set(['a', 'c'])), ['b'])
	})
	it('reports nothing when the set only grew', () => {
		assert.deepEqual(removedIds(['a'], new Set(['a', 'b'])), [])
	})
})

describe('capForCache', () => {
	it('keeps the newest sessions and drops the rest', () => {
		const big = (id: string, at: number, size: number) => ({
			id,
			updatedAt: at,
			nodes: [node(`${id}-n`, { content: 'x'.repeat(size) })],
		})
		const sessions = [
			big('old', 1, 400),
			big('new', 3, 400),
			big('mid', 2, 400),
		]
		const kept = capForCache(sessions, 1200)
		assert.deepEqual(kept.map((s) => s.id), ['new', 'mid'])
	})

	it('never returns nothing, even for one oversized session', () => {
		const huge = { id: 'h', updatedAt: 1, nodes: [node('n', { content: 'x'.repeat(5000) })] }
		assert.equal(capForCache([huge], 100).length, 1)
	})

	it('fits the whole list when the budget allows', () => {
		const s = [
			{ updatedAt: 1, nodes: [node('a')] },
			{ updatedAt: 2, nodes: [node('b')] },
		]
		assert.equal(capForCache(s, 10_000_000).length, 2)
	})
})
