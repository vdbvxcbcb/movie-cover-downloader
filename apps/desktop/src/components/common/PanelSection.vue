<script setup lang="ts">
// 通用面板容器：统一页面区块标题和右侧操作区域。
defineProps<{
  eyebrow: string;
  title: string;
}>();
</script>

<template>
  <section class="panel">
    <div class="panel__head">
      <div>
        <p class="eyebrow">{{ eyebrow }}</p>
        <h3>{{ title }}</h3>
      </div>

      <slot name="aside" />
    </div>

    <slot />
  </section>
</template>
