import { uploadImage, type UploadedImage } from "@/services/image-storage";

type GeneratedWorkflowImage = {
    id: string;
    dataUrl: string;
};

export type StoredWorkflowImage = {
    id: string;
    dataUrl: string;
    displayUrl: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type StoreImage = (input: string | Blob) => Promise<UploadedImage>;

export async function storeWorkflowGeneratedImages(images: GeneratedWorkflowImage[], durationMs: number, storeImage: StoreImage = uploadImage): Promise<StoredWorkflowImage[]> {
    return Promise.all(
        images.map(async (image) => {
            const stored = await storeImage(image.dataUrl);
            return {
                id: image.id,
                dataUrl: stored.url,
                displayUrl: stored.url,
                storageKey: stored.storageKey,
                durationMs,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            };
        }),
    );
}

export function serializeWorkflowStoredImage<T extends { dataUrl?: string; storageKey?: string }>(image: T): T {
    return {
        ...image,
        dataUrl: image.dataUrl?.startsWith("http") ? image.dataUrl : "",
    };
}
