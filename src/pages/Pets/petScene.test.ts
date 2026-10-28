import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPetScene } from './petScene.js';
import type { PetScene } from './petScene';

interface MeshObject {
  isMesh?: boolean;
  name: string;
  material?: {
    isMeshBasicMaterial: boolean;
    map: unknown;
    color: { getHexString(): string };
    addEventListener(type: string, callback: () => void): void;
  };
}
interface Scene {
  traverseVisible(callback: (object: MeshObject) => void): void;
}
interface Vector {
  x: number;
}
interface Bounds {
  max: { y: number };
  union(other: Bounds): Bounds;
  setFromObject(object: MeshObject): Bounds;
  getSize(target: Vector): Vector;
  clone(): Bounds;
  equals(other: Bounds): boolean;
}
const THREE = await vi.importActual<{ Box3: new () => Bounds; Vector3: new () => Vector }>('three');

const capture = vi.hoisted(() => ({ scene: null as Scene | null }));
vi.mock('three', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('three');
  return {
    ...actual,
    WebGLRenderer: class {
      setPixelRatio() {}
      setClearColor() {}
      setSize() {}
      render(scene: Scene) {
        capture.scene = scene;
      }
      dispose() {}
    },
  };
});

let renderer: PetScene;
beforeEach(() => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }), devicePixelRatio: 1 });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  renderer = createPetScene({ clientWidth: 500, clientHeight: 400 } as HTMLCanvasElement);
});
afterEach(() => {
  renderer?.dispose();
  vi.unstubAllGlobals();
});

const egg = (stage: number) => ({
  id: 1,
  kind: 'mecha' as const,
  stage,
  level: stage * 10,
  color: 0,
});
function visibleShell() {
  const meshes: MeshObject[] = [],
    bounds = new THREE.Box3();
  capture.scene!.traverseVisible((object) => {
    if (object.isMesh && object.name !== 'egg-core') {
      meshes.push(object);
      bounds.union(new THREE.Box3().setFromObject(object));
    }
  });
  return { meshes, bounds };
}

it('gives level ten a visibly separated three-piece shell instead of only recoloring the intact egg', () => {
  renderer.show(egg(0));
  const intact = visibleShell();
  renderer.show(egg(1));
  const cracked = visibleShell();
  expect(intact.meshes).toHaveLength(1);
  expect(cracked.meshes).toHaveLength(3);
  expect(cracked.bounds.max.y).toBeGreaterThan(intact.bounds.max.y + 0.5);
  expect(cracked.bounds.getSize(new THREE.Vector3()).x).toBeGreaterThan(
    intact.bounds.getSize(new THREE.Vector3()).x + 1
  );
});

it('keeps the same cracked shape at the upgrade endpoint and when returning after hatching', () => {
  renderer.show(egg(0));
  const done = vi.fn();
  renderer.upgrade(egg(1), done);
  expect(done).toHaveBeenCalledTimes(1);
  const end = visibleShell().bounds.clone();
  renderer.show(egg(1));
  expect(visibleShell().bounds.equals(end)).toBe(true);
  renderer.upgrade({ ...egg(2), level: 20 }, vi.fn());
  renderer.show(egg(1));
  expect(visibleShell().meshes).toHaveLength(3);
  expect(visibleShell().bounds.equals(end)).toBe(true);
});

it('keeps a single unlit, egg-colored core inside the cracked shell without an idle animation loop', () => {
  const cores = () => {
    const visible: MeshObject[] = [];
    capture.scene!.traverseVisible((object) => {
      if (object.isMesh && object.name === 'egg-core') visible.push(object);
    });
    return visible;
  };
  renderer.show(egg(0));
  expect(cores()).toHaveLength(0);
  renderer.show(egg(1));
  expect(cores()).toHaveLength(1);
  const material = cores()[0].material!,
    blue = material.color.getHexString();
  expect(material.isMeshBasicMaterial).toBe(true);
  expect(material.map).toBeNull();
  renderer.show({ ...egg(1), color: 1 });
  expect(cores()[0].material!.color.getHexString()).not.toBe(blue);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  renderer.upgrade(egg(2), vi.fn());
  expect(cores()).toHaveLength(0);
  renderer.show(egg(1));
  expect(cores()).toHaveLength(1);
  const dispose = vi.fn();
  material.addEventListener('dispose', dispose);
  renderer.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it.each([
  [0, 0],
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
])(
  'reports normalized spending progress through stage %i → %i, then stops requesting frames',
  (from, to) => {
    renderer.dispose();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), devicePixelRatio: 1 });
    let tick: FrameRequestCallback;
    const request = vi.fn((callback: FrameRequestCallback) => {
      tick = callback;
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', request);
    renderer = createPetScene({ clientWidth: 500, clientHeight: 400 } as HTMLCanvasElement);
    renderer.show(egg(from));
    const progress = vi.fn(),
      done = vi.fn();
    const start = performance.now();
    renderer.upgrade(egg(to), done, progress);
    expect(progress).toHaveBeenLastCalledWith(0);
    tick!(start + 100);
    expect(progress.mock.lastCall![0]).toBeGreaterThan(0);
    expect(progress.mock.lastCall![0]).toBeLessThan(1);
    const frames = request.mock.calls.length;
    tick!(start + 3000);
    expect(progress).toHaveBeenLastCalledWith(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(frames);
  }
);

it('does not restart an idle gesture or interrupt an upgrade when more idle requests arrive', () => {
  renderer.dispose();
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), devicePixelRatio: 1 });
  let tick: FrameRequestCallback;
  const request = vi.fn((callback: FrameRequestCallback) => {
    tick = callback;
    return 1;
  });
  vi.stubGlobal('requestAnimationFrame', request);
  renderer = createPetScene({ clientWidth: 500, clientHeight: 400 } as HTMLCanvasElement);
  renderer.show(egg(0));
  renderer.interact();
  renderer.interact();
  renderer.interact();
  expect(request).toHaveBeenCalledTimes(1);
  const done = vi.fn(),
    start = performance.now();
  renderer.upgrade(egg(1), done);
  const frames = request.mock.calls.length;
  renderer.interact();
  expect(request).toHaveBeenCalledTimes(frames);
  tick!(start + 3000);
  expect(done).toHaveBeenCalledOnce();
  renderer.interact();
  expect(request).toHaveBeenCalledTimes(frames + 1);
});
