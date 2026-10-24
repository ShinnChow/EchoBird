import type { VoicePalette } from '../../api/voiceInput';
import { voicePaletteColor, voicePaletteStops } from './voicePalettes';

export interface VoiceWaveFrame {
  state: 'thinking' | 'speaking' | 'disabled';
  level: number;
  light: boolean;
  reduced: boolean;
}

export class VoiceBarsRenderer {
  readonly ratio: number;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(
    private host: HTMLElement,
    ratio: number
  ) {
    this.ratio = ratio;
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.canvas.width = Math.round(80 * ratio);
    this.canvas.height = Math.round(24 * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    host.appendChild(this.canvas);
  }

  drawFrame(frame: VoiceWaveFrame, _dt: number) {
    const { ctx } = this;
    const level =
      frame.state === 'speaking' && Number.isFinite(frame.level)
        ? Math.max(0, Math.min(1, frame.level))
        : 0;
    const height = 4 + level * 10;
    ctx.clearRect(0, 0, 80, 24);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 20; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 4 + 2, 12 - height / 2 + 1);
      ctx.lineTo(i * 4 + 2, 12 + height / 2 - 1);
      ctx.stroke();
    }
  }

  colorize(palette: VoicePalette, light: boolean) {
    const { ctx } = this;
    const stops = voicePaletteStops[palette];
    let fill: string | CanvasGradient = getComputedStyle(this.host).color;
    if (stops.length) {
      const gradient = ctx.createLinearGradient(0, 0, 80, 0);
      stops.forEach((_, index) =>
        gradient.addColorStop(
          index / (stops.length - 1),
          voicePaletteColor(palette, index / (stops.length - 1), light)!
        )
      );
      fill = gradient;
    }
    // Tint after scrolling; the history keeps neutral shapes, so its gradient never collapses.
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 80, 24);
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose() {
    this.canvas.remove();
  }
}
