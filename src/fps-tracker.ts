/**
 * FPS Tracker with multiple smoothing algorithms
 *
 * Implements both:
 * 1. Exponential Moving Average (EMA) - lightweight, smooth
 * 2. Circular Buffer Average - more precise, slightly heavier
 */

export class FPSTracker {
  // EMA configuration
  private emaAlpha: number; // Smoothing factor (0-1, higher = more responsive)
  private emaFPS: number = 60; // Start optimistic

  // Circular buffer configuration
  private readonly bufferSize: number;
  private frameTimes: Float32Array;
  private bufferIndex: number = 0;
  private bufferFilled: boolean = false;
  private timeAccumulator: number = 0;

  // Tracking
  private lastUpdateTime: number = 0;
  private frameCount: number = 0;

  /**
   * @param smoothingFactor - EMA alpha value (0-1). Default 0.1 = smooth, 0.3 = responsive
   * @param bufferSize - Circular buffer size for precise averaging. Default 60 samples
   */
  constructor(smoothingFactor: number = 0.1, bufferSize: number = 60) {
    this.emaAlpha = smoothingFactor;
    this.bufferSize = bufferSize;
    this.frameTimes = new Float32Array(bufferSize);
    this.lastUpdateTime = performance.now();
  }

  /**
   * Update FPS calculation with new frame
   * Call this once per frame
   */
  update(): void {
    const now = performance.now();
    const deltaTime = now - this.lastUpdateTime;
    this.lastUpdateTime = now;

    // Skip first frame or massive gaps (e.g., tab switching)
    if (deltaTime <= 0 || deltaTime > 1000) {
      return;
    }

    this.frameCount++;

    // Update circular buffer
    this.timeAccumulator -= this.frameTimes[this.bufferIndex];
    this.frameTimes[this.bufferIndex] = deltaTime;
    this.timeAccumulator += deltaTime;

    this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;
    if (this.bufferIndex === 0) {
      this.bufferFilled = true;
    }

    // Update EMA
    const instantFPS = 1000 / deltaTime;
    this.emaFPS = this.emaAlpha * instantFPS + (1 - this.emaAlpha) * this.emaFPS;
  }

  /**
   * Get smoothed FPS using Exponential Moving Average
   * Fast, lightweight, good for real-time display
   */
  getEMAFPS(): number {
    return this.emaFPS;
  }

  /**
   * Get FPS using circular buffer average
   * More precise, slightly heavier computation
   */
  getBufferAverageFPS(): number {
    const sampleCount = this.bufferFilled ? this.bufferSize : this.bufferIndex;
    if (sampleCount === 0) return 60; // Default before any samples

    const avgFrameTime = this.timeAccumulator / sampleCount;
    return 1000 / avgFrameTime;
  }

  /**
   * Get instantaneous FPS (no smoothing)
   * Useful for debugging or when raw data is needed
   */
  getInstantFPS(): number {
    const lastFrameTime = this.frameTimes[(this.bufferIndex - 1 + this.bufferSize) % this.bufferSize];
    if (lastFrameTime === 0) return 60;
    return 1000 / lastFrameTime;
  }

  /**
   * Get average frame time in milliseconds
   */
  getAverageFrameTime(): number {
    const sampleCount = this.bufferFilled ? this.bufferSize : this.bufferIndex;
    if (sampleCount === 0) return 16.67;
    return this.timeAccumulator / sampleCount;
  }

  /**
   * Get total frames processed
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * Reset all tracking data
   */
  reset(): void {
    this.emaFPS = 60;
    this.frameTimes.fill(0);
    this.bufferIndex = 0;
    this.bufferFilled = false;
    this.timeAccumulator = 0;
    this.frameCount = 0;
    this.lastUpdateTime = performance.now();
  }

  /**
   * Adjust EMA smoothing factor on the fly
   * @param alpha - 0.05 = very smooth, 0.3 = very responsive
   */
  setSmoothingFactor(alpha: number): void {
    this.emaAlpha = Math.max(0.01, Math.min(1.0, alpha));
  }
}