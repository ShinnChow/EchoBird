export const PET_KINDS = ['mecha', 'unicorn', 'kaiju', 'fox', 'alien', 'kangaroo'] as const;
export type PetKind = (typeof PET_KINDS)[number];
export interface PreviewPet {
  id: number;
  kind: PetKind;
  level: number;
  color: number;
  experience?: number;
}

export const PET_TINTS = [
  { id: 'blue', hex: '#88b5cf' },
  { id: 'purple', hex: '#b7a4cb' },
  { id: 'mint', hex: '#91bfa5' },
  { id: 'orange', hex: '#dfaa70' },
  { id: 'rose', hex: '#dba2a5' },
  { id: 'yellow', hex: '#dfca78' },
] as const;
export const PET_STAGES = ['egg', 'cracked', 'baby', 'young', 'adult'] as const;

export const petStage = (level: number) =>
  level < 10 ? 0 : level < 20 ? 1 : level < 30 ? 2 : level < 50 ? 3 : 4;
export const petModel = (pet: PreviewPet) => ({ ...pet, stage: petStage(pet.level) });
export type PetModel = ReturnType<typeof petModel>;
