import type { PetModel } from './petConstants';

export interface PetScene {
  show(pet: PetModel): void;
  upgrade(next: PetModel, done: () => void, onProgress?: (progress: number) => void): void;
  interact(): void;
  rotate(dx: number, dy: number): void;
  thumbnail(pet: PetModel): string;
  dispose(): void;
}
export function createPetScene(canvas: HTMLCanvasElement): PetScene;
