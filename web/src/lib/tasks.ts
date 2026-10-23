import type { Task } from './api';

export interface TaskGroup { key: 'overdue' | 'today' | 'week' | 'later'; title: string; tone: string; items: Task[] }

/** Podział zadań: zaległe, dziś, najbliższe 7 dni (od jutra) i później. */
export function groupTasks(tasks: Task[]): TaskGroup[] {
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday); startTomorrow.setDate(startTomorrow.getDate() + 1);
  const afterWeek = new Date(startTomorrow); afterWeek.setDate(afterWeek.getDate() + 7);
  const groups: TaskGroup[] = [
    { key: 'overdue', title: 'Zaległe', tone: 'text-red-600', items: [] },
    { key: 'today', title: 'Dziś', tone: 'text-brand-600', items: [] },
    { key: 'week', title: 'Najbliższe 7 dni', tone: 'text-slate-700', items: [] },
    { key: 'later', title: 'Później', tone: 'text-slate-500', items: [] },
  ];
  for (const t of tasks) {
    const d = new Date(t.dueAt);
    groups[d < startToday ? 0 : d < startTomorrow ? 1 : d < afterWeek ? 2 : 3].items.push(t);
  }
  return groups;
}
