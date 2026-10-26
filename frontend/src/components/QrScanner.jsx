import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// Live camera QR scanner (works on phones and laptops, no native BarcodeDetector needed).
// Browsers only allow the camera on https:// or http://localhost.
export default function QrScanner({ onScan, onClose }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const cb = useRef(onScan);
  cb.current = onScan;
  const [err, setErr] = useState('');

  // Fallback when live camera is blocked (e.g. plain http on a phone): decode a photo taken with the phone's camera app.
  const fromPhoto = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
      const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      if (code && code.data) cb.current(code.data.trim()); else setErr('No QR found in that photo. Try again, closer and in focus.');
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  };

  useEffect(() => {
    let stream; let raf; let stopped = false; let last = ''; let lastAt = 0;
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErr('Camera needs a secure page (https://) or localhost. Open the site over HTTPS to use the camera.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
        const tick = () => {
          const v = video.current; const c = canvas.current;
          if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
            const w = 480; const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
            c.width = w; c.height = h;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, w, h);
            const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (code && code.data && (code.data !== last || Date.now() - lastAt > 2500)) {
              last = code.data; lastAt = Date.now();
              cb.current(code.data.trim());
            }
          }
          raf = setTimeout(tick, 120);
        };
        tick();
      } catch (e) {
        setErr(e.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access in the browser and try again.' : `Could not start the camera (${e.name}).`);
      }
    })();
    return () => { stopped = true; clearTimeout(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="scanner">
      {err ? (
        <div className="notice">
          {err}
          <div style={{ marginTop: 10 }}>
            <label className="field-label">Or take a photo of the QR with your phone camera:</label>
            <input className="input" type="file" accept="image/*" capture="environment" onChange={fromPhoto} />
          </div>
        </div>
      ) : (
        <div className="scanner-view">
          <video ref={video} playsInline muted />
          <div className="scanner-frame" />
        </div>
      )}
      <canvas ref={canvas} style={{ display: 'none' }} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close camera</button>
    </div>
  );
}
