import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeSource = readFileSync(new URL("../src/app/(user)/page.tsx", import.meta.url), "utf8");
const carouselSource = readFileSync(new URL("../src/app/(user)/home-banner-carousel.tsx", import.meta.url), "utf8");

test("首页展示三联媒体轮播并保留移动端滑动布局", () => {
    assert.match(homeSource, /<HomeBannerCarousel banners=\{HOME_BANNERS\}/);
    assert.match(homeSource, /agent\.webm/);
    assert.match(homeSource, /panorama\.webp/);
    assert.match(homeSource, /3ddirector\.webp/);
    assert.match(carouselSource, /data-banner-offset/);
    assert.match(carouselSource, /@media \(max-width: 639px\)/);
    assert.match(carouselSource, /<video[\s\S]*controls[\s\S]*autoPlay/);
});

test("首页快速创作只预填工作台，不会直接开始生成", () => {
    assert.match(homeSource, /dispatchImage\(\{ prompt, run: false \}\)/);
    assert.match(homeSource, /dispatchVideo\(\{ prompt, run: false \}\)/);
    assert.match(homeSource, /router\.push\("\/image"\)/);
    assert.match(homeSource, /router\.push\("\/video"\)/);
    assert.match(homeSource, /updateConfig\("size", imagePreset\.size\)/);
    assert.match(homeSource, /updateConfig\("vquality", videoPreset\.quality\)/);
    assert.match(homeSource, /不会直接开始生成/);
});
