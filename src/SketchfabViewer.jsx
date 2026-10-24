import React from 'react';

/**
 * Official Sketchfab embed for the user-provided model.
 * The embedded viewer owns its own orbit/zoom controls; the parent app cannot
 * programmatically select internal meshes or move its camera without model/API access.
 */
export default function SketchfabViewer() {
  return (
    <div className="sketchfab-viewer" aria-label="Interactive 3D house model">
      <iframe
        title="Modern House. Prefab House. AirBnB. 3Bed — Sketchfab 3D viewer"
        src="https://sketchfab.com/models/39177ad7f302433e8a8af343bc5a5d1a/embed?autostart=0&ui_theme=dark&ui_infos=0&ui_watermark=1"
        allow="autoplay; fullscreen; xr-spatial-tracking"
        allowFullScreen
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <div className="viewer-credit">
        <span>3D ASSET · SKETCHFAB</span>
        <a href="https://sketchfab.com/3d-models/modern-house-prefab-house-airbnb-3bed-39177ad7f302433e8a8af343bc5a5d1a" target="_blank" rel="noreferrer">Open model page ↗</a>
      </div>
    </div>
  );
}
