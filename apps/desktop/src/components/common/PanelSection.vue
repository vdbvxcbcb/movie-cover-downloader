<script setup lang="ts">
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
