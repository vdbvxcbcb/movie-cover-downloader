<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DoubanMovieDetails, DoubanMovieDetailsSeed } from "../../../types/app";

const props = defineProps<{
  details: DoubanMovieDetails | null;
  seed: DoubanMovieDetailsSeed | null;
  loading: boolean;
  errorMessage: string;
}>();

const emit = defineEmits<{
  close: [];
  retry: [];
}>();

const castExpanded = ref(false);
const copyState = ref<"idle" | "copied" | "failed">("idle");
let copyTimer: ReturnType<typeof setTimeout> | undefined;

function normalizeDetailTitle(value: string) {
  return value
    .trim()
    .replace(/\s+(?:(?:剧照|海报|壁纸)\s+)?(?:自动下载|选图下载)\s*$/, "")
    .trim();
}

const title = computed(() => normalizeDetailTitle(props.details?.title || props.seed?.title || "影片详情"));
const coverSource = computed(() =>
  props.details?.coverDataUrl || props.seed?.coverDataUrl || props.details?.coverUrl || props.seed?.coverUrl || "",
);
const visibleCasts = computed(() => {
  const casts = props.details?.casts ?? [];
  return castExpanded.value ? casts : casts.slice(0, 6);
});
const ratingCountLabel = computed(() =>
  typeof props.details?.ratingCount === "number" ? `${props.details.ratingCount.toLocaleString("zh-CN")} 人评价` : "",
);
const detailRows = computed(() => {
  const details = props.details;
  if (!details) return [];

  return [
    { label: "导演", value: details.directors.join(" / ") },
    { label: "编剧", value: details.writers.join(" / ") },
    { label: "主演", value: details.casts.join(" / "), isCast: true },
    { label: "类型", value: details.genres.join(" / ") },
    { label: "制片国家 / 地区", value: details.countries.join(" / ") },
    { label: "语言", value: details.languages.join(" / ") },
    { label: "上映日期", value: details.releaseDates.join(" / ") },
    { label: "片长", value: details.durations.join(" / ") },
    { label: "季数", value: details.seasonNumber ? String(details.seasonNumber) : "" },
    { label: "集数", value: details.episodeCount ? String(details.episodeCount) : "" },
    { label: "又名", value: details.aka.join(" / ") },
    { label: "IMDb", value: details.imdbId ?? "" },
  ].filter((row) => row.value);
});

watch(
  () => props.details?.detailUrl,
  () => {
    castExpanded.value = false;
    copyState.value = "idle";
  },
);

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

async function copySummary() {
  const summary = props.details?.summary;
  if (!summary) return;

  if (copyTimer) clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText(summary);
    copyState.value = "copied";
  } catch {
    copyState.value = "failed";
  }
  copyTimer = setTimeout(() => {
    copyState.value = "idle";
  }, 1600);
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<template>
  <Teleport to="body">
    <div class="movie-detail-backdrop">
      <section class="movie-detail" role="dialog" aria-modal="true" aria-labelledby="movie-detail-title">
        <header class="movie-detail__header">
          <div>
            <p class="movie-detail__eyebrow">Douban Movie Detail</p>
            <h2 id="movie-detail-title">{{ title }}</h2>
          </div>
          <button type="button" class="movie-detail__close" aria-label="关闭影片详情" title="关闭" @click="emit('close')">×</button>
        </header>

        <div v-if="loading" class="movie-detail__loading" aria-live="polite">
          <div class="movie-detail__skeleton movie-detail__skeleton--cover"></div>
          <div class="movie-detail__loading-lines">
            <span v-for="index in 7" :key="index" class="movie-detail__skeleton"></span>
          </div>
        </div>

        <div v-else-if="errorMessage" class="movie-detail__error" role="alert">
          <strong>影片详情加载失败</strong>
          <p>{{ errorMessage }}</p>
          <button type="button" class="movie-detail__retry" @click="emit('retry')">重试</button>
        </div>

        <div v-else-if="details" class="movie-detail__body">
          <div class="movie-detail__overview">
            <div class="movie-detail__cover">
              <img v-if="coverSource" :src="coverSource" :alt="`${title}封面`" />
              <span v-else>暂无封面</span>
            </div>

            <div class="movie-detail__facts">
              <p v-if="details.originalTitle || details.year" class="movie-detail__original">
                {{ [details.originalTitle, details.year].filter(Boolean).join(" · ") }}
              </p>
              <dl>
                <template v-for="row in detailRows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd v-if="row.isCast">
                    {{ visibleCasts.join(" / ") }}
                    <button
                      v-if="details.casts.length > 6"
                      type="button"
                      class="movie-detail__cast-toggle"
                      @click="castExpanded = !castExpanded"
                    >
                      {{ castExpanded ? "收起" : "更多" }}
                    </button>
                  </dd>
                  <dd v-else>{{ row.value }}</dd>
                </template>
              </dl>
            </div>

            <aside class="movie-detail__rating" aria-label="豆瓣评分">
              <template v-if="typeof details.ratingValue === 'number'">
                <strong class="movie-detail__rating-value">{{ details.ratingValue.toFixed(1) }}</strong>
                <span class="movie-detail__rating-count">{{ ratingCountLabel }}</span>
              </template>
              <strong v-else class="movie-detail__rating-empty">暂无评分</strong>
            </aside>
          </div>

          <section class="movie-detail__summary">
            <div class="movie-detail__section-head">
              <h3>{{ title }}的剧情简介</h3>
              <button
                v-if="details.summary"
                type="button"
                class="movie-detail__copy"
                :title="copyState === 'failed' ? '复制失败' : '复制剧情简介'"
                @click="void copySummary()"
              >
                {{ copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制简介" }}
              </button>
            </div>
            <p>{{ details.summary || "暂无剧情简介" }}</p>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.movie-detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2300;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.68);
  backdrop-filter: blur(4px);
}

.movie-detail {
  width: min(820px, 100%);
  max-height: 82vh;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #0b171a;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.5);
}

.movie-detail__header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--line);
  background: rgba(11, 23, 26, 0.96);
  backdrop-filter: blur(14px);
}

.movie-detail__eyebrow {
  margin: 0 0 4px;
  color: var(--accent);
  font-size: 0.72rem;
  text-transform: uppercase;
}

.movie-detail__header h2,
.movie-detail__summary h3,
.movie-detail__error p {
  margin: 0;
}

.movie-detail__header h2 {
  max-width: 690px;
  color: var(--text);
  font-size: 1.22rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.movie-detail__close {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--muted);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}

.movie-detail__close:hover,
.movie-detail__close:focus-visible,
.movie-detail__copy:hover,
.movie-detail__copy:focus-visible,
.movie-detail__cast-toggle:hover,
.movie-detail__cast-toggle:focus-visible {
  color: var(--accent);
  outline: none;
}

.movie-detail__body {
  padding: 22px;
}

.movie-detail__overview {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 132px;
  gap: 22px;
  align-items: start;
}

.movie-detail__cover {
  width: 150px;
  aspect-ratio: 2 / 3;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  font-size: 0.82rem;
}

.movie-detail__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.movie-detail__facts {
  min-width: 0;
}

.movie-detail__original {
  margin: 0 0 12px;
  color: var(--text);
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.movie-detail__facts dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 7px 10px;
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.55;
}

.movie-detail__facts dt {
  color: var(--muted);
}

.movie-detail__facts dd {
  min-width: 0;
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.movie-detail__cast-toggle,
.movie-detail__copy {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

.movie-detail__cast-toggle {
  margin-left: 8px;
}

.movie-detail__rating {
  min-height: 112px;
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 7px;
  padding-left: 20px;
  border-left: 1px solid var(--line);
}

.movie-detail__rating-value {
  color: #ffb85c;
  font-size: 2.25rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.movie-detail__rating-count,
.movie-detail__rating-empty {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 500;
}

.movie-detail__summary {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}

.movie-detail__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.movie-detail__summary h3 {
  color: var(--text);
  font-size: 0.98rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.movie-detail__copy {
  flex: 0 0 auto;
  line-height: 1.5;
}

.movie-detail__summary > p {
  color: var(--muted);
  line-height: 1.85;
  white-space: pre-line;
}

.movie-detail__loading {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 22px;
  min-height: 390px;
  padding: 22px;
}

.movie-detail__loading-lines {
  display: grid;
  align-content: start;
  gap: 14px;
}

.movie-detail__skeleton {
  height: 18px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.07);
  animation: movie-detail-pulse 1.2s ease-in-out infinite alternate;
}

.movie-detail__skeleton:nth-child(2n) {
  width: 76%;
}

.movie-detail__skeleton--cover {
  width: 150px;
  height: 225px;
  border-radius: 8px;
}

.movie-detail__error {
  min-height: 300px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 40px;
  color: var(--text);
  text-align: center;
}

.movie-detail__error p {
  max-width: 520px;
  color: var(--muted);
  line-height: 1.65;
}

.movie-detail__retry {
  margin-top: 8px;
  padding: 9px 18px;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: #031113;
  font-weight: 700;
  cursor: pointer;
}

@keyframes movie-detail-pulse {
  to { opacity: 0.45; }
}

@media (max-width: 720px) {
  .movie-detail-backdrop { padding: 12px; }
  .movie-detail { max-height: calc(100vh - 24px); }
  .movie-detail__body { padding: 18px; }
  .movie-detail__overview { grid-template-columns: 116px minmax(0, 1fr); gap: 16px; }
  .movie-detail__cover { width: 116px; }
  .movie-detail__rating { grid-column: 1 / -1; min-height: 0; padding: 16px 0 0; border-top: 1px solid var(--line); border-left: 0; }
}

@media (max-width: 480px) {
  .movie-detail__overview { grid-template-columns: 1fr; }
  .movie-detail__cover { width: min(150px, 100%); }
  .movie-detail__facts dl { grid-template-columns: 1fr; gap: 2px; }
  .movie-detail__facts dd { margin-bottom: 7px; }
}
</style>
