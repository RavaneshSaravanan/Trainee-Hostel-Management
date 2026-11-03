import { Hostel } from '../models/Hostel.js';
import { Trainee } from '../models/Trainee.js';
import { RoomHistory } from '../models/RoomHistory.js';
import { todayStr } from '../utils/dates.js';
import { bumpRev } from '../models/Meta.js';
import { sendTraineeWelcomeEmail, sendTraineeIdCardEmail } from './emailService.js';

// Statuses of trainees that actively hold / occupy a bed in a room
// As required: "Do not count resigned trainees or trainees whose room allocation has ended. Do not count temporary leave or outing as a vacant bed."
export const ACTIVE_OCCUPANCY_STATUSES = ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'];

// In-memory mutex for concurrency control per hostel room
const roomLocks = new Map();

export async function withRoomLock(lockKey, fn) {
  let prevPromise = roomLocks.get(lockKey) || Promise.resolve();
  let release;
  const currentPromise = new Promise((resolve) => {
    release = resolve;
  });
  roomLocks.set(lockKey, prevPromise.then(() => currentPromise));
  try {
    await prevPromise;
    return await fn();
  } finally {
    release();
    if (roomLocks.get(lockKey) === currentPromise) {
      roomLocks.delete(lockKey);
    }
  }
}

/**
 * Calculates dynamic room occupancy for a specific room directly from genuine MongoDB records.
 */
export async function getRoomOccupancy(hostelIdentifier, roomNo) {
  const cleanRoomNo = String(roomNo || '').trim();
  const hostel = await Hostel.findOne({
    $or: [{ id: String(hostelIdentifier).trim() }, { name: String(hostelIdentifier).trim() }],
  }).lean();

  if (!hostel) {
    throw new Error(`Hostel "${hostelIdentifier}" not found.`);
  }

  const room = (hostel.rooms || []).find((r) => String(r.no).trim() === cleanRoomNo);
  if (!room) {
    throw new Error(`Room "${cleanRoomNo}" not found in hostel "${hostel.name}".`);
  }

  const activeOccupants = await Trainee.find({
    $or: [{ hostel: hostel.name }, { hostelId: hostel.id }],
    roomNo: cleanRoomNo,
    hostelStatus: { $in: ACTIVE_OCCUPANCY_STATUSES },
  })
    .select('traineeId qrId name email mobile hostelStatus joiningDate approvalStatus photo')
    .lean();

  const capacity = Number(room.capacity) || 1;
  const occupied = activeOccupants.length;
  const available = Math.max(0, capacity - occupied);
  const occupancyPercentage = Math.round((occupied / capacity) * 100);
  const status = occupied >= capacity ? 'FULL' : 'AVAILABLE';

  return {
    hostelId: hostel.id,
    hostelName: hostel.name,
    roomNo: cleanRoomNo,
    capacity,
    occupied,
    available,
    occupancyPercentage,
    status,
    isFull: occupied >= capacity,
    occupants: activeOccupants,
  };
}

/**
 * Returns dynamic occupancy calculation for all rooms in all hostels.
 * Supports filters: hostel, room, status ('FULL' | 'AVAILABLE')
 */
export async function getAllRoomsOccupancy(filters = {}) {
  const hostels = await Hostel.find().lean();
  const allActiveOccupants = await Trainee.find({
    hostelStatus: { $in: ACTIVE_OCCUPANCY_STATUSES },
    roomNo: { $exists: true, $ne: '' },
  })
    .select('traineeId qrId name email mobile hostel hostelId roomNo hostelStatus joiningDate approvalStatus')
    .lean();

  const results = [];

  for (const h of hostels) {
    if (filters.hostel && h.name !== filters.hostel && h.id !== filters.hostel) {
      continue;
    }

    for (const r of h.rooms || []) {
      const roomNo = String(r.no).trim();
      if (filters.room && roomNo !== String(filters.room).trim()) {
        continue;
      }

      const occupants = allActiveOccupants.filter(
        (t) =>
          (t.hostel === h.name || t.hostelId === h.id) &&
          String(t.roomNo).trim() === roomNo
      );

      const capacity = Number(r.capacity) || 1;
      const occupied = occupants.length;
      const available = Math.max(0, capacity - occupied);
      const occupancyPercentage = Math.round((occupied / capacity) * 100);
      const status = occupied >= capacity ? 'FULL' : 'AVAILABLE';

      if (filters.status && status !== filters.status.toUpperCase()) {
        continue;
      }

      results.push({
        hostelId: h.id,
        hostelName: h.name,
        roomNo,
        capacity,
        occupied,
        available,
        occupancyPercentage,
        status,
        isFull: occupied >= capacity,
        occupants,
      });
    }
  }

  return results;
}

/**
 * Allocates or transfers a trainee to a hostel room with strict capacity enforcement.
 * Concurrency protection ensures two administrators cannot allocate the final bed simultaneously.
 */
export async function allocateTraineeToRoom({
  traineeId,
  hostelNameOrId,
  roomNo,
  actorName = 'System',
}) {
  const cleanTraineeId = String(traineeId || '').trim().toUpperCase();
  const cleanRoomNo = String(roomNo || '').trim();
  const cleanHostel = String(hostelNameOrId || '').trim();

  if (!cleanTraineeId) {
    const err = new Error('Trainee identifier is required.');
    err.status = 400;
    throw err;
  }
  if (!cleanHostel || !cleanRoomNo) {
    const err = new Error('Both hostel and room number are required.');
    err.status = 400;
    throw err;
  }

  // Find the trainee
  const trainee = await Trainee.findOne({
    $or: [{ traineeId: cleanTraineeId }, { qrId: cleanTraineeId }],
  });

  if (!trainee) {
    const err = new Error(`Trainee "${cleanTraineeId}" not found.`);
    err.status = 404;
    throw err;
  }

  if (trainee.approvalStatus === 'REJECTED' || trainee.hostelStatus === 'REJECTED') {
    const err = new Error('Cannot allocate room: Trainee registration is rejected.');
    err.status = 400;
    throw err;
  }

  // Find the hostel and room
  const hostel = await Hostel.findOne({
    $or: [{ id: cleanHostel }, { name: cleanHostel }],
  });

  if (!hostel) {
    const err = new Error(`Hostel "${cleanHostel}" not found.`);
    err.status = 404;
    throw err;
  }

  const room = (hostel.rooms || []).find((r) => String(r.no).trim() === cleanRoomNo);
  if (!room) {
    const err = new Error(`Room "${cleanRoomNo}" not found in hostel "${hostel.name}".`);
    err.status = 404;
    throw err;
  }

  const capacity = Number(room.capacity) || 1;
  const lockKey = `${hostel.name}:${cleanRoomNo}`;

  // Execute inside serialized mutex to prevent concurrency races
  return await withRoomLock(lockKey, async () => {
    // Count active room allocations excluding this trainee
    const activeOccupants = await Trainee.find({
      $or: [{ hostel: hostel.name }, { hostelId: hostel.id }],
      roomNo: cleanRoomNo,
      hostelStatus: { $in: ACTIVE_OCCUPANCY_STATUSES },
      _id: { $ne: trainee._id },
    }).lean();

    const currentOccupancy = activeOccupants.length;
    const availableBeds = capacity - currentOccupancy;

    if (availableBeds <= 0) {
      const err = new Error(
        `This room is already full. Maximum capacity: ${capacity}. Current occupancy: ${currentOccupancy}.`
      );
      err.status = 409; // HTTP 409 Conflict as specified
      err.code = 'ROOM_FULL';
      err.capacity = capacity;
      err.currentOccupancy = currentOccupancy;
      throw err;
    }

    const prevHostel = trainee.hostel || '';
    const prevRoom = trainee.roomNo || '';
    const isTransfer = Boolean((prevHostel || prevRoom) && (prevHostel !== hostel.name || prevRoom !== cleanRoomNo));

    // Update trainee record
    trainee.hostel = hostel.name;
    trainee.hostelId = hostel.id;
    trainee.roomNo = cleanRoomNo;
    trainee.hostelStatus = 'ACTIVE';
    trainee.approvalStatus = 'APPROVED';
    trainee.qrStatus = 'ACTIVE';
    if (!trainee.approvedBy) trainee.approvedBy = actorName;

    await trainee.save();

    // If transferred from a previous room, record in RoomHistory
    if (isTransfer) {
      await RoomHistory.create({
        traineeId: trainee.traineeId || trainee.qrId,
        prevHostel,
        prevRoom,
        newHostel: hostel.name,
        newRoom: cleanRoomNo,
        changeDate: todayStr(),
        changedBy: actorName,
      });
    }

    await bumpRev();

    // Trigger Welcome Email if not yet sent and trainee is approved
    let emailResult = null;
    if (!trainee.welcomeEmailSent && trainee.email) {
      try {
        emailResult = await sendTraineeWelcomeEmail({
          trainee,
          triggeredBy: isTransfer ? 'Room Transfer' : 'Room Allocation',
        });
      } catch (err) {
        console.warn('[Welcome Email Auto Trigger Error]', err.message);
        emailResult = { ok: false, error: err.message };
      }
    }

    // Trigger ID Card Email (updated or initial)
    let idCardResult = null;
    if (trainee.email) {
      try {
        idCardResult = await sendTraineeIdCardEmail({
          trainee,
          force: true,
          isUpdated: isTransfer,
        });
      } catch (err) {
        console.warn('[ID Card Email Auto Trigger Error]', err.message);
        idCardResult = { ok: false, error: err.message };
      }
    }

    const newOccupancy = currentOccupancy + 1;
    const remainingBeds = Math.max(0, capacity - newOccupancy);

    return {
      ok: true,
      message: `${trainee.name} successfully allocated to ${hostel.name}, Room ${cleanRoomNo}.`,
      trainee,
      roomOccupancy: {
        hostelName: hostel.name,
        roomNo: cleanRoomNo,
        capacity,
        occupied: newOccupancy,
        available: remainingBeds,
        status: newOccupancy >= capacity ? 'FULL' : 'AVAILABLE',
      },
      emailResult,
      idCardResult,
    };
  });
}

/**
 * Validates that Super Admin cannot reduce room capacity below current active occupancy count.
 * - Ensures capacity is a positive integer >= 1.
 * - Computes dynamic active occupancy from MongoDB (excluding resigned trainees; preserving leave/outing).
 * - Rejects values below current active occupancy with HTTP 400.
 * - Allows capacity equal to or greater than current occupancy.
 */
export async function validateCapacityReduction(hostelIdentifier, roomNo, newCapacity) {
  const cleanRoomNo = String(roomNo || '').trim();
  const cap = Number(newCapacity);

  if (isNaN(cap) || cap < 1 || !Number.isInteger(cap)) {
    const err = new Error('Room capacity must be a positive integer of at least 1.');
    err.status = 400;
    err.code = 'INVALID_CAPACITY';
    throw err;
  }

  const hostel = await Hostel.findOne({
    $or: [{ id: String(hostelIdentifier).trim() }, { name: String(hostelIdentifier).trim() }],
  }).lean();

  let activeOccupants = [];
  if (hostel) {
    activeOccupants = await Trainee.find({
      $or: [{ hostel: hostel.name }, { hostelId: hostel.id }],
      roomNo: cleanRoomNo,
      hostelStatus: { $in: ACTIVE_OCCUPANCY_STATUSES },
      employmentStatus: { $ne: 'RESIGNED' },
    }).lean();
  } else {
    // If hostel is being created or identified by direct name
    activeOccupants = await Trainee.find({
      $or: [{ hostel: String(hostelIdentifier).trim() }, { hostelId: String(hostelIdentifier).trim() }],
      roomNo: cleanRoomNo,
      hostelStatus: { $in: ACTIVE_OCCUPANCY_STATUSES },
      employmentStatus: { $ne: 'RESIGNED' },
    }).lean();
  }

  const currentOccupancy = activeOccupants.length;
  const roomObj = hostel ? (hostel.rooms || []).find((r) => String(r.no).trim() === cleanRoomNo) : null;
  const currentCapacity = roomObj ? roomObj.capacity : cap;

  if (cap < currentOccupancy) {
    const err = new Error(`Cannot reduce room capacity below current occupancy of ${currentOccupancy}.`);
    err.status = 400;
    err.code = 'CAPACITY_BELOW_OCCUPANCY';
    err.currentOccupancy = currentOccupancy;
    err.currentCapacity = currentCapacity;
    err.requestedCapacity = cap;
    throw err;
  }

  return {
    ok: true,
    roomNo: cleanRoomNo,
    currentOccupancy,
    currentCapacity,
    newCapacity: cap,
    activeOccupantsCount: currentOccupancy,
  };
}
