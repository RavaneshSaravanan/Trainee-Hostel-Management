/** Shrink a photo to a small JPEG data-URL so phone pictures don't bloat the database. */
export function resizeImage(file, max = 320, quality = 0.82) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onerror = bad;
    r.onload = () => {
      const img = new Image();
      img.onerror = bad;
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/jpeg', quality));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
/** Large background images: keep within ~1600px so the config stays light. */
export const resizeBackground = (file) => resizeImage(file, 1600, 0.72);
