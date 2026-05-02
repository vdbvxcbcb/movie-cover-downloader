import type { SourceAdapter } from "./base.js";
import { dedupeUrls, extractTitleFromHtml, fetchText, normalizeWhitespace, resolveRelativeUrl } from "./base.js";
import type { AdapterContext } from "./base.js";
import type { DiscoveredImage, DiscoveryResult, SidecarTask } from "../shared/contracts.js";
import { buildOutputDir, buildOutputFolderName } from "../utils/output-folder.js";
import { createResolvedSkeleton } from "../utils/source-detector.js";

function extractImpAwardsTitle(html: string) {
  const heading = html.match(/<h[34][^>]*>\s*([^<(]+?)\s*\(<a href=/i)?.[1];
  if (heading) {
    return normalizeWhitespace(heading);
  }

  return normalizeWhitespace(
    extractTitleFromHtml(html)
      .replace(/\s+Movie Poster.*$/i, "")
      .replace(/\s+-\s+IMP Awards$/i, ""),
  );
}

function extractPosterUrls(html: string, pageUrl: string) {
  const matches = Array.from(
    html.matchAll(/(?:src|href)\s*=\s*["']?([^"' >]+?\.(?:jpg|jpeg|png))/gi),
    (match) => match[1],
  );

  return dedupeUrls(matches)
    .map((rawUrl) => resolveRelativeUrl(rawUrl, pageUrl))
    .filter((imageUrl) => /impawards\.com/i.test(imageUrl))
    .filter((imageUrl) => /\/posters\//i.test(imageUrl))
    .filter((imageUrl) => !/\/thumbs\//i.test(imageUrl));
}

function extractVariantPages(html: string, detailUrl: string) {
  const matches = Array.from(
    html.matchAll(/href\s*=\s*["']?([^"' >]+?_ver\d+\.html)/gi),
    (match) => match[1],
  );

  return dedupeUrls(matches).map((rawUrl) => resolveRelativeUrl(rawUrl, detailUrl));
}

function extractPosterSize(html: string) {
  const metaMatch = html.match(/Image dimensions:\s*(\d+)\s*x\s*(\d+)/i);
  if (metaMatch) {
    return {
      width: Number(metaMatch[1]),
      height: Number(metaMatch[2]),
    };
  }

  const otherSizeMatch = html.match(/other sizes:\s*<a[^>]*>(\d+)x(\d+)<\/a>/i);
  if (otherSizeMatch) {
    return {
      width: Number(otherSizeMatch[1]),
      height: Number(otherSizeMatch[2]),
    };
  }

  return {};
}

function createDiscoveredImages(
  title: string,
  items: Array<{ imageUrl: string; pageUrl: string; width?: number; height?: number }>,
) {
  return items.map(({ imageUrl, pageUrl, width, height }, index) => {
    const isVertical = !/_xlg|banner|wide/i.test(imageUrl);
    return {
      id: `impawards-${index + 1}`,
      source: "impawards",
      title: `${title} Poster ${index + 1}`,
      imageUrl,
      pageUrl,
      category: "poster",
      orientation: isVertical ? "vertical" : "horizontal",
      width,
      height,
    } satisfies DiscoveredImage;
  });
}

export class ImpAwardsAdapter implements SourceAdapter {
  source = "impawards" as const;

  canHandle(task: SidecarTask) {
    return task.detailUrl.includes("impawards.com/");
  }

  async discover(task: SidecarTask, context: AdapterContext): Promise<DiscoveryResult> {
    const resolved = createResolvedSkeleton(task);
    if (resolved.source !== "impawards") {
      throw new Error(`impawards adapter cannot handle source: ${resolved.source}`);
    }

    context.logger.info(`fetching impawards page: ${resolved.detailUrl}`, task.id);
    const detailPage = await fetchText(resolved.detailUrl, context);
    const title = extractImpAwardsTitle(detailPage.html);
    context.logger.info(`片名已解析: ${title}`, task.id);
    const variantPages = extractVariantPages(detailPage.html, resolved.detailUrl);
    const primarySize = extractPosterSize(detailPage.html);

    const collected = extractPosterUrls(detailPage.html, resolved.detailUrl).map((imageUrl) => ({
      imageUrl,
      pageUrl: resolved.detailUrl,
      width: primarySize.width,
      height: primarySize.height,
    }));

    for (const variantPage of variantPages) {
      context.logger.info(`fetching impawards variant page: ${variantPage}`, task.id);
      const variantHtml = await fetchText(variantPage, context);
      const variantPoster = extractPosterUrls(variantHtml.html, variantPage)[0];
      const variantSize = extractPosterSize(variantHtml.html);
      if (variantPoster) {
        collected.push({
          imageUrl: variantPoster,
          pageUrl: variantPage,
          width: variantSize.width,
          height: variantSize.height,
        });
      }
    }

    const deduped = new Map<string, (typeof collected)[number]>();
    for (const item of collected) {
      deduped.set(`${item.pageUrl}::${item.imageUrl}`, item);
    }

    const allImages = createDiscoveredImages(title, [...deduped.values()]);
    const images = task.imageCountMode === "unlimited" ? allImages : allImages.slice(0, task.maxImages);
    if (images.length === 0) {
      throw new Error("no images discovered on impawards page");
    }

    const outputFolderName = buildOutputFolderName(title);
    return {
      source: "impawards",
      detailUrl: resolved.detailUrl,
      imagePageUrl: resolved.imagePageUrl,
      normalizedTitle: title,
      outputFolderName,
      outputDir: buildOutputDir(task.outputRootDir, outputFolderName),
      images,
    };
  }
}
