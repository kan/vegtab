<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTodoStore, GROUP_COLORS, type RepeatRule, type Todo } from '@/stores/todo';
import { formatDateLocal } from '@/utils/date';

const { t } = useI18n();
const store = useTodoStore();

// --- Add / Edit form ---
const showForm = ref(false);
const editingId = ref<string | null>(null);
const formTitle = ref('');
const formMemo = ref('');
const formDueDate = ref('');
const formGroupId = ref<string | null>(null);
const formRepeatType = ref<'none' | 'daily' | 'weekly' | 'monthly'>('none');
const formRepeatDow = ref(1);   // Monday
const formRepeatDom = ref(1);   // 1st

function openAddForm() {
  editingId.value = null;
  formTitle.value = '';
  formMemo.value = '';
  formDueDate.value = '';
  formGroupId.value = null;
  formRepeatType.value = 'none';
  formRepeatDow.value = 1;
  formRepeatDom.value = 1;
  showForm.value = true;
}

function openEditForm(todo: Todo) {
  editingId.value = todo.id;
  formTitle.value = todo.title;
  formMemo.value = todo.memo;
  formDueDate.value = todo.dueDate ?? '';
  formGroupId.value = todo.groupId;
  if (!todo.repeat) {
    formRepeatType.value = 'none';
  } else {
    formRepeatType.value = todo.repeat.type;
    if (todo.repeat.type === 'weekly') formRepeatDow.value = todo.repeat.dayOfWeek;
    if (todo.repeat.type === 'monthly') formRepeatDom.value = todo.repeat.dayOfMonth;
  }
  showForm.value = true;
}

function saveForm() {
  const title = formTitle.value.trim();
  if (!title) return;
  const repeat = buildRepeat();
  if (editingId.value) {
    store.updateTodo(editingId.value, {
      title,
      memo: formMemo.value,
      dueDate: formDueDate.value || null,
      groupId: formGroupId.value,
      repeat,
    });
  } else {
    store.addTodo({
      title,
      memo: formMemo.value,
      dueDate: formDueDate.value || null,
      groupId: formGroupId.value,
      repeat,
    });
  }
  showForm.value = false;
}

function buildRepeat(): RepeatRule | null {
  switch (formRepeatType.value) {
    case 'daily': return { type: 'daily' };
    case 'weekly': return { type: 'weekly', dayOfWeek: formRepeatDow.value };
    case 'monthly': return { type: 'monthly', dayOfMonth: formRepeatDom.value };
    default: return null;
  }
}

// --- Group management ---
const showGroupForm = ref(false);
const groupFormName = ref('');
const groupFormColor = ref(0);

function openGroupForm() {
  groupFormName.value = '';
  groupFormColor.value = nextAvailableColor();
  showGroupForm.value = true;
}

function saveGroup() {
  const name = groupFormName.value.trim();
  if (!name) return;
  store.addGroup(name, groupFormColor.value);
  showGroupForm.value = false;
}

function nextAvailableColor(): number {
  const used = new Set(store.groups.map(g => g.color));
  for (let i = 0; i < 5; i++) {
    if (!used.has(i)) return i;
  }
  return 0;
}

// --- Collapse state ---
const collapsedGroups = ref(new Set<string | null>());

function toggleGroup(groupId: string | null) {
  if (collapsedGroups.value.has(groupId)) {
    collapsedGroups.value.delete(groupId);
  } else {
    collapsedGroups.value.add(groupId);
  }
}

// --- Expand task (subtasks / memo) ---
const expandedTodo = ref<string | null>(null);
const newSubtaskText = ref('');

function toggleExpand(id: string) {
  expandedTodo.value = expandedTodo.value === id ? null : id;
  newSubtaskText.value = '';
}

function addSubtask(todoId: string) {
  const text = newSubtaskText.value.trim();
  if (!text) return;
  store.addSubtask(todoId, text);
  newSubtaskText.value = '';
}

// --- Delete confirmation ---
const deleteTargetId = ref<string | null>(null);

function confirmDelete(id: string) {
  deleteTargetId.value = id;
}

function executeDelete() {
  if (deleteTargetId.value) {
    store.deleteTodo(deleteTargetId.value);
    if (expandedTodo.value === deleteTargetId.value) expandedTodo.value = null;
    deleteTargetId.value = null;
  }
}

function clearAllDone() {
  for (const todo of [...store.doneTodos]) {
    store.deleteTodo(todo.id);
  }
}

// --- Done section ---
const showDone = ref(false);

// --- Display helpers ---
const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function repeatLabel(r: RepeatRule | null): string {
  if (!r) return '';
  switch (r.type) {
    case 'daily': return t('todo.daily');
    case 'weekly': return t('todo.weeklyDay', { day: t(`weekdays.${DOW_KEYS[r.dayOfWeek]}`) });
    case 'monthly': return t('todo.monthlyDay', { day: r.dayOfMonth });
  }
}

const fmtLocal = formatDateLocal;

function dueDateLabel(d: string): string {
  const today = fmtLocal(new Date());
  if (d === today) return t('todo.today');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d === fmtLocal(tomorrow)) return t('todo.tomorrow');
  // Show month/day
  const parts = d.split('-');
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

function isOverdue(d: string): boolean {
  return d < fmtLocal(new Date());
}

const ungroupedTodos = computed(() => store.todosByGroup.get(null) ?? []);

/** Groups in sort order (including empty ones) */
const groupOrder = computed(() => {
  const order: { groupId: string; group: typeof store.sortedGroups[0] }[] = [];
  for (const g of store.sortedGroups) {
    order.push({ groupId: g.id, group: g });
  }
  return order;
});

function groupColor(groupId: string | null): string {
  if (!groupId) return '#999';
  const g = store.groups.find(g => g.id === groupId);
  return g ? GROUP_COLORS[g.color].band : '#999';
}
</script>

<template>
  <div class="todo-view">
    <header class="todo-header">
      <h1>{{ t('todo.title') }}</h1>
      <div class="daily-progress">
        <span class="daily-count">{{ store.dailyCompleted }}</span>
        <span class="daily-label">{{ t('todo.doneToday') }}</span>
      </div>
    </header>

    <!-- Quick add -->
    <div class="quick-actions">
      <button class="add-btn" @click="openAddForm">{{ t('todo.newTask') }}</button>
      <button v-if="store.groups.length < 5" class="group-btn" @click="openGroupForm">{{ t('todo.newGroup') }}</button>
    </div>

    <!-- Task list -->
    <div class="todo-list">
      <!-- Ungrouped todos (no header) -->
      <div
        v-for="todo in ungroupedTodos"
        :key="todo.id"
        class="todo-item"
      >
        <div class="todo-row">
          <button
            class="check-btn"
            :class="{ 'check-disabled': !store.canComplete(todo) }"
            :disabled="!store.canComplete(todo)"
            @click="store.completeTodo(todo.id)"
          >
            <span class="check-circle" />
          </button>
          <div class="todo-content" @click="toggleExpand(todo.id)">
            <span class="todo-title">{{ todo.title }}</span>
            <div class="todo-meta">
              <span v-if="todo.dueDate" class="todo-due" :class="{ overdue: isOverdue(todo.dueDate) }">
                {{ dueDateLabel(todo.dueDate) }}
              </span>
              <span v-if="todo.repeat" class="todo-repeat">{{ repeatLabel(todo.repeat) }}</span>
              <span v-if="todo.subtasks.length > 0" class="todo-subtask-count">
                {{ todo.subtasks.filter(s => s.done).length }}/{{ todo.subtasks.length }}
              </span>
            </div>
          </div>
          <button class="edit-btn" @click="openEditForm(todo)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <!-- Expanded: memo + subtasks -->
        <div v-if="expandedTodo === todo.id" class="todo-expanded">
          <div v-if="todo.memo" class="todo-memo">{{ todo.memo }}</div>
          <div v-if="todo.subtasks.length > 0 || todo.status === 'active'" class="subtask-section">
            <div v-for="sub in todo.subtasks" :key="sub.id" class="subtask-item">
              <button class="subtask-check" :class="{ checked: sub.done }" @click="store.toggleSubtask(todo.id, sub.id)">
                <span v-if="sub.done" class="subtask-checkmark">&#x2713;</span>
              </button>
              <span class="subtask-text" :class="{ 'subtask-done': sub.done }">{{ sub.text }}</span>
              <button class="subtask-delete" @click="store.deleteSubtask(todo.id, sub.id)">&times;</button>
            </div>
            <div v-if="todo.status === 'active'" class="subtask-add">
              <input v-model="newSubtaskText" class="subtask-input" :placeholder="t('todo.addSubtask')" @keydown.enter="addSubtask(todo.id)" />
              <button class="subtask-add-btn" @click="addSubtask(todo.id)">+</button>
            </div>
          </div>
          <button class="expanded-delete-btn" @click="confirmDelete(todo.id)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4l.5 8h6l.5-8" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Grouped todos -->
      <template v-for="entry in groupOrder" :key="entry.groupId">
        <div class="group-header" @click="toggleGroup(entry.groupId)">
          <span class="group-color-dot" :style="{ background: groupColor(entry.groupId) }" />
          <span class="group-name">{{ entry.group.name }}</span>
          <span class="group-count">{{ (store.todosByGroup.get(entry.groupId) ?? []).length }}</span>
          <span class="group-chevron">{{ collapsedGroups.has(entry.groupId) ? '\u25B6' : '\u25BC' }}</span>
          <button
            class="group-delete-btn"
            @click.stop="store.deleteGroup(entry.group.id)"
          >&times;</button>
        </div>

        <template v-if="!collapsedGroups.has(entry.groupId)">
          <div
            v-for="todo in (store.todosByGroup.get(entry.groupId) ?? [])"
            :key="todo.id"
            class="todo-item"
          >
            <div class="todo-row">
              <button
                class="check-btn"
                :class="{ 'check-disabled': !store.canComplete(todo) }"
                :disabled="!store.canComplete(todo)"
                @click="store.completeTodo(todo.id)"
              >
                <span class="check-circle" />
              </button>
              <div class="todo-content" @click="toggleExpand(todo.id)">
                <span class="todo-title">{{ todo.title }}</span>
                <div class="todo-meta">
                  <span v-if="todo.dueDate" class="todo-due" :class="{ overdue: isOverdue(todo.dueDate) }">
                    {{ dueDateLabel(todo.dueDate) }}
                  </span>
                  <span v-if="todo.repeat" class="todo-repeat">{{ repeatLabel(todo.repeat) }}</span>
                  <span v-if="todo.subtasks.length > 0" class="todo-subtask-count">
                    {{ todo.subtasks.filter(s => s.done).length }}/{{ todo.subtasks.length }}
                  </span>
                </div>
              </div>
              <button class="edit-btn" @click="openEditForm(todo)">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>

            <!-- Expanded: memo + subtasks -->
            <div v-if="expandedTodo === todo.id" class="todo-expanded">
              <div v-if="todo.memo" class="todo-memo">{{ todo.memo }}</div>

              <!-- Subtasks -->
              <div v-if="todo.subtasks.length > 0 || todo.status === 'active'" class="subtask-section">
                <div
                  v-for="sub in todo.subtasks"
                  :key="sub.id"
                  class="subtask-item"
                >
                  <button
                    class="subtask-check"
                    :class="{ checked: sub.done }"
                    @click="store.toggleSubtask(todo.id, sub.id)"
                  >
                    <span v-if="sub.done" class="subtask-checkmark">&#x2713;</span>
                  </button>
                  <span class="subtask-text" :class="{ 'subtask-done': sub.done }">{{ sub.text }}</span>
                  <button class="subtask-delete" @click="store.deleteSubtask(todo.id, sub.id)">&times;</button>
                </div>
                <div v-if="todo.status === 'active'" class="subtask-add">
                  <input
                    v-model="newSubtaskText"
                    class="subtask-input"
                    :placeholder="t('todo.addSubtask')"
                    @keydown.enter="addSubtask(todo.id)"
                  />
                  <button class="subtask-add-btn" @click="addSubtask(todo.id)">+</button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- Done section -->
      <div v-if="store.doneTodos.length > 0" class="done-section">
        <div class="group-header done-toggle" @click="showDone = !showDone">
          <span class="group-color-dot" style="background: #aaa" />
          <span class="group-name">{{ t('todo.done') }}</span>
          <span class="group-count">{{ store.doneTodos.length }}</span>
          <span class="group-chevron">{{ showDone ? '\u25BC' : '\u25B6' }}</span>
        </div>
        <template v-if="showDone">
          <div class="done-actions">
            <button class="clear-done-btn" @click="clearAllDone">{{ t('todo.clearAll') }}</button>
          </div>
          <div
            v-for="todo in store.doneTodos"
            :key="todo.id"
            class="todo-item todo-done"
          >
            <div class="todo-row">
              <span class="check-done">&#x2713;</span>
              <div class="todo-content">
                <span class="todo-title done-title">{{ todo.title }}</span>
              </div>
              <button class="trash-btn" @click="confirmDelete(todo.id)">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4l.5 8h6l.5-8" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Add/Edit form overlay -->
    <div v-if="showForm" class="overlay" @click.self="showForm = false">
      <div class="form-card">
        <h2>{{ editingId ? t('todo.editTask') : t('todo.newTaskTitle') }}</h2>

        <label class="form-label">{{ t('todo.fieldTitle') }}</label>
        <input v-model="formTitle" class="form-input" :placeholder="t('todo.taskTitlePlaceholder')" autofocus />

        <label class="form-label">{{ t('todo.fieldMemo') }}</label>
        <textarea v-model="formMemo" class="form-textarea" :placeholder="t('todo.memoPlaceholder')" rows="2" />

        <label class="form-label">{{ t('todo.fieldDueDate') }}</label>
        <input v-model="formDueDate" class="form-input" type="date" />

        <label class="form-label">{{ t('todo.fieldGroup') }}</label>
        <div class="form-group-select">
          <button
            class="group-chip"
            :class="{ selected: formGroupId === null }"
            @click="formGroupId = null"
          >{{ t('common.none') }}</button>
          <button
            v-for="g in store.sortedGroups"
            :key="g.id"
            class="group-chip"
            :class="{ selected: formGroupId === g.id }"
            :style="{ '--chip-color': GROUP_COLORS[g.color].band }"
            @click="formGroupId = g.id"
          >{{ g.name }}</button>
        </div>

        <label class="form-label">{{ t('todo.fieldRepeat') }}</label>
        <select v-model="formRepeatType" class="form-select">
          <option value="none">{{ t('common.none') }}</option>
          <option value="daily">{{ t('todo.repeatDaily') }}</option>
          <option value="weekly">{{ t('todo.repeatWeekly') }}</option>
          <option value="monthly">{{ t('todo.repeatMonthly') }}</option>
        </select>
        <div v-if="formRepeatType === 'weekly'" class="repeat-detail">
          <select v-model.number="formRepeatDow" class="form-select form-select-sm">
            <option v-for="(key, i) in DOW_KEYS" :key="i" :value="i">{{ t(`weekdays.${key}`) }}</option>
          </select>
        </div>
        <div v-if="formRepeatType === 'monthly'" class="repeat-detail">
          <select v-model.number="formRepeatDom" class="form-select form-select-sm">
            <option v-for="d in 31" :key="d" :value="d">{{ d }}</option>
          </select>
          <span class="repeat-suffix">{{ t('todo.ofMonth') }}</span>
        </div>

        <div class="form-actions">
          <button v-if="editingId" class="btn btn-delete" @click="showForm = false; confirmDelete(editingId!)">{{ t('common.delete') }}</button>
          <div class="form-actions-right">
            <button class="btn btn-cancel" @click="showForm = false">{{ t('common.cancel') }}</button>
            <button class="btn btn-save" @click="saveForm">{{ editingId ? t('common.save') : t('common.add') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete confirmation overlay -->
    <div v-if="deleteTargetId" class="overlay" @click.self="deleteTargetId = null">
      <div class="form-card delete-confirm-card">
        <h2>{{ t('todo.deleteConfirmTitle') }}</h2>
        <p class="delete-confirm-text">{{ t('todo.deleteConfirmMessage') }}</p>
        <div class="form-actions">
          <button class="btn btn-cancel" @click="deleteTargetId = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-delete" @click="executeDelete">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <!-- Group form overlay -->
    <div v-if="showGroupForm" class="overlay" @click.self="showGroupForm = false">
      <div class="form-card">
        <h2>{{ t('todo.newGroupTitle') }}</h2>
        <label class="form-label">{{ t('todo.fieldName') }}</label>
        <input v-model="groupFormName" class="form-input" :placeholder="t('todo.groupNamePlaceholder')" autofocus />

        <label class="form-label">{{ t('todo.fieldColor') }}</label>
        <div class="color-picker">
          <button
            v-for="(c, i) in GROUP_COLORS"
            :key="i"
            class="color-swatch"
            :class="{ selected: groupFormColor === i }"
            :style="{ background: c.band }"
            @click="groupFormColor = i"
          />
        </div>

        <div class="form-actions">
          <button class="btn btn-cancel" @click="showGroupForm = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-save" @click="saveGroup">{{ t('common.add') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
  position: relative;
}
.todo-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}
.todo-header h1 {
  font-size: 24px;
  color: #333;
}
.daily-progress {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.daily-count {
  font-size: 20px;
  font-weight: 700;
  color: #c0392b;
}
.daily-label {
  font-size: 11px;
  color: #999;
}

/* Quick actions */
.quick-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.add-btn {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: #c0392b;
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
}
.group-btn {
  padding: 10px 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  color: #666;
  font-size: 13px;
  cursor: pointer;
}

/* Todo list */
.todo-list {
  flex: 1;
  overflow-y: auto;
}
.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  cursor: pointer;
  user-select: none;
}
.group-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.group-name {
  font-size: 13px;
  font-weight: 600;
  color: #555;
  flex: 1;
}
.group-count {
  font-size: 11px;
  color: #999;
  background: #eee;
  padding: 1px 6px;
  border-radius: 8px;
}
.group-chevron {
  font-size: 9px;
  color: #999;
}
.group-delete-btn {
  border: none;
  background: none;
  color: #ccc;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}
.group-delete-btn:hover { color: #e06b6b; }

/* Todo item */
.todo-item {
  background: #fff;
  border-radius: 8px;
  margin-bottom: 4px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  overflow: hidden;
}
.todo-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.check-btn {
  width: 22px;
  height: 22px;
  border: 2px solid #ccc;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.15s;
}
.check-btn:hover:not(:disabled) { border-color: #7bc67e; }
.check-disabled {
  opacity: 0.3;
  cursor: default;
}
.check-done {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7bc67e;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}
.todo-content {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.todo-title {
  font-size: 14px;
  color: #333;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.done-title {
  text-decoration: line-through;
  color: #999;
}
.todo-meta {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.todo-due {
  font-size: 11px;
  color: #888;
}
.todo-due.overdue {
  color: #c0392b;
  font-weight: 600;
}
.todo-repeat {
  font-size: 11px;
  color: #4088c4;
}
.todo-subtask-count {
  font-size: 11px;
  color: #999;
}
.edit-btn {
  border: none;
  background: none;
  color: #bbb;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
}
.edit-btn:hover { color: #666; }

/* Todo done */
.todo-done {
  opacity: 0.6;
}
.done-section {
  margin-top: 12px;
}
.done-toggle {
  opacity: 0.7;
}
.trash-btn {
  border: none;
  background: none;
  color: #ccc;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
}
.trash-btn:hover { color: #e06b6b; }
.done-actions {
  display: flex;
  justify-content: flex-end;
  padding: 2px 4px 6px;
}
.clear-done-btn {
  border: none;
  background: none;
  color: #999;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.clear-done-btn:hover { color: #e06b6b; }

/* Expanded */
.todo-expanded {
  padding: 0 12px 10px;
  border-top: 1px solid #f0f0f0;
}
.todo-memo {
  font-size: 12px;
  color: #777;
  padding: 8px 0;
  white-space: pre-wrap;
  line-height: 1.5;
}
.subtask-section {
  padding: 4px 0;
}
.subtask-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.subtask-check {
  width: 18px;
  height: 18px;
  border: 1.5px solid #ccc;
  border-radius: 3px;
  background: none;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #7bc67e;
}
.subtask-check.checked {
  border-color: #7bc67e;
  background: #e8f8e8;
}
.subtask-checkmark {
  font-weight: 700;
}
.subtask-text {
  font-size: 13px;
  color: #555;
  flex: 1;
}
.subtask-done {
  text-decoration: line-through;
  color: #aaa;
}
.subtask-delete {
  border: none;
  background: none;
  color: #ccc;
  font-size: 14px;
  cursor: pointer;
}
.subtask-add {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.subtask-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 12px;
  background: #fafafa;
}
.subtask-add-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: #eee;
  color: #666;
  font-size: 14px;
  cursor: pointer;
}
.expanded-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: none;
  color: #ccc;
  cursor: pointer;
  margin-left: auto;
  margin-top: 4px;
}
.expanded-delete-btn:hover { color: #e06b6b; }
.delete-confirm-card {
  margin-top: 30vh;
}
.delete-confirm-text {
  font-size: 14px;
  color: #666;
  margin: 8px 0 4px;
}
.btn-delete {
  background: #e06b6b;
  color: #fff;
}

/* Overlay & form */
.overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 40px;
  z-index: 20;
}
.form-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  width: 90%;
  max-width: 360px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.form-card h2 {
  font-size: 18px;
  color: #333;
  margin-bottom: 12px;
}
.form-label {
  display: block;
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  margin: 10px 0 4px;
  font-weight: 600;
}
.form-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}
.form-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
}
.form-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  background: #fff;
  box-sizing: border-box;
}
.form-select-sm {
  width: auto;
}
.form-group-select {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.group-chip {
  padding: 5px 12px;
  border: 2px solid #ddd;
  border-radius: 16px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  color: #555;
}
.group-chip.selected {
  border-color: var(--chip-color, #c0392b);
  background: color-mix(in srgb, var(--chip-color, #c0392b) 10%, white);
  font-weight: 600;
}
.repeat-detail {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.repeat-suffix {
  font-size: 12px;
  color: #888;
}
.color-picker {
  display: flex;
  gap: 10px;
}
.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid transparent;
  cursor: pointer;
}
.color-swatch.selected {
  border-color: #333;
}
.form-actions {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}
.form-actions-right {
  display: flex;
  gap: 8px;
}
.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.btn-cancel {
  background: #eee;
  color: #666;
}
.btn-save {
  background: #c0392b;
  color: #fff;
}
</style>
