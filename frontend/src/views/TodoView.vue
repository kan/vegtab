<script setup lang="ts">
import { ref } from 'vue';
import { useTodoStore } from '@/stores/todo';

const store = useTodoStore();
const newTitle = ref('');

function addTodo() {
  const title = newTitle.value.trim();
  if (title) {
    store.addTodo(title);
    newTitle.value = '';
  }
}
</script>

<template>
  <div class="todo-view">
    <header class="todo-header">
      <h1>TODO</h1>
      <div class="daily-progress">
        Today: {{ store.dailyCompleted }} done
      </div>
    </header>

    <div class="add-form">
      <input
        v-model="newTitle"
        class="add-input"
        placeholder="New task..."
        @keydown.enter="addTodo"
      />
      <button class="add-btn" @click="addTodo">+</button>
    </div>

    <div class="todo-list">
      <div
        v-for="todo in store.activeTodos"
        :key="todo.id"
        class="todo-item"
      >
        <button class="check-btn" @click="store.completeTodo(todo.id)">
          <span class="check-circle" />
        </button>
        <div class="todo-content">
          <span class="todo-title">{{ todo.title }}</span>
          <span v-if="todo.dueDate" class="todo-due">{{ todo.dueDate }}</span>
        </div>
        <button class="delete-btn" @click="store.deleteTodo(todo.id)">x</button>
      </div>

      <div v-if="store.doneTodos.length > 0" class="done-section">
        <h3 class="done-header">Done ({{ store.doneTodos.length }})</h3>
        <div
          v-for="todo in store.doneTodos"
          :key="todo.id"
          class="todo-item done"
        >
          <span class="check-done">\u2713</span>
          <span class="todo-title">{{ todo.title }}</span>
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
}
.todo-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16px;
}
.todo-header h1 {
  font-size: 24px;
  color: #333;
}
.daily-progress {
  font-size: 12px;
  color: #888;
}
.add-form {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.add-input {
  flex: 1;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 15px;
  background: #fff;
}
.add-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 8px;
  background: #c0392b;
  color: #fff;
  font-size: 20px;
  cursor: pointer;
}
.todo-list {
  flex: 1;
  overflow-y: auto;
}
.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
  margin-bottom: 6px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.todo-item.done {
  opacity: 0.5;
}
.check-btn {
  width: 24px;
  height: 24px;
  border: 2px solid #ccc;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  flex-shrink: 0;
}
.check-done {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7bc67e;
  font-weight: 700;
  flex-shrink: 0;
}
.todo-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.todo-title {
  font-size: 14px;
  color: #333;
}
.todo-due {
  font-size: 11px;
  color: #999;
}
.delete-btn {
  border: none;
  background: none;
  color: #ccc;
  font-size: 16px;
  cursor: pointer;
}
.done-section {
  margin-top: 16px;
}
.done-header {
  font-size: 13px;
  color: #999;
  margin-bottom: 8px;
}
</style>
