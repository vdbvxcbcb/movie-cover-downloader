import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDetailUrlsInput,
  validateTaskDraftInput,
} from "./task-draft-input";

test("批量链接输入会把连续链接自动拆成逐行", () => {
  const normalized = normalizeDetailUrlsInput(
    "https://movie.douban.com/subject/36965301https://movie.douban.com/subject/34780991https://movie.douban.com/subject/36857924",
  );

  assert.equal(
    normalized,
    [
      "https://movie.douban.com/subject/36965301",
      "https://movie.douban.com/subject/34780991",
      "https://movie.douban.com/subject/36857924",
    ].join("\n"),
  );
});

test("详情页链接只允许豆瓣 subject 链接", () => {
  const result = validateTaskDraftInput({
    detailUrls: "https://example.com/movie/1",
    outputRootDir: "D:/cover",
    imageCountMode: "limited",
    maxImagesInput: "50",
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /不能加入队列/);
  assert.match(result.message, /不支持的链接/);
});

test("详情页链接接受指定形式的豆瓣 subject 链接", () => {
  const result = validateTaskDraftInput({
    detailUrls: [
      "https://movie.douban.com/subject/34780991/",
      "https://movie.douban.com/subject/1292064/",
    ].join("\n"),
    outputRootDir: "D:/cover",
    imageCountMode: "limited",
    maxImagesInput: "10",
  });

  assert.equal(result.ok, true);
});

test("详情页链接会拒绝豆瓣根站和非豆瓣链接", () => {
  const doubanResult = validateTaskDraftInput({
    detailUrls: "https://movie.douban.com/",
    outputRootDir: "D:/cover",
    imageCountMode: "limited",
    maxImagesInput: "10",
  });
  const externalResult = validateTaskDraftInput({
    detailUrls: "https://example.org/movie/1",
    outputRootDir: "D:/cover",
    imageCountMode: "limited",
    maxImagesInput: "10",
  });

  assert.equal(doubanResult.ok, false);
  assert.equal(externalResult.ok, false);
});

test("详情页链接会拒绝豆瓣非 subject 链接", () => {
  const result = validateTaskDraftInput({
    detailUrls: "https://movie.douban.com/subject/34780991/photos?type=S",
    outputRootDir: "D:/cover",
    imageCountMode: "limited",
    maxImagesInput: "10",
  });

  assert.equal(result.ok, false);
});

test("详情页链接会拒绝非字符串类型", () => {
  const result = validateTaskDraftInput({
    detailUrls: ["https://movie.douban.com/subject/34780991/"],
    outputRootDir: "D:/cover",
    imageCountMode: "limited",
    maxImagesInput: "10",
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, "不能加入队列：详情页链接（批量）必须是文本字符串。");
});

test("详情页链接为空时返回不能加入队列的原因", () => {
  const result = validateTaskDraftInput({
    detailUrls: "",
    outputRootDir: "D:/cover",
    imageCountMode: "limited",
    maxImagesInput: "10",
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, "不能加入队列：请填写详情页链接（批量）。");
});

test("数量限制填入非数值类型时返回中文警告", () => {
  const result = validateTaskDraftInput({
    detailUrls: "https://movie.douban.com/subject/34780991/",
    outputRootDir: "D:/cover",
    imageCountMode: "limited",
    maxImagesInput: "abc",
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, "不能加入队列：数量限制填入文本类型错误，非数值类型。");
});

test("无限制模式不依赖数量输入", () => {
  const result = validateTaskDraftInput({
    detailUrls: "https://movie.douban.com/subject/34780991/",
    outputRootDir: "D:/cover",
    imageCountMode: "unlimited",
    maxImagesInput: "",
  });

  assert.equal(result.ok, true);
});