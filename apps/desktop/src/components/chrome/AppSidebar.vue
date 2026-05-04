<script setup lang="ts">
// 侧边栏导航组件：根据路由高亮当前页面。
import { RouterLink, useRoute } from "vue-router";
import { navItems } from "../../data/mock";

const route = useRoute();
</script>

<template>
  <aside class="rail">
    <div class="brand">
      <div class="brand__copy">
        <p class="eyebrow">Windows Utility Desk</p>
        <h1>影视封面下载器</h1>
      </div>
    </div>

    <nav class="nav">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="nav__item"
        :class="{ 'nav__item--active': route.path === item.to }"
      >
        <span class="nav__eyebrow">{{ item.eyebrow }}</span>
        <strong>{{ item.label }}</strong>
      </RouterLink>
    </nav>

    <section class="metric metric--secondary">
      <p class="eyebrow">当前结构</p>
      <ul class="bullet-list">
        <li>控制中心集中放任务队列和 Cookie。</li>
        <li>日志中心只保留实时日志。</li>
      </ul>
    </section>
  </aside>
</template>
