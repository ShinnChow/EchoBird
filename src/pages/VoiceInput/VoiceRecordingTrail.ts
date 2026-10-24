// Keep already drawn columns moving, rather than only changing a wave's phase.
const VOICE_SCROLL_SPEED = 32;

export class VoiceRecordingTrail {
  private history: HTMLCanvasElement;
  private historyCtx: CanvasRenderingContext2D | null;
  private sourceCtx: CanvasRenderingContext2D | null;
  private seeded = false;
  private pending = 0;
  private cursor = 0;

  constructor(
    private source: HTMLCanvasElement,
    private ratio: number
  ) {
    this.history = document.createElement('canvas');
    this.history.width = source.width;
    this.history.height = source.height;
    this.historyCtx = this.history.getContext('2d');
    this.sourceCtx = source.getContext('2d');
    if (this.historyCtx) this.historyCtx.imageSmoothingEnabled = false;
  }

  draw(dt: number) {
    const { historyCtx, sourceCtx, history, source } = this;
    if (!historyCtx || !sourceCtx) return;
    const { width, height } = history;
    const pitch = Math.max(1, Math.round(4 * this.ratio));
    if (!this.seeded) {
      historyCtx.globalCompositeOperation = 'copy';
      historyCtx.drawImage(source, 0, 0);
      historyCtx.globalCompositeOperation = 'source-over';
      this.seeded = true;
    } else {
      this.pending += dt * VOICE_SCROLL_SPEED * this.ratio;
      const pixels = Math.min(width, Math.floor(this.pending + 1e-8));
      this.pending = Math.max(0, this.pending - pixels);
      if (pixels > 0) {
        historyCtx.globalCompositeOperation = 'copy';
        historyCtx.drawImage(history, -pixels, 0);
        historyCtx.globalCompositeOperation = 'source-over';
        historyCtx.clearRect(width - pixels, 0, pixels, height);
        for (let column = 0; column < pixels; column++) {
          const x = Math.floor(width / 2) + ((this.cursor + column) % pitch);
          historyCtx.drawImage(source, x, 0, 1, height, width - pixels + column, 0, 1, height);
        }
        this.cursor = (this.cursor + pixels) % pitch;
      }
    }
    sourceCtx.save();
    sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
    sourceCtx.globalAlpha = 1;
    sourceCtx.globalCompositeOperation = 'copy';
    sourceCtx.imageSmoothingEnabled = false;
    sourceCtx.drawImage(history, 0, 0);
    sourceCtx.restore();
  }

  reset() {
    if (this.seeded) this.historyCtx?.clearRect(0, 0, this.history.width, this.history.height);
    this.seeded = false;
    this.pending = 0;
    this.cursor = 0;
  }
}
