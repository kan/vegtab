import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface Todo {
  id: string;
  title: string;
  memo: string;
  dueDate: string | null;
  groupId: string | null;
  status: 'active' | 'done';
  subtasks: { text: string; done: boolean }[];
  createdAt: number;
  completedAt: number | null;
}

export interface TodoGroup {
  id: string;
  name: string;
  color: number; // 0-4
  sortOrder: number;
}

export const useTodoStore = defineStore('todo', () => {
  const todos = ref<Todo[]>(loadFromStorage('tomado_todos', []));
  const groups = ref<TodoGroup[]>(loadFromStorage('tomado_groups', []));
  const dailyCompleted = ref(loadDailyCount());

  const activeTodos = computed(() => todos.value.filter(t => t.status === 'active'));
  const doneTodos = computed(() => todos.value.filter(t => t.status === 'done'));

  function addTodo(title: string, groupId: string | null = null) {
    const todo: Todo = {
      id: crypto.randomUUID(),
      title,
      memo: '',
      dueDate: null,
      groupId,
      status: 'active',
      subtasks: [],
      createdAt: Date.now(),
      completedAt: null,
    };
    todos.value.unshift(todo);
    save();
  }

  function completeTodo(id: string) {
    const todo = todos.value.find(t => t.id === id);
    if (todo && todo.status === 'active') {
      todo.status = 'done';
      todo.completedAt = Date.now();
      dailyCompleted.value++;
      saveDailyCount();
      save();
    }
  }

  function deleteTodo(id: string) {
    todos.value = todos.value.filter(t => t.id !== id);
    save();
  }

  function addGroup(name: string, color: number) {
    const group: TodoGroup = {
      id: crypto.randomUUID(),
      name,
      color,
      sortOrder: groups.value.length,
    };
    groups.value.push(group);
    save();
  }

  function save() {
    localStorage.setItem('tomado_todos', JSON.stringify(todos.value));
    localStorage.setItem('tomado_groups', JSON.stringify(groups.value));
  }

  return {
    todos, groups, dailyCompleted,
    activeTodos, doneTodos,
    addTodo, completeTodo, deleteTodo, addGroup,
  };
});

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
    const today = new Date().toISOString().slice(0, 10);
    return data.date === today ? data.count : 0;
  } catch {
    return 0;
  }
}

function saveDailyCount() {
  const today = new Date().toISOString().slice(0, 10);
  const store = useTodoStore();
  localStorage.setItem('tomado_daily', JSON.stringify({ date: today, count: store.dailyCompleted }));
}
