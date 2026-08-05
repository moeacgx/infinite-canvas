import { CanvasNodeType, type CanvasNodeTypeId } from "../types";

export function isCanvasImageNodeType(type: CanvasNodeTypeId) {
    return type === CanvasNodeType.Image || type === "panorama";
}
