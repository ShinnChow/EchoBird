import type { VoicePalette } from '../../api/voiceInput';

export const voicePaletteStops: Record<VoicePalette, readonly string[]> = {
  white: [],
  aurora: ['#10B981', '#06B6D4', '#6366F1', '#A855F7'],
  ocean: ['#22D3EE', '#60A5FA', '#818CF8'],
  sunset: ['#FBBF24', '#FB7185', '#A78BFA'],
  iris: ['#A78BFA', '#C084FC', '#F0ABFC'],
};

export const voicePalettes = Object.keys(voicePaletteStops) as VoicePalette[];

export function voicePaletteColor(palette: VoicePalette, position: number, light = false) {
  const stops = voicePaletteStops[palette];
  if (!stops.length) return undefined;
  const x = Math.max(0, Math.min(1, position)) * (stops.length - 1);
  const index = Math.floor(x);
  const a = parseInt(stops[index].slice(1), 16);
  const b = parseInt(stops[Math.min(index + 1, stops.length - 1)].slice(1), 16);
  const rgb = [16, 8, 0].map((shift) =>
    Math.round(
      (((a >> shift) & 255) * (1 - (x - index)) + ((b >> shift) & 255) * (x - index)) *
        (light ? 0.68 : 1)
    )
  );
  return `rgb(${rgb.join(',')})`;
}
