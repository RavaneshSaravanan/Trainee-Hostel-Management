import PptxGenJS from 'pptxgenjs';
import { fmtDate, todayStr } from './dates.js';
import { SHIFTS, ATT_CODES, ATT_LABELS } from '../data/constants.js';
import { occupantsOf, dayCounts } from './summary.js';

/**
 * Generates and downloads an executive widescreen 16:9 PowerPoint presentation (.pptx)
 * containing genuine dashboard statistics, room occupancy, shift distributions, and trainee records.
 *
 * Design Standards:
 * - Slide Dimensions: 13.333" x 7.5" (True Widescreen 16:9)
 * - Safe vertical bounds: y: 1.15 to y: 6.85 (Header y: 0 to 0.9, Footer y: 7.0 to 7.4)
 * - Dynamic pagination: Tables with many rows automatically split into multiple slides.
 * - Sourced strictly from live MongoDB Atlas state.
 */
export async function exportDashboardPptx({ db, config, session }) {
  const pptx = new PptxGenJS();

  // Define true 16:9 widescreen layout (13.333 inches x 7.5 inches)
  pptx.defineLayout({ name: 'WIDESCREEN_16_9', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDESCREEN_16_9';

  const orgBranding = config?.orgBranding || {};
  const orgName = orgBranding.orgName || 'APOLLO TYRES LTD';
  const orgTagline = orgBranding.tagline || 'Hostel Administration & Trainee Operations';
  const orgLogo = orgBranding.logo || config?.logo || '';

  const appName = orgName;
  const appSub = orgTagline;
  pptx.author = orgName;
  pptx.company = orgName;
  pptx.title = `${orgName} - Trainee Hostel Operations Report`;

  const reportDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const today = todayStr();

  // Executive Theme Colors
  const COLOR_HEADER_BG = '2E1065'; // Royal Deep Violet
  const COLOR_ACCENT = '7C3AED';    // Vibrant Purple Accent
  const COLOR_GOLD = 'F59E0B';      // Gold Accent
  const COLOR_SUCCESS = '16A34A';   // Emerald Green
  const COLOR_MUTED = '64748B';     // Slate Gray
  const COLOR_TEXT_DARK = '1E1B4B'; // Deep Navy Text
  const COLOR_BG_LIGHT = 'F8FAFC';  // Soft Light Gray
  const COLOR_BORDER = 'E2E8F0';

  let totalSlideCount = 0;
  const slideRegistrations = [];

  // Helper for adding slide headers within safe boundaries
  const addSlideHeader = (slide, title, category = 'EXECUTIVE SUMMARY') => {
    // Top banner
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.9,
      fill: { color: COLOR_HEADER_BG },
    });

    // Accent strip
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0.9,
      w: 13.333,
      h: 0.05,
      fill: { color: COLOR_ACCENT },
    });

    // Category
    slide.addText(category.toUpperCase(), {
      x: 0.6,
      y: 0.12,
      w: 6.0,
      h: 0.25,
      fontSize: 9.5,
      color: 'C4B5FD',
      bold: true,
      fontFace: 'Arial',
    });

    // Title
    slide.addText(title, {
      x: 0.6,
      y: 0.36,
      w: 8.0,
      h: 0.46,
      fontSize: 17,
      color: 'FFFFFF',
      bold: true,
      fontFace: 'Arial',
    });

    // App & Date Right Tag
    slide.addText(`${appName.toUpperCase()} · ${reportDate}`, {
      x: 7.0,
      y: 0.32,
      w: 5.7,
      h: 0.35,
      fontSize: 10,
      color: 'DDD6FE',
      align: 'right',
      fontFace: 'Arial',
    });

    if (orgLogo && orgLogo.startsWith('data:image/')) {
      try {
        slide.addImage({
          data: orgLogo,
          x: 12.0,
          y: 0.12,
          w: 0.9,
          h: 0.65,
          sizing: { type: 'contain', w: 0.9, h: 0.65 },
        });
      } catch (e) {
        // Safe image fallback
      }
    }
  };

  // Helper for adding slide footer within safe boundaries
  const addSlideFooter = (slide, pageNum, customNote = '') => {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.6,
      y: 7.0,
      w: 12.133,
      h: 0,
      line: { color: COLOR_BORDER, width: 1 },
    });

    const note = customNote || `Confidential · Official Operations Record · ${orgName} · Generated on ${reportDate}`;
    slide.addText(note, {
      x: 0.6,
      y: 7.06,
      w: 9.5,
      h: 0.3,
      fontSize: 9,
      color: COLOR_MUTED,
      fontFace: 'Arial',
    });

    slide.addText(`Slide ${pageNum}`, {
      x: 10.5,
      y: 7.06,
      w: 2.233,
      h: 0.3,
      fontSize: 9,
      color: COLOR_MUTED,
      align: 'right',
      fontFace: 'Arial',
    });
  };

  const registerSlide = (slide) => {
    totalSlideCount += 1;
    slideRegistrations.push(slide);
    return totalSlideCount;
  };

  // -------------------------------------------------------------
  // SLIDE 1: Title Slide (Widescreen Hero)
  // -------------------------------------------------------------
  {
    const slide = pptx.addSlide();
    registerSlide(slide);
    slide.background = { color: '0F172A' };

    // Violet gradient backdrop box
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.8,
      y: 1.0,
      w: 11.733,
      h: 5.5,
      rectRadius: 0.15,
      fill: { color: '1E1B4B' },
      line: { color: '312E81', width: 1.5 },
    });

    // Accent line
    slide.addShape(pptx.ShapeType.rect, {
      x: 1.4,
      y: 1.6,
      w: 0.12,
      h: 2.8,
      fill: { color: COLOR_GOLD },
    });

    slide.addText(appName.toUpperCase(), {
      x: 1.7,
      y: 1.5,
      w: 10.0,
      h: 0.8,
      fontSize: 32,
      color: 'FFFFFF',
      bold: true,
      fontFace: 'Arial',
    });

    slide.addText(appSub, {
      x: 1.7,
      y: 2.3,
      w: 10.0,
      h: 0.45,
      fontSize: 18,
      color: 'C4B5FD',
      fontFace: 'Arial',
    });

    slide.addText('Executive Operations & Hostel Dashboard Report', {
      x: 1.7,
      y: 2.9,
      w: 10.0,
      h: 0.6,
      fontSize: 22,
      color: '38BDF8',
      bold: true,
      fontFace: 'Arial',
    });

    // Apollo Tyres Logo or Branding Mark
    if (orgLogo && orgLogo.startsWith('data:image/')) {
      try {
        slide.addImage({
          data: orgLogo,
          x: 9.8,
          y: 1.4,
          w: 2.3,
          h: 1.1,
          sizing: { type: 'contain', w: 2.3, h: 1.1 },
        });
      } catch (e) {
        // Safe image fallback
      }
    }

    // Metadata card
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 1.7,
      y: 3.8,
      w: 9.9,
      h: 2.1,
      rectRadius: 0.1,
      fill: { color: '0F172A' },
      line: { color: '334155', width: 1 },
    });

    slide.addText(
      [
        { text: 'Report Generation Date: ', options: { bold: true, color: 'E2E8F0' } },
        { text: `${reportDate}\n`, options: { color: '94A3B8' } },
        { text: 'Prepared By: ', options: { bold: true, color: 'E2E8F0' } },
        { text: `${session?.name || 'Administrator'} (${session?.roleId || 'Super Admin'})\n`, options: { color: '94A3B8' } },
        { text: 'Facility Operations: ', options: { bold: true, color: 'E2E8F0' } },
        { text: `${orgName} Trainee Hostel Administration (Live Verified)\n`, options: { color: '22C55E', bold: true } },
        { text: 'Total Active Records: ', options: { bold: true, color: 'E2E8F0' } },
        { text: `${db.trainees.length} Trainees | ${db.hostels.length} Hostels`, options: { color: 'F59E0B' } },
      ],
      {
        x: 2.0,
        y: 4.0,
        w: 9.3,
        h: 1.7,
        fontSize: 12,
        lineSpacingMultiple: 1.25,
        fontFace: 'Arial',
      }
    );
  }

  // -------------------------------------------------------------
  // SLIDE 2: Key Operational Metrics & Demographics (Safe 4x2 Grid)
  // -------------------------------------------------------------
  {
    const slide = pptx.addSlide();
    const pageNum = registerSlide(slide);
    addSlideHeader(slide, 'Operational Metrics & Trainee Demographics', 'EXECUTIVE DASHBOARD');

    const totalTrainees = db.trainees.length;
    const activeTrainees = db.trainees.filter((t) => t.employmentStatus === 'ACTIVE').length;
    const inHostel = db.trainees.filter((t) => t.hostelStatus === 'ACTIVE').length;
    const onLeave = db.trainees.filter((t) => t.hostelStatus === 'ON LEAVE').length;
    const onOuting = db.trainees.filter((t) => t.hostelStatus === 'OUTING').length;
    const tempVacated = db.trainees.filter((t) => t.hostelStatus === 'TEMPORARY VACATE').length;
    const permVacated = db.trainees.filter((t) => t.hostelStatus === 'PERMANENT VACATE').length;
    const resigned = db.trainees.filter((t) => t.employmentStatus === 'RESIGNED').length;

    const kpiCards = [
      { label: 'Total Registered', val: totalTrainees, color: '4F46E5' },
      { label: 'Active Employment', val: activeTrainees, color: '16A34A' },
      { label: 'Currently In Hostel', val: inHostel, color: '0284C7' },
      { label: 'On Leave', val: onLeave, color: 'EA580C' },
      { label: 'On Outing', val: onOuting, color: 'D97706' },
      { label: 'Temporary Vacated', val: tempVacated, color: '64748B' },
      { label: 'Permanent Vacated', val: permVacated, color: 'DC2626' },
      { label: 'Resigned', val: resigned, color: '991B1B' },
    ];

    // Grid: 4 columns x 2 rows, perfectly sized to stay within y: 1.15 to y: 4.35
    const cardW = 2.85;
    const cardH = 1.35;
    const gapX = 0.24;
    const gapY = 0.22;

    kpiCards.forEach((kpi, idx) => {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const x = 0.6 + col * (cardW + gapX);
      const y = 1.2 + row * (cardH + gapY);

      slide.addShape(pptx.ShapeType.roundRect, {
        x,
        y,
        w: cardW,
        h: cardH,
        rectRadius: 0.08,
        fill: { color: 'FFFFFF' },
        line: { color: COLOR_BORDER, width: 1 },
      });

      // Accent color strip on left
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: 0.08,
        h: cardH,
        fill: { color: kpi.color },
      });

      slide.addText(kpi.label, {
        x: x + 0.2,
        y: y + 0.16,
        w: cardW - 0.3,
        h: 0.3,
        fontSize: 11,
        color: COLOR_MUTED,
        bold: true,
        fontFace: 'Arial',
      });

      slide.addText(String(kpi.val), {
        x: x + 0.2,
        y: y + 0.52,
        w: cardW - 0.3,
        h: 0.65,
        fontSize: 28,
        color: COLOR_TEXT_DARK,
        bold: true,
        fontFace: 'Arial',
      });
    });

    // Summary box at bottom (y: 4.45 to 6.75)
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.6,
      y: 4.45,
      w: 12.133,
      h: 2.3,
      rectRadius: 0.08,
      fill: { color: COLOR_BG_LIGHT },
      line: { color: 'CBD5E1', width: 1 },
    });

    slide.addText('Trainee Employment & Hostel Status Key Insights', {
      x: 0.9,
      y: 4.65,
      w: 11.0,
      h: 0.35,
      fontSize: 13,
      bold: true,
      color: COLOR_HEADER_BG,
      fontFace: 'Arial',
    });

    const pendingReviewCount = db.trainees.filter(
      (t) => t.hostelStatus === 'PENDING REVIEW' || t.approvalStatus === 'PENDING_APPROVAL'
    ).length;

    slide.addText(
      `• Active In-House Trainees: ${inHostel} residents currently residing across allocated hostel blocks.\n` +
      `• Temporary Leaves & Outings: ${onLeave} trainees on approved leave; ${onOuting} trainees on authorized day outings.\n` +
      `• Pending Registration Reviews: ${pendingReviewCount} trainee applications awaiting Super Admin / Approver authorization.\n` +
      `• Permanent Departures & Exits: ${permVacated} trainees permanently vacated; ${resigned} employment resignations recorded.`,
      {
        x: 0.9,
        y: 5.08,
        w: 11.5,
        h: 1.5,
        fontSize: 11.5,
        color: '334155',
        lineSpacingMultiple: 1.3,
        fontFace: 'Arial',
      }
    );

    addSlideFooter(slide, pageNum);
  }

  // -------------------------------------------------------------
  // SLIDE 3: Hostel Capacity & Room Occupancy (Auto-Paginating)
  // -------------------------------------------------------------
  {
    let totalRooms = 0;
    let totalCapacity = 0;
    let totalOccupants = 0;

    const hostelData = db.hostels.map((h) => {
      const cap = h.rooms.reduce((s, r) => s + (r.capacity || 0), 0);
      const occ = h.rooms.reduce((s, r) => s + occupantsOf(db, h.name, r.no).length, 0);
      const pct = cap > 0 ? Math.round((occ / cap) * 100) : 0;
      totalRooms += h.rooms.length;
      totalCapacity += cap;
      totalOccupants += occ;
      return [h.name, String(h.rooms.length), `${cap} Beds`, `${occ} Occupants`, `${pct}%`];
    });

    const overallPct = totalCapacity > 0 ? Math.round((totalOccupants / totalCapacity) * 100) : 0;

    // Split hostel rows into chunks of 8 to prevent slide overflow
    const ROWS_PER_PAGE = 8;
    const chunks = [];
    if (hostelData.length === 0) {
      chunks.push([]);
    } else {
      for (let i = 0; i < hostelData.length; i += ROWS_PER_PAGE) {
        chunks.push(hostelData.slice(i, i + ROWS_PER_PAGE));
      }
    }

    chunks.forEach((chunk, pageIdx) => {
      const slide = pptx.addSlide();
      const pageNum = registerSlide(slide);
      const suffix = chunks.length > 1 ? ` (Part ${pageIdx + 1} of ${chunks.length})` : '';
      addSlideHeader(slide, `Hostel Capacity & Room Occupancy${suffix}`, 'INFRASTRUCTURE & OCCUPANCY');

      // Metric Summary banner
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.6,
        y: 1.15,
        w: 12.133,
        h: 0.8,
        rectRadius: 0.08,
        fill: { color: 'F1F5F9' },
        line: { color: 'CBD5E1', width: 1 },
      });

      slide.addText(
        [
          { text: 'Total Hostels: ', options: { bold: true, color: COLOR_HEADER_BG } },
          { text: `${db.hostels.length}    |    `, options: { color: COLOR_MUTED } },
          { text: 'Configured Rooms: ', options: { bold: true, color: COLOR_HEADER_BG } },
          { text: `${totalRooms}    |    `, options: { color: COLOR_MUTED } },
          { text: 'Total Capacity: ', options: { bold: true, color: COLOR_HEADER_BG } },
          { text: `${totalCapacity} Beds    |    `, options: { color: COLOR_MUTED } },
          { text: 'Occupied Beds: ', options: { bold: true, color: COLOR_HEADER_BG } },
          { text: `${totalOccupants}    |    `, options: { color: COLOR_SUCCESS, bold: true } },
          { text: 'Utilisation Rate: ', options: { bold: true, color: COLOR_HEADER_BG } },
          { text: `${overallPct}%`, options: { color: overallPct > 85 ? 'DC2626' : COLOR_SUCCESS, bold: true } },
        ],
        {
          x: 0.8,
          y: 1.38,
          w: 11.7,
          h: 0.35,
          fontSize: 11.5,
          fontFace: 'Arial',
        }
      );

      if (chunk.length === 0) {
        slide.addText('No hostels currently registered. Configure hostels in Admin Console.', {
          x: 1.0,
          y: 3.2,
          w: 11.3,
          h: 1.0,
          fontSize: 13,
          color: COLOR_MUTED,
          align: 'center',
          fontFace: 'Arial',
        });
      } else {
        const tableHeaders = [
          { text: 'Hostel Block Name', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Rooms Count', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Total Capacity', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Current Occupants', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Occupancy Rate', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
        ];

        const tableRows = [
          tableHeaders,
          ...chunk.map((row) =>
            row.map((cell) => ({
              text: cell,
              options: { fontFace: 'Arial', fontSize: 10.5, color: COLOR_TEXT_DARK },
            }))
          ),
        ];

        slide.addTable(tableRows, {
          x: 0.6,
          y: 2.15,
          w: 12.133,
          colW: [4.133, 2.0, 2.0, 2.0, 2.0],
          border: { pt: 1, color: COLOR_BORDER },
          fill: { color: 'FFFFFF' },
          autoPage: false,
        });
      }

      addSlideFooter(slide, pageNum);
    });
  }

  // -------------------------------------------------------------
  // SLIDE 4: Shift Allocations & Today's Attendance (Clean Side-by-Side)
  // -------------------------------------------------------------
  {
    const slide = pptx.addSlide();
    const pageNum = registerSlide(slide);
    addSlideHeader(slide, 'Shift Distributions & Today\'s Attendance Breakdown', 'ATTENDANCE MANAGEMENT');

    const shiftData = SHIFTS.map((s) => ({
      shift: `${s} Shift`,
      count: db.trainees.filter((t) => t.defaultShift === s && t.hostelStatus === 'ACTIVE').length,
    }));

    // Bar chart on left half (x: 0.6, w: 5.8, y: 1.2 to 6.7)
    slide.addChart(
      pptx.ChartType.bar,
      [
        {
          name: 'Active Residents',
          labels: shiftData.map((d) => d.shift),
          values: shiftData.map((d) => d.count),
        },
      ],
      {
        x: 0.6,
        y: 1.2,
        w: 5.7,
        h: 5.5,
        chartColors: ['7C3AED'],
        showValue: true,
        valAxisLabelFontSize: 9.5,
        catAxisLabelFontSize: 9.5,
        title: 'Active Residents by Assigned Shift',
        titleFontSize: 12,
        titleColor: COLOR_HEADER_BG,
      }
    );

    // Right half: Today's Attendance Table (x: 6.6, w: 6.133)
    const day = dayCounts(db, today);
    const attRows = [
      [
        { text: 'Code', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
        { text: 'Attendance Status', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
        { text: 'Today\'s Count', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
      ],
      ...ATT_CODES.map((k) => [
        { text: k, options: { bold: true, color: '7C3AED', fontSize: 10 } },
        { text: ATT_LABELS[k] || k, options: { color: '334155', fontSize: 10 } },
        { text: String(day.final[k] || 0), options: { bold: true, color: COLOR_TEXT_DARK, fontSize: 10 } },
      ]),
      [
        { text: 'TOTAL', options: { bold: true, fill: { color: 'EDE9FE' }, color: COLOR_HEADER_BG } },
        { text: 'Total Attendance Counted', options: { bold: true, fill: { color: 'EDE9FE' }, color: COLOR_MUTED } },
        { text: String(day.total || 0), options: { bold: true, fill: { color: 'EDE9FE' }, color: COLOR_SUCCESS, fontSize: 11 } },
      ],
    ];

    slide.addText(`Attendance Log Summary (${reportDate})`, {
      x: 6.6,
      y: 1.2,
      w: 6.133,
      h: 0.35,
      fontSize: 12,
      bold: true,
      color: COLOR_HEADER_BG,
      fontFace: 'Arial',
    });

    slide.addTable(attRows, {
      x: 6.6,
      y: 1.6,
      w: 6.133,
      colW: [1.2, 3.433, 1.5],
      border: { pt: 1, color: COLOR_BORDER },
      fill: { color: 'FFFFFF' },
      autoPage: false,
    });

    addSlideFooter(slide, pageNum);
  }

  // -------------------------------------------------------------
  // SLIDE 5: Recent Admissions & Registrations (Auto-Paginating)
  // -------------------------------------------------------------
  {
    const allTraineesSorted = [...db.trainees].sort(
      (a, b) => ((b.submissionDate || b.joiningDate || '') > (a.submissionDate || a.joiningDate || '') ? 1 : -1)
    );

    const TRAINEES_PER_PAGE = 8;
    const traineeChunks = [];
    if (allTraineesSorted.length === 0) {
      traineeChunks.push([]);
    } else {
      for (let i = 0; i < allTraineesSorted.length; i += TRAINEES_PER_PAGE) {
        traineeChunks.push(allTraineesSorted.slice(i, i + TRAINEES_PER_PAGE));
      }
    }

    traineeChunks.forEach((chunk, pageIdx) => {
      const slide = pptx.addSlide();
      const pageNum = registerSlide(slide);
      const suffix = traineeChunks.length > 1 ? ` (Part ${pageIdx + 1} of ${traineeChunks.length})` : '';
      addSlideHeader(slide, `Trainee Registrations & Status Records${suffix}`, 'TRAINEE MANAGEMENT');

      if (chunk.length === 0) {
        slide.addText('No trainee records currently found in operations roster.', {
          x: 1.0,
          y: 3.2,
          w: 11.3,
          h: 1.0,
          fontSize: 13,
          color: COLOR_MUTED,
          align: 'center',
          fontFace: 'Arial',
        });
      } else {
        const regHeaders = [
          { text: 'Trainee ID', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Full Name', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Contact No.', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Hostel & Room', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Joining Date', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Shift', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
          { text: 'Approval Status', options: { bold: true, fill: { color: COLOR_HEADER_BG }, color: 'FFFFFF' } },
        ];

        const regRows = [
          regHeaders,
          ...chunk.map((t) => [
            { text: t.traineeId || '—', options: { bold: true, color: '7C3AED', fontSize: 9.5 } },
            { text: t.name || '—', options: { bold: true, color: COLOR_TEXT_DARK, fontSize: 9.5 } },
            { text: t.mobile || '—', options: { color: '334155', fontSize: 9.5 } },
            { text: t.roomNo ? `${t.hostel || 'Hostel'} / Rm ${t.roomNo}` : 'Unallocated', options: { color: '334155', fontSize: 9.5 } },
            { text: fmtDate(t.joiningDate) || '—', options: { color: '334155', fontSize: 9.5 } },
            { text: `${t.defaultShift || 'G'} Shift`, options: { color: '334155', fontSize: 9.5 } },
            {
              text: t.approvalStatus || t.hostelStatus || '—',
              options: {
                bold: true,
                fontSize: 9.5,
                color:
                  t.approvalStatus === 'APPROVED' || t.hostelStatus === 'ACTIVE'
                    ? COLOR_SUCCESS
                    : t.approvalStatus === 'REJECTED'
                    ? 'DC2626'
                    : 'D97706',
              },
            },
          ]),
        ];

        slide.addTable(regRows, {
          x: 0.6,
          y: 1.25,
          w: 12.133,
          colW: [1.8, 2.533, 1.8, 2.3, 1.4, 1.0, 1.3],
          border: { pt: 1, color: COLOR_BORDER },
          fill: { color: 'FFFFFF' },
          autoPage: false,
        });
      }

      addSlideFooter(slide, pageNum);
    });
  }

  // Trigger file download
  const safeAppName = (appName || 'Hostel').replace(/[^a-zA-Z0-9_-]/g, '-');
  const fileName = `${safeAppName}-Executive-Dashboard-${today}.pptx`;
  await pptx.writeFile({ fileName });
}
