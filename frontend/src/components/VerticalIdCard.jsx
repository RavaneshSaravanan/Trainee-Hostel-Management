import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import jsPDF from 'jspdf';
import { useStore } from '../store.jsx';
import { Icon, Modal } from './ui.jsx';
import { fmtDate } from '../utils/dates.js';
import { getToken } from '../utils/api.js';
import { DEFAULT_IDCARD_TEMPLATE, DEFAULT_ORG_BRANDING } from '../data/defaults.js';

/**
 * Converts any image URL (local relative path, remote URL, or blob)
 * into a safe base64 Data URL so it never taints HTML5 Canvas or triggers CORS errors.
 */
async function toDataUrlSafe(src) {
  if (!src || typeof src !== 'string') return '';
  if (src.startsWith('data:image/')) return src;

  try {
    const token = getToken();
    const headers = {};
    if (token && (src.startsWith('/') || src.includes(window.location.host))) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(src, { headers, mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn(`[ID Card] Could not convert image to safe Data URL: ${err.message}. Using source as-is.`);
    return src;
  }
}

/**
 * Preloads an Image element and waits for it to decode into memory.
 */
function preloadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`[ID Card] Image failed to load: ${src.slice(0, 50)}…`);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Professional Vertical Trainee ID Card (CR80 Standard Aspect Ratio).
 * Features:
 * - Professional Violet & Deep-Purple Theme (Hex: #2E1065, #4C1D95, #7C3AED, #8B5CF6, #EDE9FE)
 * - Safe image loading via Blob -> DataURL (prevents canvas tainting & missing photos)
 * - True isolated single-card print output (body.printing-id-card)
 * - High-resolution CR80 PDF export via jsPDF
 * - Direct high-res PNG export
 */
export default function VerticalIdCard({ trainee, onClose, embedded = false, customTemplate = null }) {
  const { config, notify } = useStore();
  const cardRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState('');

  const tpl = customTemplate || config.idCardTemplate || DEFAULT_IDCARD_TEMPLATE;
  const branding = config.orgBranding || DEFAULT_ORG_BRANDING;
  const companyName = tpl.companyName || branding.orgName || 'APOLLO TYRES LTD';
  const subtitle = tpl.subtitle || 'TRAINEE IDENTITY CARD';
  const headerBgStart = tpl.headerBgStart || '#2E1065';
  const headerBgEnd = tpl.headerBgEnd || '#4C1D95';
  const accentColor = tpl.accentColor || '#8B5CF6';
  const footerText = tpl.footerText || `Authorized Trainee ID Card · ${companyName}`;
  const effectiveLogo = branding.logo || config.logo || '';
  const photoRadius = tpl.photoShape === 'square' ? '18px' : '50%';

  if (!trainee) return null;

  // Public verification URL encoded in the QR code
  const verifyUrl = `${window.location.origin}${window.location.pathname}#/verify/${encodeURIComponent(trainee.traineeId)}`;

  // Pre-convert trainee photo and logo to safe base64 Data URLs so they are ready for instant canvas draw
  useEffect(() => {
    let active = true;
    if (trainee.photo) {
      toDataUrlSafe(trainee.photo).then((dataUrl) => {
        if (active && dataUrl) setPhotoDataUrl(dataUrl);
      });
    } else {
      setPhotoDataUrl('');
    }
    return () => {
      active = false;
    };
  }, [trainee.photo]);

  // Clean, isolated print handler: prints ONLY the ID card
  const handlePrint = () => {
    document.body.classList.add('printing-id-card');
    const cleanup = () => {
      document.body.classList.remove('printing-id-card');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    // Fallback cleanup in case browser afterprint event is delayed
    setTimeout(cleanup, 2000);
  };

  /**
   * Generates high-resolution 300-DPI canvas (638 x 1012 px, CR80 ratio).
   * Violet theme is strictly applied here to match preview, print, and PDF.
   */
  const generateCanvas = async () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 638;
    canvas.height = 1012;

    // 1. Solid White Card Base
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Executive Header Gradient
    const headerGrad = ctx.createLinearGradient(0, 0, canvas.width, 185);
    headerGrad.addColorStop(0, headerBgStart);
    headerGrad.addColorStop(1, headerBgEnd);
    ctx.fillStyle = headerGrad;
    ctx.fillRect(0, 0, canvas.width, 185);

    // 3. Vibrant Accent Stripe
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 185, canvas.width, 8);

    // 4. Preload Assets
    const [logoImg, photoImg] = await Promise.all([
      effectiveLogo ? preloadImage(await toDataUrlSafe(effectiveLogo)) : Promise.resolve(null),
      (photoDataUrl || trainee.photo) ? preloadImage(photoDataUrl || await toDataUrlSafe(trainee.photo)) : Promise.resolve(null),
    ]);

    // Draw Company Logo if available
    if (logoImg && logoImg.width > 0) {
      const logoH = 80;
      const logoW = Math.min(100, logoH * (logoImg.width / logoImg.height));
      ctx.drawImage(logoImg, 35, 52, logoW, logoH);
    }

    // Header Titles
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 27px Inter, Arial, sans-serif';
    ctx.textAlign = logoImg ? 'left' : 'center';
    const titleX = logoImg ? 150 : canvas.width / 2;
    ctx.fillText(companyName.toUpperCase(), titleX, 90);

    ctx.fillStyle = '#DDD6FE';
    ctx.font = '15px Inter, Arial, sans-serif';
    ctx.fillText(subtitle.toUpperCase(), titleX, 126);

    // 5. Trainee Photograph
    const photoBoxX = canvas.width / 2 - 82;
    const photoBoxY = 222;
    const photoSize = 164;

    ctx.save();
    ctx.beginPath();
    if (tpl.photoShape === 'square') {
      if (ctx.roundRect) ctx.roundRect(photoBoxX, photoBoxY, photoSize, photoSize, 18);
      else ctx.rect(photoBoxX, photoBoxY, photoSize, photoSize);
    } else {
      ctx.arc(canvas.width / 2, photoBoxY + photoSize / 2, photoSize / 2, 0, Math.PI * 2);
    }
    ctx.closePath();
    ctx.clip();

    if (photoImg && photoImg.width > 0) {
      ctx.drawImage(photoImg, photoBoxX, photoBoxY, photoSize, photoSize);
    } else {
      // Clean fallback avatar with violet background
      ctx.fillStyle = '#EDE9FE';
      ctx.fillRect(photoBoxX, photoBoxY, photoSize, photoSize);
      ctx.fillStyle = '#5B21B6';
      ctx.font = 'bold 54px Arial';
      ctx.textAlign = 'center';
      const initials = (trainee.name || 'TR').trim().slice(0, 2).toUpperCase();
      ctx.fillText(initials, canvas.width / 2, photoBoxY + 105);
    }
    ctx.restore();

    // Photo Ring Border
    ctx.beginPath();
    if (tpl.photoShape === 'square') {
      if (ctx.roundRect) ctx.roundRect(photoBoxX, photoBoxY, photoSize, photoSize, 18);
      else ctx.rect(photoBoxX, photoBoxY, photoSize, photoSize);
    } else {
      ctx.arc(canvas.width / 2, photoBoxY + photoSize / 2, photoSize / 2, 0, Math.PI * 2);
    }
    ctx.lineWidth = 5;
    ctx.strokeStyle = accentColor;
    ctx.stroke();

    // 6. Trainee Full Name
    ctx.fillStyle = '#1E1B4B';
    ctx.font = 'bold 32px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(trainee.name, canvas.width / 2, 432);

    // 7. Trainee ID Pill (Lavender Background #EDE9FE, Bold Violet Text #5B21B6)
    ctx.fillStyle = '#EDE9FE';
    const pillW = 270;
    const pillH = 42;
    const pillX = canvas.width / 2 - pillW / 2;
    const pillY = 455;
    if (ctx.roundRect) {
      ctx.roundRect(pillX, pillY, pillW, pillH, 21);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();

    ctx.fillStyle = '#5B21B6';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(trainee.traineeId, canvas.width / 2, pillY + 29);

    // 8. Trainee Details Rows (Configurable)
    const items = [];
    if (tpl.showQualification !== false) items.push(['Qualification:', trainee.qualification || 'Trainee']);
    if (tpl.showPhone !== false) items.push(['Phone Number:', trainee.mobile || '—']);
    if (tpl.showHostel !== false) items.push(['Hostel Block:', trainee.hostel || 'Hostel Campus']);
    if (tpl.showRoom !== false) items.push(['Room Number:', trainee.roomNo ? `Room ${trainee.roomNo}` : 'Unassigned']);
    if (tpl.showJoiningDate !== false) items.push(['Joining Date:', fmtDate(trainee.joiningDate)]);

    ctx.textAlign = 'left';
    const startY = 548;
    const step = 41;
    const leftCol = 70;
    const valCol = 275;

    items.forEach(([label, val], idx) => {
      ctx.fillStyle = '#6D28D9';
      ctx.font = '18.5px Inter, Arial, sans-serif';
      ctx.fillText(label, leftCol, startY + idx * step);

      ctx.fillStyle = '#1E1B4B';
      ctx.font = 'bold 18.5px Inter, Arial, sans-serif';
      ctx.fillText(val, valCol, startY + idx * step);
    });

    // 9. Horizontal Divider
    ctx.strokeStyle = '#DDD6FE';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(60, 755);
    ctx.lineTo(canvas.width - 60, 755);
    ctx.stroke();
    ctx.setLineDash([]);

    // 10. QR Code with Verification Label
    if (tpl.showQr !== false) {
      const qrCanvas = cardRef.current?.querySelector('.id-card-qr-box canvas');
      if (qrCanvas) {
        ctx.drawImage(qrCanvas, canvas.width / 2 - 75, 780, 150, 150);
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = '#5B21B6';
      ctx.font = 'bold 13px Inter, Arial, sans-serif';
      ctx.fillText('Scan with Camera to Verify Official Status', canvas.width / 2, 955);
    }

    // 11. Footer Strip
    ctx.fillStyle = headerBgStart;
    ctx.fillRect(0, 978, canvas.width, 34);

    ctx.fillStyle = '#DDD6FE';
    ctx.font = '12.5px Inter, Arial, sans-serif';
    ctx.fillText(footerText, canvas.width / 2, 1000);

    return canvas;
  };

  // PDF Generation with standard CR80 physical proportions
  const handleDownloadPdf = async () => {
    try {
      setDownloading(true);
      notify('Generating high-resolution ID card PDF…');
      const canvas = await generateCanvas();
      const imgData = canvas.toDataURL('image/png');

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [54, 85.6], // Standard CR80 badge dimensions
      });

      pdf.addImage(imgData, 'PNG', 0, 0, 54, 85.6);
      pdf.save(`ID-CARD-${trainee.traineeId}.pdf`);
      notify('✓ ID Card PDF downloaded successfully.');
    } catch (err) {
      console.error('[ID Card PDF Error]', err);
      notify(`PDF generation error: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  // Direct PNG Download
  const handleDownloadImage = async () => {
    try {
      notify('Generating ID card image…');
      const canvas = await generateCanvas();
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `ID-CARD-${trainee.traineeId}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      notify('✓ ID Card image downloaded successfully.');
    } catch (err) {
      console.error('[ID Card Image Error]', err);
      notify(`Image download error: ${err.message}`);
    }
  };

  // Action Buttons Bar
  const actionButtons = (
    <div className="id-card-actions-bar no-print">
      <button
        type="button"
        className="btn btn-primary"
        onClick={handleDownloadPdf}
        disabled={downloading}
        title="Download high-resolution printable ID card PDF"
      >
        <Icon name="download" size={15} /> {downloading ? 'Generating PDF…' : 'Download ID Card (PDF)'}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={handleDownloadImage}
        title="Download ID card as PNG image"
      >
        <Icon name="download" size={15} /> Download (PNG)
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={handlePrint}
        title="Print ID card directly on card printer or paper"
      >
        <Icon name="print" size={15} /> Print ID Card
      </button>
    </div>
  );

  const cardContent = (
    <div className="id-card-modal-wrap">
      {actionButtons}

      {/* Printable & Screen-Visible Vertical Card in Violet Theme */}
      <div className="vertical-id-card violet-id-card" ref={cardRef} id="printable-id-card">
        {/* Card Header */}
        <div className="id-card-header" style={{ background: `linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%)` }}>
          {effectiveLogo ? (
            <img src={effectiveLogo} alt="Company Logo" className="id-card-logo" crossOrigin="anonymous" />
          ) : (
            <div className="id-card-header-icon">
              <Icon name="home" size={24} />
            </div>
          )}
          <div className="id-card-header-text">
            <div className="id-card-company">{companyName.toUpperCase()}</div>
            <div className="id-card-sub">{subtitle.toUpperCase()}</div>
          </div>
        </div>

        {/* Accent Stripe */}
        <div className="id-card-stripe" style={{ background: accentColor }} />

        {/* Card Body */}
        <div className="id-card-body">
          <div className="id-card-photo-box" style={{ borderRadius: photoRadius, borderColor: accentColor }}>
            {photoDataUrl || trainee.photo ? (
              <img
                src={photoDataUrl || trainee.photo}
                alt={trainee.name}
                className="id-card-photo"
                style={{ borderRadius: photoRadius }}
                crossOrigin="anonymous"
              />
            ) : (
              <div className="id-card-photo-fallback" style={{ borderRadius: photoRadius }}>
                {(trainee.name || 'TR').trim().slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>

          <div className="id-card-name">{trainee.name}</div>
          <div className="id-card-id-pill" style={{ color: headerBgEnd }}>{trainee.traineeId}</div>

          {/* Trainee Details */}
          <div className="id-card-details">
            {tpl.showQualification !== false && (
              <div className="id-card-row">
                <span className="id-card-k">Qualification:</span>
                <span className="id-card-v">{trainee.qualification || 'Trainee'}</span>
              </div>
            )}
            {tpl.showPhone !== false && (
              <div className="id-card-row">
                <span className="id-card-k">Phone Number:</span>
                <span className="id-card-v">{trainee.mobile || '—'}</span>
              </div>
            )}
            {tpl.showHostel !== false && (
              <div className="id-card-row">
                <span className="id-card-k">Hostel:</span>
                <span className="id-card-v">{trainee.hostel || 'Hostel Campus'}</span>
              </div>
            )}
            {tpl.showRoom !== false && (
              <div className="id-card-row">
                <span className="id-card-k">Room No:</span>
                <span className="id-card-v">{trainee.roomNo ? `Room ${trainee.roomNo}` : 'Unassigned'}</span>
              </div>
            )}
            {tpl.showJoiningDate !== false && (
              <div className="id-card-row">
                <span className="id-card-k">Joining Date:</span>
                <span className="id-card-v">{fmtDate(trainee.joiningDate)}</span>
              </div>
            )}
          </div>

          {/* QR Code */}
          {tpl.showQr !== false && (
            <div className="id-card-qr-box">
              <QRCodeCanvas
                value={verifyUrl}
                size={110}
                fgColor="#1E1B4B"
                bgColor="#FFFFFF"
                includeMargin={false}
              />
              <div className="id-card-qr-id">Scan to Verify Official Credentials</div>
            </div>
          )}
        </div>

        {/* Card Footer */}
        <div className="id-card-footer" style={{ background: headerBgStart }}>
          <span style={{ color: '#DDD6FE' }}>{footerText}</span>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return cardContent;
  }

  return (
    <Modal
      title={`Trainee Identity Card · ${trainee.name}`}
      onClose={onClose}
      action={actionButtons}
    >
      {cardContent}
    </Modal>
  );
}
