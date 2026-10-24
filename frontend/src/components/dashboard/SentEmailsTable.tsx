'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { ExternalLink, Search, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { EmailJob, PaginatedResponse } from '@/types';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';

function SkeletonRow() {
  return (
    <tr>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} style={{ padding: '14px 16px' }}>
          <div className="skeleton" style={{ height: 14, width: i === 6 ? '40%' : '70%' }} />
        </td>
      ))}
    </tr>
  );
}

interface SentEmailsTableProps {
  refreshTrigger?: number;
}

export default function SentEmailsTable({ refreshTrigger }: SentEmailsTableProps) {
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const LIMIT = 10;
  const totalPages = Math.ceil(total / LIMIT);

  const fetchEmails = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        ...(search ? { search } : {}),
      });
      const res = await api.get<PaginatedResponse<EmailJob>>(
        `/api/emails/sent?${params}`
      );
      if (res.success) {
        setEmails(res.data);
        setTotal(res.total);
      }
    } catch {
      setEmails([]);
      setTotal(0);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const timeout = setTimeout(() => void fetchEmails(), 0);
    return () => clearTimeout(timeout);
  }, [fetchEmails, refreshTrigger]);

  useEffect(() => {
    const interval = setInterval(fetchEmails, 15000);
    return () => clearInterval(interval);
  }, [fetchEmails]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, flex: 1, maxWidth: 360 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="input-field"
              placeholder="Search sent emails..."
              style={{ paddingLeft: 34, fontSize: 13 }}
            />
          </div>
          <button type="submit" className="btn-secondary" style={{ padding: '8px 14px', fontSize: 13 }}>
            Search
          </button>
        </form>
        <button onClick={fetchEmails} className="btn-secondary" style={{ padding: '8px 12px' }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Table */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {isLoading ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Sender</th>
                <th>Sent At</th>
                <th>Status</th>
                <th>Preview</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        ) : loadError ? (
          <div role="alert" style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
            Could not load sent emails. Check your connection and try again.
          </div>
        ) : emails.length === 0 ? (
          <EmptyState
            title="No Sent Emails"
            description="Emails sent via your campaigns will appear here once they're delivered."
            icon="sent"
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Sender</th>
                <th>Sent At</th>
                <th>Status</th>
                <th>Preview</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => (
                <tr key={email.id}>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {email.recipientEmail}
                  </td>
                  <td style={{ maxWidth: 200 }}>
                    <p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email.subject}
                    </p>
                  </td>
                  <td>{email.senderEmail}</td>
                  <td>
                    {email.sentAt
                      ? format(new Date(email.sentAt), 'MMM d, yyyy HH:mm')
                      : '—'}
                  </td>
                  <td>
                    <StatusBadge status={email.status} />
                  </td>
                  <td>
                    {email.previewUrl ? (
                      <a
                        href={email.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: 'var(--accent)',
                          fontSize: 12,
                          fontWeight: 500,
                          textDecoration: 'none',
                        }}
                      >
                        <ExternalLink size={12} />
                        View
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary"
              style={{ padding: '6px 10px', opacity: page === 1 ? 0.4 : 1 }}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary"
              style={{ padding: '6px 10px', opacity: page === totalPages ? 0.4 : 1 }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
