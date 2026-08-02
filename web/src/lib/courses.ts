import type { Course } from '@/types'

const PALETTE = ['#a179f0', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#f472b6']

export function courseColor(course: Pick<Course, 'id' | 'color'>): string {
  return course.color ?? PALETTE[course.id % PALETTE.length]
}
