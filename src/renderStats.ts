import Renderer from "./renderer";

export default class RenderStats {
  private frameTimes: number[] = [];

  private lambda6 = 0.5720236015483775;
  updateOverlay(frameTime: number, renderer: Renderer) {
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length >= 20)
      this.frameTimes.shift();

    const ema = this.ema6();
    // overlayElement.innerText = `${Math.round((1/ema.pop()) * 100) / 100}`;
    renderer.overlayElement.innerText = 
      `FPS: ${Math.round(1/ema.pop())}\n` +
      `Objects: ${renderer.verlet.objectCount}\n` +
      `Bins: ${renderer.verlet.computer.binGridSquareCount}\n` +
      `Object Size: ${renderer.verlet.minRadius * 2} - ${renderer.verlet.maxRadius * 2}\n` +
      `Bounds Size: ${renderer.constrainRadius * 2}\n` +
      `Collision: ${renderer.doCollision}\n` +
      `Constrain: ${renderer.classicConstrain ? "Classic" : "Reflect"}\n` +
      `ClickForce: ${renderer.clickLock ? 'LOCKED' : renderer.clickForce}`;
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