export default class RenderStats {
  private frameTimes: number[] = [];

  private lambda6 = 0.5720236015483775;
  updateFPS(frameTime: number, overlayElement: HTMLElement) {
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length >= 20)
      this.frameTimes.shift();

    const ema = this.ema6();
    overlayElement.innerText = `${Math.round((1/ema.pop()) * 100) / 100}`;
    // overlayElement.innerText = `${Math.round(1/ema.pop())}`;
  }

  private exponentialAverage(values: number[], lambda: number): number[] {
    const out = [];
    const n = values.length;
    for (let i = 0; i < n; ++i) 
      out[i] = (out[i-1]||0) * (1 - lambda) + values[i] * lambda;
    return out;
  }

  private ema6(): number[] {
    return this.exponentialAverage(
      this.exponentialAverage(
        this.exponentialAverage(
          this.exponentialAverage(
            this.exponentialAverage(
              this.exponentialAverage(
                this.frameTimes, this.lambda6
              ), this.lambda6
            ), this.lambda6
          ), this.lambda6
        ), this.lambda6
      ), this.lambda6
    )
  }
}