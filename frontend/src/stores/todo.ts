import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useGameStore } from './game';

export type RepeatRule =
  | { type: 'daily' }
  | { type: 'weekly'; dayOfWeek: number }   // 0=Sun..6=Sat
  | { type: 'monthly'; dayOfMonth: number }; // 1-31

export interface Subtask {
  id: string;
  text: string;
  done: boolean;
}

export interface Todo {
  id: string;
  title: string;
  memo: string;
  dueDate: string | null;       // 'YYYY-MM-DD'
  groupId: string | null;
  repeat: RepeatRule | null;
  status: 'active' | 'done';
  subtasks: Subtask[];
  createdAt: number;
  completedAt: number | null;
}

export interface TodoGroup {
  id: string;
  name: string;
  color: number; // 0-4
  sortOrder: number;
}

const GROUP_COLORS = [
  { band: '#e6c832', bg: '#fdf6d0', name: 'Yellow' },
  { band: '#5aad5e', bg: '#ddf2dd', name: 'Green' },
  { band: '#4088c4', bg: '#d6e8f7', name: 'Blue' },
  { band: '#e06b6b', bg: '#fce0e0', name: 'Red' },
  { band: '#a85e90', bg: '#f0dce8', name: 'Purple' },
];

export { GROUP_COLORS };

export const useTodoStore = defineStore('todo', () => {
  const todos = ref<Todo[]>(loadFromStorage('tomado_todos', []));
  const groups = ref<TodoGroup[]>(loadFromStorage('tomado_groups', []));
  const dailyCompleted = ref(loadDailyCount());

  // --- Computed ---
  const activeTodos = computed(() => todos.value.filter(t => t.status === 'active'));
  const doneTodos = computed(() => todos.value.filter(t => t.status === 'done'));

  /** Group active todos by groupId (null = ungrouped) */
  const todosByGroup = computed(() => {
    const map = new Map<string | null, Todo[]>();
    for (const t of activeTodos.value) {
      const key = t.groupId;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  });

  const sortedGroups = computed(() =>
    [...groups.value].sort((a, b) => a.sortOrder - b.sortOrder)
  );

  // --- Todo CRUD ---

  function addTodo(data: {
    title: string;
    memo?: string;
    dueDate?: string | null;
    groupId?: string | null;
    repeat?: RepeatRule | null;
  }) {
    const todo: Todo = {
      id: crypto.randomUUID(),
      title: data.title,
      memo: data.memo ?? '',
      dueDate: data.dueDate ?? null,
      groupId: data.groupId ?? null,
      repeat: data.repeat ?? null,
      status: 'active',
      subtasks: [],
      createdAt: Date.now(),
      completedAt: null,
    };
    todos.value.unshift(todo);
    save();
    return todo;
  }

  function updateTodo(id: string, data: Partial<Pick<Todo, 'title' | 'memo' | 'dueDate' | 'groupId' | 'repeat'>>) {
    const todo = todos.value.find(t => t.id === id);
    if (!todo) return;
    if (data.title !== undefined) todo.title = data.title;
    if (data.memo !== undefined) todo.memo = data.memo;
    if (data.dueDate !== undefined) todo.dueDate = data.dueDate;
    if (data.groupId !== undefined) todo.groupId = data.groupId;
    if (data.repeat !== undefined) todo.repeat = data.repeat;
    save();
  }

  function canComplete(todo: Todo): boolean {
    if (todo.status !== 'active') return false;
    // Repeat tasks with a future due date cannot be completed yet
    if (todo.repeat && todo.dueDate) {
      const today = todayLocal();
      if (todo.dueDate > today) return false;
    }
    return true;
  }

  function completeTodo(id: string) {
    const todo = todos.value.find(t => t.id === id);
    if (!todo || !canComplete(todo)) return;
    todo.status = 'done';
    todo.completedAt = Date.now();
    dailyCompleted.value++;
    saveDailyCount(dailyCompleted.value);
    save();

    // Game integration: stamina, undo, item rights
    const gameStore = useGameStore();
    gameStore.onTodoCompleted();

    // Regenerate if repeat rule is set
    if (todo.repeat) {
      // Only compute next due date if the original had one;
      // otherwise keep it null so the task stays completable anytime.
      const nextDate = todo.dueDate
        ? computeNextDate(todo.repeat, todo.dueDate)
        : null;
      addTodo({
        title: todo.title,
        memo: todo.memo,
        dueDate: nextDate,
        groupId: todo.groupId,
        repeat: todo.repeat,
      });
    }
  }

  function deleteTodo(id: string) {
    todos.value = todos.value.filter(t => t.id !== id);
    save();
  }

  // --- Subtask ---

  function addSubtask(todoId: string, text: string) {
    const todo = todos.value.find(t => t.id === todoId);
    if (!todo) return;
    todo.subtasks.push({ id: crypto.randomUUID(), text, done: false });
    save();
  }

  function toggleSubtask(todoId: string, subtaskId: string) {
    const todo = todos.value.find(t => t.id === todoId);
    if (!todo) return;
    const sub = todo.subtasks.find(s => s.id === subtaskId);
    if (sub) sub.done = !sub.done;
    save();
  }

  function deleteSubtask(todoId: string, subtaskId: string) {
    const todo = todos.value.find(t => t.id === todoId);
    if (!todo) return;
    todo.subtasks = todo.subtasks.filter(s => s.id !== subtaskId);
    save();
  }

  // --- Groups ---

  function addGroup(name: string, color: number) {
    if (groups.value.length >= 5) return;
    const group: TodoGroup = {
      id: crypto.randomUUID(),
      name,
      color,
      sortOrder: groups.value.length,
    };
    groups.value.push(group);
    save();
    return group;
  }

  function updateGroup(id: string, data: Partial<Pick<TodoGroup, 'name' | 'color'>>) {
    const group = groups.value.find(g => g.id === id);
    if (!group) return;
    if (data.name !== undefined) group.name = data.name;
    if (data.color !== undefined) group.color = data.color;
    save();
  }

  function deleteGroup(id: string) {
    groups.value = groups.value.filter(g => g.id !== id);
    // Unassign todos from deleted group
    for (const t of todos.value) {
      if (t.groupId === id) t.groupId = null;
    }
    save();
  }

  // --- Persistence ---

  function save() {
    localStorage.setItem('tomado_todos', JSON.stringify(todos.value));
    localStorage.setItem('tomado_groups', JSON.stringify(groups.value));
  }

  return {
    todos, groups, dailyCompleted,
    activeTodos, doneTodos, todosByGroup, sortedGroups,
    addTodo, updateTodo, completeTodo, canComplete, deleteTodo,
    addSubtask, toggleSubtask, deleteSubtask,
    addGroup, updateGroup, deleteGroup,
  };
});

// --- Helpers ---

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadDailyCount(): number {
  try {
    const raw = localStorage.getItem('tomado_daily');
    if (!raw) return 0;
    const data = JSON.parse(raw);
    const today = todayLocal();
    return data.date === today ? data.count : 0;
  } catch {
    return 0;
  }
}

function saveDailyCount(count: number) {
  const today = todayLocal();
  localStorage.setItem('tomado_daily', JSON.stringify({ date: today, count }));
}

function computeNextDate(rule: RepeatRule, currentDueDate: string | null): string {
  const base = currentDueDate ? new Date(currentDueDate + 'T00:00:00') : new Date();

  switch (rule.type) {
    case 'daily': {
      const next = new Date(base);
      next.setDate(next.getDate() + 1);
      return fmt(next);
    }
    case 'weekly': {
      const next = new Date(base);
      next.setDate(next.getDate() + 1); // at least next day
      while (next.getDay() !== rule.dayOfWeek) {
        next.setDate(next.getDate() + 1);
      }
      return fmt(next);
    }
    case 'monthly': {
      const next = new Date(base);
      next.setMonth(next.getMonth() + 1);
      // Clamp day to valid range for the month
      const day = Math.min(rule.dayOfMonth, daysInMonth(next.getFullYear(), next.getMonth()));
      next.setDate(day);
      return fmt(next);
    }
  }
}

function todayLocal(): string {
  return fmt(new Date());
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
