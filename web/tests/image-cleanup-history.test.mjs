import assert from "node:assert/strict";
import test from "node:test";

import localforage from "localforage";

const memoryStores = new Map();
const memoryDriver = {
    _driver: "memory-test-driver",
    _support: true,
    _initStorage(options) {
        const key = `${options.name || "localforage"}/${options.storeName || "keyvaluepairs"}`;
        if (!memoryStores.has(key)) memoryStores.set(key, new Map());
        this._memoryStore = memoryStores.get(key);
        return Promise.resolve();
    },
    clear(callback) {
        this._memoryStore.clear();
        callback?.(null);
        return Promise.resolve();
    },
    getItem(key, callback) {
        const value = this._memoryStore.has(key) ? this._memoryStore.get(key) : null;
        callback?.(null, value);
        return Promise.resolve(value);
    },
    setItem(key, value, callback) {
        this._memoryStore.set(key, value);
        callback?.(null, value);
        return Promise.resolve(value);
    },
    removeItem(key, callback) {
        this._memoryStore.delete(key);
        callback?.(null);
        return Promise.resolve();
    },
    iterate(iterator, callback) {
        let index = 1;
        for (const [key, value] of this._memoryStore.entries()) {
            const result = iterator(value, key, index++);
            if (result !== undefined) {
                callback?.(null, result);
                return Promise.resolve(result);
            }
        }
        callback?.(null);
        return Promise.resolve();
    },
    key(index, callback) {
        const value = Array.from(this._memoryStore.keys())[index] ?? null;
        callback?.(null, value);
        return Promise.resolve(value);
    },
    keys(callback) {
        const value = Array.from(this._memoryStore.keys());
        callback?.(null, value);
        return Promise.resolve(value);
    },
    length(callback) {
        const value = this._memoryStore.size;
        callback?.(null, value);
        return Promise.resolve(value);
    },
};

await localforage.defineDriver(memoryDriver);
const createLocalForageInstance = localforage.createInstance.bind(localforage);
localforage.createInstance = (options = {}) => createLocalForageInstance({ ...options, driver: memoryDriver._driver });

function testStore(storeName) {
    return localforage.createInstance({ name: "infinite-canvas", storeName });
}

test("清理未使用图片时保留生图工作台历史记录引用的图片", async () => {
    const { cleanupUnusedImages, getImageBlob } = await import("../src/services/image-storage.ts");
    const imageFiles = testStore("image_files");
    const imageLogs = testStore("image_generation_logs");
    await imageFiles.clear();
    await imageLogs.clear();

    const historyBlob = new Blob(["history"], { type: "image/png" });
    const orphanBlob = new Blob(["orphan"], { type: "image/png" });
    await imageFiles.setItem("image:history", historyBlob);
    await imageFiles.setItem("image:orphan", orphanBlob);
    await imageLogs.setItem("log-1", { id: "log-1", images: [{ id: "img-1", dataUrl: "", storageKey: "image:history" }] });

    await cleanupUnusedImages({});

    assert.equal(await getImageBlob("image:history"), historyBlob);
    assert.equal(await getImageBlob("image:orphan"), null);
});
