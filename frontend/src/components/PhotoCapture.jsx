import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import { resizeImage } from '../utils/image.js';

/**
 * Reusable Photo Input with both Camera Capture and File Upload.
 * Works seamlessly on laptops, webcams, and mobile devices.
 */
export default function PhotoCapture({ value, onChange }) {
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [facingMode, setFacingMode] = useState('user'); // 'user' | 'environment'
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const mobileCameraInputRef = useRef(null);

  // Stop camera stream cleanly
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Start live camera stream
  const startCamera = async (mode = facingMode) => {
    setCameraLoading(true);
    setCameraError('');
    stopCamera();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Live camera access is not supported in this browser. Please use the device camera or file upload option.');
      setCameraLoading(false);
      return;
    }

    try {
      const constraints = {
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Check if device has multiple cameras (front + rear)
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      } catch {
        setHasMultipleCameras(false);
      }

      setCameraLoading(false);
    } catch (err) {
      console.warn('Camera stream error:', err);
      let msg = 'Unable to access camera: ' + (err.message || 'Unknown error');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission was denied. Please allow camera permissions in your browser or use the file upload option.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No camera device found on this system. Please upload a photo file instead.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = 'Camera is already in use by another application or tab. Please close other camera apps and try again.';
      }
      setCameraError(msg);
      setCameraLoading(false);
    }
  };

  // Open camera modal
  const openCameraModal = () => {
    setIsCameraOpen(true);
    startCamera(facingMode);
  };

  // Close camera modal
  const closeCameraModal = () => {
    stopCamera();
    setIsCameraOpen(false);
    setCameraError('');
  };

  // Toggle front/rear camera
  const toggleFacingMode = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  // Capture still image from live video
  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError('Camera feed not ready yet. Please wait a moment and try again.');
      return;
    }

    try {
      const maxDim = 320;
      const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      onChange(dataUrl);
      closeCameraModal();
    } catch (err) {
      setCameraError('Failed to capture frame: ' + err.message);
    }
  };

  // Handle standard file upload
  const onFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      try {
        const resized = await resizeImage(file);
        onChange(resized);
      } catch (err) {
        alert('Could not process selected image: ' + err.message);
      }
    }
    e.target.value = '';
  };

  // Stop camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  return (
    <div className="photo-capture-wrapper">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
      {/* Fallback for mobile native camera capture */}
      <input
        ref={mobileCameraInputRef}
        type="file"
        accept="image/*"
        capture="user"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      <div className="photo-capture-row" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* Photo Preview Thumbnail */}
        <div
          className="photo-preview-box"
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid var(--border, #e2e8f0)',
            background: 'var(--purple-50, #f8fafc)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          {value ? (
            <img
              src={value}
              alt="Trainee Preview"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Icon name="users" size={26} />
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {value ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={openCameraModal}
                title="Retake photo using camera"
              >
                <Icon name="camera" size={14} /> Retake Photo
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => fileInputRef.current?.click()}
                title="Choose a different image file"
              >
                <Icon name="upload" size={14} /> Replace File
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => onChange('')}
                title="Remove current photo"
              >
                <Icon name="trash" size={14} /> Remove
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={openCameraModal}
              >
                <Icon name="camera" size={15} /> Take Photo
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="download" size={14} /> Upload File
              </button>
            </>
          )}
        </div>
      </div>

      {value && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          ✓ Photo attached (preview shown above). Click &ldquo;Retake&rdquo; or &ldquo;Remove&rdquo; to change.
        </div>
      )}

      {/* Camera Viewfinder Modal */}
      {isCameraOpen && (
        <div
          className="modal-overlay"
          style={{ zIndex: 9999 }}
          onMouseDown={(e) => e.target === e.currentTarget && closeCameraModal()}
        >
          <div
            className="modal"
            style={{
              maxWidth: 500,
              width: '95%',
              background: '#fff',
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div className="modal-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <Icon name="camera" size={18} />
                <span>Take Trainee Photo</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={closeCameraModal}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* Modal Body / Viewfinder */}
            <div className="modal-body" style={{ padding: 16, textAlign: 'center' }}>
              {cameraError ? (
                <div style={{ padding: '16px 8px' }}>
                  <div className="notice" style={{ color: 'var(--red, #dc2626)', marginBottom: 16, textAlign: 'left' }}>
                    {cameraError}
                  </div>
                  <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
                    You can open your device's native camera or upload a file directly:
                  </p>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        closeCameraModal();
                        mobileCameraInputRef.current?.click();
                      }}
                    >
                      <Icon name="camera" size={15} /> Device Camera
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        closeCameraModal();
                        fileInputRef.current?.click();
                      }}
                    >
                      Choose Photo File
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ position: 'relative', width: '100%', maxWidth: 440, margin: '0 auto', background: '#0f172a', borderRadius: 10, overflow: 'hidden', minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                      width: '100%',
                      height: '100%',
                      maxHeight: 330,
                      objectFit: 'cover',
                      display: cameraLoading ? 'none' : 'block',
                      transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                    }}
                  />
                  {cameraLoading && (
                    <div style={{ color: '#fff', fontSize: 14, padding: 20 }}>
                      Starting camera…
                    </div>
                  )}

                  {/* Framing guideline overlay */}
                  {!cameraLoading && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        border: '2px dashed rgba(255,255,255,0.45)',
                        margin: 16,
                        borderRadius: '50%',
                        maxWidth: 220,
                        maxHeight: 260,
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                      }}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            {!cameraError && (
              <div
                className="modal-foot"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 18px',
                  borderTop: '1px solid var(--border)',
                  background: 'var(--gray-50, #f8fafc)',
                }}
              >
                <div>
                  {hasMultipleCameras && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={toggleFacingMode}
                      title="Switch front/back camera"
                    >
                      <Icon name="sliders" size={14} /> Switch Camera
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={closeCameraModal}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={captureFrame}
                    disabled={cameraLoading}
                  >
                    <Icon name="camera" size={16} /> Capture Photo
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
