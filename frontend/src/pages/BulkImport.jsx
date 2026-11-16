import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { api, getToken, BASE_URL } from '../utils/api.js';
import { useStore } from '../store.jsx';
import { Card, Icon, Badge, Table, Modal } from '../components/ui.jsx';
import ModernLoader from '../components/ModernLoader.jsx';
import { fmtDate } from '../utils/dates.js';

export default function BulkImport() {
  const { notify, refreshData, isSuper } = useStore();
  const fileInputRef = useRef(null);

  // States
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [previewData, setPreviewData] = useState(null);
  const [filterTab, setFilterTab] = useState('all'); // all | complete | partial | warnings | duplicates
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState(null);
  const [importStats, setImportStats] = useState(null);

  // History state
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedRowDetail, setSelectedRowDetail] = useState(null);

  // Fetch past import batches
  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await api('/api/trainees/bulk-history');
      setHistory(res.batches || []);
    } catch (e) {
      console.warn('Failed to load import history:', e.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // 1. Download Excel Template
  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      const token = getToken();
      const res = await fetch(`${BASE_URL}/api/trainees/bulk-template`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download template');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Trainee-Bulk-Import-Template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      notify('Excel Template downloaded successfully.');
    } catch (err) {
      notify(err.message || 'Error downloading template.');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  // 2. Handle File Selection & Parse
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const processFile = async (file) => {
    setSelectedFile(file);
    setPreviewData(null);
    setImportResult(null);
    setParsing(true);
    setParseProgress(10);

    try {
      const data = await file.arrayBuffer();
      setParseProgress(35);

      const workbook = XLSX.read(data, { type: 'array' });
      setParseProgress(60);

      // Read first sheet
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (jsonRows.length === 0) {
        throw new Error('No trainee data found in Sheet 1 of the uploaded Excel file.');
      }

      setParseProgress(80);

      // Send to server for database cross-verification (duplicates, capacity, schema)
      const previewRes = await api('/api/trainees/bulk-preview', {
        method: 'POST',
        body: { rows: jsonRows },
      });

      setParseProgress(100);
      setPreviewData(previewRes);
      notify(`Parsed ${previewRes.summary.totalRows} rows from "${file.name}".`);
    } catch (err) {
      notify(err.message || 'Failed to read Excel file.');
      setSelectedFile(null);
    } finally {
      setParsing(false);
    }
  };

  // 3. Confirm & Execute Import
  const handleConfirmImport = async () => {
    if (!previewData?.rows) return;

    const rowsToImport = previewData.rows.filter((r) => r.canImport);
    if (rowsToImport.length === 0) {
      notify('No valid rows available to import.');
      return;
    }

    setImporting(true);
    setImportProgress(20);
    setImportStats({ current: 0, total: rowsToImport.length, success: 0, partial: 0, skipped: 0 });

    try {
      // Simulate stepped progress indicator
      const progressTimer = setInterval(() => {
        setImportProgress((p) => (p < 85 ? p + 15 : p));
      }, 350);

      const res = await api('/api/trainees/bulk-import', {
        method: 'POST',
        body: {
          rows: previewData.rows,
          filename: selectedFile?.name || 'trainee-upload.xlsx',
        },
      });

      clearInterval(progressTimer);
      setImportProgress(100);
      setImportResult(res.batch);
      notify(`✓ Import finished! Created ${res.batch.successfulCount} complete & ${res.batch.partialCount} partial records.`);

      // Refresh application trainees data
      if (refreshData) refreshData();
      fetchHistory();
    } catch (err) {
      notify(err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  // 4. Download Report for a batch
  const handleDownloadBatchReport = async (batchId, type) => {
    try {
      const token = getToken();
      const res = await fetch(`${BASE_URL}/api/trainees/bulk-report/${batchId}/${type}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download report');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${batchId}-${type}-report.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      notify(e.message || 'Failed to download report');
    }
  };

  // Filtered rows for preview table
  const allRows = previewData?.rows || [];
  const filteredRows = allRows.filter((r) => {
    if (filterTab === 'complete') return r.status === 'COMPLETE';
    if (filterTab === 'partial') return r.status === 'PARTIAL';
    if (filterTab === 'warnings') return r.warnings && r.warnings.length > 0;
    if (filterTab === 'duplicates') return r.status === 'DUPLICATE' || r.status === 'SKIPPED';
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ---------------- Step 1: Download Template Banner ---------------- */}
      <Card title="Step 1: Download Standard Excel Template" sub="Use the official Apollo Tyres Ltd template with predefined columns and sample data.">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--gray-700)', maxWidth: 640 }}>
            The template contains clearly formatted headers for Trainee Details, Department, Emergency Contacts, and optional Hostel & Room allocation. 
            Partial records are supported: missing fields can be filled later by the respective hostel Warden.
          </div>
          <button
            className="btn btn-primary"
            onClick={handleDownloadTemplate}
            disabled={downloadingTemplate}
            style={{ minHeight: 40 }}
          >
            {downloadingTemplate ? (
              <ModernLoader type="button" text="Generating Template…" />
            ) : (
              <>
                <Icon name="download" size={16} /> Download Excel Template (.xlsx)
              </>
            )}
          </button>
        </div>
      </Card>

      {/* ---------------- Step 2: Upload Excel File Dropzone ---------------- */}
      <Card title="Step 2: Upload Completed Trainee Excel File" sub="Select or drag and drop your completed spreadsheet for validation and preview.">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          style={{
            border: '2px dashed #c4b5fd',
            borderRadius: 12,
            padding: '36px 20px',
            textAlign: 'center',
            background: 'var(--purple-50, #f5f3ff)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx, .xls, .csv"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <div style={{ width: 50, height: 50, borderRadius: '50%', background: '#ede9fe', color: '#5b21b6', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="upload" size={24} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--purple-900, #2e1065)' }}>
            {selectedFile ? selectedFile.name : 'Click to select or drag and drop Excel file (.xlsx, .xls)'}
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Supports 100+ trainees per batch. Partial records and intelligent duplicate checks enabled.
          </p>
        </div>

        {parsing && (
          <div style={{ marginTop: 20 }}>
            <ModernLoader
              type="progress"
              text="Analyzing & Validating Spreadsheet..."
              sub="Checking schema, mobile numbers, Aadhaar checksums, and room capacities..."
              progress={parseProgress}
            />
          </div>
        )}
      </Card>

      {/* ---------------- Step 3: Interactive Validation Preview ---------------- */}
      {previewData && !parsing && (
        <Card
          title="Step 3: Trainee Import Preview & Intelligence Report"
          sub={`Detected ${previewData.summary.totalRows} rows. Review validation statuses before committing to the database.`}
          noPad
        >
          {/* Summary KPIs */}
          <div style={{ padding: '16px 20px', background: '#faf5ff', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1px solid #e9d5ff' }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>Total Rows</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#5b21b6' }}>{previewData.summary.totalRows}</div>
            </div>
            <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1px solid #bbf7d0' }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>Ready (Complete)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#15803d' }}>{previewData.summary.validCount}</div>
            </div>
            <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1px solid #fed7aa' }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>Partial Records</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#c2410c' }}>{previewData.summary.partialCount}</div>
            </div>
            <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1px solid #fecaca' }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>Duplicates / Skipped</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#dc2626' }}>{previewData.summary.duplicateCount + previewData.summary.skippedCount}</div>
            </div>
            <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1px solid #c7d2fe' }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>Rooms Allocated</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#4338ca' }}>{previewData.summary.roomAllocatedCount}</div>
            </div>
          </div>

          {/* Filter Bar & Action */}
          <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                className={`btn btn-xs ${filterTab === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilterTab('all')}
              >
                All ({allRows.length})
              </button>
              <button
                className={`btn btn-xs ${filterTab === 'complete' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilterTab('complete')}
              >
                Complete ({previewData.summary.validCount})
              </button>
              <button
                className={`btn btn-xs ${filterTab === 'partial' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilterTab('partial')}
              >
                Partial ({previewData.summary.partialCount})
              </button>
              <button
                className={`btn btn-xs ${filterTab === 'warnings' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilterTab('warnings')}
              >
                Warnings ({previewData.summary.warningCount})
              </button>
              <button
                className={`btn btn-xs ${filterTab === 'duplicates' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilterTab('duplicates')}
              >
                Skipped / Duplicates ({previewData.summary.duplicateCount + previewData.summary.skippedCount})
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={handleConfirmImport}
                disabled={importing || allRows.filter((r) => r.canImport).length === 0}
                style={{ minHeight: 38 }}
              >
                {importing ? (
                  <ModernLoader type="button" text="Importing Records…" />
                ) : (
                  <>
                    <Icon name="check" size={15} /> Confirm & Import {allRows.filter((r) => r.canImport).length} Trainees
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Progress while importing */}
          {importing && (
            <div style={{ padding: 20 }}>
              <ModernLoader
                type="progress"
                text="Writing Trainee Records to MongoDB Database..."
                sub="Generating secure QR IDs, verifying room capacities, and establishing audit trails..."
                progress={importProgress}
                stats={importStats}
              />
            </div>
          )}

          {/* Preview Table */}
          {!importing && (
            <Table
              headers={['Row #', 'Trainee Name', 'Trainee ID', 'Mobile', 'Department', 'Hostel', 'Room', 'Validation Status', 'Issues / Details']}
              empty="No rows match the selected filter."
              rows={filteredRows.map((r) => [
                r.rowNumber,
                <strong>{r.name}</strong>,
                r.traineeId,
                r.mobile,
                r.department,
                r.hostel,
                r.roomNo,
                <Badge
                  status={
                    r.status === 'COMPLETE'
                      ? 'ACTIVE'
                      : r.status === 'PARTIAL'
                      ? 'PENDING REVIEW'
                      : 'REJECTED'
                  }
                />,
                <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {r.missingFields && r.missingFields.length > 0 && (
                    <span style={{ color: '#b45309' }}>
                      ⚠️ Missing: {r.missingFields.join(', ')}
                    </span>
                  )}
                  {r.warnings && r.warnings.map((w, idx) => (
                    <span key={idx} style={{ color: '#c2410c' }}>
                      • {w}
                    </span>
                  ))}
                  {r.errors && r.errors.map((e, idx) => (
                    <span key={idx} style={{ color: '#dc2626', fontWeight: 600 }}>
                      ✕ {e}
                    </span>
                  ))}
                  {r.status === 'COMPLETE' && (
                    <span style={{ color: '#15803d', fontWeight: 600 }}>✓ Ready for instant active enrollment</span>
                  )}
                </div>,
              ])}
            />
          )}
        </Card>
      )}

      {/* ---------------- Step 4: Import Results & Download Reports ---------------- */}
      {importResult && (
        <Card title="Import Completed Successfully!" sub={`Batch ID: ${importResult.batchId}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: 16, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={22} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#065f46' }}>
                  {importResult.successfulCount + importResult.partialCount} Trainees Registered Successfully
                </div>
                <div style={{ fontSize: 13, color: '#047857', marginTop: 2 }}>
                  <strong>{importResult.successfulCount}</strong> complete records ready with ID card & rooms. <strong>{importResult.partialCount}</strong> partial records forwarded to respective Wardens for completion.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
              <button
                className="btn btn-ghost"
                onClick={() => handleDownloadBatchReport(importResult.batchId, 'success')}
              >
                <Icon name="download" size={15} /> Download Success Report (.xlsx)
              </button>
              {importResult.errors && importResult.errors.length > 0 && (
                <button
                  className="btn btn-danger"
                  onClick={() => handleDownloadBatchReport(importResult.batchId, 'errors')}
                >
                  <Icon name="alert" size={15} /> Download Error Report ({importResult.errors.length} items)
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ---------------- Step 5: Past Bulk Import History & Audit ---------------- */}
      <Card title="Bulk Import History & Audit Log" sub="Historical log of all Excel batch imports, records processed, and downloadable error reports." noPad>
        {loadingHistory ? (
          <ModernLoader text="Loading Import History..." sub="Fetching audit records from database" />
        ) : (
          <Table
            headers={['Batch ID', 'Date & Time', 'Uploaded By', 'Original Filename', 'Total', 'Complete', 'Partial', 'Skipped', 'Actions']}
            empty="No bulk imports recorded yet."
            rows={history.map((h) => [
              <strong>{h.batchId}</strong>,
              fmtDate(h.uploadDate),
              h.uploadedByName || h.uploadedBy || 'Super Admin',
              h.originalFilename || '—',
              h.totalRows || 0,
              <span style={{ color: '#15803d', fontWeight: 700 }}>{h.successfulCount || 0}</span>,
              <span style={{ color: '#c2410c', fontWeight: 700 }}>{h.partialCount || 0}</span>,
              <span style={{ color: '#dc2626', fontWeight: 700 }}>{h.skippedCount || 0}</span>,
              <div className="row-actions">
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => handleDownloadBatchReport(h.batchId, 'all')}
                  title="Download complete report spreadsheet"
                >
                  <Icon name="download" size={13} /> Report
                </button>
              </div>,
            ])}
          />
        )}
      </Card>
    </div>
  );
}
