interface GrowthTrack {
  a: number[];
  b: number[];
  sa: number;
  sb: number;
  delay: number;
}
interface Voxel {
  x: number;
  y: number;
  z: number;
  color: string;
}
export function createVoxelModels(): {
  definitions: { kind: string; age: number; voxels: Map<string, Voxel> }[];
  egg: Map<string, Voxel>;
  cracked: Map<string, Voxel>;
  transitions: { kind: string; step: number; tracks: GrowthTrack[] }[];
  growthCell(track: GrowthTrack, amount: number): { p: number[]; scale: number; u: number };
};
