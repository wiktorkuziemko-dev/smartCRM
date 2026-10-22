import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Task } from '../lib/api';
import { seesAll, useMe, useTasks, useUsers } from '../lib/queries';
import { TaskForm } from '../components/TaskForm';
import { TaskItem } from '../components/TaskItem';
import { Button, Empty } from '../components/ui';

function groupTasks(tasks: Task[]) {
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday); startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startAfter = new Date(startTomorrow); startAfter.setDate(startAfter.getDate() + 1);
  const groups = [
    { title: 'Zaległe', tone: 'text-red-600', items: [] as Task[] },
    { title: 'Dziś', tone: 'text-brand-600', items: [] as Task[] },
    { title: 'Jutro', tone: 'text-slate-700', items: [] as Task[] },
    { title: 'Później', tone: 'text-slate-700', items: [] as Task[] },
  ];
  for (const t of tasks) {
    const d = new Date(t.dueAt);
    const i = d < startToday ? 0 : d < startTomorrow ? 1 : d < startAfter ? 2 : 3;
    groups[i].items.push(t);
  }
  return groups;
}

export function TasksPage() {
  const { data: me } = useMe();
  const { data: users = [] } = useUsers();
  const [assignee, setAssignee] = useState<string>('me');
  const [showDone, setShowDone] = useState(false);
  const [form, setForm] = useState<{ task?: Task } | null>(null);

  const assigneeId = assignee === 'me' ? me?.id : assignee === 'all' ? undefined : Number(assignee);
  const { data: open = [] } = useTasks({ assigneeId, status: 'open' });
  const { data: done = [] } = useTasks({ assigneeId, status: 'done' });
  const showAssignee = assignee !== 'me';

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{assignee === 'me' ? 'Moje zadania' : 'Zadania'}</h1>
        {seesAll(me) && (
          <select className="input w-auto" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="me">Moje</option>
            <option value="all">Wszystkich handlowców</option>
            {users.filter((u) => u.id !== me?.id).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        )}
        <Button onClick={() => setForm({})}><Plus size={16} /> Nowe zadanie</Button>
      </div>

      <div className="space-y-5">
        {groupTasks(open).filter((g) => g.items.length || g.title === 'Dziś').map((g) => (
          <section key={g.title}>
            <h2 className={`mb-2 text-sm font-semibold ${g.tone}`}>{g.title} <span className="font-normal text-slate-400">{g.items.length}</span></h2>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {g.items.length ? g.items.map((t) => <TaskItem key={t.id} task={t} showAssignee={showAssignee} onOpen={() => setForm({ task: t })} />)
                : <Empty>Nic na dziś – dobra robota! 🎉</Empty>}
            </div>
          </section>
        ))}

        <section>
          <button onClick={() => setShowDone((v) => !v)} className="text-sm font-medium text-slate-500 hover:text-slate-700">
            {showDone ? 'Ukryj' : 'Pokaż'} wykonane ({done.length})
          </button>
          {showDone && done.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {done.slice().reverse().slice(0, 100).map((t) => <TaskItem key={t.id} task={t} showAssignee={showAssignee} onOpen={() => setForm({ task: t })} />)}
            </div>
          )}
        </section>
      </div>

      {form && <TaskForm task={form.task} onClose={() => setForm(null)} />}
    </div>
  );
}
