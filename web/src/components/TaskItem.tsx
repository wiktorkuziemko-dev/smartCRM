import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Clock } from 'lucide-react';
import { api, type Task } from '../lib/api';
import { fmtDue, isOverdue } from '../lib/format';
import { Avatar } from './ui';

export function TaskItem({ task, onOpen, showClient = true, showAssignee = false }: {
  task: Task; onOpen: () => void; showClient?: boolean; showAssignee?: boolean;
}) {
  const qc = useQueryClient();
  const overdue = !task.done && isOverdue(task.dueAt);

  async function toggle() {
    await api.put(`/api/tasks/${task.id}`, { done: !task.done });
    await Promise.all([qc.invalidateQueries({ queryKey: ['tasks'] }), qc.invalidateQueries({ queryKey: ['clients'] })]);
  }

  return (
    <div className="group flex items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-0 hover:bg-slate-50">
      <button onClick={toggle} title={task.done ? 'Oznacz jako niewykonane' : 'Oznacz jako wykonane'}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${task.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500'}`}>
        <Check size={12} strokeWidth={3} />
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={`truncate text-sm ${task.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{task.title}</div>
        {showClient && task.clientName && (
          <Link to={`/clients/${task.clientId}`} onClick={(e) => e.stopPropagation()} className="text-xs text-brand-600 hover:underline">{task.clientName}</Link>
        )}
      </button>
      <span className={`inline-flex shrink-0 items-center gap-1 text-xs ${overdue ? 'font-medium text-red-600' : 'text-slate-500'}`}>
        <Clock size={12} /> {fmtDue(task.dueAt)}
      </span>
      {showAssignee && <Avatar name={task.assigneeName} size={24} />}
    </div>
  );
}
