import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Task } from '../lib/api';
import { seesAll, useMe, useNavLabels, useTasks, useUsers } from '../lib/queries';
import { TaskForm } from '../components/TaskForm';
import { TaskItem } from '../components/TaskItem';
import { Button, Empty } from '../components/ui';
import { groupTasks } from '../lib/tasks';


export function TasksPage() {
  const labels = useNavLabels();
  const { data: me } = useMe();
  const { data: users = [] } = useUsers();
  const [assignee, setAssignee] = useState<string>('me');
  const [showDone, setShowDone] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const [form, setForm] = useState<{ task?: Task } | null>(null);

  const assigneeId = assignee === 'me' ? me?.id : assignee === 'all' ? undefined : Number(assignee);
  const { data: open = [] } = useTasks({ assigneeId, status: 'open' });
  const { data: done = [] } = useTasks({ assigneeId, status: 'done' });
  const showAssignee = assignee !== 'me';

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{assignee === 'me' ? labels.tasks : 'Zadania'}</h1>
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
        {groupTasks(open).filter((g) => g.key === 'today' || g.key === 'week' || g.items.length).map((g) => (
          <section key={g.key}>
            {g.key === 'later' ? (
              <button onClick={() => setShowLater((v) => !v)} className="mb-2 text-sm font-semibold text-slate-500 hover:text-slate-700">
                {showLater ? 'Ukryj' : 'Pokaż'} późniejsze <span className="font-normal text-slate-400">{g.items.length}</span>
              </button>
            ) : (
              <h2 className={`mb-2 text-sm font-semibold ${g.tone}`}>{g.title} <span className="font-normal text-slate-400">{g.items.length}</span></h2>
            )}
            {(g.key !== 'later' || showLater) && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {g.items.length ? g.items.map((t) => <TaskItem key={t.id} task={t} showAssignee={showAssignee} onOpen={() => setForm({ task: t })} />)
                  : <Empty>{g.key === 'today' ? 'Nic na dziś – dobra robota! 🎉' : 'Brak zadań w najbliższym tygodniu.'}</Empty>}
              </div>
            )}
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
