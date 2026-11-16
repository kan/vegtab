<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import QRCode from 'qrcode';

const props = defineProps<{
  value: string;
  size?: number;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);

async function render() {
  if (!canvas.value || !props.value) return;
  const sz = props.size ?? 128;
  await QRCode.toCanvas(canvas.value, props.value, {
    width: sz,
    margin: 1,
    color: { dark: '#333', light: '#ffffff' },
  });
}

onMounted(render);
watch(() => [props.value, props.size], render);
</script>

<template>
  <canvas ref="canvas" class="qr-canvas" />
</template>

<style scoped>
.qr-canvas {
  display: block;
  border-radius: 8px;
}
</style>
