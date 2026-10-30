import { google } from 'googleapis';
import stream from 'node:stream';
import fs from 'node:fs';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

let driveClient = null;

/**
 * Initializes and returns the authenticated Google Drive API client.
 * Supports:
 * 1. GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY + GOOGLE_DRIVE_FOLDER_ID
 * 2. GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON file)
 */
export function getDriveClient() {
  if (driveClient) return driveClient;

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (keyFilePath && fs.existsSync(keyFilePath)) {
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: keyFilePath,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      driveClient = google.drive({ version: 'v3', auth });
      console.log('[Google Drive] Authenticated successfully via key file:', keyFilePath);
      return driveClient;
    } catch (err) {
      console.error('[Google Drive] Failed initializing auth from key file:', err.message);
    }
  }

  if (clientEmail && privateKey) {
    try {
      // Handle private key newlines safely if stored as escaped string in .env
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });

      driveClient = google.drive({ version: 'v3', auth });
      console.log(`[Google Drive] Authenticated successfully for Service Account: ${clientEmail}`);
      return driveClient;
    } catch (err) {
      console.error('[Google Drive] Failed initializing JWT auth:', err.message);
    }
  }

  return null;
}

export function isDriveConfigured() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const client = getDriveClient();
  return Boolean(client && folderId);
}

/**
 * Helper to parse a Base64 data URL into a Buffer and MimeType
 */
export function parsePhotoData(input) {
  if (!input || typeof input !== 'string') return null;

  if (input.startsWith('data:')) {
    const match = input.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mimeType = match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    return { buffer, mimeType };
  }

  // Raw base64 string fallback
  try {
    const buffer = Buffer.from(input, 'base64');
    return { buffer, mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
}

/**
 * Uploads a trainee photograph to Google Drive inside designated folder.
 * Validates file type and size.
 */
export async function uploadTraineePhoto({ traineeId, photoInput, filename }) {
  if (!photoInput) return null;

  const parsed = parsePhotoData(photoInput);
  if (!parsed) {
    throw new Error('Invalid image format: Must be a valid image Data URL or base64 string.');
  }

  const { buffer, mimeType } = parsed;

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`Unsupported image type "${mimeType}". Allowed types: JPEG, PNG, WebP.`);
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`Photograph exceeds maximum allowed size of 5 MB (size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB).`);
  }

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const drive = getDriveClient();

  if (!drive || !folderId) {
    console.warn('[Google Drive] GOOGLE_DRIVE_FOLDER_ID or Google credentials not configured in environment. Using fallback image storage.');
    return {
      uploadedToDrive: false,
      fileId: '',
      driveUrl: '',
      mimeType,
      size: buffer.length,
      fallbackPhoto: photoInput,
    };
  }

  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const name = filename || `trainee-photo-${traineeId}-${Date.now()}.${extension}`;

  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);

  try {
    const res = await drive.files.create({
      requestBody: {
        name,
        parents: [folderId],
        description: `Trainee Photograph for ID: ${traineeId}`,
      },
      media: {
        mimeType,
        body: bufferStream,
      },
      fields: 'id, name, webViewLink, webContentLink, size',
    });

    const fileId = res.data.id;
    console.log(`[Google Drive] Photo uploaded successfully for ${traineeId}: File ID ${fileId}`);

    return {
      uploadedToDrive: true,
      fileId,
      driveUrl: res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
      mimeType,
      size: buffer.length,
      fallbackPhoto: `/api/public/photo/${encodeURIComponent(traineeId)}`,
    };
  } catch (err) {
    console.error(`[Google Drive Upload Error] Trainee ${traineeId}:`, err.message);
    // Graceful fallback so registration does not fail if Google Drive has temporary network error
    return {
      uploadedToDrive: false,
      fileId: '',
      driveUrl: '',
      mimeType,
      size: buffer.length,
      fallbackPhoto: photoInput,
      warning: `Google Drive upload failed: ${err.message}`,
    };
  }
}

/**
 * Deletes a previous photo from Google Drive when replaced or cleaned up.
 */
export async function deleteTraineePhoto(fileId) {
  if (!fileId || typeof fileId !== 'string') return;
  const drive = getDriveClient();
  if (!drive) return;

  try {
    await drive.files.delete({ fileId });
    console.log(`[Google Drive] Successfully deleted file ID: ${fileId}`);
  } catch (err) {
    console.warn(`[Google Drive] Failed deleting file ${fileId}:`, err.message);
  }
}

/**
 * Streams photo from Google Drive.
 */
export async function getPhotoStreamFromDrive(fileId) {
  if (!fileId) return null;
  const drive = getDriveClient();
  if (!drive) return null;

  try {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    return res.data;
  } catch (err) {
    console.error(`[Google Drive Stream Error] File ${fileId}:`, err.message);
    return null;
  }
}

/**
 * Migrates existing MongoDB records containing raw base64 photos to Google Drive.
 */
export async function migrateExistingPhotosToDrive(TraineeModel) {
  if (!isDriveConfigured()) {
    return { ok: false, message: 'Google Drive is not configured in .env' };
  }

  const traineesWithBase64 = await TraineeModel.find({
    photo: { $regex: /^data:image\// },
    photoDriveId: { $in: ['', null] },
  }).lean();

  console.log(`[Migration] Found ${traineesWithBase64.length} trainees with base64 photos to migrate to Google Drive.`);
  let migrated = 0;
  let failed = 0;

  for (const t of traineesWithBase64) {
    try {
      const uploadResult = await uploadTraineePhoto({
        traineeId: t.traineeId,
        photoInput: t.photo,
      });

      if (uploadResult?.uploadedToDrive && uploadResult.fileId) {
        await TraineeModel.updateOne(
          { traineeId: t.traineeId },
          {
            $set: {
              photoDriveId: uploadResult.fileId,
              photoDriveUrl: uploadResult.driveUrl,
              photoDriveMimeType: uploadResult.mimeType,
              photoDriveSize: uploadResult.size,
              photoDriveUpdatedAt: new Date(),
              photo: `/api/public/photo/${encodeURIComponent(t.traineeId)}`,
            },
          }
        );
        migrated += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      console.error(`[Migration Error] Trainee ${t.traineeId}:`, err.message);
      failed += 1;
    }
  }

  return { ok: true, total: traineesWithBase64.length, migrated, failed };
}
