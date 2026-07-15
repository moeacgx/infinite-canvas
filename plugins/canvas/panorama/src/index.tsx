// 3D 全景节点:等距柱状(equirectangular)全景查看器。three.js 从 CDN 按需加载。
import { definePlugin, useEffect, useRef } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

// three 从 CDN 动态加载(env.d.ts 里声明为 any),不打进 bundle
let threePromise: Promise<any> | undefined;
function loadThree(): Promise<any> {
    if (!threePromise) threePromise = import("https://esm.sh/three@0.180.0");
    return threePromise;
}

function PanoramaContent({ ctx }: CanvasNodeContentProps) {
    const mountRef = useRef<HTMLDivElement>(null);
    const upstreamImage = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .find(Boolean);
    const source = ctx.node.metadata?.content || upstreamImage;

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount || !source) return;
        let disposed = false;
        let cleanup = () => {};

        loadThree().then((THREE: any) => {
            if (disposed || !mountRef.current) return;
            const width = mount.clientWidth || 400;
            const height = mount.clientHeight || 300;
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
            const renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(width, height);
            renderer.setPixelRatio(window.devicePixelRatio);
            mount.appendChild(renderer.domElement);

            const geometry = new THREE.SphereGeometry(50, 60, 40);
            geometry.scale(-1, 1, 1); // 翻转法线,从球心向内看
            const texture = new THREE.TextureLoader().load(source);
            texture.colorSpace = THREE.SRGBColorSpace;
            const sphere = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
            scene.add(sphere);

            let lon = 0;
            let lat = 0;
            let dragging = false;
            let startX = 0;
            let startY = 0;
            let startLon = 0;
            let startLat = 0;

            const onDown = (event: PointerEvent) => {
                dragging = true;
                startX = event.clientX;
                startY = event.clientY;
                startLon = lon;
                startLat = lat;
            };
            const onMove = (event: PointerEvent) => {
                if (!dragging) return;
                lon = startLon - (event.clientX - startX) * 0.2;
                lat = Math.max(-85, Math.min(85, startLat + (event.clientY - startY) * 0.2));
            };
            const onUp = () => (dragging = false);
            const canvas: HTMLCanvasElement = renderer.domElement;
            canvas.style.cursor = "grab";
            canvas.addEventListener("pointerdown", onDown);
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);

            let frame = 0;
            const animate = () => {
                frame = requestAnimationFrame(animate);
                if (!dragging) lon += 0.03; // 缓慢自转
                const phi = THREE.MathUtils.degToRad(90 - lat);
                const theta = THREE.MathUtils.degToRad(lon);
                camera.lookAt(new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)));
                renderer.render(scene, camera);
            };
            animate();

            cleanup = () => {
                cancelAnimationFrame(frame);
                canvas.removeEventListener("pointerdown", onDown);
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                renderer.dispose();
                geometry.dispose();
                texture.dispose();
                if (canvas.parentElement === mount) mount.removeChild(canvas);
            };
        });

        return () => {
            disposed = true;
            cleanup();
        };
    }, [source]);

    if (!source) {
        return (
            <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: ctx.theme.node.placeholder }}>
                <span style={{ fontSize: 26 }}>🌐</span>
                <span style={{ fontSize: 14 }}>连接一个全景图片节点</span>
            </div>
        );
    }
    return <div ref={mountRef} data-canvas-no-zoom onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} style={{ height: "100%", width: "100%", overflow: "hidden", borderRadius: 16, background: "#000" }} />;
}

export default definePlugin({
    id: "panorama",
    name: "3D 全景节点",
    version: "1.0.0",
    description: "查看 360° 等距柱状全景图,可从上游图片节点取图",
    nodes: [
        {
            type: "panorama:viewer",
            title: "3D 全景",
            icon: "🌐",
            description: "360° 全景查看器",
            defaultSize: { width: 480, height: 300 },
            defaultMetadata: {},
            minimapColor: "#0ea5e9",
            Content: PanoramaContent,
        },
    ],
});
