import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import CreateTaskModal from "../../CreateTaskModal.vue";
import { runtimeBridge } from "../../../../lib/runtime-bridge";
import type {
  RuntimeDiscoveredAsset,
  RuntimeDoubanPhotoDiscoveryBatchResult,
  RuntimeDoubanPhotoDiscoveryProgressEvent,
  RuntimeDiscoverDoubanPhotosPayload,
} from "../../../../types/app";

const originalDiscoverDoubanPhotos = runtimeBridge.discoverDoubanPhotos;
const originalCancelDoubanPhotoDiscovery = runtimeBridge.cancelDoubanPhotoDiscovery;
const originalResolveDoubanMoviePreview = runtimeBridge.resolveDoubanMoviePreview;
const originalOnDoubanPhotoDiscoveryProgress = runtimeBridge.onDoubanPhotoDiscoveryProgress;

function waitForTick() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function createDiscoveryResult(overrides: Partial<RuntimeDoubanPhotoDiscoveryBatchResult> = {}): RuntimeDoubanPhotoDiscoveryBatchResult {
  return {
    source: "douban",
    detailUrl: "https://movie.douban.com/subject/34780991/",
    imagePageUrl: "https://movie.douban.com/subject/34780991/photos?type=S",
    normalizedTitle: "示例电影",
    outputFolderName: "示例电影",
    outputDir: "D:/cover/示例电影/selected/still/still-original",
    images: [],
    nextCursor: undefined as any,
    done: true,
    ...overrides,
  };
}

function createPhoto(overrides: Partial<RuntimeDiscoveredAsset> = {}): RuntimeDiscoveredAsset {
  return {
    id: "late-photo",
    source: "douban",
    title: "晚到剧照",
    imageUrl: "https://img1.doubanio.com/view/photo/l/public/p1.jpg",
    previewUrl: "https://img1.doubanio.com/view/photo/m/public/p1.jpg",
    category: "still",
    doubanAssetType: "still",
    orientation: "horizontal",
    ...overrides,
  };
}

describe("create task modal selected photo discovery", () => {
  afterEach(() => {
    runtimeBridge.discoverDoubanPhotos = originalDiscoverDoubanPhotos;
    runtimeBridge.cancelDoubanPhotoDiscovery = originalCancelDoubanPhotoDiscovery;
    runtimeBridge.resolveDoubanMoviePreview = originalResolveDoubanMoviePreview;
    runtimeBridge.onDoubanPhotoDiscoveryProgress = originalOnDoubanPhotoDiscoveryProgress;
  });

  it("ignores late progress from a stopped discovery task", async () => {
    setActivePinia(createPinia());
    let progressListener: ((event: RuntimeDoubanPhotoDiscoveryProgressEvent) => void) | null = null;
    let firstDiscoveryPayload: RuntimeDiscoverDoubanPhotosPayload | undefined = undefined;
    let resolveCancel: ((taskId: number) => void) | undefined = undefined;

    runtimeBridge.resolveDoubanMoviePreview = async () => null;
    runtimeBridge.onDoubanPhotoDiscoveryProgress = async (listener) => {
      progressListener = listener;
      return () => {
        progressListener = null;
      };
    };
    runtimeBridge.discoverDoubanPhotos = async (payload) => {
      if (!firstDiscoveryPayload) {
        firstDiscoveryPayload = payload;
      }
      return new Promise<RuntimeDoubanPhotoDiscoveryBatchResult>(() => {});
    };
    runtimeBridge.cancelDoubanPhotoDiscovery = async (taskId) =>
      new Promise<number>((resolve) => {
        resolveCancel = resolve;
        void taskId;
      });

    const wrapper = mount(CreateTaskModal, {
      props: {
        selectedPhotoSeed: {
          detailUrl: "https://movie.douban.com/subject/34780991/",
          title: "示例电影",
          autoDiscover: true,
        },
      },
    });

    await waitForTick();
    await waitForTick();
    const payload = firstDiscoveryPayload as unknown as RuntimeDiscoverDoubanPhotosPayload;
    expect(payload?.taskId).toBeTruthy();

    await wrapper.findAll(".selected-download__filters button")[1]!.trigger("click");
    expect(resolveCancel).toBeTruthy();

    const listener = progressListener!;
    listener({
      taskId: payload.taskId,
      doubanAssetType: "still",
      pageUrl: "https://movie.douban.com/subject/34780991/photos?type=S",
      normalizedTitle: "示例电影",
      images: [createPhoto()],
    });
    await waitForTick();

    expect(wrapper.text()).toContain("剧照 0");
    expect(wrapper.text()).not.toContain("晚到剧照");

    const cancel = resolveCancel!;
    cancel(1);
    wrapper.unmount();
  });

  it("ignores final result from a stopped discovery task", async () => {
    setActivePinia(createPinia());
    let firstDiscoveryPayload: RuntimeDiscoverDoubanPhotosPayload | undefined = undefined;
    let resolveFirstDiscovery: ((result: RuntimeDoubanPhotoDiscoveryBatchResult) => void) | undefined = undefined;

    runtimeBridge.resolveDoubanMoviePreview = async () => null;
    runtimeBridge.onDoubanPhotoDiscoveryProgress = async () => () => {};
    runtimeBridge.discoverDoubanPhotos = async (payload) => {
      if (firstDiscoveryPayload) {
        return new Promise<RuntimeDoubanPhotoDiscoveryBatchResult>(() => {});
      }
      firstDiscoveryPayload = payload;
      return new Promise<RuntimeDoubanPhotoDiscoveryBatchResult>((resolve) => {
        resolveFirstDiscovery = resolve;
      });
    };
    runtimeBridge.cancelDoubanPhotoDiscovery = async () => 1;

    const wrapper = mount(CreateTaskModal, {
      props: {
        selectedPhotoSeed: {
          detailUrl: "https://movie.douban.com/subject/34780991/",
          title: "示例电影",
          autoDiscover: true,
        },
      },
    });

    await waitForTick();
    await waitForTick();
    const payload = firstDiscoveryPayload as unknown as RuntimeDiscoverDoubanPhotosPayload;
    expect(payload?.taskId).toBeTruthy();

    await wrapper.findAll(".selected-download__filters button")[1]!.trigger("click");
    const resolve = resolveFirstDiscovery as unknown as (result: RuntimeDoubanPhotoDiscoveryBatchResult) => void;
    resolve(createDiscoveryResult({
      images: [createPhoto({ title: "晚到最终剧照" })],
      done: false,
    }));
    await waitForTick();
    await waitForTick();

    expect(wrapper.text()).toContain("剧照 0");
    expect(wrapper.text()).not.toContain("晚到最终剧照");

    wrapper.unmount();
  });
});
