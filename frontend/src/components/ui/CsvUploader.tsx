'use client';

import { useRef, useState } from 'react';
import { Upload, X, FileText, CheckCircle2 } from 'lucide-react';
import Papa from 'papaparse';

interface CsvUploaderProps {
  onEmailsParsed: (emails: string[]) => void;
}

function parseEmails(text: string): string[] {
  const addressPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i;
  const cells = Papa.parse<string[]>(text, { skipEmptyLines: true }).data.flat();
  const normalized = cells.flatMap((cell) => cell.trim().split(/[\s;]+/))
    .filter((token) => addressPattern.test(token))
    .map((address) => address.toLowerCase());
  return [...new Set(normalized)];
}

export default function CsvUploader({ onEmailsParsed }: CsvUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [emailCount, setEmailCount] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const emails = parseEmails(text);
      setEmailCount(emails.length);
      onEmailsParsed(emails);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const clear = () => {
    setFileName(null);
    setEmailCount(null);
    onEmailsParsed([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      {!fileName ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `1px dashed ${dragging ? 'var(--ink)' : 'var(--border-hover)'}`,
            borderRadius: 10,
            padding: '28px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            background: 'var(--bg-secondary)',
            transition: 'all 0.2s ease',
          }}
        >
          <Upload size={24} color="var(--text-muted)" style={{ margin: '0 auto 10px' }} />
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>
            Drop CSV / TXT file here or <span style={{ color: 'var(--accent)' }}>browse</span>
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Supports CSV, TXT files with email addresses
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 16px',
          }}
        >
          <FileText size={20} color="var(--accent)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileName}
            </p>
            {emailCount !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <CheckCircle2 size={13} color="var(--success)" />
                <p style={{ fontSize: 12, color: 'var(--success)' }}>
                  {emailCount} email{emailCount !== 1 ? 's' : ''} detected
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={clear}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
