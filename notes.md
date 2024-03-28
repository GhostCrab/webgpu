# Motion Blur
render-pass-descriptor.ts
 * this.colorAttachments => loadOp: 'load'

verlet-renderer.ts
 * Mess with alpha blending in this.fragment
````
  {
    this.renderPassDesc.updateResolveTarget(this.context.getCurrentTexture().createView()); 
    
    let passEncoder = commandEncoder.beginRenderPass(this.renderPassDesc);
    
    passEncoder.setPipeline(this.dimTexturePipeline);
    passEncoder.setBindGroup(0, this.dimTextureBindGroup);
    passEncoder.draw(6);
    passEncoder.end();
  }
  
  {
    // ⏭ Acquire next image from context
    this.renderPassDesc.updateResolveTarget(this.renderTexture.createView()); 

    let passEncoder = commandEncoder.beginRenderPass(this.renderPassDesc);
    passEncoder.setBindGroup(0, this.uniformBindGroup);

    this.verlet.render(passEncoder);        
    passEncoder.end();
  }

  {
    this.renderPassDesc.updateResolveTarget(this.context.getCurrentTexture().createView()); 
    
    let passEncoder = commandEncoder.beginRenderPass(this.renderPassDesc);
    
    passEncoder.setPipeline(this.fullscreenQuadPipeline);
    passEncoder.setBindGroup(0, this.fullscreenQuadBindGroup);
    passEncoder.draw(6);
    passEncoder.end();
  }
````
