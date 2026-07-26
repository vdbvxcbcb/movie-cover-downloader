import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateTaskModal from "../../CreateTaskModal.vue";
import { runtimeBridge } from "../../../../lib/runtime-bridge";
import { useMovieDetails } from "../../../../stores/movieDetails";
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

  it("opens the shared movie details from the selected-photo cover", async () => {
    setActivePinia(createPinia());
    const movieDetailsStore = useMovieDetails();
    const openDetails = vi.spyOn(movieDetailsStore, "openDetails").mockImplementation(() => undefined);

    const wrapper = mount(CreateTaskModal, {
      props: {
        selectedPhotoSeed: {
          detailUrl: "https://movie.douban.com/subject/34780991/",
          title: "示例电影 (2024)",
          coverUrl: "https://img1.doubanio.com/cover.jpg",
          coverDataUrl: "data:image/jpeg;base64,selected-cover",
        },
      },
    });

    await wrapper.get(".selected-download__cover").trigger("click");

    expect(openDetails).toHaveBeenCalledWith({
      detailUrl: "https://movie.douban.com/subject/34780991/",
      title: "示例电影 (2024)",
      coverUrl: "https://img1.doubanio.com/cover.jpg",
      coverDataUrl: "data:image/jpeg;base64,selected-cover",
    });
    wrapper.unmount();
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

  it("does not show empty warning while a partial selected-photo batch is waiting for more images", async () => {
    setActivePinia(createPinia());
    let firstDiscoveryPayload: RuntimeDiscoverDoubanPhotosPayload | undefined = undefined;
    const partialStills = Array.from({ length: 5 }, (_, index) =>
      createPhoto({
        id: `still-${index + 1}`,
        title: `剧照 ${index + 1}`,
        imageUrl: `https://img1.doubanio.com/view/photo/l/public/still${index + 1}.jpg`,
        previewUrl: `https://img1.doubanio.com/view/photo/m/public/still${index + 1}.jpg`,
      }),
    );

    runtimeBridge.resolveDoubanMoviePreview = async () => null;
    runtimeBridge.onDoubanPhotoDiscoveryProgress = async () => () => {};
    runtimeBridge.discoverDoubanPhotos = async (payload) => {
      firstDiscoveryPayload = payload;
      return createDiscoveryResult({
        images: partialStills,
        nextCursor: {
          assetIndex: 0,
          pageIndex: 0,
          withinPageOffset: 5,
          pageCount: 6,
          totalCount: 159,
          normalizedTitle: "示例电影",
          outputFolderName: "示例电影",
        },
        done: false,
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
    expect(payload.doubanAssetType).toBe("still");
    expect(wrapper.text()).toContain("剧照 0");
    expect(wrapper.text()).toContain("共159张剧照，已缓存0张");
    expect(wrapper.text()).not.toContain("没有解析到可下载图片。");

    wrapper.unmount();
  });
});
